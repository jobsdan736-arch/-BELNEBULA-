const pool = require('../db/pool');

const VALID_TIERS = ['hourly', 'daily', 'weekly', 'monthly'];

function extractCode(line, headerCols) {
  if (!headerCols) return line.trim();

  const cols = line.split(',').map((c) => c.trim());
  const idx =
    headerCols.indexOf('username') !== -1
      ? headerCols.indexOf('username')
      : headerCols.indexOf('code');
  return idx === -1 ? cols[0] : cols[idx];
}

/**
 * Parses either Mikhmon's own CSV export (a header row containing
 * "username"/"code"/"password") or a plain one-code-per-line file.
 * Returns an array of voucher code strings.
 */
function parseVoucherText(text) {
  const lines = text.split(/\r?\n/);
  let headerCols = null;
  let isFirstLine = true;
  const codes = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (isFirstLine) {
      isFirstLine = false;
      const lower = line.toLowerCase();
      if (lower.includes('username') || lower.includes('code') || lower.includes('password')) {
        headerCols = lower.split(',').map((c) => c.trim());
        continue; // this line was a header, not a code
      }
    }

    const code = extractCode(line, headerCols);
    if (code) codes.push(code);
  }

  return codes;
}

/**
 * Inserts a batch of voucher codes for a tier. Duplicate codes (e.g. the
 * same file imported twice) are silently skipped rather than erroring,
 * so it's always safe to re-run an import.
 */
async function importCodes({ tier, codes }) {
  if (!VALID_TIERS.includes(tier)) {
    throw new Error(`Unknown tier "${tier}". Must be one of: ${VALID_TIERS.join(', ')}`);
  }

  let inserted = 0;
  for (const code of codes) {
    const result = await pool.query(
      `INSERT INTO vouchers (code, tier) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
      [code, tier]
    );
    inserted += result.rowCount;
  }

  return { total: codes.length, inserted, duplicates: codes.length - inserted };
}

module.exports = { VALID_TIERS, parseVoucherText, importCodes };
