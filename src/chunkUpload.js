const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const {
  createChunkUpload,
  getChunkUpload,
  updateChunkUploadProgress,
  setChunkUploadStatus,
  deleteChunkUpload,
  createTempUpload,
  checkGlobalStorageQuota,
} = require('./db');
const { removeFileFromDisk } = require('./cleanup');
const { assertUserCanUpload } = require('./uploadQuota');

const CHUNK_STATUSES = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETE: 'complete',
  CANCELLED: 'cancelled',
};

function computeTotalChunks(totalSize, chunkSize) {
  return Math.ceil(totalSize / chunkSize);
}

function buildFileFingerprint(originalName, totalSize, lastModified) {
  return crypto
    .createHash('sha256')
    .update(`${originalName}:${totalSize}:${lastModified || 0}`)
    .digest('hex');
}

function parseReceivedChunks(json) {
  try {
    const chunks = JSON.parse(json || '[]');
    return Array.isArray(chunks) ? chunks : [];
  } catch {
    return [];
  }
}

function bytesFromChunks(session, uploadedChunks) {
  let bytes = 0;
  for (const index of uploadedChunks) {
    const offset = index * session.chunk_size;
    bytes += Math.min(session.chunk_size, session.total_size - offset);
  }
  return bytes;
}

function formatSessionResponse(session) {
  const uploadedChunks = parseReceivedChunks(session.received_chunks);
  const bytesReceived = bytesFromChunks(session, uploadedChunks);
  const progress = session.total_size
    ? Math.min(100, Math.round((bytesReceived / session.total_size) * 100))
    : 0;

  return {
    sessionId: session.id,
    originalName: session.original_name,
    totalSize: session.total_size,
    chunkSize: session.chunk_size,
    totalChunks: session.total_chunks,
    uploadedChunks,
    bytesReceived,
    progress,
    status: session.status,
  };
}

function sanitizeFileName(originalName) {
  return originalName.replace(/[^\w.\-() ]/g, '_');
}

function getStoredPath(sessionId, originalName) {
  return path.join(config.chunkUploadDir, `${sessionId}__${sanitizeFileName(originalName)}`);
}

function assertSessionOwner(session, ownerUserId) {
  if (!session) return false;
  if (ownerUserId == null) {
    return session.owner_user_id == null;
  }
  return session.owner_user_id === ownerUserId;
}

function ensureChunkDir() {
  fs.mkdirSync(config.chunkUploadDir, { recursive: true });
}

function preallocateFile(storedPath, totalSize) {
  const fd = fs.openSync(storedPath, 'w');
  try {
    fs.ftruncateSync(fd, totalSize);
  } finally {
    fs.closeSync(fd);
  }
}

function validateFileSize(totalSize) {
  if (!Number.isFinite(totalSize) || totalSize < 1) {
    return 'Некорректный размер файла';
  }
  if (totalSize > config.maxFileSizeBytes) {
    return `Файл слишком большой (макс. ${config.maxFileSizeBytes / (1024 * 1024)} МБ)`;
  }
  return null;
}

function handleInit(req, res, ownerUserId) {
  const { originalName, totalSize, lastModified, resumeSessionId } = req.body || {};

  if (!originalName || typeof originalName !== 'string') {
    res.status(400).json({ error: 'Укажите имя файла' });
    return;
  }

  const size = Number(totalSize);
  const sizeError = validateFileSize(size);
  if (sizeError) {
    res.status(400).json({ error: sizeError });
    return;
  }

  const fingerprint = buildFileFingerprint(originalName, size, lastModified);

  if (resumeSessionId) {
    const existing = getChunkUpload(resumeSessionId);
    if (
      existing
      && existing.status !== CHUNK_STATUSES.CANCELLED
      && existing.status !== CHUNK_STATUSES.COMPLETE
      && assertSessionOwner(existing, ownerUserId)
      && existing.file_fingerprint === fingerprint
      && existing.total_size === size
    ) {
      if (existing.status === CHUNK_STATUSES.PAUSED) {
        setChunkUploadStatus(existing.id, CHUNK_STATUSES.ACTIVE);
      }
      res.json({
        ...formatSessionResponse(getChunkUpload(existing.id)),
        resumed: true,
      });
      return;
    }
  }

  if (ownerUserId != null) {
    const quota = assertUserCanUpload(ownerUserId, size);
    if (quota.error) {
      res.status(403).json({ error: quota.error });
      return;
    }
  }

  const globalQuota = checkGlobalStorageQuota(size);
  if (globalQuota.error) {
    res.status(403).json({ error: globalQuota.error });
    return;
  }

  const sessionId = crypto.randomBytes(16).toString('hex');
  const chunkSize = config.chunkSizeBytes;
  const totalChunks = computeTotalChunks(size, chunkSize);
  const storedPath = getStoredPath(sessionId, originalName);

  ensureChunkDir();
  preallocateFile(storedPath, size);

  createChunkUpload({
    id: sessionId,
    originalName,
    totalSize: size,
    chunkSize,
    totalChunks,
    receivedChunks: '[]',
    storedPath,
    ownerUserId,
    status: CHUNK_STATUSES.ACTIVE,
    fileFingerprint: fingerprint,
  });

  res.json({
    ...formatSessionResponse(getChunkUpload(sessionId)),
    resumed: false,
  });
}

