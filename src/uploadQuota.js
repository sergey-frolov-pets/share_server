const {
  getFullUserById,
  isUploadPermissionActive,
  getUserUploadUsage,
  checkUserUploadQuota,
  bytesToMb,
} = require('./db');

function assertUserCanUpload(userId, fileSizeBytes) {
  const user = getFullUserById(userId);
  if (!user) {
    return { error: 'Пользователь не найден' };
  }
  if (!isUploadPermissionActive(user)) {
    return { error: 'Загрузка файлов не разрешена' };
  }
  const quota = checkUserUploadQuota(user, fileSizeBytes);
  if (quota.error) {
    return { error: quota.error };
  }
  return { user, usage: quota.usage };
}

function assertTempOwnedByUser(temp, userId) {
  if (!temp) return { error: 'Загрузка не найдена' };
  if (temp.owner_user_id !== userId) {
    return { error: 'Загрузка не найдена' };
  }
  return { ok: true };
}

function formatUserUploadInfo(user) {
  const usage = getUserUploadUsage(user.id);
  const active = isUploadPermissionActive(user);
  return {
    canUpload: active,
    uploadExpiresAt: user.upload_expires_at,
    maxFileSizeMb: bytesToMb(user.upload_max_file_size_bytes),
    maxTotalSizeMb: bytesToMb(user.upload_max_total_bytes),
    maxFiles: user.upload_max_files,
    usage: {
      fileCount: usage.fileCount,
      totalBytes: usage.totalBytes,
      totalMb: bytesToMb(usage.totalBytes),
      linkCount: usage.linkCount,
    },
  };
}

module.exports = {
  assertUserCanUpload,
  assertTempOwnedByUser,
  formatUserUploadInfo,
};
