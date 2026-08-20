const crypto = require('crypto');
const config = require('./config');
const {
  createUser,
  updateUserPassword,
  createToken,
  getToken,
  markTokenUsed,
  getUserByEmail,
} = require('./db');
const { hashSecret, verifySecret } = require('./password');
const { sendEmail } = require('./email');
const {
  normalizeEmail,
  validateEmailFormat,
} = require('./access');
const { requireUserAuth } = require('./auth');

const TOKEN_BYTES = 32;
const REGISTRATION_TOKEN_HOURS = 24;
const RESET_TOKEN_HOURS = 1;

function generateTokenValue() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function tokenExpiresAt(hours) {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function sendRegistrationInvite(email, shortName) {
  const token = generateTokenValue();
  createToken({
    token,
    type: 'register',
    email: normalizeEmail(email),
    shortName: shortName || null,
    expiresAt: tokenExpiresAt(REGISTRATION_TOKEN_HOURS),
  });

  const registerUrl = `${config.baseUrl}/register.html?token=${encodeURIComponent(token)}`;
  const text = [
    'Вам открыт доступ к файлу на Share Server.',
    '',
    `Зарегистрируйтесь по ссылке: ${registerUrl}`,
    '',
    'Ссылка действует 24 часа.',
  ].join('\n');

  await sendEmail({
    to: email,
    subject: 'Регистрация для доступа к файлу',
    text,
  });
}

async function sendPasswordResetEmail(email) {
  const normalized = normalizeEmail(email);
  const user = getUserByEmail(normalized);
  if (!user) {
    return { sent: false, reason: 'not_found' };
  }

  const token = generateTokenValue();
  createToken({
    token,
    type: 'reset',
    email: normalized,
    shortName: null,
    expiresAt: tokenExpiresAt(RESET_TOKEN_HOURS),
  });

  const resetUrl = `${config.baseUrl}/reset-password.html?token=${encodeURIComponent(token)}`;
  const text = [
    'Запрос на сброс пароля Share Server.',
    '',
    `Ссылка для сброса: ${resetUrl}`,
    '',
    'Ссылка действует 1 час. Если вы не запрашивали сброс — проигнорируйте письмо.',
  ].join('\n');

  await sendEmail({
    to: normalized,
    subject: 'Сброс пароля Share Server',
    text,
  });

  return { sent: true };
}

function handleRegister(req, res) {
  const { token, password } = req.body || {};

  if (!token || !password || String(password).length < 6) {
    res.status(400).json({ error: 'Укажите токен и пароль (минимум 6 символов)' });
    return;
  }

  const tokenRow = getToken(token);
  if (!tokenRow || tokenRow.type !== 'register' || tokenRow.used_at) {
    res.status(400).json({ error: 'Ссылка регистрации недействительна' });
    return;
  }

  if (new Date(tokenRow.expires_at) <= new Date()) {
    res.status(400).json({ error: 'Ссылка регистрации истекла' });
    return;
  }

  if (getUserByEmail(tokenRow.email)) {
    res.status(409).json({ error: 'Пользователь уже зарегистрирован' });
    return;
  }

  const userId = createUser(tokenRow.email, hashSecret(password));
  markTokenUsed(token);
  req.session.userId = userId;

  res.json({
    ok: true,
    email: tokenRow.email,
    shortName: tokenRow.short_name,
  });
}

function handleChangePassword(req, res) {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword || String(newPassword).length < 6) {
    res.status(400).json({ error: 'Новый пароль должен быть не короче 6 символов' });
    return;
  }

  const user = require('./db').getUserById(req.session.userId);
  if (!user) {
    res.status(401).json({ error: 'Требуется вход пользователя' });
    return;
  }

  const userWithPassword = getUserByEmail(user.email);
  if (!userWithPassword || !verifySecret(currentPassword, userWithPassword.password_hash)) {
    res.status(401).json({ error: 'Неверный текущий пароль' });
    return;
  }

  updateUserPassword(user.id, hashSecret(newPassword));
  res.json({ ok: true });
}

async function handleForgotPassword(req, res) {
  const emailError = validateEmailFormat(req.body?.email);
  if (emailError) {
    res.status(400).json({ error: emailError });
    return;
  }

  const normalized = normalizeEmail(req.body.email);
  const result = await sendPasswordResetEmail(normalized);

  if (!result.sent) {
    res.json({
      ok: true,
      message: 'Если email зарегистрирован, письмо будет отправлено',
    });
    return;
  }

  res.json({
    ok: true,
    message: 'Ссылка для сброса пароля отправлена на email',
  });
}

function handleResetPassword(req, res) {
  const { token, password } = req.body || {};

  if (!token || !password || String(password).length < 6) {
    res.status(400).json({ error: 'Укажите токен и пароль (минимум 6 символов)' });
    return;
  }

  const tokenRow = getToken(token);
  if (!tokenRow || tokenRow.type !== 'reset' || tokenRow.used_at) {
    res.status(400).json({ error: 'Ссылка сброса недействительна' });
    return;
  }

  if (new Date(tokenRow.expires_at) <= new Date()) {
    res.status(400).json({ error: 'Ссылка сброса истекла' });
    return;
  }

  const user = getUserByEmail(tokenRow.email);
  if (!user) {
    res.status(400).json({ error: 'Пользователь не найден' });
    return;
  }

  updateUserPassword(user.id, hashSecret(password));
  markTokenUsed(token);
  req.session.userId = user.id;

  res.json({ ok: true, email: user.email });
}

function handleRegisterInfo(req, res) {
  const tokenRow = getToken(req.query.token);
  if (!tokenRow || tokenRow.type !== 'register' || tokenRow.used_at) {
    res.status(400).json({ error: 'Ссылка регистрации недействительна' });
    return;
  }

  if (new Date(tokenRow.expires_at) <= new Date()) {
    res.status(400).json({ error: 'Ссылка регистрации истекла' });
    return;
  }

  res.json({
    email: tokenRow.email,
    shortName: tokenRow.short_name,
    valid: true,
  });
}

function handleResetInfo(req, res) {
  const tokenRow = getToken(req.query.token);
  if (!tokenRow || tokenRow.type !== 'reset' || tokenRow.used_at) {
    res.status(400).json({ error: 'Ссылка сброса недействительна' });
    return;
  }

  if (new Date(tokenRow.expires_at) <= new Date()) {
    res.status(400).json({ error: 'Ссылка сброса истекла' });
    return;
  }

  res.json({
    email: tokenRow.email,
    valid: true,
  });
}

module.exports = {
  sendRegistrationInvite,
  sendPasswordResetEmail,
  handleRegister,
  handleChangePassword,
  handleForgotPassword,
  handleResetPassword,
  handleRegisterInfo,
  handleResetInfo,
  requireUserAuth,
};
