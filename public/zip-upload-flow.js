(function (global) {
  const MODES = {
    FOLDER: 'folder',
    FILES: 'files',
    SINGLE: 'single',
  };

  function formatBytes(bytes) {
    if (global.formatUploadBytes) return global.formatUploadBytes(bytes);
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  class ZipUploadFlow {
    constructor(elements) {
      this.modal = elements.modal;
      this.titleEl = elements.title;
      this.summaryEl = elements.summary;
      this.progressEl = elements.progress;
      this.progressTextEl = elements.progressText;
      this.folderNameField = elements.folderNameField;
      this.folderNameInput = elements.folderNameInput;
      this.volumeInput = elements.volumeInput;
      this.passwordInput = elements.passwordInput;
      this.errorEl = elements.error;
      this.cancelBtn = elements.cancelBtn;
      this.rawBtn = elements.rawBtn;
      this.zipBtn = elements.zipBtn;
      this._resolve = null;
      this._mode = null;
      this._files = [];

      this.cancelBtn.addEventListener('click', () => this.finish({ cancelled: true }));
      this.rawBtn.addEventListener('click', () => this.finish({ asRaw: true }));
      this.zipBtn.addEventListener('click', () => this.confirmZip());
      this.modal.querySelectorAll('[data-zip-upload-close]').forEach((btn) => {
        btn.addEventListener('click', () => this.finish({ cancelled: true }));
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !this.modal.classList.contains('hidden')) {
          this.finish({ cancelled: true });
        }
      });
    }

    show(el) {
      el.classList.remove('hidden');
    }

    hide(el) {
      el.classList.add('hidden');
    }

    setError(message) {
      if (!message) {
        this.errorEl.textContent = '';
        this.hide(this.errorEl);
        return;
      }
      this.errorEl.textContent = message;
      this.errorEl.className = 'error';
      this.show(this.errorEl);
    }

    setProgress(message) {
      if (!message) {
        this.hide(this.progressEl);
        this.progressTextEl.textContent = '';
        return;
      }
      this.progressTextEl.textContent = message;
      this.show(this.progressEl);
    }

    setBusy(busy) {
      this.cancelBtn.disabled = busy;
      this.rawBtn.disabled = busy;
      this.zipBtn.disabled = busy;
      this.folderNameInput.disabled = busy;
      this.volumeInput.disabled = busy;
      this.passwordInput.disabled = busy;
    }

    open(mode, files) {
      if (!global.ZipPack) {
        return Promise.resolve({ asRaw: true });
      }

      const list = Array.from(files);
      if (!list.length) {
        return Promise.resolve({ cancelled: true });
      }

      const analysis = global.ZipPack.analyzeFiles(list);
      this._mode = mode;
      this._files = analysis.files;

      this.setError(null);
      this.setProgress(null);
      this.setBusy(false);

      const defaultFolder = analysis.rootName || global.ZipPack.sanitizeName(list[0].name);
      this.folderNameInput.value = defaultFolder;
      this.volumeInput.value = '';
      this.passwordInput.value = '';

      if (mode === MODES.FOLDER) {
        this.titleEl.textContent = 'Загрузить папку как ZIP';
        this.summaryEl.textContent = [
          `Файлов: ${analysis.count}`,
          `Размер: ${formatBytes(analysis.totalSize)}`,
          `Папка: ${analysis.rootName || defaultFolder}`,
        ].join(' · ');
        this.show(this.folderNameField);
        this.rawBtn.classList.add('hidden');
        this.zipBtn.textContent = 'Создать ZIP и загрузить';
      } else if (mode === MODES.SINGLE) {
        this.titleEl.textContent = 'Загрузка файла';
        this.summaryEl.textContent = `${list[0].name} · ${formatBytes(list[0].size)}`;
        this.hide(this.folderNameField);
        this.rawBtn.textContent = 'Загрузить файл';
        this.rawBtn.classList.remove('hidden');
        this.zipBtn.textContent = 'Загрузить как ZIP';
      } else {
        this.titleEl.textContent = 'Загрузка файлов';
        this.summaryEl.textContent = [
          `Файлов: ${analysis.count}`,
          `Размер: ${formatBytes(analysis.totalSize)}`,
        ].join(' · ');
        this.show(this.folderNameField);
        this.rawBtn.textContent = 'Загрузить как есть';
        this.rawBtn.classList.remove('hidden');
        this.zipBtn.textContent = 'Создать ZIP и загрузить';
      }

      this.show(this.modal);
      return new Promise((resolve) => {
        this._resolve = resolve;
      });
    }

    finish(result) {
      this.hide(this.modal);
      this.setBusy(false);
      this.setProgress(null);
      const resolve = this._resolve;
      this._resolve = null;
      if (resolve) resolve(result);
    }

    readOptions() {
      const volumeRaw = this.volumeInput.value.trim();
      const volumeMaxMb = volumeRaw ? parseInt(volumeRaw, 10) : 0;
      if (volumeRaw && (!Number.isFinite(volumeMaxMb) || volumeMaxMb < 1)) {
        throw new Error('Размер тома: целое число ≥ 1 МБ или пусто');
      }
      const password = this.passwordInput.value;
      if (password && password.length < 4) {
        throw new Error('Пароль ZIP — минимум 4 символа');
      }
      const useInnerFolder = this._mode !== MODES.SINGLE;
      const folderName = this.folderNameInput.value.trim();
      if (useInnerFolder && !folderName) {
        throw new Error('Укажите имя папки внутри архива');
      }
      const baseName = global.ZipPack.sanitizeName(
        folderName
        || global.ZipPack.detectRootFolder(this._files)
        || this._files[0]?.name
        || 'archive',
      );
      return {
        baseName,
        folderName,
        useInnerFolder,
        volumeMaxMb,
        password,
      };
    }

    async confirmZip() {
      try {
        const options = this.readOptions();
        this.setError(null);
        this.setBusy(true);
        this.setProgress('Создание ZIP на клиенте…');

        const files = await global.ZipPack.packFilesToUpload(this._files, options, (progress) => {
          if (progress.phase === 'pack') {
            const groupSuffix = progress.groupCount > 1
              ? ` (часть ${progress.group}/${progress.groupCount})`
              : '';
            this.setProgress(`Архивация: ${progress.done}/${progress.total}${groupSuffix}`);
          }
        });

        this.finish({ files });
      } catch (err) {
        this.setError(err.message || 'Не удалось создать ZIP');
        this.setBusy(false);
        this.setProgress(null);
      }
    }

    async decide(files, mode) {
      const result = await this.open(mode, files);
      if (result.cancelled) return { cancelled: true };
      if (result.files) return { files: result.files };
      if (result.asRaw) return { files: Array.from(files) };
      return { cancelled: true };
    }
  }

  global.ZipUploadFlow = ZipUploadFlow;
  global.ZIP_UPLOAD_MODES = MODES;
})(window);
