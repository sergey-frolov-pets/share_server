const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(config.dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS stored_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stored_path TEXT NOT NULL,
    original_name TEXT NOT NULL,
    total_download_count INTEGER NOT NULL DEFAULT 0,
    delete_max_downloads INTEGER,
    delete_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_name TEXT UNIQUE NOT NULL,
    stored_file_id INTEGER NOT NULL,
    link_download_count INTEGER NOT NULL DEFAULT 0,
    link_max_downloads INTEGER,
    link_expires_at TEXT,
    download_password_hash TEXT,
    allowed_emails TEXT NOT NULL DEFAULT '[]',
    allowed_domains TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (stored_file_id) REFERENCES stored_files(id)
  );

  CREATE TABLE IF NOT EXISTS temp_uploads (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    email TEXT NOT NULL,
    short_name TEXT,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function migrateLegacyFilesTable() {
  const legacy = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='files'"
  ).get();
  if (!legacy) return;

  const rows = db.prepare('SELECT * FROM files').all();
  for (const row of rows) {
    const stored = db.prepare(`
      INSERT INTO stored_files (
        stored_path, original_name, total_download_count,
        delete_max_downloads, delete_at, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      row.stored_path,
      row.original_name,
      row.download_count || 0,
      row.max_downloads,
      row.expires_at,
      row.created_at || new Date().toISOString().slice(0, 19).replace('T', ' ')
    );

    db.prepare(`
      INSERT INTO links (
        short_name, stored_file_id, link_download_count,
        link_max_downloads, link_expires_at, download_password_hash,
        allowed_emails, allowed_domains, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.short_name,
      stored.lastInsertRowid,
      row.download_count || 0,
      row.max_downloads,
      row.expires_at,
      row.download_password_hash || null,
      row.allowed_emails || '[]',
      row.allowed_domains || '[]',
      row.created_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
      row.created_at || new Date().toISOString().slice(0, 19).replace('T', ' ')
    );
  }

  db.exec('DROP TABLE files');
}

migrateLegacyFilesTable();

function migrateOwnershipAndUploadColumns() {
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('can_upload')) {
    db.exec('ALTER TABLE users ADD COLUMN can_upload INTEGER NOT NULL DEFAULT 0');
  }
  if (!userCols.includes('upload_max_file_size_bytes')) {
    db.exec('ALTER TABLE users ADD COLUMN upload_max_file_size_bytes INTEGER');
  }
  if (!userCols.includes('upload_max_total_bytes')) {
    db.exec('ALTER TABLE users ADD COLUMN upload_max_total_bytes INTEGER');
  }
  if (!userCols.includes('upload_max_files')) {
    db.exec('ALTER TABLE users ADD COLUMN upload_max_files INTEGER');
  }
  if (!userCols.includes('upload_expires_at')) {
    db.exec('ALTER TABLE users ADD COLUMN upload_expires_at TEXT');
  }

  const fileCols = db.prepare('PRAGMA table_info(stored_files)').all().map((c) => c.name);
  if (!fileCols.includes('owner_user_id')) {
    db.exec('ALTER TABLE stored_files ADD COLUMN owner_user_id INTEGER');
  }
  if (!fileCols.includes('file_size_bytes')) {
    db.exec('ALTER TABLE stored_files ADD COLUMN file_size_bytes INTEGER NOT NULL DEFAULT 0');
  }

  const linkCols = db.prepare('PRAGMA table_info(links)').all().map((c) => c.name);
  if (!linkCols.includes('owner_user_id')) {
    db.exec('ALTER TABLE links ADD COLUMN owner_user_id INTEGER');
  }

  const tempCols = db.prepare('PRAGMA table_info(temp_uploads)').all().map((c) => c.name);
  if (!tempCols.includes('owner_user_id')) {
    db.exec('ALTER TABLE temp_uploads ADD COLUMN owner_user_id INTEGER');
  }
  if (!tempCols.includes('file_size')) {
    db.exec('ALTER TABLE temp_uploads ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0');
  }

  if (!fileCols.includes('description')) {
    db.exec('ALTER TABLE stored_files ADD COLUMN description TEXT');
  }
}

migrateOwnershipAndUploadColumns();

