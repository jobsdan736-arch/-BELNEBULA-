const axios = require('axios');
const nodemailer = require('nodemailer');

/**
 * MOCK MODE: if the relevant provider keys aren't set, delivery is logged
 * to the console instead of actually sent. That lets you test the full
 * payment -> voucher flow before Termii/SMTP credentials exist, the same
 * way MikroTik mock mode worked in the earlier build.
 */
const smsIsMock = !process.env.TERMII_API_KEY;
const emailIsMock = !process.env.SMTP_HOST;

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

async function sendSms(to, message) {
  if (smsIsMock) {
    console.log(`[sms:mock] would text ${to}: "${message}"`);
    return { mocked: true };
  }

  await axios.post('https://api.ng.termii.com/api/sms/send', {
    api_key: process.env.TERMII_API_KEY,
    to,
    from: process.env.TERMII_SENDER_ID || 'BelNebula',
    sms: message,
    type: 'plain',
    channel: 'generic',
  });
  return { mocked: false };
}

async function sendEmail(to, subject, message) {
  if (emailIsMock) {
    console.log(`[email:mock] would email ${to} — "${subject}": "${message}"`);
    return { mocked: true };
  }

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM || 'Bel-Nebula <no-reply@bel-nebula.vercel.app>',
    to,
    subject,
    text: message,
  });
  return { mocked: false };
}

/**
 * Sends a voucher to the buyer via whichever contact method they chose
 * at checkout.
 */
async function deliverVoucher({ contact, contactMethod, voucherCode, tierLabel }) {
  const message =
    `Bel-Nebula: Your ${tierLabel} voucher is ${voucherCode}. ` +
    `Connect to the Bel-Nebula WiFi and enter this as both username and password to log in.`;

  if (contactMethod === 'sms') {
    return sendSms(contact, message);
  }
  return sendEmail(contact, 'Your Bel-Nebula WiFi voucher', message);
}

module.exports = { deliverVoucher, smsIsMock, emailIsMock };
