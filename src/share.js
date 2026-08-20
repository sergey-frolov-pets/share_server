const fs = require('fs');
const path = require('path');
const config = require('./config');
const {
  isShortNameTaken,
  createStoredFile,
  createLink,
  getLinkWithFile,
  getStoredFileById,
  updateLink,
  updateStoredFileLimits,
  updateStoredFilePath,
  countLinksForStoredFile,
  deleteStoredFileRecord,
  getTempUpload,
  deleteTempUpload,
} = require('./db');
const { removeFileFromDisk } = require('./cleanup');
const { hashSecret } = require('./password');
const { parseAccessInput, parseDomainInput } = require('./access');
const { parseLimitFields } = require('./limits');

function parseShareLimits(body) {
  const linkLimits = parseLimitFields(body, 'link');
  if (linkLimits.error) return { error: linkLimits.error };

  const fileLimits = parseLimitFields(body, 'file');
  if (fileLimits.error) return { error: fileLimits.error };

  return { linkLimits, fileLimits };
}

function parseDownloadPassword(downloadPassword) {
  if (!downloadPassword || !String(downloadPassword).trim()) {
    return { hash: null };
  }
  if (String(downloadPassword).length < 4) {
    return { error: 'Пароль для скачивания — минимум 4 символа' };
  }
  return { hash: hashSecret(String(downloadPassword).trim()) };
}

function parseAccessLists(body) {
  return {
    emails: parseAccessInput(body.allowedEmails || ''),
    domains: parseDomainInput(body.allowedDomains || ''),
  };
}

function finalizeTempUpload(temp, shortNamePrefix) {
  const finalPath = path.join(
    config.uploadDir,
    `${shortNamePrefix}__${temp.original_name.replace(/[^\w.\-() ]/g, '_')}`
  );
  try {
    fs.renameSync(temp.stored_path, finalPath);
  } catch {
    return { error: 'Не удалось сохранить файл' };
  }
  return { finalPath, originalName: temp.original_name };
}

function cleanupOrphanStoredFile(storedFileId, excludeLinkId) {
  const refs = countLinksForStoredFile(storedFileId, excludeLinkId);
  if (refs > 0) return;
  const stored = getStoredFileById(storedFileId);
  if (!stored) return;
  removeFileFromDisk(stored.stored_path);
  deleteStoredFileRecord(storedFileId);
}

function buildShareResponse(shortName, linkLimits, fileLimits, extras = {}) {
  return {
    ok: true,
    shareUrl: `${config.baseUrl}/${encodeURIComponent(shortName)}`,
    shortName,
    linkMaxDownloads: linkLimits.maxDownloads,
    linkDays: linkLimits.days,
    linkExpiresAt: linkLimits.expiresAt,
    fileMaxDownloads: fileLimits.maxDownloads,
    fileDays: fileLimits.days,
    fileDeleteAt: fileLimits.expiresAt,
    ...extras,
  };
}

function handleCreateShare(req, res, validateShortName) {
  const body = req.body || {};
  const { uploadId, shortName, downloadPassword } = body;

  if (!uploadId) {
    res.status(400).json({ error: 'Загрузка не найдена' });
    return;
  }

  const nameError = validateShortName(shortName);
  if (nameError) {
    res.status(400).json({ error: nameError });
    return;
  }

  const trimmedName = shortName.trim();
  if (isShortNameTaken(trimmedName)) {
    res.status(409).json({ error: 'Такое имя уже занято' });
    return;
  }

  const limitsParsed = parseShareLimits(body);
  if (limitsParsed.error) {
    res.status(400).json({ error: limitsParsed.error });
    return;
  }

  const temp = getTempUpload(uploadId);
  if (!temp) {
    res.status(400).json({ error: 'Загрузка не найдена или уже использована' });
    return;
  }

  const passwordParsed = parseDownloadPassword(downloadPassword);
  if (passwordParsed.error) {
    res.status(400).json({ error: passwordParsed.error });
    return;
  }

  const access = parseAccessLists(body);
  const finalized = finalizeTempUpload(temp, trimmedName);
  if (finalized.error) {
    res.status(500).json({ error: finalized.error });
    return;
  }

  const { linkLimits, fileLimits } = limitsParsed;

  try {
    const storedFileId = createStoredFile({
      storedPath: finalized.finalPath,
      originalName: finalized.originalName,
      deleteMaxDownloads: fileLimits.maxDownloads,
      deleteAt: fileLimits.expiresAt,
    });

    createLink({
      shortName: trimmedName,
      storedFileId,
      linkMaxDownloads: linkLimits.maxDownloads,
      linkExpiresAt: linkLimits.expiresAt,
      downloadPasswordHash: passwordParsed.hash,
      allowedEmails: JSON.stringify(access.emails),
      allowedDomains: JSON.stringify(access.domains),
    });

    deleteTempUpload(uploadId);
  } catch {
    removeFileFromDisk(finalized.finalPath);
    res.status(409).json({ error: 'Такое имя уже занято' });
    return;
  }

  res.json(buildShareResponse(trimmedName, linkLimits, fileLimits, {
    hasDownloadPassword: Boolean(passwordParsed.hash),
    allowedEmails: access.emails,
    allowedDomains: access.domains,
  }));
}

