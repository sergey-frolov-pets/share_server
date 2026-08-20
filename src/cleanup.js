const fs = require('fs');
const {
  getExpiredFiles,
  getExhaustedFiles,
  getStaleTempUploads,
  deleteFileRecord,
  deleteTempUpload,
} = require('./db');

const STALE_TEMP_HOURS = 24;

function removeFileFromDisk(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore filesystem errors during cleanup
  }
}

function cleanupExpiredAndExhausted() {
  const toRemove = [...getExpiredFiles(), ...getExhaustedFiles()];
  const seen = new Set();

  for (const file of toRemove) {
    if (seen.has(file.id)) continue;
    seen.add(file.id);
    removeFileFromDisk(file.stored_path);
    deleteFileRecord(file.id);
  }

  const staleTemps = getStaleTempUploads(STALE_TEMP_HOURS);
  for (const temp of staleTemps) {
    removeFileFromDisk(temp.stored_path);
    deleteTempUpload(temp.id);
  }
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
