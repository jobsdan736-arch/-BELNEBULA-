require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { router: paymentRoutes } = require('./src/routes/payment');
const adminRoutes = require('./src/routes/admin');
const voucherService = require('./src/services/voucherService');
const notifyService = require('./src/services/notifyService');

const app = express();

app.use(cors());
app.use(morgan('tiny'));

// Capture the raw request body (needed to verify the Paystack webhook
// signature) while still parsing JSON for every route.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get('/api/health', async (req, res) => {
  try {
    const stock = await voucherService.stock();
    res.json({
      ok: true,
      smsMockMode: notifyService.smsIsMock,
      emailMockMode: notifyService.emailIsMock,
      stock,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use('/api', paymentRoutes);
app.use('/api/admin', adminRoutes);

// Fallback error handler so unexpected exceptions return JSON, not an
// HTML stack trace, to a phone browser.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Bel-Nebula backend listening on port ${PORT}`);
  if (notifyService.smsIsMock) console.log('SMS delivery is in MOCK MODE — set TERMII_API_KEY to send real texts.');
  if (notifyService.emailIsMock) console.log('Email delivery is in MOCK MODE — set SMTP_HOST to send real emails.');
});
