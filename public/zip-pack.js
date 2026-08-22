(function (global) {
  if (!global.zip) {
    console.error('[zip-pack] zip.js not loaded');
    return;
  }

  const { ZipWriter, BlobWriter, BlobReader, configure } = global.zip;
  configure({ useWebWorkers: false });

  function sanitizeName(name) {
    const trimmed = String(name || '').trim().replace(/[^\w.\-() ]/g, '_');
    return trimmed.replace(/^\.+/, '') || 'archive';
  }

  function detectRootFolder(files) {
    for (const file of files) {
      const rel = file.webkitRelativePath;
      if (rel && rel.includes('/')) {
        return rel.split('/')[0];
      }
    }
    return '';
  }

  function analyzeFiles(files) {
    const list = Array.from(files);
    const totalSize = list.reduce((sum, file) => sum + file.size, 0);
    const rootName = detectRootFolder(list);
    return {
      count: list.length,
      totalSize,
      rootName,
      files: list,
    };
  }

  function entryPath(file, folderPrefix) {
    let path = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
    if (file.webkitRelativePath) {
      const parts = path.split('/');
      if (parts.length > 1) {
        path = parts.slice(1).join('/');
      }
    }
    if (folderPrefix) {
      path = `${folderPrefix}/${path}`;
    }
    return path;
  }

  async function buildZipBlob(files, options, onProgress) {
    const writer = new BlobWriter('application/zip');
    const zipWriterOptions = {};
    if (options.password) {
      zipWriterOptions.password = options.password;
      zipWriterOptions.zipCrypto = true;
    }
    const zipWriter = new ZipWriter(writer, zipWriterOptions);
    const total = files.length;
    let done = 0;
    for (const file of files) {
      const path = entryPath(file, options.folderPrefix);
      await zipWriter.add(path, new BlobReader(file), { level: 6 });
      done += 1;
      if (onProgress) {
        onProgress({ done, total, phase: 'pack' });
      }
    }
    await zipWriter.close();
    return await writer.getData();
  }

  function splitBlobToFiles(blob, maxBytes, baseName) {
    if (!maxBytes || blob.size <= maxBytes) {
      return [new File([blob], `${baseName}.zip`, { type: 'application/zip', lastModified: Date.now() })];
    }
    const parts = [];
    let offset = 0;
    let part = 1;
    while (offset < blob.size) {
      const end = Math.min(offset + maxBytes, blob.size);
      const slice = blob.slice(offset, end);
      parts.push(new File(
        [slice],
        `${baseName}.part${String(part).padStart(3, '0')}.zip`,
        { type: 'application/zip', lastModified: Date.now() },
      ));
      offset = end;
      part += 1;
    }
    return parts;
  }

  function partitionByUncompressedSize(files, maxBytes) {
    if (!maxBytes) return [files];
    const groups = [];
    let current = [];
    let currentSize = 0;
    for (const file of files) {
      if (current.length && currentSize + file.size > maxBytes) {
        groups.push(current);
        current = [];
        currentSize = 0;
      }
      current.push(file);
      currentSize += file.size;
    }
    if (current.length) groups.push(current);
    return groups;
  }

  async function packFilesToUpload(files, options, onProgress) {
    const baseName = sanitizeName(options.baseName || detectRootFolder(files) || 'archive');
    const volumeBytes = options.volumeMaxMb > 0
      ? Math.floor(options.volumeMaxMb * 1024 * 1024)
      : 0;
    const folderPrefix = options.useInnerFolder
      ? sanitizeName(options.folderName || baseName)
      : null;

    const fileGroups = partitionByUncompressedSize(files, volumeBytes);
    const uploadFiles = [];

    for (let groupIndex = 0; groupIndex < fileGroups.length; groupIndex += 1) {
      const group = fileGroups[groupIndex];
      const groupBase = fileGroups.length > 1
        ? `${baseName}.part${String(groupIndex + 1).padStart(2, '0')}`
        : baseName;

      const blob = await buildZipBlob(group, {
        folderPrefix,
        password: options.password,
      }, (progress) => {
        if (onProgress) {
          onProgress({
            ...progress,
            group: groupIndex + 1,
            groupCount: fileGroups.length,
          });
        }
      });

      uploadFiles.push(...splitBlobToFiles(blob, volumeBytes, groupBase));
    }

    return uploadFiles;
  }

  global.ZipPack = {
    analyzeFiles,
    sanitizeName,
    detectRootFolder,
    packFilesToUpload,
  };
})(window);
