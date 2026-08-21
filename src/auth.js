const config = require('./config');
const { getUserById, getUserByEmail } = require('./db');
const { verifySecret } = require('./password');
const { formatUserUploadInfo } = require('./uploadQuota');
const { isEmailConfigured } = require('./email');

function requireAdminAuth(req, res, next) {
  if (req.session?.adminAuth) {
    next();
    return;
  }
  res.status(401).json({ error: 'Требуется авторизация' });
}

function requireUserAuth(req, res, next) {
  if (req.session?.userId) {
    next();
    return;
  }
  res.status(401).json({ error: 'Требуется вход пользователя' });
}

function handleAdminLogin(req, res) {
  const { username, password } = req.body || {};

  if (username === config.loginUsername && password === config.loginPassword) {
    req.session.adminAuth = true;
    res.json({ ok: true });
    return;
  }

  res.status(401).json({ error: 'Неверный логин или пароль' });
}

function handleAdminLogout(req, res) {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
}

function handleAdminMe(req, res) {
  res.json({
    authenticated: Boolean(req.session?.adminAuth),
    smtpConfigured: isEmailConfigured(),
  });
}

function handleUserLogin(req, res) {
  const { email, password } = req.body || {};
  const user = getUserByEmail(String(email || '').trim().toLowerCase());

  if (!user || !verifySecret(password, user.password_hash)) {
    res.status(401).json({ error: 'Неверный email или пароль' });
    return;
  }

  req.session.userId = user.id;
  res.json({ ok: true, email: user.email });
}

function handleUserLogout(req, res) {
  delete req.session.userId;
  res.json({ ok: true });
}

function handleUserMe(req, res) {
  if (!req.session?.userId) {
    res.json({ user: null });
    return;
  }

  const user = getUserById(req.session.userId);
  if (!user) {
    delete req.session.userId;
    res.json({ user: null });
    return;
  }

  const fullUser = getUserByEmail(user.email);
  res.json({
    user: {
      email: user.email,
      upload: formatUserUploadInfo(fullUser),
    },
  });
}

module.exports = {
  requireAdminAuth,
  requireUserAuth,
  handleAdminLogin,
  handleAdminLogout,
  handleAdminMe,
  handleUserLogin,
  handleUserLogout,
  handleUserMe,
};
