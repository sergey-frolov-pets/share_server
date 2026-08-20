(function (global) {
  const STATUS_LABELS = {
    pending: 'В очереди',
    uploading: 'Загрузка…',
    paused: 'Пауза',
    remote: 'Загрузка…',
    ready: 'Готов к публикации',
    shared: 'Ссылка создана',
    error: 'Ошибка',
    cancelled: 'Отменено',
  };

  const SERVER_STATUS_LABELS = {
    active: 'Загрузка…',
    paused: 'Пауза',
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

  function sessionToItem(session) {
    const serverStatus = session.status || 'active';
    return {
      id: createItemId(),
      file: null,
      sessionId: session.sessionId,
      name: session.originalName,
      size: session.totalSize,
      serverStatus,
      status: serverStatus === 'paused' ? 'paused' : 'remote',
      progress: session.progress || 0,
      uploadId: null,
      error: null,
    };
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
      this._syncTimer = null;
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

    formatItemStatus(item) {
      if (item.status === 'remote' || (item.status === 'paused' && !item.file)) {
        const label = SERVER_STATUS_LABELS[item.serverStatus] || STATUS_LABELS[item.status] || item.status;
        return item.progress ? `${label} · ${item.progress}%` : label;
      }
      const label = STATUS_LABELS[item.status] || item.status;
      return item.progress && ['pending', 'uploading', 'paused'].includes(item.status)
        ? `${label} · ${item.progress}%`
        : label;
    }

    syncSessionsFromServer(sessions) {
      const entries = Array.isArray(sessions) ? sessions : [];
      const activeSessionIds = new Set(entries.map((session) => session.sessionId).filter(Boolean));
      let changed = false;

      this.items = this.items.filter((item) => {
        if (!item.sessionId || item.file || item.status === 'uploading') return true;
        if (activeSessionIds.has(item.sessionId)) return true;
        changed = true;
        return false;
      });

      for (const session of entries) {
        if (!session?.sessionId) continue;

        const existing = this.items.find((item) => item.sessionId === session.sessionId);
        if (existing) {
          if (existing.status === 'uploading') continue;
          const nextStatus = session.status === 'paused' ? 'paused' : 'remote';
          if (
            existing.serverStatus !== session.status
            || existing.progress !== session.progress
            || existing.status !== nextStatus
          ) {
            existing.serverStatus = session.status;
            existing.progress = session.progress || 0;
            existing.status = nextStatus;
            changed = true;
          }
          continue;
        }

        this.items.push(sessionToItem(session));
        changed = true;
      }

      if (changed) {
        this.notify();
      }

      this.updateServerSyncTimer();
      return entries.length > 0;
    }

    updateServerSyncTimer() {
      const hasRemoteItems = this.items.some((item) => item.sessionId && !item.file && item.status !== 'uploading');
      if (hasRemoteItems && !this._syncTimer) {
        this._syncTimer = setInterval(() => {
          this.refreshFromServer().catch(() => {});
        }, 4000);
      } else if (!hasRemoteItems && this._syncTimer) {
        clearInterval(this._syncTimer);
        this._syncTimer = null;
      }
    }

    async refreshFromServer() {
      const response = await this.fetchFn(`${this.apiPrefix}/sessions`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Ошибка запроса');
      }
      this.syncSessionsFromServer(data.sessions || []);
    }

    attachRemoteFile(file) {
      const match = this.items.find((item) => (
        !item.file
        && item.sessionId
        && item.name === file.name
        && item.size === file.size
        && ['remote', 'paused'].includes(item.status)
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
        if (this.attachRemoteFile(file)) continue;

        this.items.push({
          id: createItemId(),
          file,
          sessionId: null,
          serverStatus: null,
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
      this.updateServerSyncTimer();
      this.start();
    }

    clearFinished() {
      this.items = this.items.filter((item) => !['shared', 'cancelled', 'error'].includes(item.status));
      this.notify();
      this.updateServerSyncTimer();
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
      this.updateServerSyncTimer();

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
          next.serverStatus = 'active';
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
          next.serverStatus = null;
          next.status = 'ready';
          next.progress = 100;
          this.onActiveItem(next);
        } else if (uploader.waitingForResume) {
          next.status = 'paused';
          next.serverStatus = 'paused';
        } else if (uploader.cancelled) {
          next.status = 'cancelled';
        }
      } catch (error) {
        this.currentUploader = null;
        if (uploader.waitingForResume) {
          next.status = 'paused';
          next.serverStatus = 'paused';
          next.error = error.message;
        } else if (!uploader.cancelled) {
          next.status = 'error';
          next.error = error.message;
        }
      }

      this.running = false;
      this.notify();
      this.updateServerSyncTimer();

      if (!this.queuePaused) {
        await this.start();
      }
    }
  }

  global.UploadQueue = UploadQueue;
  global.UPLOAD_QUEUE_STATUS_LABELS = STATUS_LABELS;
  global.UPLOAD_SERVER_STATUS_LABELS = SERVER_STATUS_LABELS;
})(window);
