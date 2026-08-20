require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const config = require('./config');
const {
  isShortNameTaken,
  createFile,
  getFileByShortName,
  createTempUpload,
  getTempUpload,
  deleteTempUpload,
} = require('./db');
const {
  requireAdminAuth,
  handleAdminLogin,
  handleAdminLogout,
  handleAdminMe,
  handleUserLogin,
  handleUserLogout,
  handleUserMe,
} = require('./auth');
const { startCleanupScheduler, removeFileFromDisk } = require('./cleanup');
const { hashSecret } = require('./password');
const { parseAccessInput, parseDomainInput } = require('./access');
const {
  handleRegister,
  handleChangePassword,
  handleForgotPassword,
  handleResetPassword,
  handleRegisterInfo,
  handleResetInfo,
  requireUserAuth,
} = require('./users');
const {
  handleFileInfo,
  handleAuthorizeDownload,
  handleDownloadFile,
  shouldServeDownloadPage,
  isFileAvailable,
} = require('./download');

fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.tempDir, { recursive: true });

const tempStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.tempDir),
  filename: (_req, file, cb) => {
    const id = crypto.randomBytes(16).toString('hex');
    const safeName = file.originalname.replace(/[^\w.\-() ]/g, '_');
    cb(null, `${id}__${safeName}`);
  },
});

const uploadTemp = multer({
  storage: tempStorage,
  limits: { fileSize: config.maxFileSizeBytes },
});

const app = express();

app.use(express.json());
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  })
);

app.use(express.static(path.join(__dirname, '..', 'public')));

function validateShortName(shortName) {
  if (!shortName || typeof shortName !== 'string') {
    return 'Укажите короткое имя';
  }

  const trimmed = shortName.trim();
  if (trimmed.length < config.shortNameMinLength) {
    return `Имя должно быть не короче ${config.shortNameMinLength} символов`;
  }
  if (trimmed.length > config.shortNameMaxLength) {
    return `Имя должно быть не длиннее ${config.shortNameMaxLength} символов`;
  }
  if (!config.shortNamePattern.test(trimmed)) {
    return 'Имя может содержать только латинские буквы, цифры, _ и -';
  }
  if (['api', 'register', 'reset-password', 'account'].includes(trimmed.toLowerCase())) {
    return 'Это имя недоступно';
  }
  return null;
}

function parsePositiveInt(value, fieldName) {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num < 1) {
    return { error: `${fieldName} должно быть целым числом ≥ 1` };
  }
  return { value: num };
}

app.post('/api/login', handleAdminLogin);
app.post('/api/logout', handleAdminLogout);
app.get('/api/me', handleAdminMe);

app.post('/api/user/login', handleUserLogin);
app.post('/api/user/logout', handleUserLogout);
app.get('/api/user/me', handleUserMe);
app.post('/api/user/register', handleRegister);
app.get('/api/user/register-info', handleRegisterInfo);
app.post('/api/user/change-password', requireUserAuth, handleChangePassword);
app.post('/api/user/forgot-password', handleForgotPassword);
app.post('/api/user/reset-password', handleResetPassword);
app.get('/api/user/reset-info', handleResetInfo);

app.get('/api/check-name/:name', requireAdminAuth, (req, res) => {
  const error = validateShortName(req.params.name);
  if (error) {
    res.json({ available: false, error });
    return;
  }

  const trimmed = req.params.name.trim();
  if (isShortNameTaken(trimmed)) {
    res.json({ available: false, error: 'Такое имя уже занято' });
    return;
  }

  res.json({ available: true });
});