function handleGetShare(req, res) {
  const row = getLinkWithFile(req.params.shortName);
  if (!row) {
    res.status(404).json({ error: 'Ссылка не найдена' });
    return;
  }

  res.json({
    shortName: row.short_name,
    originalName: row.original_name,
    linkMaxDownloads: row.link_max_downloads,
    linkDownloadCount: row.link_download_count,
    linkExpiresAt: row.link_expires_at,
    fileMaxDownloads: row.delete_max_downloads,
    fileDownloadCount: row.total_download_count,
    fileDeleteAt: row.delete_at,
    hasDownloadPassword: Boolean(row.download_password_hash),
    allowedEmails: JSON.parse(row.allowed_emails || '[]'),
    allowedDomains: JSON.parse(row.allowed_domains || '[]'),
    updatedAt: row.link_updated_at,
  });
}

function handleUpdateShare(req, res, validateShortName) {
  const currentName = req.params.shortName;
  const row = getLinkWithFile(currentName);
  if (!row) {
    res.status(404).json({ error: 'Ссылка не найдена' });
    return;
  }

  const body = req.body || {};
  const limitsParsed = parseShareLimits(body);
  if (limitsParsed.error) {
    res.status(400).json({ error: limitsParsed.error });
    return;
  }

  const passwordParsed = parseDownloadPassword(body.downloadPassword);
  if (passwordParsed.error) {
    res.status(400).json({ error: passwordParsed.error });
    return;
  }

  const access = parseAccessLists(body);
  const { linkLimits, fileLimits } = limitsParsed;

  let newShortName = currentName;
  if (body.newShortName && body.newShortName.trim() !== currentName) {
    const nameError = validateShortName(body.newShortName);
    if (nameError) {
      res.status(400).json({ error: nameError });
      return;
    }
    newShortName = body.newShortName.trim();
    if (isShortNameTaken(newShortName)) {
      res.status(409).json({ error: 'Такое имя уже занято' });
      return;
    }
  }

  let storedFileId = row.stored_file_id;
  const oldStoredFileId = row.stored_file_id;
  let originalName = row.original_name;

  if (body.uploadId) {
    const temp = getTempUpload(body.uploadId);
    if (!temp) {
      res.status(400).json({ error: 'Загрузка не найдена или уже использована' });
      return;
    }

    const finalized = finalizeTempUpload(temp, newShortName);
    if (finalized.error) {
      res.status(500).json({ error: finalized.error });
      return;
    }

    const newStoredId = createStoredFile({
      storedPath: finalized.finalPath,
      originalName: finalized.originalName,
      deleteMaxDownloads: fileLimits.maxDownloads,
      deleteAt: fileLimits.expiresAt,
    });

    storedFileId = newStoredId;
    originalName = finalized.originalName;
    deleteTempUpload(body.uploadId);
    cleanupOrphanStoredFile(oldStoredFileId, row.link_id);
  } else {
    updateStoredFileLimits(storedFileId, {
      deleteMaxDownloads: fileLimits.maxDownloads,
      deleteAt: fileLimits.expiresAt,
    });
  }

  let downloadPasswordHash = row.download_password_hash;
  if (body.downloadPassword !== undefined) {
    downloadPasswordHash = passwordParsed.hash;
  }

  const resetLinkCount = Boolean(body.resetLinkCount) || linkLimits.maxDownloads !== row.link_max_downloads
    || linkLimits.expiresAt !== row.link_expires_at;

  updateLink(currentName, {
    newShortName,
    storedFileId,
    linkMaxDownloads: linkLimits.maxDownloads,
    linkExpiresAt: linkLimits.expiresAt,
    linkDownloadCount: resetLinkCount ? 0 : row.link_download_count,
    downloadPasswordHash,
    allowedEmails: JSON.stringify(access.emails),
    allowedDomains: JSON.stringify(access.domains),
  });

  res.json(buildShareResponse(newShortName, linkLimits, fileLimits, {
    hasDownloadPassword: Boolean(downloadPasswordHash),
    allowedEmails: access.emails,
    allowedDomains: access.domains,
    originalName,
    linkDownloadCount: resetLinkCount ? 0 : row.link_download_count,
  }));
}

module.exports = {
  handleCreateShare,
  handleGetShare,
  handleUpdateShare,
};
