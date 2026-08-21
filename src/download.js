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
const { storageExists, sendStoredFile } = require('./chunkStorage');

const DOWNLOAD_GRANT_TTL_MS = 5 * 60 * 1000;

function isDownloadAllowed(row) {
  if (!row) return false;
  if (!isStoredFileAvailable(row)) return false;
  if (!storageExists(row)) return false;
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

function assertDownloadLinkAvailable(row, res) {
  if (!row) {
    res.status(404).json({ error: 'Файл не найден' });
    return false;
  }
  if (!isStoredFileAvailable(row) || !storageExists(row)) {
    res.status(404).json({ error: 'Файл удалён с сервера' });
    return false;
  }
  if (!isLinkAvailable(row)) {
    res.status(403).json({ error: 'Ссылка недоступна (лимит или срок истёк)' });
    return false;
  }
  return true;
}

async function sendRegistrationInviteForDownload(res, email, shortName) {
  const inviteResult = await sendRegistrationInvite(email, shortName);
  if (!inviteResult.delivered) {
    if (inviteResult.reason === 'smtp_not_configured') {
      res.status(503).json({
        error: 'Отправка email на сервере не настроена. Обратитесь к администратору сайта.',
        emailNotConfigured: true,
        canResendRegistration: true,
      });
      return;
    }
    res.status(500).json({
      error: inviteResult.reason === 'smtp_timeout'
        ? 'Сервер почты не отвечает. Проверьте SMTP_HOST/SMTP_PORT на сервере или попробуйте позже.'
        : 'Не удалось отправить письмо для регистрации. Попробуйте позже.',
      emailSendFailed: true,
      smtpTimeout: inviteResult.reason === 'smtp_timeout',
      canResendRegistration: true,
    });
    return;
  }
  res.json({
    ok: true,
    registrationSent: true,
    message: 'На email отправлена ссылка для регистрации. После регистрации скачайте файл снова.',
    canResendRegistration: true,
  });
}

async function handleAuthorizeDownload(req, res) {
  const shortName = req.params.name;
  const row = getLinkWithFile(shortName);

  if (!assertDownloadLinkAvailable(row, res)) {
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
        await sendRegistrationInviteForDownload(res, access.email, shortName);
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

async function handleResendRegistration(req, res) {
  const shortName = req.params.name;
  const row = getLinkWithFile(shortName);

  if (!assertDownloadLinkAvailable(row, res)) {
    return;
  }

  if (!fileHasAccessRestrictions(row)) {
    res.status(400).json({ error: 'Для этой ссылки не требуется регистрация по email' });
    return;
  }

  if (getSessionUserEmail(req)) {
    res.status(400).json({ error: 'Вы уже вошли в аккаунт — нажмите «Скачать»' });
    return;
  }

  const emailError = validateEmailFormat(req.body?.email);
  if (emailError) {
    res.status(400).json({ error: emailError });
    return;
  }

  const email = normalizeEmail(req.body.email);
  if (!isEmailAllowedForFile(email, row)) {
    res.status(403).json({ error: 'Этот email не имеет доступа к файлу' });
    return;
  }

  if (isUserRegistered(email)) {
    res.status(400).json({
      error: 'Этот email уже зарегистрирован. Введите пароль и нажмите «Скачать».',
      needsLogin: true,
    });
    return;
  }

  await sendRegistrationInviteForDownload(res, email, shortName);
}

function handleDownloadFile(req, res) {
  const shortName = req.params.name;
  const row = getLinkWithFile(shortName);

  if (!row) {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
    return;
  }

  if (!isStoredFileAvailable(row) || !storageExists(row)) {
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

  sendStoredFile(res, row, row.original_name);
}

function shouldServeDownloadPage(row) {
  return fileHasGates(row);
}

module.exports = {
  buildFileInfo,
  handleFileInfo,
  handleAuthorizeDownload,
  handleResendRegistration,
  handleDownloadFile,
  shouldServeDownloadPage,
  isDownloadAllowed,
  isLinkExhausted,
};
