(function (global) {
  const STATUS_LABELS = {
    pending: 'В очереди',
    uploading: 'Загрузка…',
    paused: 'Пауза',
    awaiting_file: 'Выберите файл',
    ready: 'Готов к публикации',
    shared: 'Ссылка создана',
    error: 'Ошибка',
    cancelled: 'Отменено',
  };

  const STORAGE_PREFIX = global.CHUNK_UPLOAD_STORAGE_PREFIX || 'shareChunkUpload:';

  function createItemId() {
    return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function storageKey(apiPrefix, file) {
    if (global.getChunkUploadStorageKey) {
      return global.getChunkUploadStorageKey(apiPrefix, file);
    }
    return `${STORAGE_PREFIX}${apiPrefix}:${file.name}:${file.size}:${file.lastModified}`;
  }

  function clearSessionStorageForSession(sessionId) {
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

  function mapServerStatus(status) {
    if (status === 'paused') return 'paused';
    return 'awaiting_file';
  }

  class UploadQueue {
    constructor(options = {}) {
      this.apiPrefix = options.apiPrefix || '/api/upload';
      this.fetchFn = options.fetchFn;
      this.onChange = options.onChange || (() => {});
      this.onActiveItem = options.onActiveItem || (() => {});
      this.items = [];
      this.running = false;
      this.queuePaused = false;
      this.currentUploader = null;
      this.currentItemId = null;
    }

    getState() {
      return {
        items: this.items.map((item) => ({ ...item, file: undefined })),
        running: this.running,
        queuePaused: this.queuePaused,
        currentItemId: this.currentItemId,
      };
    }

    notify(immediate = true) {
      if (!immediate) {
        if (this._notifyTimer) return;
        this._notifyTimer = setTimeout(() => {
          this._notifyTimer = null;
          this.onChange(this.getState());
        }, 250);
        return;
      }
      if (this._notifyTimer) {
        clearTimeout(this._notifyTimer);
        this._notifyTimer = null;
      }
      this.onChange(this.getState());
    }

    restoreSessions(sessions) {
      const entries = Array.isArray(sessions) ? sessions : [];
      if (!entries.length) return false;

      let changed = false;
      for (const session of entries) {
        if (!session?.sessionId) continue;
        if (this.items.some((item) => item.sessionId === session.sessionId)) continue;

        this.items.push({
          id: createItemId(),
          file: null,
          sessionId: session.sessionId,
          name: session.originalName,
          size: session.totalSize,
          status: mapServerStatus(session.status),
          progress: session.progress || 0,
          uploadId: null,
          error: null,
        });
        changed = true;
      }

      if (changed) {
        this.notify();
      }
      return changed;
    }

    attachAwaitingFile(file) {
      const match = this.items.find((item) => (
        !item.file
        && item.sessionId
        && item.name === file.name
        && item.size === file.size
        && ['awaiting_file', 'paused'].includes(item.status)
      ));

      if (!match) return false;

      match.file = file;
      match.status = 'pending';
      match.error = null;
      sessionStorage.setItem(storageKey(this.apiPrefix, file), match.sessionId);
      this.notify();
      this.start();
      return true;
    }

    addFiles(fileList) {
      const files = Array.from(fileList || []).filter(Boolean);
      if (!files.length) return;

      for (const file of files) {
        if (this.attachAwaitingFile(file)) continue;

        this.items.push({
          id: createItemId(),
          file,
          sessionId: null,
          name: file.name,
          size: file.size,
          status: 'pending',
          progress: 0,
          uploadId: null,
          error: null,
        });
      }
      this.notify();
      this.start();
    }

    getItem(id) {
      return this.items.find((item) => item.id === id);
    }

    getActiveItem() {
      return this.items.find((item) => item.id === this.currentItemId)
        || this.items.find((item) => item.status === 'ready')
        || this.items.find((item) => item.status === 'uploading')
        || null;
    }

    setActiveItem(id) {
      const item = this.getItem(id);
      if (!item || !['ready', 'uploading', 'paused'].includes(item.status)) return;
      this.currentItemId = id;
      this.onActiveItem(item);
      this.notify();
    }

    markShared(id) {
      const item = this.getItem(id);
      if (!item) return;
      item.status = 'shared';
      if (this.currentItemId === id) {
        const next = this.items.find((entry) => entry.status === 'ready');
        this.currentItemId = next?.id || null;
        if (next) this.onActiveItem(next);
      }
      this.notify();
      this.start();
    }

    pauseQueue() {
      this.queuePaused = true;
      if (this.currentUploader) {
        this.currentUploader.pause().catch(() => {});
      }
      this.notify();
    }

    resumeQueue() {
      this.queuePaused = false;
      if (this.currentUploader?.waitingForResume) {
        this.currentUploader.resumeUpload().catch(() => {});
      }
      this.notify();
      this.start();
    }

    cancelItem(id) {
      const item = this.getItem(id);
      if (!item) return;

      if (this.currentItemId === id && this.currentUploader) {
        this.currentUploader.cancel().catch(() => {});
        this.currentUploader = null;
      } else if (item.sessionId) {
        this.fetchFn(`${this.apiPrefix}/cancel/${item.sessionId}`, {
          method: 'DELETE',
        }).catch(() => {});
        clearSessionStorageForSession(item.sessionId);
      }

      item.status = 'cancelled';
      if (this.currentItemId === id) {
        this.currentItemId = null;
      }
      this.notify();
      this.start();
    }

    clearFinished() {
      this.items = this.items.filter((item) => !['shared', 'cancelled', 'error'].includes(item.status));
      this.notify();
    }

    async start() {
      if (this.running || this.queuePaused) return;

      const next = this.items.find((item) => item.status === 'pending' && item.file);
      if (!next) return;

      this.running = true;
      this.currentItemId = next.id;
      next.status = 'uploading';
      next.error = null;
      this.onActiveItem(next);
      this.notify();

      if (next.sessionId) {
        sessionStorage.setItem(storageKey(this.apiPrefix, next.file), next.sessionId);
      }

      const uploader = new global.ChunkUploader({
        apiPrefix: this.apiPrefix,
        fetchFn: this.fetchFn,
      });
      this.currentUploader = uploader;

      uploader.setHandlers({
        onProgress: ({ percent }) => {
          next.progress = percent;
          this.notify(false);
        },
        onStatus: () => {},
      });

      try {
        const result = await uploader.upload(next.file);
        this.currentUploader = null;
        if (result?.uploadId) {
          next.uploadId = result.uploadId;
          next.sessionId = null;
          next.status = 'ready';
          next.progress = 100;
          this.onActiveItem(next);
        } else if (uploader.waitingForResume) {
          next.status = 'paused';
        } else if (uploader.cancelled) {
          next.status = 'cancelled';
        }
      } catch (error) {
        this.currentUploader = null;
        if (uploader.waitingForResume) {
          next.status = 'paused';
          next.error = error.message;
        } else if (!uploader.cancelled) {
          next.status = 'error';
          next.error = error.message;
        }
      }

      this.running = false;
      this.notify();

      if (!this.queuePaused) {
        await this.start();
      }
    }
  }

  global.UploadQueue = UploadQueue;
  global.UPLOAD_QUEUE_STATUS_LABELS = STATUS_LABELS;
})(window);
