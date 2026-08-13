const pool = require('../db/pool');

const VALID_TIERS = ['hourly', 'daily', 'weekly', 'monthly'];

/**
 * Parses a CSV with "username" and "password" columns (used when each
 * voucher has a different login and password), a CSV with just
 * "username"/"code" (username and password are the same), or a plain
 * one-code-per-line file with no header. Returns { username, password }
 * objects.
 */
function parseVoucherText(text) {
  const lines = text.split(/\r?\n/);
  let headerCols = null;
  let isFirstLine = true;
  const vouchers = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (isFirstLine) {
      isFirstLine = false;
      const lower = line.toLowerCase();
      if (lower.includes('username') || lower.includes('code') || lower.includes('password')) {
        headerCols = lower.split(',').map((c) => c.trim());
        continue;
      }
    }

    if (!headerCols) {
      vouchers.push({ username: line, password: line });
      continue;
    }

    const cols = line.split(',').map((c) => c.trim());
    const userIdx =
      headerCols.indexOf('username') !== -1 ? headerCols.indexOf('username') : headerCols.indexOf('code');
    const passIdx = headerCols.indexOf('password');

    const username = userIdx === -1 ? cols[0] : cols[userIdx];
    const password = passIdx === -1 ? username : cols[passIdx];

    if (username) vouchers.push({ username, password });
  }

  return vouchers;
}

async function importCodes({ tier, codes }) {
  if (!VALID_TIERS.includes(tier)) {
    throw new Error(`Unknown tier "${tier}". Must be one of: ${VALID_TIERS.join(', ')}`);
  }

  let inserted = 0;
  for (const v of codes) {
    const result = await pool.query(
      `INSERT INTO vouchers (code, password, tier) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
      [v.username, v.password, tier]
    );
    inserted += result.rowCount;
  }

  return { total: codes.length, inserted, duplicates: codes.length - inserted };
}

module.exports = { VALID_TIERS, parseVoucherText, importCodes };
