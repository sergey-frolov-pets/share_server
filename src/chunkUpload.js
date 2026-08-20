const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');
const {
  createChunkUpload,
  getChunkUpload,
  updateChunkUploadProgress,
  setChunkUploadStatus,
  deleteChunkUpload,
  listActiveChunkUploads,
  createTempUpload,
  checkGlobalStorageQuota,
} = require('./db');
const { removeStorageFromDisk, getSessionChunkDir, ensureChunkDir, writeChunkPart, chunkPartExists, storageExists } = require('./chunkStorage');
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


function getStoredPath(sessionId) {
  return getSessionChunkDir(sessionId);
}

function assertSessionOwner(session, ownerUserId) {
  if (!session) return false;
  if (ownerUserId == null) {
    return session.owner_user_id == null;
  }
  return session.owner_user_id === ownerUserId;
}

function ensureChunkDirReady() {
  fs.mkdirSync(config.chunkUploadDir, { recursive: true });
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
  const storedPath = getStoredPath(sessionId);

  ensureChunkDirReady();
  ensureChunkDir(storedPath);

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
  if (uploadedChunks.includes(chunkIndex) && chunkPartExists(session.stored_path, chunkIndex)) {
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

  writeChunkPart(session.stored_path, chunkIndex, buffer);

  if (!uploadedChunks.includes(chunkIndex)) {
    uploadedChunks.push(chunkIndex);
    uploadedChunks.sort((a, b) => a - b);
  }

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

  removeStorageFromDisk(session.stored_path, true);
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

  if (!storageExists({
    stored_path: session.stored_path,
    is_chunked: 1,
    total_chunks: session.total_chunks,
    file_size_bytes: session.total_size,
  })) {
    res.status(400).json({ error: 'Не все части найдены на сервере' });
    return;
  }

  if (ownerUserId != null) {
    const quota = assertUserCanUpload(ownerUserId, session.total_size);
    if (quota.error) {
      res.status(403).json({ error: quota.error });
      return;
    }
  }

  const uploadId = session.id;

  createTempUpload({
    id: uploadId,
    originalName: session.original_name,
    storedPath: session.stored_path,
    ownerUserId: session.owner_user_id,
    fileSize: session.total_size,
    isChunked: true,
    chunkSize: session.chunk_size,
    totalChunks: session.total_chunks,
  });

  setChunkUploadStatus(session.id, CHUNK_STATUSES.COMPLETE);
  deleteChunkUpload(session.id);

  res.json({
    uploadId,
    originalName: session.original_name,
    size: session.total_size,
  });
}

function handleListSessions(req, res, ownerUserId) {
  const sessions = listActiveChunkUploads(ownerUserId).map(formatSessionResponse);
  res.json({ sessions });
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
  app.get(`${basePath}/sessions`, authMiddleware, (req, res) => {
    handleListSessions(req, res, ownerUserIdFromReq(req));
  });
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
