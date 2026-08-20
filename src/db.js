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

function isShortNameTaken(shortName) {
  const row = db.prepare('SELECT 1 FROM links WHERE short_name = ?').get(shortName);
  return Boolean(row);
}

function createStoredFile(record) {
  const result = db.prepare(`
    INSERT INTO stored_files (
      stored_path, original_name, delete_max_downloads, delete_at
    )
    VALUES (@storedPath, @originalName, @deleteMaxDownloads, @deleteAt)
  `).run(record);
  return result.lastInsertRowid;
}

function getStoredFileById(id) {
  return db.prepare('SELECT * FROM stored_files WHERE id = ?').get(id);
}

function updateStoredFileLimits(id, record) {
  db.prepare(`
    UPDATE stored_files
    SET delete_max_downloads = @deleteMaxDownloads, delete_at = @deleteAt
    WHERE id = @id
  `).run({ id, ...record });
}

function updateStoredFilePath(id, storedPath, originalName, limits) {
  db.prepare(`
    UPDATE stored_files
    SET stored_path = @storedPath, original_name = @originalName,
        total_download_count = 0, delete_max_downloads = @deleteMaxDownloads,
        delete_at = @deleteAt
    WHERE id = @id
  `).run({
    id,
    storedPath,
    originalName,
    deleteMaxDownloads: limits.deleteMaxDownloads,
    deleteAt: limits.deleteAt,
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
      download_password_hash, allowed_emails, allowed_domains
    )
    VALUES (
      @shortName, @storedFileId, @linkMaxDownloads, @linkExpiresAt,
      @downloadPasswordHash, @allowedEmails, @allowedDomains
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
      l.created_at AS link_created_at,
      l.updated_at AS link_updated_at,
      s.id AS stored_file_id,
      s.stored_path,
      s.original_name,
      s.total_download_count,
      s.delete_max_downloads,
      s.delete_at,
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
    INSERT INTO temp_uploads (id, original_name, stored_path)
    VALUES (@id, @originalName, @storedPath)
  `).run(record);
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

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  return db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(id);
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
  getUserByEmail,
  getUserById,
  createUser,
  updateUserPassword,
  createToken,
  getToken,
  markTokenUsed,
  deleteExpiredTokens,
  getFileByShortName,
};
