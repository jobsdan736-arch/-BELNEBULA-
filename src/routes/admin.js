const express = require('express');
const pool = require('../db/pool');
const voucherService = require('../services/voucherService');
const { VALID_TIERS, parseVoucherText, importCodes } = require('../services/voucherImportService');

const router = express.Router();

// Every route here requires a shared secret header — this is a small
// operational tool for you, not something meant to be public.
router.use((req, res, next) => {
  const secret = req.headers['x-admin-secret'];
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// GET /api/admin/stock — how many vouchers are left per tier.
router.get('/stock', async (req, res) => {
  const stock = await voucherService.stock();
  res.json({ stock });
});

// GET /api/admin/pending — transactions that were paid but couldn't be
// fulfilled because a tier sold out mid-purchase. Check this after
// importing fresh vouchers.
router.get('/pending', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT reference, tier, contact, contact_method, created_at
     FROM transactions WHERE status = 'paid_awaiting_voucher'
     ORDER BY created_at ASC`
  );
  res.json({ pending: rows });
});

// POST /api/admin/resolve-pending  { reference }
// Re-runs fulfilment for a single stuck transaction — call this once
// you've imported more vouchers for that tier.
router.post('/resolve-pending', async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'reference is required' });

    // Requiring here (not at module top) avoids a circular require, since
    // payment.js's fulfil() doesn't need anything from this file.
    const { fulfil } = require('./payment');
    const result = await fulfil(reference);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/import-vouchers  { tier, csv }
// `csv` is the raw text content of a Mikhmon-exported voucher file — the
// admin GUI reads the chosen file in the browser and posts its text
// here directly, no file storage needed on either end.
router.post('/import-vouchers', async (req, res) => {
  try {
    const { tier, csv } = req.body;
    if (!tier || !VALID_TIERS.includes(tier)) {
      return res.status(400).json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` });
    }
    if (!csv || typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ error: 'csv (file contents) is required' });
    }

    const codes = parseVoucherText(csv);
    if (codes.length === 0) {
      return res.status(400).json({ error: 'No voucher codes found in that file.' });
    }

    const result = await importCodes({ tier, codes });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
