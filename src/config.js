const path = require('path');

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '100', 10);
const SHORT_NAME_MIN_LENGTH = 2;
const SHORT_NAME_MAX_LENGTH = 32;
const SHORT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  loginUsername: process.env.LOGIN_USERNAME || 'admin',
  loginPassword: process.env.LOGIN_PASSWORD || 'changeme',
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  maxFileSizeBytes: MAX_FILE_SIZE_MB * 1024 * 1024,
  uploadDir: path.resolve(process.env.UPLOAD_DIR || 'uploads'),
  tempDir: path.resolve(process.env.UPLOAD_DIR || 'uploads', 'temp'),
  dataDir: path.resolve(process.env.DATA_DIR || 'data'),
  dbPath: path.resolve(process.env.DATA_DIR || 'data', 'share.db'),
  shortNameMinLength: SHORT_NAME_MIN_LENGTH,
  shortNameMaxLength: SHORT_NAME_MAX_LENGTH,
  shortNamePattern: SHORT_NAME_PATTERN,
  cleanupIntervalMs: 60 * 60 * 1000,
};
