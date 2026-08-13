const axios = require('axios');
const nodemailer = require('nodemailer');

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

// Termii expects Nigerian numbers as 234XXXXXXXXXX, not the local
// 0XXXXXXXXXX format students actually type in.
function toInternational(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('234')) return digits;
  if (digits.startsWith('0')) return '234' + digits.slice(1);
  return digits;
}

async function sendSms(to, message) {
  if (smsIsMock) {
    console.log(`[sms:mock] would text ${to}: "${message}"`);
    return { mocked: true };
  }

  await axios.post('https://api.ng.termii.com/api/sms/send', {
    api_key: process.env.TERMII_API_KEY,
    to: toInternational(to),
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

async function deliverVoucher({ contact, contactMethod, voucherCode, voucherPassword, tierLabel }) {
  const message =
    `Bel-Nebula: Your ${tierLabel} voucher — Username: ${voucherCode}, Password: ${voucherPassword}. ` +
    `Connect to the Bel-Nebula WiFi and enter these on the login page.`;

  if (contactMethod === 'sms') {
    return sendSms(contact, message);
  }
  return sendEmail(contact, 'Your Bel-Nebula WiFi voucher', message);
}

module.exports = { deliverVoucher, smsIsMock, emailIsMock };
