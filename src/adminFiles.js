const fs = require('fs');
const path = require('path');
const config = require('./config');
const { removeStorageFromDisk, storageExists, sendStoredFile } = require('./chunkStorage');
const { isLinkAvailable, isStoredFileAvailable } = require('./limits');
const {
  bytesToMb,
  getAllStoredFilesAdmin,
  getLinksForStoredFile,
  getStoredFileById,
  updateStoredFileRename,
  updateLinkShortNameById,
  touchLinksUpdatedAt,
  deleteLinksForStoredFile,
  deleteStoredFileRecord,
  isShortNameTaken,
} = require('./db');

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
  const active = isLinkAvailable(row);
  return {
    id: link.id,
    shortName: link.short_name,
    downloadCount: link.link_download_count,
    maxDownloads: link.link_max_downloads,
    expiresAt: link.link_expires_at,
    active,
    shareUrl: `${config.baseUrl}/${encodeURIComponent(link.short_name)}`,
    updatedAt: link.updated_at,
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

  const linkUpdates = Array.isArray(body.links) ? body.links : [];
  const updatedLinks = [];

  for (const update of linkUpdates) {
    const linkId = parseInt(update.id, 10);
    const link = links.find((item) => item.id === linkId);
    if (!link || !update.shortName) continue;

    const shortError = validateShortName(update.shortName);
    if (shortError) {
      res.status(400).json({ error: shortError });
      return;
    }

    const newShortName = update.shortName.trim();
    if (newShortName === link.short_name) continue;

    if (isShortNameTaken(newShortName)) {
      res.status(409).json({ error: `Ссылка «${newShortName}» уже занята` });
      return;
    }

    updateLinkShortNameById(linkId, newShortName);
    updatedLinks.push({ id: linkId, shortName: newShortName });
  }

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
  } else if (updatedLinks.length > 0) {
    touchLinksUpdatedAt(fileId);
  }

  const refreshed = mapFileRow(getStoredFileById(fileId));
  res.json({
    ok: true,
    file: refreshed,
    updatedLinks,
    warning: activeLinks.length > 0
      ? `На файл ссылаются ${activeLinks.length} активных ссылок — изменения применены`
      : null,
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
};
