const pool = require('../db/pool');

/**
 * Source of truth for pricing. `tier` must match the Postgres enum value
 * (voucher_tier) and the tier names you use when importing CSVs with
 * scripts/importVouchers.js.
 */
const TIERS = {
  hourly: { tier: 'hourly', label: '3 Hours', description: 'Quick session', priceNaira: 250 },
  daily: { tier: 'daily', label: '24 Hours', description: 'Unlimited for a full day', priceNaira: 500 },
  weekly: { tier: 'weekly', label: '1 Week', description: 'Unlimited for 7 days', priceNaira: 3000 },
  monthly: { tier: 'monthly', label: '1 Month', description: 'Unlimited for 30 days', priceNaira: 15000 },
};

function getTier(tierId) {
  return TIERS[tierId] || null;
}

function listTiers() {
  return Object.values(TIERS);
}

async function stock() {
  const { rows } = await pool.query('SELECT * FROM voucher_stock');
  return rows;
}

/**
 * Claims exactly one available voucher of the given tier and hands it to
 * `contact`, atomically. This is the piece that has to be race-condition
 * safe: two students paying for the last "hourly" voucher at the same
 * second must never both get told they got it.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes that safe — it locks the one row
 * it picks, and any concurrent call skips past rows another transaction
 * already has locked instead of blocking on them. Combined with wrapping
 * the whole thing in a single UPDATE ... WHERE id = (SELECT ...), the
 * pick-and-claim happens as one atomic operation with no gap a second
 * request could slip into.
 *
 * Returns the claimed voucher row, or null if the tier is sold out.
 */
async function claimVoucher({ tier, reference, contact }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE vouchers
         SET status = 'assigned',
             assigned_to = $1,
             assigned_at = now(),
             transaction_reference = $2
       WHERE id = (
         SELECT id FROM vouchers
         WHERE tier = $3 AND status = 'available'
         ORDER BY id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING code, id`,
      [contact, reference, tier]
    );

    await client.query('COMMIT');
    return rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { TIERS, getTier, listTiers, stock, claimVoucher };