function handleStatus(req, res, ownerUserId) {
  const session = getChunkUpload(req.params.sessionId);
  if (!assertSessionOwner(session, ownerUserId)) {
    res.status(404).json({ error: 'Сессия не найдена' });
    return;
  }
  res.json(formatSessionResponse(session));
}

function handleChunk(req, res, ownerUserId) {
  const session = getChunkUpload(req.params.sessionId);
  if (!assertSessionOwner(session, ownerUserId)) {
    res.status(404).json({ error: 'Сессия не найдена' });
    return;
  }

  if (session.status === CHUNK_STATUSES.CANCELLED) {
    res.status(410).json({ error: 'Загрузка отменена' });
    return;
  }

  if (session.status === CHUNK_STATUSES.COMPLETE) {
    res.status(400).json({ error: 'Загрузка уже завершена' });
    return;
  }

  const chunkIndex = parseInt(req.params.chunkIndex, 10);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.total_chunks) {
    res.status(400).json({ error: 'Неверный номер части' });
    return;
  }

  const uploadedChunks = parseReceivedChunks(session.received_chunks);
  if (uploadedChunks.includes(chunkIndex)) {
    res.json(formatSessionResponse(session));
    return;
  }

  const buffer = req.body;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    res.status(400).json({ error: 'Пустая часть файла' });
    return;
  }

  const offset = chunkIndex * session.chunk_size;
  const expectedLength = Math.min(session.chunk_size, session.total_size - offset);
  if (buffer.length !== expectedLength) {
    res.status(400).json({
      error: `Ожидается ${expectedLength} байт, получено ${buffer.length}`,
    });
    return;
  }

  const fd = fs.openSync(session.stored_path, 'r+');
  try {
    fs.writeSync(fd, buffer, 0, buffer.length, offset);
  } finally {
    fs.closeSync(fd);
  }

  uploadedChunks.push(chunkIndex);
  uploadedChunks.sort((a, b) => a - b);

  const nextStatus = session.status === CHUNK_STATUSES.PAUSED
    ? CHUNK_STATUSES.ACTIVE
    : session.status;

  updateChunkUploadProgress(session.id, JSON.stringify(uploadedChunks), nextStatus);
  res.json(formatSessionResponse(getChunkUpload(session.id)));
}

function handlePause(req, res, ownerUserId) {
  const session = getChunkUpload(req.params.sessionId);
  if (!assertSessionOwner(session, ownerUserId)) {
    res.status(404).json({ error: 'Сессия не найдена' });
    return;
  }

  if (session.status === CHUNK_STATUSES.COMPLETE) {
    res.status(400).json({ error: 'Загрузка уже завершена' });
    return;
  }

  setChunkUploadStatus(session.id, CHUNK_STATUSES.PAUSED);
  res.json(formatSessionResponse(getChunkUpload(session.id)));
}

function handleResume(req, res, ownerUserId) {
  const session = getChunkUpload(req.params.sessionId);
  if (!assertSessionOwner(session, ownerUserId)) {
    res.status(404).json({ error: 'Сессия не найдена' });
    return;
  }

  if (session.status === CHUNK_STATUSES.COMPLETE) {
    res.status(400).json({ error: 'Загрузка уже завершена' });
    return;
  }

  setChunkUploadStatus(session.id, CHUNK_STATUSES.ACTIVE);
  res.json(formatSessionResponse(getChunkUpload(session.id)));
}

