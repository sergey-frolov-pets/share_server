const fs = require('fs');
const path = require('path');
const config = require('./config');

const CHUNK_PART_SUFFIX = '.part';

function getSessionChunkDir(sessionId) {
  return path.join(config.chunkUploadDir, sessionId);
}

function getChunkPartPath(chunkDir, chunkIndex) {
  return path.join(chunkDir, `${chunkIndex}${CHUNK_PART_SUFFIX}`);
}

function ensureChunkDir(chunkDir) {
  fs.mkdirSync(chunkDir, { recursive: true });
}

function writeChunkPart(chunkDir, chunkIndex, buffer) {
  ensureChunkDir(chunkDir);
  fs.writeFileSync(getChunkPartPath(chunkDir, chunkIndex), buffer);
}

function chunkPartExists(chunkDir, chunkIndex) {
  return fs.existsSync(getChunkPartPath(chunkDir, chunkIndex));
}

function isChunkedRecord(record) {
  return Boolean(record?.is_chunked);
}

function removeStorageFromDisk(storedPath, isChunked = false) {
  if (!storedPath) return;
  try {
    if (!fs.existsSync(storedPath)) return;
    const stat = fs.statSync(storedPath);
    if (isChunked || stat.isDirectory()) {
      fs.rmSync(storedPath, { recursive: true, force: true });
      return;
    }
    fs.unlinkSync(storedPath);
  } catch {
    // ignore filesystem errors during cleanup
  }
}

function storageExists(record) {
  if (!record?.stored_path) return false;

  if (isChunkedRecord(record)) {
    const totalChunks = record.total_chunks || 0;
    if (!fs.existsSync(record.stored_path)) return false;
    for (let index = 0; index < totalChunks; index += 1) {
      if (!chunkPartExists(record.stored_path, index)) return false;
    }
    return true;
  }

  return fs.existsSync(record.stored_path);
}

function getStoredFileSize(record) {
  if (record.file_size_bytes) return record.file_size_bytes;
  if (record.file_size) return record.file_size;
  if (record.total_size) return record.total_size;
  if (!record.stored_path || !fs.existsSync(record.stored_path)) return 0;
  try {
    return fs.statSync(record.stored_path).size;
  } catch {
    return 0;
  }
}

function buildContentDisposition(originalName) {
  const encoded = encodeURIComponent(originalName).replace(/['()]/g, escape);
  const asciiFallback = originalName.replace(/[^\x20-\x7E]/g, '_') || 'download';
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function sendStoredFile(res, record, originalName) {
  if (isChunkedRecord(record)) {
    streamChunkedFile(res, record, originalName);
    return;
  }
  res.download(record.stored_path, originalName);
}

function streamChunkedFile(res, record, originalName) {
  const chunkDir = record.stored_path;
  const totalChunks = record.total_chunks || 0;
  const totalSize = getStoredFileSize(record);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', buildContentDisposition(originalName));
  if (totalSize > 0) {
    res.setHeader('Content-Length', String(totalSize));
  }

  let chunkIndex = 0;

  function sendNext() {
    if (chunkIndex >= totalChunks) {
      res.end();
      return;
    }

    const partPath = getChunkPartPath(chunkDir, chunkIndex);
    const stream = fs.createReadStream(partPath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500);
      }
      res.end();
    });
    stream.on('end', () => {
      chunkIndex += 1;
      sendNext();
    });
    stream.pipe(res, { end: false });
  }

  sendNext();
}

module.exports = {
  getSessionChunkDir,
  getChunkPartPath,
  ensureChunkDir,
  writeChunkPart,
  chunkPartExists,
  isChunkedRecord,
  removeStorageFromDisk,
  storageExists,
  getStoredFileSize,
  sendStoredFile,
  streamChunkedFile,
};
