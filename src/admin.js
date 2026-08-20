const {
  getAdminStats,
  getAllUsersWithStats,
  updateUserUploadSettings,
  getFullUserById,
  mbToBytes,
  bytesToMb,
} = require('./db');
const { daysToDatetime } = require('./limits');

function handleAdminStats(req, res) {
  res.json(getAdminStats());
}

function mapUserRow(row) {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    canUpload: Boolean(row.can_upload),
    maxFileSizeMb: bytesToMb(row.upload_max_file_size_bytes),
    maxTotalSizeMb: bytesToMb(row.upload_max_total_bytes),
    maxFiles: row.upload_max_files,
    uploadExpiresAt: row.upload_expires_at,
    fileCount: row.file_count,
    linkCount: row.link_count,
    storageMb: bytesToMb(row.storage_bytes),
  };
}

function handleAdminUsers(req, res) {
  const users = getAllUsersWithStats().map(mapUserRow);
  res.json({ users });
}

function handleAdminUpdateUser(req, res) {
  const userId = parseInt(req.params.id, 10);
  if (!userId) {
    res.status(400).json({ error: 'Некорректный id пользователя' });
    return;
  }

  const user = getFullUserById(userId);
  if (!user) {
    res.status(404).json({ error: 'Пользователь не найден' });
    return;
  }

  const body = req.body || {};
  const canUpload = Boolean(body.canUpload);

  let maxFileSizeBytes = mbToBytes(body.maxFileSizeMb);
  let maxTotalBytes = mbToBytes(body.maxTotalSizeMb);
  let maxFiles = body.maxFiles === '' || body.maxFiles === null || body.maxFiles === undefined
    ? null
    : parseInt(body.maxFiles, 10);

  if (maxFiles !== null && (!Number.isFinite(maxFiles) || maxFiles < 1)) {
    res.status(400).json({ error: 'Макс. файлов — целое число ≥ 1' });
    return;
  }

  let uploadExpiresAt = user.upload_expires_at;
  if (canUpload) {
    const validDays = body.uploadValidDays === '' || body.uploadValidDays === null || body.uploadValidDays === undefined
      ? null
      : parseInt(body.uploadValidDays, 10);

    if (validDays !== null && (!Number.isFinite(validDays) || validDays < 1)) {
      res.status(400).json({ error: 'Срок загрузки — целое число ≥ 1 дней' });
      return;
    }

    if (validDays !== null) {
      uploadExpiresAt = daysToDatetime(validDays);
    }
  } else {
    uploadExpiresAt = null;
    maxFileSizeBytes = null;
    maxTotalBytes = null;
    maxFiles = null;
  }

  updateUserUploadSettings(userId, {
    canUpload,
    maxFileSizeBytes: canUpload ? maxFileSizeBytes : null,
    maxTotalBytes: canUpload ? maxTotalBytes : null,
    maxFiles: canUpload ? maxFiles : null,
    uploadExpiresAt: canUpload ? uploadExpiresAt : null,
  });

  const updated = getAllUsersWithStats().find((u) => u.id === userId);
  res.json({ ok: true, user: mapUserRow(updated) });
}

module.exports = {
  handleAdminStats,
  handleAdminUsers,
  handleAdminUpdateUser,
};
