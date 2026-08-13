const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const voucherService = require('../services/voucherService');
const paystackService = require('../services/paystackService');
const notifyService = require('../services/notifyService');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidContact(contact, method) {
  if (method === 'email') return EMAIL_RE.test(contact);
  if (method === 'sms') return String(contact).replace(/\D/g, '').length >= 10;
  return false;
}

// GET /api/tiers — packages + live stock, so the frontend can grey out
// (or hide) a tier that's sold out instead of taking payment for
// something it can't deliver.
router.get('/tiers', async (req, res) => {
  try {
    const stockRows = await voucherService.stock();
    const stockByTier = Object.fromEntries(stockRows.map((r) => [r.tier, Number(r.available)]));

    const tiers = voucherService.listTiers().map((t) => ({
      ...t,
      available: stockByTier[t.tier] ?? 0,
    }));

    res.json({ tiers });
  } catch (err) {
    console.error('[tiers]', err.message);
    res.status(500).json({ error: 'Could not load packages.' });
  }
});

// POST /api/payment/initialize
// body: { tierId, contact, contactMethod }
router.post('/payment/initialize', async (req, res) => {
  try {
    const { tierId, contact, contactMethod } = req.body;

    const tier = voucherService.getTier(tierId);
    if (!tier) return res.status(400).json({ error: 'Unknown package selected.' });

    if (!['email', 'sms'].includes(contactMethod)) {
      return res.status(400).json({ error: 'Choose email or phone for delivery.' });
    }
    if (!isValidContact(contact, contactMethod)) {
      return res.status(400).json({
        error: contactMethod === 'email' ? 'Enter a valid email address.' : 'Enter a valid phone number.',
      });
    }

    // Fail fast if this tier is already sold out, rather than taking
    // money we can't fulfil. There's still a narrow window where stock
    // could run out between this check and payment completing seconds
    // later — that's handled separately, see fulfil() below.
    const stockRows = await voucherService.stock();
    const available = stockRows.find((r) => r.tier === tier.tier);
    if (!available || Number(available.available) === 0) {
      return res.status(409).json({ error: `${tier.label} vouchers are sold out right now.` });
    }

    const reference = `BN-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const amountKobo = tier.priceNaira * 100;

  // Paystack requires an email even for SMS-delivery buyers. Use a
    // domain we actually control, since Paystack rejects made-up
    // top-level domains like ".customer" as invalid.
    const cleanPhone = String(contact).replace(/\D/g, '');
    const billingEmail =
      contactMethod === 'email' ? contact : `${cleanPhone}@belnebula-frontend.vercel.app`;

    const tx = await paystackService.initializeTransaction({
      email: billingEmail,
      amountKobo,
      reference,
      metadata: { tierId, contact, contactMethod },
    });

    await pool.query(
      `INSERT INTO transactions (reference, tier, amount_kobo, contact, contact_method)
       VALUES ($1, $2, $3, $4, $5)`,
      [reference, tier.tier, amountKobo, contact, contactMethod]
    );

    res.json({
      reference,
      accessCode: tx.access_code,
      publicKey: process.env.PAYSTACK_PUBLIC_KEY,
      amountNaira: tier.priceNaira,
    });
  } catch (err) {
    console.error('[payment/initialize]', err.response?.data || err.message);
    res.status(500).json({ error: 'Could not start payment. Please try again.' });
  }
});

/**
 * Does the actual "payment confirmed -> hand over a voucher" work.
 * Shared by both the frontend's /verify call and the Paystack webhook,
 * so whichever fires first wins and the second is a safe no-op — neither
 * one can claim two vouchers for the same payment.
 */
async function fulfil(reference) {
  const { rows } = await pool.query('SELECT * FROM transactions WHERE reference = $1', [reference]);
  const txRow = rows[0];
  if (!txRow) throw new Error(`No transaction found for reference ${reference}`);

 if (txRow.status === 'fulfilled') {
    return {
      status: 'fulfilled',
      voucherCode: txRow.voucher_code,
      voucherPassword: txRow.voucher_password,
      tier: txRow.tier,
    };
  }

  const verified = await paystackService.verifyTransaction(reference);
  if (verified.status !== 'success') {
    throw new Error(`Payment not successful (status: ${verified.status})`);
  }
  if (Number(verified.amount) !== Number(txRow.amount_kobo)) {
    throw new Error('Paid amount does not match package price.');
  }

  if (txRow.status !== 'paid_awaiting_voucher') {
    await pool.query(`UPDATE transactions SET paid_at = now() WHERE reference = $1`, [reference]);
  }

  const claimed = await voucherService.claimVoucher({
    tier: txRow.tier,
    reference,
    contact: txRow.contact,
  });

  if (!claimed) {
    // Money is in the account and there is no voucher left to give —
    // this must never fail silently. Flag it loudly and leave the
    // transaction in a state an admin can resolve as soon as more
    // vouchers are imported (see routes/admin.js).
    await pool.query(
      `UPDATE transactions SET status = 'paid_awaiting_voucher' WHERE reference = $1`,
      [reference]
    );
    console.error(
      `[ALERT] Paid but no ${txRow.tier} voucher available — reference ${reference}, ` +
        `contact ${txRow.contact}. Import more vouchers, then call ` +
        `POST /api/admin/resolve-pending with this reference.`
    );
    return { status: 'paid_awaiting_voucher', tier: txRow.tier };
  }

 await pool.query(
    `UPDATE transactions
       SET status = 'fulfilled', voucher_code = $1, voucher_password = $2, fulfilled_at = now()
     WHERE reference = $3`,
    [claimed.code, claimed.password, reference]
  );

  // TIERS is keyed by the same string as the tier enum (e.g. "hourly"),
  // so txRow.tier doubles as the lookup key.
  const tierInfo = voucherService.getTier(txRow.tier);

  await notifyService
    .deliverVoucher({
      contact: txRow.contact,
      contactMethod: txRow.contact_method,
   voucherCode: claimed.code,
      voucherPassword: claimed.password,
      tierLabel: tierInfo?.label || txRow.tier,
    })
    .catch((err) => console.error(`[notify] delivery failed for ${reference}:`, err.message));

return {
    status: 'fulfilled',
    voucherCode: claimed.code,
    voucherPassword: claimed.password,
    tier: txRow.tier,
  };
}

// POST /api/payment/verify — called by the frontend right after the
// Paystack popup reports success, so we can hand back the voucher
// immediately without waiting on the webhook round trip.
router.post('/payment/verify', async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'Reference is required.' });

    const result = await fulfil(reference);

    if (result.status === 'paid_awaiting_voucher') {
      return res.status(202).json({
        status: 'paid_awaiting_voucher',
        message:
          "Payment received, but we're out of stock for that package right now. " +
          "We'll deliver your voucher as soon as we top up — keep an eye on your inbox/SMS.",
      });
    }

  res.json({
      status: 'fulfilled',
      voucherCode: result.voucherCode,
      voucherPassword: result.voucherPassword,
      tier: result.tier,
    });
  } catch (err) {
    console.error('[payment/verify]', err.message);
    res.status(400).json({ error: err.message || 'Could not verify payment.' });
  }
});

// POST /api/webhook/paystack — the trustworthy server-to-server path.
// Configure this URL in the Paystack dashboard. Signature check stops
// anyone but Paystack from triggering a fake "payment succeeded" call.
router.post('/webhook/paystack', async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const expected = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(req.rawBody)
      .digest('hex');

    if (signature !== expected) return res.status(401).end();

    const event = req.body;
    if (event.event === 'charge.success') {
      await fulfil(event.data.reference).catch((err) =>
        console.error('[webhook] fulfil error:', err.message)
      );
    }

    res.sendStatus(200); // ack quickly so Paystack doesn't retry forever
  } catch (err) {
    console.error('[webhook]', err.message);
    res.sendStatus(200);
  }
});

module.exports = { router, fulfil };
