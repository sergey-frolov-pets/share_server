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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS temp_uploads (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function isShortNameTaken(shortName) {
  const row = db.prepare('SELECT 1 FROM files WHERE short_name = ?').get(shortName);
  return Boolean(row);
}

function createFile(record) {
  db.prepare(`
    INSERT INTO files (short_name, original_name, stored_path, max_downloads, expires_at)
    VALUES (@shortName, @originalName, @storedPath, @maxDownloads, @expiresAt)
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
};
