(function (global) {
  const STORAGE_PREFIX = 'shareChunkUpload:';
  const MAX_RETRIES = 5;
  const RETRY_BASE_MS = 2000;

  function storageKey(apiPrefix, file) {
    return `${STORAGE_PREFIX}${apiPrefix}:${file.name}:${file.size}:${file.lastModified}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
  }

  class ChunkUploader {
    constructor(options) {
      this.apiPrefix = options.apiPrefix;
      this.fetchFn = options.fetchFn || ((path, opts) => fetch(path, {
        credentials: 'same-origin',
        ...opts,
      }));
      this.file = null;
      this.session = null;
      this.paused = false;
      this.cancelled = false;
      this.waitingForResume = false;
      this.onProgress = null;
      this.onStatus = null;
      this.onComplete = null;
      this.onError = null;
    }

    setHandlers(handlers) {
      this.onProgress = handlers.onProgress || null;
      this.onStatus = handlers.onStatus || null;
      this.onComplete = handlers.onComplete || null;
      this.onError = handlers.onError || null;
    }

    emitStatus(text, className) {
      if (this.onStatus) this.onStatus(text, className);
    }

    emitProgress(percent, bytesReceived, totalSize) {
      if (this.onProgress) {
        this.onProgress({ percent, bytesReceived, totalSize });
      }
    }

    async api(path, options = {}) {
      const isBinary = options.body instanceof ArrayBuffer
        || options.body instanceof Blob
        || (typeof Buffer !== 'undefined' && options.body instanceof Buffer);

      const response = await this.fetchFn(path, {
        ...options,
        headers: {
          ...(isBinary ? { 'Content-Type': 'application/octet-stream' } : { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Ошибка запроса');
      }
      return data;
    }

    async initSession(file) {
      const resumeSessionId = sessionStorage.getItem(storageKey(this.apiPrefix, file)) || undefined;
      const session = await this.api(`${this.apiPrefix}/init`, {
        method: 'POST',
        body: JSON.stringify({
          originalName: file.name,
          totalSize: file.size,
          lastModified: file.lastModified,
          resumeSessionId,
        }),
      });

      sessionStorage.setItem(storageKey(this.apiPrefix, file), session.sessionId);
      this.session = session;
      return session;
    }

    async refreshSession() {
      if (!this.session?.sessionId) return this.session;
      const session = await this.api(`${this.apiPrefix}/status/${this.session.sessionId}`);
      this.session = { ...this.session, ...session };
      return this.session;
    }

    async uploadChunks() {
      const session = await this.refreshSession();
      const uploadedSet = new Set(session.uploadedChunks || []);
      const { sessionId, chunkSize, totalChunks } = session;

      for (let index = 0; index < totalChunks; index += 1) {
        if (this.cancelled) return;
        while (this.paused) {
          await sleep(300);
          if (this.cancelled) return;
        }
        if (uploadedSet.has(index)) continue;

        const start = index * chunkSize;
        const end = Math.min(start + chunkSize, this.file.size);
        const blob = this.file.slice(start, end);
        await this.uploadChunkWithRetry(sessionId, index, blob);
        uploadedSet.add(index);
        this.updateProgressFromSet(uploadedSet, chunkSize);
      }
    }

    updateProgressFromSet(uploadedSet, chunkSize) {
      let bytesReceived = 0;
      uploadedSet.forEach((index) => {
        const start = index * chunkSize;
        bytesReceived += Math.min(chunkSize, this.file.size - start);
      });
      const percent = Math.min(100, Math.round((bytesReceived / this.file.size) * 100));
      this.emitProgress(percent, bytesReceived, this.file.size);
      this.emitStatus(
        `Загрузка… ${percent}% (${formatBytes(bytesReceived)} / ${formatBytes(this.file.size)})`,
        'uploading'
      );
    }

    async uploadChunkWithRetry(sessionId, index, blob) {
      let lastError;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
        if (this.cancelled) throw new Error('Отменено');
        try {
          const buffer = await blob.arrayBuffer();
          const data = await this.api(`${this.apiPrefix}/chunk/${sessionId}/${index}`, {
            method: 'PUT',
            body: buffer,
          });
          this.session = { ...this.session, ...data, sessionId };
          this.waitingForResume = false;
          return data;
        } catch (error) {
          lastError = error;
          if (attempt < MAX_RETRIES - 1) {
            this.emitStatus(
              `Связь потеряна, повтор ${attempt + 1}/${MAX_RETRIES}…`,
              'uploading'
            );
            await sleep(RETRY_BASE_MS * (attempt + 1));
          }
        }
      }

      this.paused = true;
      this.waitingForResume = true;
      await this.api(`${this.apiPrefix}/pause/${sessionId}`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).catch(() => {});
      this.emitStatus('Пауза: нет связи. Нажмите «Продолжить»', 'error');
      throw lastError;
    }

    async upload(file) {
      this.file = file;
      this.paused = false;
      this.cancelled = false;
      this.waitingForResume = false;

      try {
        this.emitStatus('Подготовка…', 'uploading');
        await this.initSession(file);
        this.updateProgressFromSet(new Set(this.session.uploadedChunks || []), this.session.chunkSize);
        await this.uploadChunks();
        if (this.cancelled) return null;
        return await this.finishUpload();
      } catch (error) {
        if (this.cancelled) return null;
        if (this.waitingForResume) {
          if (this.onError) this.onError(error);
          throw error;
        }
        this.emitStatus(error.message, 'error');
        if (this.onError) this.onError(error);
        throw error;
      }
    }

    async finishUpload() {
      this.emitStatus('Сборка файла…', 'uploading');
      const result = await this.api(`${this.apiPrefix}/complete/${this.session.sessionId}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      sessionStorage.removeItem(storageKey(this.apiPrefix, this.file));
      this.emitStatus('Загружено', 'done');
      this.emitProgress(100, this.file.size, this.file.size);
      if (this.onComplete) this.onComplete(result);
      return result;
    }

    async pause() {
      if (!this.session?.sessionId || this.cancelled) return;
      this.paused = true;
      await this.api(`${this.apiPrefix}/pause/${this.session.sessionId}`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).catch(() => {});
      this.emitStatus('Пауза', 'uploading');
    }

    async resumeUpload() {
      if (!this.file || !this.session?.sessionId || this.cancelled) return null;
      this.paused = false;
      this.waitingForResume = false;
      await this.api(`${this.apiPrefix}/resume/${this.session.sessionId}`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).catch(() => {});
      this.emitStatus('Загрузка…', 'uploading');

      try {
        await this.uploadChunks();
        if (this.cancelled) return null;
        return await this.finishUpload();
      } catch (error) {
        if (this.cancelled || this.waitingForResume) {
          if (this.onError) this.onError(error);
          throw error;
        }
        this.emitStatus(error.message, 'error');
        if (this.onError) this.onError(error);
        throw error;
      }
    }

    async cancel() {
      this.cancelled = true;
      this.paused = false;
      this.waitingForResume = false;
      if (this.session?.sessionId) {
        await this.api(`${this.apiPrefix}/cancel/${this.session.sessionId}`, {
          method: 'DELETE',
        }).catch(() => {});
      }
      if (this.file) {
        sessionStorage.removeItem(storageKey(this.apiPrefix, this.file));
      }
      this.session = null;
      this.emitStatus('Отменено', 'error');
    }
  }

  function bindUploadControls(uploader, elements) {
    const {
      progressWrap,
      progressFill,
      progressText,
      statusEl,
      pauseBtn,
      resumeBtn,
      cancelBtn,
    } = elements;

    function setControls(state) {
      if (pauseBtn) pauseBtn.classList.toggle('hidden', state !== 'uploading');
      if (resumeBtn) resumeBtn.classList.toggle('hidden', state !== 'paused');
      if (cancelBtn) cancelBtn.classList.toggle('hidden', state === 'idle' || state === 'done');
    }

    uploader.setHandlers({
      onProgress({ percent, bytesReceived, totalSize }) {
        if (progressWrap) progressWrap.classList.remove('hidden');
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (progressText) {
          progressText.textContent = `${percent}% · ${formatBytes(bytesReceived)} / ${formatBytes(totalSize)}`;
        }
      },
      onStatus(text, className) {
        if (statusEl) {
          statusEl.textContent = text;
          statusEl.className = `status ${className || ''}`.trim();
        }
        if (className === 'uploading') setControls('uploading');
        else if (className === 'done') setControls('done');
        else if (className === 'error' && uploader.waitingForResume) setControls('paused');
        else if (className === 'error') setControls('paused');
      },
    });

    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        uploader.pause().catch(() => {});
        setControls('paused');
      });
    }

    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => {
        setControls('uploading');
        uploader.resumeUpload().catch(() => {});
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        uploader.cancel().catch(() => {});
        if (progressWrap) progressWrap.classList.add('hidden');
        if (progressFill) progressFill.style.width = '0%';
        setControls('idle');
      });
    }

    setControls('idle');
    return uploader;
  }

  global.ChunkUploader = ChunkUploader;
  global.bindChunkUploadControls = bindUploadControls;
  global.formatUploadBytes = formatBytes;
  global.getChunkUploadStorageKey = storageKey;
  global.CHUNK_UPLOAD_STORAGE_PREFIX = STORAGE_PREFIX;
})(window);
