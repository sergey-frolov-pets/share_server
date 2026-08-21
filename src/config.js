const path = require('path');

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '4096', 10);
const CHUNK_SIZE_MB = parseInt(process.env.CHUNK_SIZE_MB || '5', 10);
const CHUNK_SESSION_MAX_AGE_HOURS = parseInt(process.env.CHUNK_SESSION_MAX_AGE_HOURS || '48', 10);
const SHORT_NAME_MIN_LENGTH = 2;
const SHORT_NAME_MAX_LENGTH = 32;
const SHORT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SMTP_CONNECTION_TIMEOUT_MS = parseInt(process.env.SMTP_CONNECTION_TIMEOUT_MS || '10000', 10);
const SMTP_SEND_TIMEOUT_MS = parseInt(process.env.SMTP_SEND_TIMEOUT_MS || '15000', 10);
const CLIENT_API_TIMEOUT_MS = 20000;

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  loginUsername: process.env.LOGIN_USERNAME || 'admin',
  loginPassword: process.env.LOGIN_PASSWORD || 'changeme',
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  maxFileSizeBytes: MAX_FILE_SIZE_MB * 1024 * 1024,
  chunkSizeBytes: CHUNK_SIZE_MB * 1024 * 1024,
  chunkSessionMaxAgeHours: CHUNK_SESSION_MAX_AGE_HOURS,
  uploadDir: path.resolve(process.env.UPLOAD_DIR || 'uploads'),
  tempDir: path.resolve(process.env.UPLOAD_DIR || 'uploads', 'temp'),
  chunkUploadDir: path.resolve(process.env.UPLOAD_DIR || 'uploads', 'chunks'),
  dataDir: path.resolve(process.env.DATA_DIR || 'data'),
  dbPath: path.resolve(process.env.DATA_DIR || 'data', 'share.db'),
  shortNameMinLength: SHORT_NAME_MIN_LENGTH,
  shortNameMaxLength: SHORT_NAME_MAX_LENGTH,
  shortNamePattern: SHORT_NAME_PATTERN,
  cleanupIntervalMs: 60 * 60 * 1000,
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || 'share@localhost',
  smtpConnectionTimeoutMs: SMTP_CONNECTION_TIMEOUT_MS,
  smtpSendTimeoutMs: SMTP_SEND_TIMEOUT_MS,
  clientApiTimeoutMs: CLIENT_API_TIMEOUT_MS,
};
