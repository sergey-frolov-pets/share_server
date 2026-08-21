(function (global) {
  function basename(name) {
    if (!name) return '';
    const normalized = String(name).replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || normalized;
  }

  function normalizeName(name) {
    return basename(name).normalize('NFC');
  }

  function sameFileIdentity(file, item) {
    if (!file || !item) return false;
    return normalizeName(file.name) === normalizeName(item.name)
      && Number(file.size) === Number(item.size);
  }

  global.UploadFileMatcher = {
    basename,
    sameFileIdentity,
  };
})(window);
