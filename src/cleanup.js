const {
  getStoredFilesPendingDeletion,
  deleteStoredFileRecord,
  deleteLinksForStoredFile,
  getStaleTempUploads,
  deleteTempUpload,
  deleteExpiredTokens,
} = require('./db');

const STALE_TEMP_HOURS = 24;

function removeFileFromDisk(filePath) {
  const fs = require('fs');
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore filesystem errors during cleanup
  }
}

function cleanupExpiredAndExhausted() {
  const pendingDeletion = getStoredFilesPendingDeletion();
  for (const storedFile of pendingDeletion) {
    removeFileFromDisk(storedFile.stored_path);
    deleteLinksForStoredFile(storedFile.id);
    deleteStoredFileRecord(storedFile.id);
  }

  const staleTemps = getStaleTempUploads(STALE_TEMP_HOURS);
  for (const temp of staleTemps) {
    removeFileFromDisk(temp.stored_path);
    deleteTempUpload(temp.id);
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
