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
      connectionTimeout: config.smtpConnectionTimeoutMs,
      greetingTimeout: config.smtpConnectionTimeoutMs,
      socketTimeout: config.smtpSendTimeoutMs,
    });
  }
  return transporter;
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
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
    const info = await withTimeout(
      transport.sendMail(mail),
      config.smtpSendTimeoutMs,
      `SMTP timeout after ${config.smtpSendTimeoutMs}ms`
    );
    return {
      delivered: true,
      mode: 'smtp',
      messageId: info.messageId,
    };
  } catch (error) {
    console.error('[email] Ошибка отправки:', error.message);
    const isTimeout = /timeout/i.test(error.message);
    return {
      delivered: false,
      mode: 'smtp',
      reason: isTimeout ? 'smtp_timeout' : 'smtp_send_failed',
      error: error.message,
    };
  }
}

module.exports = {
  isEmailConfigured,
  sendEmail,
};