function handleCancel(req, res, ownerUserId) {
  const session = getChunkUpload(req.params.sessionId);
  if (!assertSessionOwner(session, ownerUserId)) {
    res.status(404).json({ error: 'Сессия не найдена' });
    return;
  }

  removeFileFromDisk(session.stored_path);
  setChunkUploadStatus(session.id, CHUNK_STATUSES.CANCELLED);
  deleteChunkUpload(session.id);
  res.json({ ok: true });
}

function handleComplete(req, res, ownerUserId) {
  const session = getChunkUpload(req.params.sessionId);
  if (!assertSessionOwner(session, ownerUserId)) {
    res.status(404).json({ error: 'Сессия не найдена' });
    return;
  }

  const uploadedChunks = parseReceivedChunks(session.received_chunks);
  if (uploadedChunks.length !== session.total_chunks) {
    res.status(400).json({ error: 'Не все части загружены' });
    return;
  }

  if (!fs.existsSync(session.stored_path)) {
    res.status(400).json({ error: 'Файл на сервере не найден' });
    return;
  }

  const stat = fs.statSync(session.stored_path);
  if (stat.size !== session.total_size) {
    res.status(400).json({ error: 'Размер файла не совпадает' });
    return;
  }

  if (ownerUserId != null) {
    const quota = assertUserCanUpload(ownerUserId, session.total_size);
    if (quota.error) {
      res.status(403).json({ error: quota.error });
      return;
    }
  }

  fs.mkdirSync(config.tempDir, { recursive: true });
  const uploadId = session.id;
  const tempPath = path.join(
    config.tempDir,
    `${uploadId}__${sanitizeFileName(session.original_name)}`
  );

  fs.renameSync(session.stored_path, tempPath);

  createTempUpload({
    id: uploadId,
    originalName: session.original_name,
    storedPath: tempPath,
    ownerUserId: session.owner_user_id,
    fileSize: session.total_size,
  });

  setChunkUploadStatus(session.id, CHUNK_STATUSES.COMPLETE);
  deleteChunkUpload(session.id);

  res.json({
    uploadId,
    originalName: session.original_name,
    size: session.total_size,
  });
}

function handleUploadConfig(_req, res) {
  res.json({
    maxFileSizeBytes: config.maxFileSizeBytes,
    chunkSizeBytes: config.chunkSizeBytes,
  });
}

function registerChunkUploadRoutes(app, {
  basePath,
  authMiddleware,
  ownerUserIdFromReq,
}) {
  const chunkParser = require('express').raw({
    type: () => true,
    limit: config.chunkSizeBytes + 1024,
  });

  app.get(`${basePath}/config`, authMiddleware, handleUploadConfig);
  app.post(`${basePath}/init`, authMiddleware, (req, res) => {
    handleInit(req, res, ownerUserIdFromReq(req));
  });
  app.get(`${basePath}/status/:sessionId`, authMiddleware, (req, res) => {
    handleStatus(req, res, ownerUserIdFromReq(req));
  });
  app.put(`${basePath}/chunk/:sessionId/:chunkIndex`, authMiddleware, chunkParser, (req, res) => {
    handleChunk(req, res, ownerUserIdFromReq(req));
  });
  app.post(`${basePath}/pause/:sessionId`, authMiddleware, (req, res) => {
    handlePause(req, res, ownerUserIdFromReq(req));
  });
  app.post(`${basePath}/resume/:sessionId`, authMiddleware, (req, res) => {
    handleResume(req, res, ownerUserIdFromReq(req));
  });
  app.delete(`${basePath}/cancel/:sessionId`, authMiddleware, (req, res) => {
    handleCancel(req, res, ownerUserIdFromReq(req));
  });
  app.post(`${basePath}/complete/:sessionId`, authMiddleware, (req, res) => {
    handleComplete(req, res, ownerUserIdFromReq(req));
  });
}

module.exports = {
  registerChunkUploadRoutes,
  CHUNK_STATUSES,
};
