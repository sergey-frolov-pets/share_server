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
  createTempUpload,
  getTempUpload,
  deleteTempUpload,
  getLinkWithFile,
  incrementLinkDownloadCount,
  incrementStoredFileDownloadCount,
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
const {
  handleAdminStats,
  handleAdminUsers,
  handleAdminUpdateUser,
  handleAdminStorageSettings,
} = require('./admin');
const {
  handleCreateShare,
  handleGetShare,
  handleUpdateShare,
} = require('./share');
const { assertUserCanUpload } = require('./uploadQuota');
const { checkGlobalStorageQuota } = require('./db');
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
  isDownloadAllowed,
  isLinkExhausted,
} = require('./download');
const { handleRandomName } = require('./randomName');
const { registerChunkUploadRoutes } = require('./chunkUpload');

fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.tempDir, { recursive: true });
fs.mkdirSync(config.chunkUploadDir, { recursive: true });

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

app.get('/api/random-name', requireAdminAuth, handleRandomName);

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

    const globalQuota = checkGlobalStorageQuota(req.file.size);
    if (globalQuota.error) {
      removeFileFromDisk(req.file.path);
      res.status(403).json({ error: globalQuota.error });
      return;
    }

    const uploadId = req.file.filename.split('__')[0];
    createTempUpload({
      id: uploadId,
      originalName: req.file.originalname,
      storedPath: req.file.path,
      ownerUserId: null,
      fileSize: req.file.size,
    });

    res.json({
      uploadId,
      originalName: req.file.originalname,
      size: req.file.size,
    });
  });
});

registerChunkUploadRoutes(app, {
  basePath: '/api/upload',
  authMiddleware: requireAdminAuth,
  ownerUserIdFromReq: () => null,
});

app.post('/api/share', requireAdminAuth, (req, res) => {
  handleCreateShare(req, res, validateShortName);
});

app.get('/api/share/:shortName', requireAdminAuth, handleGetShare);
app.put('/api/share/:shortName', requireAdminAuth, (req, res) => {
  handleUpdateShare(req, res, validateShortName);
});

app.get('/api/admin/stats', requireAdminAuth, handleAdminStats);
app.get('/api/admin/users', requireAdminAuth, handleAdminUsers);
app.put('/api/admin/users/:id', requireAdminAuth, handleAdminUpdateUser);
app.put('/api/admin/storage', requireAdminAuth, handleAdminStorageSettings);

app.get('/api/user/upload-quota', requireUserAuth, (req, res) => {
  const user = require('./db').getFullUserById(req.session.userId);
  if (!user) {
    res.status(404).json({ error: 'Пользователь не найден' });
    return;
  }
  const { formatUserUploadInfo } = require('./uploadQuota');
  res.json(formatUserUploadInfo(user));
});

app.get('/api/user/random-name', requireUserAuth, handleRandomName);

app.get('/api/user/check-name/:name', requireUserAuth, (req, res) => {
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

app.post('/api/user/upload-temp', requireUserAuth, (req, res) => {
  const precheck = assertUserCanUpload(req.session.userId, 0);
  if (!precheck.user) {
    res.status(403).json({ error: precheck.error || 'Загрузка не разрешена' });
    return;
  }

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

    const quota = assertUserCanUpload(req.session.userId, req.file.size);
    if (quota.error) {
      removeFileFromDisk(req.file.path);
      res.status(403).json({ error: quota.error });
      return;
    }

    const globalQuota = checkGlobalStorageQuota(req.file.size);
    if (globalQuota.error) {
      removeFileFromDisk(req.file.path);
      res.status(403).json({ error: globalQuota.error });
      return;
    }

    const uploadId = req.file.filename.split('__')[0];
    createTempUpload({
      id: uploadId,
      originalName: req.file.originalname,
      storedPath: req.file.path,
      ownerUserId: req.session.userId,
      fileSize: req.file.size,
    });

    res.json({
      uploadId,
      originalName: req.file.originalname,
      size: req.file.size,
    });
  });
});

registerChunkUploadRoutes(app, {
  basePath: '/api/user/upload',
  authMiddleware: (req, res, next) => {
    requireUserAuth(req, res, () => {
      const precheck = assertUserCanUpload(req.session.userId, 0);
      if (!precheck.user) {
        res.status(403).json({ error: precheck.error || 'Загрузка не разрешена' });
        return;
      }
      next();
    });
  },
  ownerUserIdFromReq: (req) => req.session.userId,
});

app.post('/api/user/share', requireUserAuth, (req, res) => {
  req.shareOwnerUserId = req.session.userId;
  handleCreateShare(req, res, validateShortName);
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

  const file = getLinkWithFile(shortName);
  if (!file) {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
    return;
  }

  if (!isDownloadAllowed(file)) {
    if (!fs.existsSync(file.stored_path)) {
      res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
      return;
    }
    if (isLinkExhausted(file)) {
      res.status(403).sendFile(path.join(__dirname, '..', 'public', 'limit.html'));
      return;
    }
    res.status(403).sendFile(path.join(__dirname, '..', 'public', 'link-expired.html'));
    return;
  }

  if (shouldServeDownloadPage(file)) {
    res.sendFile(path.join(__dirname, '..', 'public', 'download.html'));
    return;
  }

  incrementLinkDownloadCount(file.link_id);
  incrementStoredFileDownloadCount(file.stored_file_id);
  res.download(file.stored_path, file.original_name);
});

startCleanupScheduler(config.cleanupIntervalMs);

app.listen(config.port, () => {
  console.log(`Share server: ${config.baseUrl}`);
});
