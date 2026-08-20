const nodemailer = require('nodemailer');
const config = require('./config');

let transporter = null;

function isEmailConfigured() {
  return Boolean(config.smtpHost);
}

function getTransporter() {
  if (!isEmailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    });
  }
  return transporter;
}

async function sendEmail({ to, subject, text, html }) {
  const mail = {
    from: config.smtpFrom,
    to,
    subject,
    text,
    html: html || text,
  };

  const transport = getTransporter();
  if (!transport) {
    console.log('[email:dev] To:', to);
    console.log('[email:dev] Subject:', subject);
    console.log('[email:dev] Body:', text);
    return { dev: true };
  }

  await transport.sendMail(mail);
  return { sent: true };
}

module.exports = {
  isEmailConfigured,
  sendEmail,
};
