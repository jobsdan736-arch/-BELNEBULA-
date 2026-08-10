/**
 * Imports a CSV of Mikhmon-generated voucher codes into the vouchers
 * table, tagged with a tier.
 *
 * Usage:
 *   node scripts/importVouchers.js --file ./hourly-batch.csv --tier hourly
 *
 * You usually won't need this if you're using the admin GUI's Import
 * Vouchers page instead — this is here as a scriptable alternative.
 */
require('dotenv').config();
const fs = require('fs');
const { parseVoucherText, importCodes } = require('../src/services/voucherImportService');
const pool = require('../src/db/pool');

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg, i, arr) => {
    if (arg === '--file') args.file = arr[i + 1];
    if (arg === '--tier') args.tier = arr[i + 1];
  });
  return args;
}

async function main() {
  const { file, tier } = parseArgs();

  if (!file || !tier) {
    console.error('Usage: node scripts/importVouchers.js --file <path.csv> --tier <hourly|daily|weekly|monthly>');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const text = fs.readFileSync(file, 'utf8');
  const codes = parseVoucherText(text);
  console.log(`Parsed ${codes.length} voucher codes from ${file}. Importing as tier "${tier}"...`);

  const result = await importCodes({ tier, codes });
  console.log(`Done. Inserted ${result.inserted} new vouchers (${result.duplicates} were already in the database).`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
