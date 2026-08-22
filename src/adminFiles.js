const fs = require('fs');
const path = require('path');
const config = require('./config');
const { removeStorageFromDisk, storageExists, sendStoredFile } = require('./chunkStorage');
const {
  isLinkAvailable,
  isStoredFileAvailable,
  parseRemainingDownloads,
  parseExpiresDateInput,
  parseFileDeleteDeadline,
  parseOptionalPositiveInt,
  parseLimitFields,
} = require('./limits');
const { hashSecret } = require('./password');
const {
  parseAccessList,
  parseAccessInput,
  parseDomainInput,
  validateAccessRestrictionsSmtp,
} = require('./access');
const { isEmailConfigured } = require('./email');
const {
  bytesToMb,
  getAllStoredFilesAdmin,
  getLinksForStoredFile,
  getStoredFileById,
  updateStoredFileRename,
  updateStoredFileLimits,
  updateLinkById,
  touchLinksUpdatedAt,
  deleteLinksForStoredFile,
  deleteStoredFileRecord,
  isShortNameTaken,
  createLink,
  getLinkById,
  deleteLinkById,
} = require('./db');
const { findAvailableRandomShortName } = require('./randomName');

const ORIGINAL_NAME_MAX_LENGTH = 255;

function sanitizeFileName(originalName) {
  return originalName.replace(/[^\w.\-() ]/g, '_');
}

