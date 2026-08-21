const nodemailer = require('nodemailer');
const config = require('./config');

let transporter = null;

function isEmailConfigured() {
  return Boolean(config.smtpHost && String(config.smtpHost).trim());
}

function getTransporter() {
  if (!isEmailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: config.smtpUser
        ? { user: config.smtpUser, pass: config.smtpPass }
        : undefined,
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
    console.warn('[email] SMTP не настроен — письмо не отправлено');
    console.log('[email:dev] To:', to);
    console.log('[email:dev] Subject:', subject);
    console.log('[email:dev] Body:', text);
    return {
      delivered: false,
      mode: 'console',
      reason: 'smtp_not_configured',
    };
  }

  try {
    const info = await transport.sendMail(mail);
    return {
      delivered: true,
      mode: 'smtp',
      messageId: info.messageId,
    };
  } catch (error) {
    console.error('[email] Ошибка отправки:', error.message);
    return {
      delivered: false,
      mode: 'smtp',
      reason: 'smtp_send_failed',
      error: error.message,
    };
  }
}

module.exports = {
  isEmailConfigured,
  sendEmail,
};
