const fs = require('fs');
const path = require('path');
const {
  getLinkWithFile,
  incrementLinkDownloadCount,
  incrementStoredFileDownloadCount,
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
const {
  isLinkAvailable,
  isLinkExhausted,
  isStoredFileAvailable,
} = require('./limits');

const DOWNLOAD_GRANT_TTL_MS = 5 * 60 * 1000;

function isDownloadAllowed(row) {
  if (!row) return false;
  if (!isStoredFileAvailable(row)) return false;
  if (!fs.existsSync(row.stored_path)) return false;
  return isLinkAvailable(row);
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

function buildFileInfo(row) {
  return {
    shortName: row.short_name,
    originalName: row.original_name,
    linkMaxDownloads: row.link_max_downloads,
    linkDownloadCount: row.link_download_count,
    linkExpiresAt: row.link_expires_at,
    fileMaxDownloads: row.delete_max_downloads,
    fileDownloadCount: row.total_download_count,
    fileDeleteAt: row.delete_at,
    available: isDownloadAllowed(row),
    linkAvailable: isLinkAvailable(row),
    description: row.description || null,
    requiresDownloadPassword: fileHasDownloadPassword(row),
    requiresAccess: fileHasAccessRestrictions(row),
    hasGates: fileHasGates(row),
  };
}

function handleFileInfo(req, res) {
  const row = getLinkWithFile(req.params.name);
  if (!row) {
    res.status(404).json({ error: 'Файл не найден' });
    return;
  }

  res.json({
    ...buildFileInfo(row),
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
  const row = getLinkWithFile(shortName);

  if (!row) {
    res.status(404).json({ error: 'Файл не найден' });
    return;
  }

  if (!isStoredFileAvailable(row) || !fs.existsSync(row.stored_path)) {
    res.status(404).json({ error: 'Файл удалён с сервера' });
    return;
  }

  if (!isLinkAvailable(row)) {
    res.status(403).json({ error: 'Ссылка недоступна (лимит или срок истёк)' });
    return;
  }

  const { downloadPassword, password } = req.body || {};

  if (fileHasDownloadPassword(row)) {
    if (!downloadPassword || !verifySecret(downloadPassword, row.download_password_hash)) {
      res.status(403).json({ error: 'Неверный пароль для скачивания' });
      return;
    }
  }

  if (fileHasAccessRestrictions(row)) {
    const access = await resolveAccessEmail(req, req.body);
    if (access.error) {
      res.status(400).json({ error: access.error });
      return;
    }

    if (!isEmailAllowedForFile(access.email, row)) {
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
    } else if (!isEmailAllowedForFile(access.email, row)) {
      res.status(403).json({ error: 'Ваш аккаунт не имеет доступа к этому файлу' });
      return;
    }
  }

  grantDownload(req, shortName);
  res.json({ ok: true, authorized: true });
}

function handleDownloadFile(req, res) {
  const shortName = req.params.name;
  const row = getLinkWithFile(shortName);

  if (!row) {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
    return;
  }

  if (!isStoredFileAvailable(row) || !fs.existsSync(row.stored_path)) {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
    return;
  }

  if (!isLinkAvailable(row)) {
    if (isLinkExhausted(row)) {
      res.status(403).sendFile(path.join(__dirname, '..', 'public', 'limit.html'));
      return;
    }
    res.status(403).sendFile(path.join(__dirname, '..', 'public', 'link-expired.html'));
    return;
  }

  if (fileHasGates(row) && !hasDownloadGrant(req, shortName)) {
    res.status(403).json({ error: 'Сначала пройдите проверку доступа' });
    return;
  }

  incrementLinkDownloadCount(row.link_id);
  incrementStoredFileDownloadCount(row.stored_file_id);
  delete ensureDownloadGrants(req)[shortName];

  res.download(row.stored_path, row.original_name);
}

function shouldServeDownloadPage(row) {
  return fileHasGates(row);
}

module.exports = {
  buildFileInfo,
  handleFileInfo,
  handleAuthorizeDownload,
  handleDownloadFile,
  shouldServeDownloadPage,
  isDownloadAllowed,
  isLinkExhausted,
};
