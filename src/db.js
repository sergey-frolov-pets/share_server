const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(config.dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_name TEXT UNIQUE NOT NULL,
    original_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    max_downloads INTEGER NOT NULL,
    download_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    download_password_hash TEXT,
    allowed_emails TEXT NOT NULL DEFAULT '[]',
    allowed_domains TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

function migrateFilesTable() {
  const columns = db.prepare('PRAGMA table_info(files)').all().map((col) => col.name);
  if (!columns.includes('download_password_hash')) {
    db.exec('ALTER TABLE files ADD COLUMN download_password_hash TEXT');
  }
  if (!columns.includes('allowed_emails')) {
    db.exec("ALTER TABLE files ADD COLUMN allowed_emails TEXT NOT NULL DEFAULT '[]'");
  }
  if (!columns.includes('allowed_domains')) {
    db.exec("ALTER TABLE files ADD COLUMN allowed_domains TEXT NOT NULL DEFAULT '[]'");
  }
}

migrateFilesTable();

function isShortNameTaken(shortName) {
  const row = db.prepare('SELECT 1 FROM files WHERE short_name = ?').get(shortName);
  return Boolean(row);
}

function createFile(record) {
  db.prepare(`
    INSERT INTO files (
      short_name, original_name, stored_path, max_downloads, expires_at,
      download_password_hash, allowed_emails, allowed_domains
    )
    VALUES (
      @shortName, @originalName, @storedPath, @maxDownloads, @expiresAt,
      @downloadPasswordHash, @allowedEmails, @allowedDomains
    )
  `).run(record);
}

function getFileByShortName(shortName) {
  return db.prepare('SELECT * FROM files WHERE short_name = ?').get(shortName);
}

function incrementDownloadCount(id) {
  db.prepare('UPDATE files SET download_count = download_count + 1 WHERE id = ?').run(id);
}

function deleteFileRecord(id) {
  db.prepare('DELETE FROM files WHERE id = ?').run(id);
}

function getExpiredFiles() {
  return db.prepare('SELECT * FROM files WHERE expires_at <= datetime(\'now\')').all();
}

function getExhaustedFiles() {
  return db.prepare('SELECT * FROM files WHERE download_count >= max_downloads').all();
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

module.exports = {
  db,
  isShortNameTaken,
  createFile,
  getFileByShortName,
  incrementDownloadCount,
  deleteFileRecord,
  getExpiredFiles,
  getExhaustedFiles,
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
};