app.post('/api/upload-temp', requireAdminAuth, (req, res) => {
  uploadTemp.single('file')(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Файл слишком большой (макс. ${config.maxFileSizeBytes / (1024 * 1024)} МБ)`
          : err.message || 'Ошибка загрузки';
      res.status(400).json({ error: message });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Файл не передан' });
      return;
    }

    const uploadId = req.file.filename.split('__')[0];
    createTempUpload({
      id: uploadId,
      originalName: req.file.originalname,
      storedPath: req.file.path,
    });

    res.json({
      uploadId,
      originalName: req.file.originalname,
      size: req.file.size,
    });
  });
});

app.post('/api/share', requireAdminAuth, (req, res) => {
  const {
    uploadId,
    shortName,
    maxDownloads,
    storageDays,
    downloadPassword,
    allowedEmails,
    allowedDomains,
  } = req.body || {};

  if (!uploadId) {
    res.status(400).json({ error: 'Загрузка не найдена' });
    return;
  }

  const nameError = validateShortName(shortName);
  if (nameError) {
    res.status(400).json({ error: nameError });
    return;
  }

  const trimmedName = shortName.trim();
  if (isShortNameTaken(trimmedName)) {
    res.status(409).json({ error: 'Такое имя уже занято' });
    return;
  }

  const downloadsParsed = parsePositiveInt(maxDownloads, 'Лимит скачиваний');
  if (downloadsParsed.error) {
    res.status(400).json({ error: downloadsParsed.error });
    return;
  }

  const daysParsed = parsePositiveInt(storageDays, 'Срок хранения');
  if (daysParsed.error) {
    res.status(400).json({ error: daysParsed.error });
    return;
  }

  const temp = getTempUpload(uploadId);
  if (!temp) {
    res.status(400).json({ error: 'Загрузка не найдена или уже использована' });
    return;
  }

  const emailList = parseAccessInput(allowedEmails || '');
  const domainList = parseDomainInput(allowedDomains || '');
  let downloadPasswordHash = null;

  if (downloadPassword && String(downloadPassword).trim()) {
    if (String(downloadPassword).length < 4) {
      res.status(400).json({ error: 'Пароль для скачивания — минимум 4 символа' });
      return;
    }
    downloadPasswordHash = hashSecret(String(downloadPassword).trim());
  }

  const finalPath = path.join(
    config.uploadDir,
    `${trimmedName}__${temp.original_name.replace(/[^\w.\-() ]/g, '_')}`
  );
  try {
    fs.renameSync(temp.stored_path, finalPath);
  } catch {
    res.status(500).json({ error: 'Не удалось сохранить файл' });
    return;
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + daysParsed.value);
  const expiresAtIso = expiresAt.toISOString().slice(0, 19).replace('T', ' ');

  try {
    createFile({
      shortName: trimmedName,
      originalName: temp.original_name,
      storedPath: finalPath,
      maxDownloads: downloadsParsed.value,
      expiresAt: expiresAtIso,
      downloadPasswordHash,
      allowedEmails: JSON.stringify(emailList),
      allowedDomains: JSON.stringify(domainList),
    });
    deleteTempUpload(uploadId);
  } catch {
    removeFileFromDisk(finalPath);
    res.status(409).json({ error: 'Такое имя уже занято' });
    return;
  }

  const shareUrl = `${config.baseUrl}/${encodeURIComponent(trimmedName)}`;
  res.json({
    ok: true,
    shareUrl,
    shortName: trimmedName,
    maxDownloads: downloadsParsed.value,
    storageDays: daysParsed.value,
    expiresAt: expiresAtIso,
    hasDownloadPassword: Boolean(downloadPasswordHash),
    allowedEmails: emailList,
    allowedDomains: domainList,
  });
});

app.get('/api/file/:name', handleFileInfo);
app.post('/api/download/:name/authorize', handleAuthorizeDownload);
app.get('/api/download/:name/file', handleDownloadFile);

app.get('/:shortName', (req, res, next) => {
  const shortName = req.params.shortName;
  const reserved = ['api', 'register', 'reset-password', 'account'];
  if (reserved.includes(shortName) || shortName.includes('.')) {
    next();
    return;
  }

  const file = getFileByShortName(shortName);
  if (!file) {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
    return;
  }

  if (!isFileAvailable(file)) {
    if (file.download_count >= file.max_downloads) {
      res.status(403).sendFile(path.join(__dirname, '..', 'public', 'limit.html'));
      return;
    }
    res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
    return;
  }

  if (shouldServeDownloadPage(file)) {
    res.sendFile(path.join(__dirname, '..', 'public', 'download.html'));
    return;
  }

  if (!fs.existsSync(file.stored_path)) {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
    return;
  }

  const { incrementDownloadCount } = require('./db');
  incrementDownloadCount(file.id);
  res.download(file.stored_path, file.original_name);
});

startCleanupScheduler(config.cleanupIntervalMs);

app.listen(config.port, () => {
  console.log(`Share server: ${config.baseUrl}`);
});
