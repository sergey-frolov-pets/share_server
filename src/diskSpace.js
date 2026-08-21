const fs = require('fs');
const config = require('./config');

function getDiskSpaceForPath(targetPath) {
  try {
    const stats = fs.statfsSync(targetPath);
    const blockSize = stats.bsize;
    return {
      totalBytes: stats.blocks * blockSize,
      availableBytes: stats.bavail * blockSize,
      freeBytes: stats.bfree * blockSize,
    };
  } catch {
    return null;
  }
}

function getUploadDiskSpace() {
  return getDiskSpaceForPath(config.uploadDir);
}

module.exports = {
  getDiskSpaceForPath,
  getUploadDiskSpace,
};