function validateOriginalName(name) {
  if (!name || typeof name !== 'string') {
    return 'Укажите имя файла';
  }
  const trimmed = name.trim();
  if (!trimmed) return 'Укажите имя файла';
  if (trimmed.length > ORIGINAL_NAME_MAX_LENGTH) {
    return `Имя файла не длиннее ${ORIGINAL_NAME_MAX_LENGTH} символов`;
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return 'Имя файла не может содержать / или \\';
  }
  return null;
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

function validateShortName(shortName) {
  if (!shortName || typeof shortName !== 'string') {
    return 'Укажите короткое имя ссылки';
  }
  const trimmed = shortName.trim();
  if (trimmed.length < config.shortNameMinLength) {
    return `Имя ссылки не короче ${config.shortNameMinLength} символов`;
  }
  if (trimmed.length > config.shortNameMaxLength) {
    return `Имя ссылки не длиннее ${config.shortNameMaxLength} символов`;
  }
  if (!config.shortNamePattern.test(trimmed)) {
    return 'Имя ссылки: только латиница, цифры, _ и -';
  }
  if (['api', 'register', 'reset-password', 'account'].includes(trimmed.toLowerCase())) {
    return 'Это имя ссылки недоступно';
  }
  return null;
}

function mapLinkRow(link) {
  const row = {
    link_max_downloads: link.link_max_downloads,
    link_download_count: link.link_download_count,
    link_expires_at: link.link_expires_at,
  };
  const allowedEmails = parseAccessList(link.allowed_emails);
  const allowedDomains = parseAccessList(link.allowed_domains);
  const active = isLinkAvailable(row);
  return {
    id: link.id,
    shortName: link.short_name,
    downloadCount: link.link_download_count,
    maxDownloads: link.link_max_downloads,
    expiresAt: link.link_expires_at,
    allowedEmails,
    allowedDomains,
    hasDownloadPassword: Boolean(link.download_password_hash),
    requiresAccess: allowedEmails.length > 0 || allowedDomains.length > 0,
    createdAt: link.created_at,
    updatedAt: link.updated_at,
    active,
    shareUrl: `${config.baseUrl}/${encodeURIComponent(link.short_name)}`,
  };
}

function mapFileRow(file) {
  const links = getLinksForStoredFile(file.id).map(mapLinkRow);
  const activeLinks = links.filter((link) => link.active);
  return {
    id: file.id,
    originalName: file.original_name,
    sizeBytes: file.file_size_bytes,
    sizeMb: bytesToMb(file.file_size_bytes),
    createdAt: file.created_at,
    isChunked: Boolean(file.is_chunked),
    description: file.description || null,
    linkCount: file.link_count ?? links.length,
    activeLinkCount: activeLinks.length,
    fileDownloadCount: file.total_download_count || 0,
    fileMaxDownloads: file.delete_max_downloads,
    fileDeleteAt: file.delete_at,
    fileAvailable: isStoredFileAvailable(file),
    links,
  };
}

function buildRenamedStoredPath(file, links, newSafeName) {
  const oldSafeName = sanitizeFileName(file.original_name);
  if (file.stored_path.includes(oldSafeName)) {
    return file.stored_path.replace(oldSafeName, newSafeName);
  }

  const prefixLink = links[0]?.short_name || 'file';
  const suffix = file.is_chunked ? '' : '';
  return path.join(config.uploadDir, `${prefixLink}__${newSafeName}${suffix}`);
}

function handleAdminFilesList(_req, res) {
  const files = getAllStoredFilesAdmin().map(mapFileRow);
  res.json({ files });
}

function handleAdminFileRename(req, res) {
  const fileId = parseInt(req.params.id, 10);
  if (!fileId) {
    res.status(400).json({ error: 'Некорректный id файла' });
    return;
  }

  const file = getStoredFileById(fileId);
  if (!file) {
    res.status(404).json({ error: 'Файл не найден' });
    return;
  }

  const body = req.body || {};
  const nameError = validateOriginalName(body.originalName);
  if (nameError) {
    res.status(400).json({ error: nameError });
    return;
  }

  const newOriginalName = body.originalName.trim();
  const links = getLinksForStoredFile(fileId);
  const activeLinks = links.filter((link) => isLinkAvailable({
    link_max_downloads: link.link_max_downloads,
    link_download_count: link.link_download_count,
    link_expires_at: link.link_expires_at,
  }));

  let storedPath = file.stored_path;
  if (newOriginalName !== file.original_name) {
    const newSafeName = sanitizeFileName(newOriginalName);
    const nextPath = buildRenamedStoredPath(file, links, newSafeName);

    if (nextPath !== file.stored_path && fs.existsSync(file.stored_path)) {
      fs.mkdirSync(path.dirname(nextPath), { recursive: true });
      if (fs.existsSync(nextPath)) {
        res.status(409).json({ error: 'Целевой путь на диске уже занят' });
        return;
      }
      fs.renameSync(file.stored_path, nextPath);
    }
    storedPath = nextPath;
    updateStoredFileRename(fileId, newOriginalName, storedPath);
    touchLinksUpdatedAt(fileId);
  }

  const shouldUpdateLimits = body.fileDeleteAt !== undefined
    || body.fileDays !== undefined
    || body.fileMaxDownloads !== undefined;

  if (shouldUpdateLimits) {
    let deleteAt = file.delete_at;
    if (body.fileDeleteAt !== undefined || body.fileDays !== undefined) {
      const deleteParsed = parseFileDeleteDeadline(body);
      if (deleteParsed.error) {
        res.status(400).json({ error: deleteParsed.error });
        return;
      }
      deleteAt = deleteParsed.value;
    }

    let deleteMaxDownloads = file.delete_max_downloads;
    if (body.fileMaxDownloads !== undefined) {
      const maxParsed = parseOptionalPositiveInt(body.fileMaxDownloads, 'Лимит скачиваний файла');
      if (maxParsed.error) {
        res.status(400).json({ error: maxParsed.error });
        return;
      }
      deleteMaxDownloads = maxParsed.value;
    }

    updateStoredFileLimits(fileId, {
      deleteMaxDownloads,
      deleteAt,
      description: file.description || null,
    });
    touchLinksUpdatedAt(fileId);
  }

  const refreshed = mapFileRow(getStoredFileById(fileId));
  res.json({
    ok: true,
    file: refreshed,
    warning: activeLinks.length > 0
      ? `На файл ссылаются ${activeLinks.length} активных ссылок — изменения применены`
      : null,
  });
}

function handleAdminLinkCreate(req, res) {
  const fileId = parseInt(req.params.id, 10);
  if (!fileId) {
    res.status(400).json({ error: 'Некорректный id файла' });
    return;
  }

  const file = getStoredFileById(fileId);
  if (!file) {
    res.status(404).json({ error: 'Файл не найден' });
    return;
  }

  const body = req.body || {};
  let shortName = body.shortName?.trim();

  if (shortName) {
    const shortError = validateShortName(shortName);
    if (shortError) {
      res.status(400).json({ error: shortError });
      return;
    }
    if (isShortNameTaken(shortName)) {
      res.status(409).json({ error: `Ссылка «${shortName}» уже занята` });
      return;
    }
  } else {
    shortName = findAvailableRandomShortName();
    if (!shortName) {
      res.status(503).json({ error: 'Не удалось сгенерировать имя ссылки' });
      return;
    }
  }

  const linkLimits = parseLimitFields(body, 'link');
  if (linkLimits.error) {
    res.status(400).json({ error: linkLimits.error });
    return;
  }

  const passwordParsed = parseDownloadPassword(body.downloadPassword);
  if (passwordParsed.error) {
    res.status(400).json({ error: passwordParsed.error });
    return;
  }

  const access = {
    emails: parseAccessInput(body.allowedEmails || ''),
    domains: parseDomainInput(body.allowedDomains || ''),
  };
  const smtpError = validateAccessRestrictionsSmtp(access, isEmailConfigured());
  if (smtpError) {
    res.status(503).json({ error: smtpError });
    return;
  }

  createLink({
    shortName,
    storedFileId: fileId,
    linkMaxDownloads: linkLimits.maxDownloads,
    linkExpiresAt: linkLimits.expiresAt,
    downloadPasswordHash: passwordParsed.hash,
    allowedEmails: JSON.stringify(access.emails),
    allowedDomains: JSON.stringify(access.domains),
    ownerUserId: null,
  });

  touchLinksUpdatedAt(fileId);
  const refreshed = mapFileRow(getStoredFileById(fileId));
  res.json({
    ok: true,
    file: refreshed,
    shortName,
    shareUrl: `${config.baseUrl}/${encodeURIComponent(shortName)}`,
  });
}

function handleAdminLinkUpdate(req, res) {
  const linkId = parseInt(req.params.id, 10);
  if (!linkId) {
    res.status(400).json({ error: 'Некорректный id ссылки' });
    return;
  }

  const link = getLinkById(linkId);
  if (!link) {
    res.status(404).json({ error: 'Ссылка не найдена' });
    return;
  }

  const body = req.body || {};
  const shortError = validateShortName(body.shortName);
  if (shortError) {
    res.status(400).json({ error: shortError });
    return;
  }

  const newShortName = body.shortName.trim();
  if (newShortName !== link.short_name && isShortNameTaken(newShortName)) {
    res.status(409).json({ error: `Ссылка «${newShortName}» уже занята` });
    return;
  }

  const remainingParsed = parseRemainingDownloads(
    body.linkRemainingDownloads,
    link.link_download_count
  );
  if (remainingParsed.error) {
    res.status(400).json({ error: remainingParsed.error });
    return;
  }

  const expiresParsed = parseExpiresDateInput(body.linkExpiresAt);
  if (expiresParsed.error) {
    res.status(400).json({ error: expiresParsed.error });
    return;
  }

  const access = {
    emails: parseAccessInput(body.allowedEmails || ''),
    domains: parseDomainInput(body.allowedDomains || ''),
  };
  const smtpError = validateAccessRestrictionsSmtp(access, isEmailConfigured());
  if (smtpError) {
    res.status(503).json({ error: smtpError });
    return;
  }

  updateLinkById(linkId, {
    shortName: newShortName,
    linkMaxDownloads: remainingParsed.value,
    linkExpiresAt: expiresParsed.value,
    allowedEmails: JSON.stringify(access.emails),
    allowedDomains: JSON.stringify(access.domains),
  });
  touchLinksUpdatedAt(link.stored_file_id);

  const file = mapFileRow(getStoredFileById(link.stored_file_id));
  const updatedLink = mapLinkRow(getLinkById(linkId));
  res.json({ ok: true, file, link: updatedLink });
}

function handleAdminLinkDelete(req, res) {
  const linkId = parseInt(req.params.id, 10);
  if (!linkId) {
    res.status(400).json({ error: 'Некорректный id ссылки' });
    return;
  }

  const link = getLinkById(linkId);
  if (!link) {
    res.status(404).json({ error: 'Ссылка не найдена' });
    return;
  }

  const mapped = mapLinkRow(link);
  const fileId = link.stored_file_id;
  deleteLinkById(linkId);
  touchLinksUpdatedAt(fileId);

  const file = getStoredFileById(fileId);
  res.json({
    ok: true,
    deletedLink: mapped,
    file: file ? mapFileRow(file) : null,
  });
}

function handleAdminFileDelete(req, res) {
  const fileId = parseInt(req.params.id, 10);
  if (!fileId) {
    res.status(400).json({ error: 'Некорректный id файла' });
    return;
  }

  const file = getStoredFileById(fileId);
  if (!file) {
    res.status(404).json({ error: 'Файл не найден' });
    return;
  }

  const links = getLinksForStoredFile(fileId).map(mapLinkRow);
  const activeLinks = links.filter((link) => link.active);
  const force = Boolean(req.body?.force);

  if (activeLinks.length > 0 && !force) {
    res.status(409).json({
      error: `На файл ссылаются ${activeLinks.length} активных ссылок`,
      activeLinkCount: activeLinks.length,
      links,
      requireForce: true,
    });
    return;
  }

  removeStorageFromDisk(file.stored_path, file.is_chunked);
  deleteLinksForStoredFile(fileId);
  deleteStoredFileRecord(fileId);

  res.json({
    ok: true,
    deletedLinks: links.length,
    warning: activeLinks.length > 0
      ? `Удалено вместе с ${links.length} ссылками (${activeLinks.length} были активны)`
      : null,
  });
}

function handleAdminFileDownload(req, res) {
  const fileId = parseInt(req.params.id, 10);
  if (!fileId) {
    res.status(400).json({ error: 'Некорректный id файла' });
    return;
  }

  const file = getStoredFileById(fileId);
  if (!file) {
    res.status(404).json({ error: 'Файл не найден' });
    return;
  }

  if (!storageExists(file)) {
    res.status(404).json({ error: 'Файл не найден на диске' });
    return;
  }

  sendStoredFile(res, file, file.original_name);
}

module.exports = {
  handleAdminFilesList,
  handleAdminFileRename,
  handleAdminFileDelete,
  handleAdminFileDownload,
  handleAdminLinkCreate,
  handleAdminLinkUpdate,
  handleAdminLinkDelete,
};
