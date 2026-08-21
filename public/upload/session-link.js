(function (global) {
  const { UPLOAD_CONFIG } = global;

  function storageKey(apiPrefix, file) {
    if (global.getChunkUploadStorageKey) {
      return global.getChunkUploadStorageKey(apiPrefix, file);
    }
    return `${UPLOAD_CONFIG.SESSION_STORAGE_PREFIX}${apiPrefix}:${file.name}:${file.size}:${file.lastModified || 0}`;
  }

  function linkFileToSession(apiPrefix, file, sessionId) {
    if (!file || !sessionId) return;
    sessionStorage.setItem(storageKey(apiPrefix, file), sessionId);
  }

  function clearSessionKeys(sessionId) {
    if (!sessionId) return;
    const keysToRemove = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key && sessionStorage.getItem(key) === sessionId) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => sessionStorage.removeItem(key));
  }

  global.UploadSessionLink = {
    storageKey,
    linkFileToSession,
    clearSessionKeys,
  };
})(window);
