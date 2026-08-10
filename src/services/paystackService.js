const axios = require('axios');

const client = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
});

/**
 * Starts a transaction and returns Paystack's access_code, which the
 * frontend feeds into the Paystack Inline popup. Amount must be in kobo.
 */
async function initializeTransaction({ email, amountKobo, reference, metadata }) {
  const { data } = await client.post('/transaction/initialize', {
    email,
    amount: amountKobo,
    reference,
    metadata,
  });
  return data.data; // { authorization_url, access_code, reference }
}

/**
 * Confirms a transaction really succeeded. Never trust the frontend's word
 * for this — always re-check with Paystack before handing out a voucher.
 */
async function verifyTransaction(reference) {
  const { data } = await client.get(`/transaction/verify/${encodeURIComponent(reference)}`);
  return data.data; // { status, amount, metadata, ... }
}

module.exports = { initializeTransaction, verifyTransaction };
