(function (global) {
  function basename(name) {
    if (!name) return '';
    const normalized = String(name).replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || normalized;
  }

  function sameFileIdentity(file, item) {
    if (!file || !item) return false;
    return basename(file.name) === basename(item.name)
      && Number(file.size) === Number(item.size);
  }

  global.UploadFileMatcher = {
    basename,
    sameFileIdentity,
  };
})(window);
