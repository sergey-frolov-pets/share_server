const {
  getStoredFilesPendingDeletion,
  deleteStoredFileRecord,
  deleteLinksForStoredFile,
  getStaleTempUploads,
  deleteTempUpload,
  getStaleChunkUploads,
  deleteChunkUpload,
  deleteExpiredTokens,
} = require('./db');
const config = require('./config');
const { removeStorageFromDisk } = require('./chunkStorage');

const STALE_TEMP_HOURS = 24;

function removeFileFromDisk(filePath, isChunked = false) {
  removeStorageFromDisk(filePath, isChunked);
}

function cleanupExpiredAndExhausted() {
  const pendingDeletion = getStoredFilesPendingDeletion();
  for (const storedFile of pendingDeletion) {
    removeStorageFromDisk(storedFile.stored_path, storedFile.is_chunked);
    deleteLinksForStoredFile(storedFile.id);
    deleteStoredFileRecord(storedFile.id);
  }

  const staleTemps = getStaleTempUploads(STALE_TEMP_HOURS);
  for (const temp of staleTemps) {
    removeStorageFromDisk(temp.stored_path, temp.is_chunked);
    deleteTempUpload(temp.id);
  }

  const staleChunks = getStaleChunkUploads(config.chunkSessionMaxAgeHours);
  for (const chunk of staleChunks) {
    removeStorageFromDisk(chunk.stored_path, true);
    deleteChunkUpload(chunk.id);
  }

  deleteExpiredTokens();
}

function startCleanupScheduler(intervalMs) {
  cleanupExpiredAndExhausted();
  setInterval(cleanupExpiredAndExhausted, intervalMs);
}

module.exports = {
  cleanupExpiredAndExhausted,
  startCleanupScheduler,
  removeFileFromDisk,
};