function migrateChunkStorageColumns() {
  const fileCols = db.prepare('PRAGMA table_info(stored_files)').all().map((c) => c.name);
  if (!fileCols.includes('is_chunked')) {
    db.exec('ALTER TABLE stored_files ADD COLUMN is_chunked INTEGER NOT NULL DEFAULT 0');
  }
  if (!fileCols.includes('chunk_size')) {
    db.exec('ALTER TABLE stored_files ADD COLUMN chunk_size INTEGER');
  }
  if (!fileCols.includes('total_chunks')) {
    db.exec('ALTER TABLE stored_files ADD COLUMN total_chunks INTEGER');
  }

  const tempCols = db.prepare('PRAGMA table_info(temp_uploads)').all().map((c) => c.name);
  if (!tempCols.includes('is_chunked')) {
    db.exec('ALTER TABLE temp_uploads ADD COLUMN is_chunked INTEGER NOT NULL DEFAULT 0');
  }
  if (!tempCols.includes('chunk_size')) {
    db.exec('ALTER TABLE temp_uploads ADD COLUMN chunk_size INTEGER');
  }
  if (!tempCols.includes('total_chunks')) {
    db.exec('ALTER TABLE temp_uploads ADD COLUMN total_chunks INTEGER');
  }
}

migrateChunkStorageColumns();

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chunk_uploads (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    total_size INTEGER NOT NULL,
    chunk_size INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    received_chunks TEXT NOT NULL DEFAULT '[]',
    stored_path TEXT NOT NULL,
    owner_user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    file_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const GLOBAL_MAX_STORAGE_KEY = 'global_max_storage_bytes';

function getGlobalMaxStorageBytes() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(GLOBAL_MAX_STORAGE_KEY);
  if (!row || row.value === '') return null;
  const num = parseInt(row.value, 10);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function setGlobalMaxStorageBytes(bytes) {
  const value = bytes === null || bytes === undefined ? '' : String(bytes);
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(GLOBAL_MAX_STORAGE_KEY, value);
}

function getTotalDiskUsageBytes() {
  const row = db.prepare(`
    SELECT
      (SELECT COALESCE(SUM(file_size_bytes), 0) FROM stored_files) +
      (SELECT COALESCE(SUM(file_size), 0) FROM temp_uploads) +
      (SELECT COALESCE(SUM(total_size), 0) FROM chunk_uploads
        WHERE status NOT IN ('cancelled', 'complete')) AS total
  `).get();
  return row?.total || 0;
}

function checkGlobalStorageQuota(additionalBytes) {
  const maxBytes = getGlobalMaxStorageBytes();
  const usedBytes = getTotalDiskUsageBytes();
  const additional = additionalBytes || 0;

  if (!maxBytes) {
    return { ok: true, usedBytes, maxBytes: null };
  }

  if (usedBytes + additional > maxBytes) {
    const usedLabel = usedBytes < BYTES_PER_MB
      ? `${Math.round(usedBytes / 1024)} КБ`
      : `${bytesToMb(usedBytes)} МБ`;
    return {
      error: `Недостаточно места на диске. Лимит: ${bytesToMb(maxBytes)} МБ, использовано: ${usedLabel}`,
      usedBytes,
      maxBytes,
    };
  }

  return { ok: true, usedBytes, maxBytes };
}

const BYTES_PER_MB = 1024 * 1024;

function mbToBytes(mb) {
  if (mb === null || mb === undefined || mb === '') return null;
  const num = Number(mb);
  if (!Number.isFinite(num) || num < 1) return null;
  return Math.round(num * BYTES_PER_MB);
}

function bytesToMb(bytes) {
  if (bytes === null || bytes === undefined) return null;
  return Math.round((bytes / BYTES_PER_MB) * 100) / 100;
}

function isUploadPermissionActive(user) {
  if (!user?.can_upload) return false;
  if (user.upload_expires_at && new Date(user.upload_expires_at) <= new Date()) {
    return false;
  }
  return true;
}

function getUserUploadUsage(userId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS file_count,
      COALESCE(SUM(file_size_bytes), 0) AS total_bytes
    FROM stored_files
    WHERE owner_user_id = ?
  `).get(userId);

  const linkRow = db.prepare(`
    SELECT COUNT(*) AS link_count
    FROM links
    WHERE owner_user_id = ?
  `).get(userId);

  return {
    fileCount: row?.file_count || 0,
    totalBytes: row?.total_bytes || 0,
    linkCount: linkRow?.link_count || 0,
  };
}

function checkUserUploadQuota(user, additionalFileSizeBytes) {
  const usage = getUserUploadUsage(user.id);
  const size = additionalFileSizeBytes || 0;

  if (user.upload_max_file_size_bytes && size > user.upload_max_file_size_bytes) {
    return {
      error: `Макс. размер файла: ${bytesToMb(user.upload_max_file_size_bytes)} МБ`,
      usage,
    };
  }

  if (user.upload_max_total_bytes && usage.totalBytes + size > user.upload_max_total_bytes) {
    return {
      error: `Лимит общего объёма: ${bytesToMb(user.upload_max_total_bytes)} МБ`,
      usage,
    };
  }

  if (user.upload_max_files && usage.fileCount >= user.upload_max_files) {
    return {
      error: `Лимит файлов: ${user.upload_max_files}`,
      usage,
    };
  }

  return { ok: true, usage };
}

function isShortNameTaken(shortName) {
  const row = db.prepare('SELECT 1 FROM links WHERE short_name = ?').get(shortName);
  return Boolean(row);
}

function createStoredFile(record) {
  const result = db.prepare(`
    INSERT INTO stored_files (
      stored_path, original_name, delete_max_downloads, delete_at,
      owner_user_id, file_size_bytes, description,
      is_chunked, chunk_size, total_chunks
    )
    VALUES (
      @storedPath, @originalName, @deleteMaxDownloads, @deleteAt,
      @ownerUserId, @fileSizeBytes, @description,
      @isChunked, @chunkSize, @totalChunks
    )
  `).run({
    ...record,
    isChunked: record.isChunked ? 1 : 0,
    chunkSize: record.chunkSize ?? null,
    totalChunks: record.totalChunks ?? null,
  });
  return result.lastInsertRowid;
}

function getStoredFileById(id) {
  return db.prepare('SELECT * FROM stored_files WHERE id = ?').get(id);
}

function updateStoredFileLimits(id, record) {
  db.prepare(`
    UPDATE stored_files
    SET delete_max_downloads = @deleteMaxDownloads,
        delete_at = @deleteAt,
        description = @description
    WHERE id = @id
  `).run({
    id,
    deleteMaxDownloads: record.deleteMaxDownloads,
    deleteAt: record.deleteAt,
    description: record.description,
  });
}

function updateStoredFilePath(id, storedPath, originalName, limits) {
  db.prepare(`
    UPDATE stored_files
    SET stored_path = @storedPath, original_name = @originalName,
        total_download_count = 0, delete_max_downloads = @deleteMaxDownloads,
        delete_at = @deleteAt, description = @description
    WHERE id = @id
  `).run({
    id,
    storedPath,
    originalName,
    deleteMaxDownloads: limits.deleteMaxDownloads,
    deleteAt: limits.deleteAt,
    description: limits.description,
  });
}

function incrementStoredFileDownloadCount(id) {
  db.prepare(`
    UPDATE stored_files SET total_download_count = total_download_count + 1 WHERE id = ?
  `).run(id);
}

function deleteStoredFileRecord(id) {
  db.prepare('DELETE FROM stored_files WHERE id = ?').run(id);
}

function getStoredFilesPendingDeletion() {
  return db.prepare(`
    SELECT * FROM stored_files
    WHERE (
      delete_at IS NOT NULL AND delete_at <= datetime('now')
    ) OR (
      delete_max_downloads IS NOT NULL
      AND total_download_count >= delete_max_downloads
    )
  `).all();
}

function createLink(record) {
  db.prepare(`
    INSERT INTO links (
      short_name, stored_file_id, link_max_downloads, link_expires_at,
      download_password_hash, allowed_emails, allowed_domains, owner_user_id
    )
    VALUES (
      @shortName, @storedFileId, @linkMaxDownloads, @linkExpiresAt,
      @downloadPasswordHash, @allowedEmails, @allowedDomains, @ownerUserId
    )
  `).run(record);
}

function getLinkByShortName(shortName) {
  return db.prepare('SELECT * FROM links WHERE short_name = ?').get(shortName);
}

function getLinkWithFile(shortName) {
  return db.prepare(`
    SELECT
      l.id AS link_id,
      l.short_name,
      l.stored_file_id,
      l.link_download_count,
      l.link_max_downloads,
      l.link_expires_at,
      l.download_password_hash,
      l.allowed_emails,
      l.allowed_domains,
      l.owner_user_id,
      l.created_at AS link_created_at,
      l.updated_at AS link_updated_at,
      s.id AS stored_file_id,
      s.stored_path,
      s.original_name,
      s.total_download_count,
      s.delete_max_downloads,
      s.delete_at,
      s.description,
      s.file_size_bytes,
      s.is_chunked,
      s.chunk_size,
      s.total_chunks,
      s.created_at AS file_created_at
    FROM links l
    JOIN stored_files s ON s.id = l.stored_file_id
    WHERE l.short_name = ?
  `).get(shortName);
}

function updateLink(shortName, record) {
  db.prepare(`
    UPDATE links SET
      short_name = @newShortName,
      stored_file_id = @storedFileId,
      link_max_downloads = @linkMaxDownloads,
      link_expires_at = @linkExpiresAt,
      link_download_count = @linkDownloadCount,
      download_password_hash = @downloadPasswordHash,
      allowed_emails = @allowedEmails,
      allowed_domains = @allowedDomains,
      updated_at = datetime('now')
    WHERE short_name = @shortName
  `).run({
    shortName,
    newShortName: record.newShortName,
    storedFileId: record.storedFileId,
    linkMaxDownloads: record.linkMaxDownloads,
    linkExpiresAt: record.linkExpiresAt,
    linkDownloadCount: record.linkDownloadCount,
    downloadPasswordHash: record.downloadPasswordHash,
    allowedEmails: record.allowedEmails,
    allowedDomains: record.allowedDomains,
  });
}

function incrementLinkDownloadCount(linkId) {
  db.prepare(`
    UPDATE links SET link_download_count = link_download_count + 1 WHERE id = ?
  `).run(linkId);
}

function deleteLinksForStoredFile(storedFileId) {
  db.prepare('DELETE FROM links WHERE stored_file_id = ?').run(storedFileId);
}

function countLinksForStoredFile(storedFileId, excludeLinkId = null) {
  if (excludeLinkId) {
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM links
      WHERE stored_file_id = ? AND id != ?
    `).get(storedFileId, excludeLinkId);
    return row.count;
  }
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM links WHERE stored_file_id = ?
  `).get(storedFileId);
  return row.count;
}

function createTempUpload(record) {
  db.prepare(`
    INSERT INTO temp_uploads (
      id, original_name, stored_path, owner_user_id, file_size,
      is_chunked, chunk_size, total_chunks
    )
    VALUES (
      @id, @originalName, @storedPath, @ownerUserId, @fileSize,
      @isChunked, @chunkSize, @totalChunks
    )
  `).run({
    ...record,
    isChunked: record.isChunked ? 1 : 0,
    chunkSize: record.chunkSize ?? null,
    totalChunks: record.totalChunks ?? null,
  });
}

function getTempUpload(id) {
  return db.prepare('SELECT * FROM temp_uploads WHERE id = ?').get(id);
}

function deleteTempUpload(id) {
  db.prepare('DELETE FROM temp_uploads WHERE id = ?').run(id);
}

function getStaleTempUploads(hoursOld) {
  return db.prepare(`
    SELECT * FROM temp_uploads
    WHERE created_at <= datetime('now', '-' || ? || ' hours')
  `).all(hoursOld);
}

function createChunkUpload(record) {
  db.prepare(`
    INSERT INTO chunk_uploads (
      id, original_name, total_size, chunk_size, total_chunks,
      received_chunks, stored_path, owner_user_id, status, file_fingerprint
    )
    VALUES (
      @id, @originalName, @totalSize, @chunkSize, @totalChunks,
      @receivedChunks, @storedPath, @ownerUserId, @status, @fileFingerprint
    )
  `).run(record);
}

function getChunkUpload(id) {
  return db.prepare('SELECT * FROM chunk_uploads WHERE id = ?').get(id);
}

function updateChunkUploadProgress(id, receivedChunks, status) {
  db.prepare(`
    UPDATE chunk_uploads
    SET received_chunks = @receivedChunks,
        status = @status,
        updated_at = datetime('now')
    WHERE id = @id
  `).run({ id, receivedChunks, status });
}

function setChunkUploadStatus(id, status) {
  db.prepare(`
    UPDATE chunk_uploads
    SET status = @status, updated_at = datetime('now')
    WHERE id = @id
  `).run({ id, status });
}

function deleteChunkUpload(id) {
  db.prepare('DELETE FROM chunk_uploads WHERE id = ?').run(id);
}

function listActiveChunkUploads(ownerUserId) {
  if (ownerUserId == null) {
    return db.prepare(`
      SELECT * FROM chunk_uploads
      WHERE owner_user_id IS NULL
        AND status NOT IN ('complete', 'cancelled')
      ORDER BY updated_at DESC
    `).all();
  }

  return db.prepare(`
    SELECT * FROM chunk_uploads
    WHERE owner_user_id = ?
      AND status NOT IN ('complete', 'cancelled')
    ORDER BY updated_at DESC
  `).all(ownerUserId);
}

function getStaleChunkUploads(hoursOld) {
  return db.prepare(`
    SELECT * FROM chunk_uploads
    WHERE status NOT IN ('complete', 'cancelled')
      AND updated_at <= datetime('now', '-' || ? || ' hours')
  `).all(hoursOld);
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  return db.prepare(`
    SELECT id, email, created_at, can_upload, upload_max_file_size_bytes,
           upload_max_total_bytes, upload_max_files, upload_expires_at
    FROM users WHERE id = ?
  `).get(id);
}

function getFullUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getAllUsersWithStats() {
  return db.prepare(`
    SELECT
      u.id,
      u.email,
      u.created_at,
      u.can_upload,
      u.upload_max_file_size_bytes,
      u.upload_max_total_bytes,
      u.upload_max_files,
      u.upload_expires_at,
      COALESCE(fs.file_count, 0) AS file_count,
      COALESCE(fs.storage_bytes, 0) AS storage_bytes,
      COALESCE(ls.link_count, 0) AS link_count
    FROM users u
    LEFT JOIN (
      SELECT owner_user_id, COUNT(*) AS file_count, SUM(file_size_bytes) AS storage_bytes
      FROM stored_files
      WHERE owner_user_id IS NOT NULL
      GROUP BY owner_user_id
    ) fs ON fs.owner_user_id = u.id
    LEFT JOIN (
      SELECT owner_user_id, COUNT(*) AS link_count
      FROM links
      WHERE owner_user_id IS NOT NULL
      GROUP BY owner_user_id
    ) ls ON ls.owner_user_id = u.id
    ORDER BY u.created_at DESC
  `).all();
}

function updateUserUploadSettings(userId, settings) {
  db.prepare(`
    UPDATE users SET
      can_upload = @canUpload,
      upload_max_file_size_bytes = @maxFileSizeBytes,
      upload_max_total_bytes = @maxTotalBytes,
      upload_max_files = @maxFiles,
      upload_expires_at = @uploadExpiresAt
    WHERE id = @userId
  `).run({
    userId,
    canUpload: settings.canUpload ? 1 : 0,
    maxFileSizeBytes: settings.maxFileSizeBytes,
    maxTotalBytes: settings.maxTotalBytes,
    maxFiles: settings.maxFiles,
    uploadExpiresAt: settings.uploadExpiresAt,
  });
}

function getAdminStats() {
  const users = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const uploaders = db.prepare(
    'SELECT COUNT(*) AS count FROM users WHERE can_upload = 1'
  ).get().count;
  const links = db.prepare('SELECT COUNT(*) AS count FROM links').get().count;
  const files = db.prepare('SELECT COUNT(*) AS count FROM stored_files').get().count;
  const storageBytes = getTotalDiskUsageBytes();
  const maxStorageBytes = getGlobalMaxStorageBytes();
  const linkDownloads = db.prepare(
    'SELECT COALESCE(SUM(link_download_count), 0) AS total FROM links'
  ).get().total;
  const fileDownloads = db.prepare(
    'SELECT COALESCE(SUM(total_download_count), 0) AS total FROM stored_files'
  ).get().total;

  return {
    users,
    uploaders,
    links,
    files,
    storageBytes,
    storageMb: bytesToMb(storageBytes),
    maxStorageBytes,
    maxStorageMb: bytesToMb(maxStorageBytes),
    storageFreeMb: maxStorageBytes ? bytesToMb(maxStorageBytes - storageBytes) : null,
    linkDownloads,
    fileDownloads,
  };
}

function createUser(email, passwordHash) {
  const result = db.prepare(`
    INSERT INTO users (email, password_hash)
    VALUES (?, ?)
  `).run(email, passwordHash);
  return result.lastInsertRowid;
}

function updateUserPassword(userId, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

function createToken(record) {
  db.prepare(`
    INSERT INTO tokens (token, type, email, short_name, expires_at)
    VALUES (@token, @type, @email, @shortName, @expiresAt)
  `).run(record);
}

function getToken(tokenValue) {
  return db.prepare('SELECT * FROM tokens WHERE token = ?').get(tokenValue);
}

function markTokenUsed(tokenValue) {
  db.prepare(`
    UPDATE tokens SET used_at = datetime('now') WHERE token = ?
  `).run(tokenValue);
}

function deleteExpiredTokens() {
  db.prepare('DELETE FROM tokens WHERE expires_at <= datetime(\'now\') OR used_at IS NOT NULL').run();
}

function getAllStoredFilesAdmin() {
  return db.prepare(`
    SELECT
      s.*,
      (SELECT COUNT(*) FROM links l WHERE l.stored_file_id = s.id) AS link_count
    FROM stored_files s
    ORDER BY s.created_at DESC
  `).all();
}

function getLinksForStoredFile(storedFileId) {
  return db.prepare(`
    SELECT
      id,
      short_name,
      link_download_count,
      link_max_downloads,
      link_expires_at,
      created_at,
      updated_at
    FROM links
    WHERE stored_file_id = ?
    ORDER BY created_at DESC
  `).all(storedFileId);
}

function updateStoredFileRename(id, originalName, storedPath) {
  db.prepare(`
    UPDATE stored_files
    SET original_name = @originalName, stored_path = @storedPath
    WHERE id = @id
  `).run({ id, originalName, storedPath });
}

function updateLinkShortNameById(linkId, shortName) {
  db.prepare(`
    UPDATE links
    SET short_name = @shortName, updated_at = datetime('now')
    WHERE id = @linkId
  `).run({ linkId, shortName });
}

function updateLinkById(linkId, fields) {
  db.prepare(`
    UPDATE links
    SET short_name = @shortName,
        link_max_downloads = @linkMaxDownloads,
        link_expires_at = @linkExpiresAt,
        updated_at = datetime('now')
    WHERE id = @linkId
  `).run({
    linkId,
    shortName: fields.shortName,
    linkMaxDownloads: fields.linkMaxDownloads,
    linkExpiresAt: fields.linkExpiresAt,
  });
}

function touchLinksUpdatedAt(storedFileId) {
  db.prepare(`
    UPDATE links SET updated_at = datetime('now') WHERE stored_file_id = ?
  `).run(storedFileId);
}

function getLinkById(linkId) {
  return db.prepare('SELECT * FROM links WHERE id = ?').get(linkId);
}

function deleteLinkById(linkId) {
  db.prepare('DELETE FROM links WHERE id = ?').run(linkId);
}

function getAllLinksAdmin() {
  return db.prepare(`
    SELECT
      l.id,
      l.short_name,
      l.stored_file_id,
      l.link_download_count,
      l.link_max_downloads,
      l.link_expires_at,
      l.created_at,
      l.updated_at,
      s.original_name,
      s.file_size_bytes,
      s.total_download_count AS file_download_count
    FROM links l
    JOIN stored_files s ON s.id = l.stored_file_id
    ORDER BY l.updated_at DESC
  `).all();
}

// Legacy aliases used by access/download until fully migrated
function getFileByShortName(shortName) {
  return getLinkWithFile(shortName);
}

module.exports = {
  db,
  isShortNameTaken,
  createStoredFile,
  getStoredFileById,
  updateStoredFileLimits,
  updateStoredFilePath,
  incrementStoredFileDownloadCount,
  deleteStoredFileRecord,
  getStoredFilesPendingDeletion,
  createLink,
  getLinkByShortName,
  getLinkWithFile,
  updateLink,
  incrementLinkDownloadCount,
  deleteLinksForStoredFile,
  countLinksForStoredFile,
  createTempUpload,
  getTempUpload,
  deleteTempUpload,
  getStaleTempUploads,
  createChunkUpload,
  getChunkUpload,
  updateChunkUploadProgress,
  setChunkUploadStatus,
  deleteChunkUpload,
  listActiveChunkUploads,
  getStaleChunkUploads,
  getUserByEmail,
  getUserById,
  createUser,
  updateUserPassword,
  createToken,
  getToken,
  markTokenUsed,
  deleteExpiredTokens,
  getFileByShortName,
  mbToBytes,
  bytesToMb,
  isUploadPermissionActive,
  getUserUploadUsage,
  checkUserUploadQuota,
  getFullUserById,
  getAllUsersWithStats,
  updateUserUploadSettings,
  getAdminStats,
  getGlobalMaxStorageBytes,
  setGlobalMaxStorageBytes,
  getTotalDiskUsageBytes,
  checkGlobalStorageQuota,
  getAllStoredFilesAdmin,
  getLinksForStoredFile,
  updateStoredFileRename,
  updateLinkShortNameById,
  updateLinkById,
  touchLinksUpdatedAt,
  getLinkById,
  deleteLinkById,
  getAllLinksAdmin,
};
