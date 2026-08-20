const config = require('./config');

function requireAuth(req, res, next) {
  if (req.session?.authenticated) {
    next();
    return;
  }
  res.status(401).json({ error: 'Требуется авторизация' });
}

function handleLogin(req, res) {
  const { username, password } = req.body || {};

  if (username === config.loginUsername && password === config.loginPassword) {
    req.session.authenticated = true;
    res.json({ ok: true });
    return;
  }

  res.status(401).json({ error: 'Неверный логин или пароль' });
}

function handleLogout(req, res) {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
}

function handleMe(req, res) {
  res.json({ authenticated: Boolean(req.session?.authenticated) });
}

module.exports = {
  requireAuth,
  handleLogin,
  handleLogout,
  handleMe,
};
