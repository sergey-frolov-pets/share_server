(function (global) {
  const STATUS_LABELS = {
    pending: 'Ожидает',
    uploading: 'Загружается',
    paused: 'На паузе',
    remote: 'На сервере',
    ready: 'Готов к публикации',
    shared: 'Ссылка создана',
    error: 'Ошибка',
    cancelled: 'Отменено',
  };

  const STORAGE_PREFIX = global.CHUNK_UPLOAD_STORAGE_PREFIX || 'shareChunkUpload:';
  const NOTIFY_THROTTLE_MS = 50;
  const SERVER_SYNC_MS = 1000;
  const DISPLAY_TICK_MS = 250;
  const MAX_CONCURRENT_UPLOADS = 3;

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

  function formatDuration(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
    if (totalSeconds < 60) return '≈ 1 мин';
    const minutes = Math.ceil(totalSeconds / 60);
    if (minutes < 60) return `≈ ${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    const remMin = minutes % 60;
    return remMin ? `≈ ${hours} ч ${remMin} мин` : `≈ ${hours} ч`;
  }

  function bytesFromProgress(item) {
    if (Number.isFinite(item.bytesReceived)) return item.bytesReceived;
    if (item.progress && item.size) {
      return Math.round((item.size * item.progress) / 100);
    }
    return 0;
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
      bytesReceived: session.bytesReceived || 0,
      etaSeconds: null,
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
      this.maxConcurrent = options.maxConcurrent || MAX_CONCURRENT_UPLOADS;
      this.items = [];
      this.queuePaused = false;
      this.uploaders = new Map();
      this._syncTimer = null;
      this._displayTimer = null;
    }

    getState() {
      return {
        items: this.items.map((item) => ({ ...item, file: undefined })),
        queuePaused: this.queuePaused,
        activeUploadCount: this.getActiveUploadCount(),
        maxConcurrent: this.maxConcurrent,
      };
    }

    notify(immediate = true) {
      if (!immediate) {
        if (this._notifyTimer) return;
        this._notifyTimer = setTimeout(() => {
          this._notifyTimer = null;
          this.onChange(this.getState());
        }, NOTIFY_THROTTLE_MS);
        return;
      }
      if (this._notifyTimer) {
        clearTimeout(this._notifyTimer);
        this._notifyTimer = null;
      }
      this.onChange(this.getState());
    }

    getActiveUploadCount() {
      return this.items.filter((item) => item.status === 'uploading').length;
    }

    getRemoteWaitingItems() {
      return this.items.filter((item) => (
        !item.file && ['remote', 'paused'].includes(item.status)
      ));
    }

    formatItemStatus(item) {
      if (item.status === 'uploading') {
        return item.progress ? `Загружается · ${item.progress}%` : 'Загружается';
      }

      if (item.status === 'pending') {
        const pendingItems = this.items.filter((entry) => entry.status === 'pending');
        const pendingIndex = pendingItems.findIndex((entry) => entry.id === item.id);
        if (pendingItems.length > 1 && pendingIndex >= 0) {
          return `Ожидает · ${pendingIndex + 1}/${pendingItems.length}`;
        }
        return STATUS_LABELS.pending;
      }

      if (item.status === 'paused') {
        return item.progress ? `На паузе · ${item.progress}%` : 'На паузе';
      }

      if (item.status === 'remote') {
        const waiting = this.getRemoteWaitingItems();
        const waitingIndex = waiting.findIndex((entry) => entry.id === item.id);
        const pct = item.progress ? ` · ${item.progress}%` : '';
        if (waiting.length > 1 && waitingIndex > 0) {
          return `Ожидает · ${waitingIndex + 1}/${waiting.length}${pct}`;
        }
        return `На сервере${pct} · выберите файл`;
      }

      return STATUS_LABELS[item.status] || item.status;
    }

    formatItemBadge(item) {
      if (item.status === 'uploading') return { text: 'Загружается', className: 'uploading' };
      if (item.status === 'paused') return { text: 'На паузе', className: 'paused' };
      if (item.status === 'pending') return { text: 'Ожидает', className: 'pending' };
      if (item.status === 'remote') {
        const waiting = this.getRemoteWaitingItems();
        const waitingIndex = waiting.findIndex((entry) => entry.id === item.id);
        if (waiting.length > 1 && waitingIndex > 0) {
          return { text: 'Ожидает', className: 'pending' };
        }
        return { text: 'На сервере', className: 'remote' };
      }
      if (item.status === 'ready') return { text: 'Готов', className: 'ready' };
      return null;
    }

    formatItemProgressDetail(item) {
      const formatBytes = global.formatUploadBytes;
      if (!formatBytes || !item.size) return '';
      if (!['pending', 'uploading', 'paused', 'remote'].includes(item.status)) return '';

      const received = bytesFromProgress(item);
      const total = item.size;
      let detail = `${formatBytes(received)} / ${formatBytes(total)}`;

      const showEta = item.status === 'uploading' && item.etaSeconds != null;
      const eta = showEta ? formatDuration(item.etaSeconds) : null;
      if (eta) {
        detail += ` · осталось ${eta}`;
      } else if (item.status === 'remote') {
        detail += ' · нужен тот же файл';
      }

      return detail;
    }

    updateItemTransferStats(item, bytesReceived, totalSize, sampleIntervalSec = null) {
      const total = totalSize || item.size || 0;
      const received = Math.min(total, Math.max(0, bytesReceived));
      const prevBytes = Number.isFinite(item.bytesReceived) ? item.bytesReceived : 0;

      item.size = total;
      item.bytesReceived = received;
      item.progress = total ? Math.min(100, Math.round((received / total) * 100)) : 0;

      if (sampleIntervalSec && received > prevBytes) {
        const speedBps = (received - prevBytes) / sampleIntervalSec;
        if (speedBps > 0) {
          item.etaSeconds = Math.max(0, (total - received) / speedBps);
        }
        return;
      }

      if (!item._etaTracker) {
        item._etaTracker = { lastBytes: received, lastTime: Date.now(), speedBps: 0 };
      }

      const tracker = item._etaTracker;
      const now = Date.now();
      const elapsedSec = (now - tracker.lastTime) / 1000;

      if (elapsedSec >= 0.3 && received > tracker.lastBytes) {
        const instantSpeed = (received - tracker.lastBytes) / elapsedSec;
        tracker.speedBps = tracker.speedBps
          ? tracker.speedBps * 0.7 + instantSpeed * 0.3
          : instantSpeed;
        tracker.lastBytes = received;
        tracker.lastTime = now;
      }

      if (tracker.speedBps > 0 && received < total) {
        item.etaSeconds = Math.max(0, (total - received) / tracker.speedBps);
      } else if (received >= total) {
        item.etaSeconds = 0;
      }
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
          const prevBytes = existing.bytesReceived || 0;
          const nextBytes = session.bytesReceived || 0;
          if (
            existing.serverStatus !== session.status
            || existing.progress !== session.progress
            || existing.status !== nextStatus
            || existing.bytesReceived !== nextBytes
          ) {
            existing.serverStatus = session.status;
            existing.progress = session.progress || 0;
            existing.bytesReceived = nextBytes;
            existing.status = nextStatus;
            if (nextBytes > prevBytes) {
              this.updateItemTransferStats(existing, nextBytes, session.totalSize, SERVER_SYNC_MS / 1000);
            }
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
      this.updateDisplayTimer();
      return entries.length > 0;
    }

    updateDisplayTimer() {
      const shouldTick = this.items.some((item) => (
        item.status === 'uploading'
        || (item.sessionId && ['remote', 'paused'].includes(item.status) && !item.file)
      ));

      if (shouldTick && !this._displayTimer) {
        this._displayTimer = setInterval(() => {
          let changed = false;
          this.items.forEach((item) => {
            if (item.etaSeconds > 0 && item.status === 'uploading') {
              item.etaSeconds = Math.max(0, item.etaSeconds - DISPLAY_TICK_MS / 1000);
              changed = true;
            }
          });
          if (changed) this.notify(false);
        }, DISPLAY_TICK_MS);
      } else if (!shouldTick && this._displayTimer) {
        clearInterval(this._displayTimer);
        this._displayTimer = null;
      }
    }

    updateServerSyncTimer() {
      const hasRemoteItems = this.items.some((item) => item.sessionId && !item.file && item.status !== 'uploading');
      if (hasRemoteItems && !this._syncTimer) {
        this._syncTimer = setInterval(() => {
          this.refreshFromServer().catch(() => {});
        }, SERVER_SYNC_MS);
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
          bytesReceived: 0,
          etaSeconds: null,
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
      return this.items.find((item) => item.status === 'ready')
        || this.items.find((item) => item.status === 'uploading')
        || null;
    }

    setActiveItem(id) {
      const item = this.getItem(id);
      if (!item || !['ready', 'uploading', 'paused'].includes(item.status)) return;
      this.onActiveItem(item);
      this.notify();
    }

    markShared(id) {
      const item = this.getItem(id);
      if (!item) return;
      item.status = 'shared';
      const next = this.items.find((entry) => entry.status === 'ready');
      if (next) this.onActiveItem(next);
      this.notify();
      this.start();
    }

    pauseItem(id) {
      const item = this.getItem(id);
      if (!item) return;

      const uploader = this.uploaders.get(id);

      if (item.status === 'uploading' && uploader) {
        item.status = 'paused';
        item.serverStatus = 'paused';
        uploader.pause().catch(() => {});
        this.notify();
        this.start();
        return;
      }

      if (item.status === 'pending') {
        item.status = 'paused';
        this.notify();
        return;
      }

      if (item.sessionId && item.status === 'remote' && !item.file) {
        this.fetchFn(`${this.apiPrefix}/pause/${item.sessionId}`, {
          method: 'POST',
          body: JSON.stringify({}),
        }).catch(() => {});
        item.status = 'paused';
        item.serverStatus = 'paused';
        this.notify();
      }
    }

    resumeItem(id) {
      const item = this.getItem(id);
      if (!item || item.status !== 'paused') return;

      const uploader = this.uploaders.get(id);

      if (uploader) {
        if (this.getActiveUploadCount() >= this.maxConcurrent) return;

        item.status = 'uploading';
        item.serverStatus = 'active';
        if (uploader.waitingForResume) {
          uploader.resumeUpload().catch(() => {});
        } else {
          uploader.unpause().catch(() => {});
        }
        this.notify();
        return;
      }

      if (item.sessionId && !item.file) {
        this.fetchFn(`${this.apiPrefix}/resume/${item.sessionId}`, {
          method: 'POST',
          body: JSON.stringify({}),
        }).catch(() => {});
        item.status = 'remote';
        item.serverStatus = 'active';
        this.notify();
        return;
      }

      if (item.file) {
        item.status = 'pending';
        this.notify();
        this.start();
      }
    }

    pauseQueue() {
      this.queuePaused = true;
      this.items.forEach((item) => {
        if (item.status === 'uploading') {
          this.pauseItem(item.id);
        } else if (item.status === 'pending') {
          item.status = 'paused';
        } else if (item.status === 'remote') {
          this.pauseItem(item.id);
        }
      });
      this.notify();
    }

    resumeQueue() {
      this.queuePaused = false;
      this.items.forEach((item) => {
        if (item.status === 'paused' && item.file && !this.uploaders.has(item.id)) {
          item.status = 'pending';
        }
      });
      this.uploaders.forEach((uploader, id) => {
        const item = this.getItem(id);
        if (item?.status === 'paused') {
          this.resumeItem(id);
        }
      });
      this.notify();
      this.start();
    }

    cancelItem(id) {
      const item = this.getItem(id);
      if (!item) return;

      const uploader = this.uploaders.get(id);
      if (uploader) {
        uploader.cancel().catch(() => {});
        this.uploaders.delete(id);
      } else if (item.sessionId) {
        this.fetchFn(`${this.apiPrefix}/cancel/${item.sessionId}`, {
          method: 'DELETE',
        }).catch(() => {});
        clearSessionStorageForSession(item.sessionId);
      }

      item.status = 'cancelled';
      this.notify();
      this.updateServerSyncTimer();
      this.updateDisplayTimer();
      this.start();
    }

    clearFinished() {
      this.items = this.items.filter((item) => !['shared', 'cancelled', 'error'].includes(item.status));
      this.notify();
      this.updateServerSyncTimer();
      this.updateDisplayTimer();
    }

    start() {
      if (this.queuePaused) return;

      while (this.getActiveUploadCount() < this.maxConcurrent) {
        const next = this.items.find((item) => item.status === 'pending' && item.file);
        if (!next) break;
        this.startItemUpload(next);
      }
    }

    startItemUpload(item) {
      item.status = 'uploading';
      item.error = null;
      this.onActiveItem(item);
      this.notify();
      this.updateServerSyncTimer();
      this.updateDisplayTimer();

      if (item.sessionId && item.file) {
        sessionStorage.setItem(storageKey(this.apiPrefix, item.file), item.sessionId);
      }

      const uploader = new global.ChunkUploader({
        apiPrefix: this.apiPrefix,
        fetchFn: this.fetchFn,
      });
      this.uploaders.set(item.id, uploader);

      uploader.setHandlers({
        onProgress: ({ bytesReceived, totalSize }) => {
          this.updateItemTransferStats(item, bytesReceived, totalSize);
          item.serverStatus = 'active';
          this.notify(false);
        },
        onStatus: () => {},
      });

      uploader.upload(item.file)
        .then((result) => {
          this.uploaders.delete(item.id);
          if (result?.uploadId) {
            item.uploadId = result.uploadId;
            item.sessionId = null;
            item.serverStatus = null;
            item.status = 'ready';
            item.progress = 100;
            item.bytesReceived = item.size;
            item.etaSeconds = 0;
            this.onActiveItem(item);
          } else if (uploader.waitingForResume || uploader.paused) {
            item.status = 'paused';
            item.serverStatus = 'paused';
          } else if (uploader.cancelled) {
            item.status = 'cancelled';
            this.uploaders.delete(item.id);
          }
        })
        .catch((error) => {
          if (!uploader.cancelled) {
            if (uploader.waitingForResume || uploader.paused) {
              item.status = 'paused';
              item.serverStatus = 'paused';
              item.error = error.message;
            } else {
              this.uploaders.delete(item.id);
              item.status = 'error';
              item.error = error.message;
            }
          }
        })
        .finally(() => {
          this.notify();
          this.updateServerSyncTimer();
          this.updateDisplayTimer();
          if (!uploader.paused && !uploader.waitingForResume) {
            this.uploaders.delete(item.id);
          }
          this.start();
        });
    }
  }

  global.UploadQueue = UploadQueue;
  global.UPLOAD_QUEUE_STATUS_LABELS = STATUS_LABELS;
  global.UPLOAD_MAX_CONCURRENT = MAX_CONCURRENT_UPLOADS;
})(window);
