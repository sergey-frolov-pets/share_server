const fs = require('fs');
const path = require('path');
const {
  getFileByShortName,
  incrementDownloadCount,
  getUserById,
  getUserByEmail,
} = require('./db');
const { verifySecret } = require('./password');
const {
  fileHasAccessRestrictions,
  fileHasDownloadPassword,
  fileHasGates,
  isEmailAllowedForFile,
  validateEmailFormat,
  normalizeEmail,
  isUserRegistered,
} = require('./access');
const { sendRegistrationInvite } = require('./users');

const DOWNLOAD_GRANT_TTL_MS = 5 * 60 * 1000;

function isFileAvailable(file) {
  if (!file) return false;
  const expired = new Date(file.expires_at) <= new Date();
  const exhausted = file.download_count >= file.max_downloads;
  return !expired && !exhausted;
}

function ensureDownloadGrants(req) {
  if (!req.session.downloadGrants) {
    req.session.downloadGrants = {};
  }
  return req.session.downloadGrants;
}

function grantDownload(req, shortName) {
  const grants = ensureDownloadGrants(req);
  grants[shortName] = Date.now();
}

function hasDownloadGrant(req, shortName) {
  const grants = req.session.downloadGrants || {};
  const grantedAt = grants[shortName];
  if (!grantedAt) return false;
  if (Date.now() - grantedAt > DOWNLOAD_GRANT_TTL_MS) {
    delete grants[shortName];
    return false;
  }
  return true;
}

function getSessionUserEmail(req) {
  if (!req.session?.userId) return null;
  const user = getUserById(req.session.userId);
  return user?.email || null;
}

function buildFileInfo(file) {
  return {
    shortName: file.short_name,
    originalName: file.original_name,
    maxDownloads: file.max_downloads,
    downloadCount: file.download_count,
    expiresAt: file.expires_at,
    available: isFileAvailable(file),
    requiresDownloadPassword: fileHasDownloadPassword(file),
    requiresAccess: fileHasAccessRestrictions(file),
    hasGates: fileHasGates(file),
  };
}

function handleFileInfo(req, res) {
  const file = getFileByShortName(req.params.name);
  if (!file) {
    res.status(404).json({ error: 'Файл не найден' });
    return;
  }

  res.json({
    ...buildFileInfo(file),
    userEmail: getSessionUserEmail(req),
  });
}

async function resolveAccessEmail(req, body) {
  const sessionEmail = getSessionUserEmail(req);
  const bodyEmail = body?.email ? normalizeEmail(body.email) : null;

  if (sessionEmail) {
    return { email: sessionEmail, fromSession: true };
  }

  const emailError = validateEmailFormat(bodyEmail);
  if (emailError) {
    return { error: emailError };
  }

  return { email: bodyEmail, fromSession: false };
}

async function handleAuthorizeDownload(req, res) {
  const shortName = req.params.name;
  const file = getFileByShortName(shortName);

  if (!file) {
    res.status(404).json({ error: 'Файл не найден' });
    return;
  }

  if (!isFileAvailable(file)) {
    res.status(403).json({ error: 'Файл недоступен' });
    return;
  }

  const { downloadPassword, password } = req.body || {};

  if (fileHasDownloadPassword(file)) {
    if (!downloadPassword || !verifySecret(downloadPassword, file.download_password_hash)) {
      res.status(403).json({ error: 'Неверный пароль для скачивания' });
      return;
    }
  }

  if (fileHasAccessRestrictions(file)) {
    const access = await resolveAccessEmail(req, req.body);
    if (access.error) {
      res.status(400).json({ error: access.error });
      return;
    }

    if (!isEmailAllowedForFile(access.email, file)) {
      res.status(403).json({ error: 'Этот email не имеет доступа к файлу' });
      return;
    }

    if (!access.fromSession) {
      if (isUserRegistered(access.email)) {
        if (!password) {
          res.status(401).json({
            error: 'Войдите с паролем или используйте уже выполненный вход',
            needsLogin: true,
          });
          return;
        }

        const registeredUser = getUserByEmail(access.email);
        if (!registeredUser || !verifySecret(password, registeredUser.password_hash)) {
          res.status(401).json({ error: 'Неверный email или пароль', needsLogin: true });
          return;
        }

        req.session.userId = registeredUser.id;
      } else {
        await sendRegistrationInvite(access.email, shortName);
        res.json({
          ok: false,
          registrationSent: true,
          message: 'На email отправлена ссылка для регистрации. После регистрации скачайте файл снова.',
        });
        return;
      }
    } else if (!isEmailAllowedForFile(access.email, file)) {
      res.status(403).json({ error: 'Ваш аккаунт не имеет доступа к этому файлу' });
      return;
    }
  }

  grantDownload(req, shortName);
  res.json({ ok: true, authorized: true });
}

function handleDownloadFile(req, res) {
  const shortName = req.params.name;
  const file = getFileByShortName(shortName);

  if (!file) {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
    return;
  }

  if (!isFileAvailable(file)) {
    if (file.download_count >= file.max_downloads) {
      res.status(403).sendFile(path.join(__dirname, '..', 'public', 'limit.html'));
      return;
    }
    res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
    return;
  }

  if (fileHasGates(file) && !hasDownloadGrant(req, shortName)) {
    res.status(403).json({ error: 'Сначала пройдите проверку доступа' });
    return;
  }

  if (!fs.existsSync(file.stored_path)) {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
    return;
  }

  incrementDownloadCount(file.id);
  delete ensureDownloadGrants(req)[shortName];

  res.download(file.stored_path, file.original_name);
}

function shouldServeDownloadPage(file) {
  return fileHasGates(file);
}

module.exports = {
  buildFileInfo,
  handleFileInfo,
  handleAuthorizeDownload,
  handleDownloadFile,
  shouldServeDownloadPage,
  isFileAvailable,
  fileHasGates,
};
