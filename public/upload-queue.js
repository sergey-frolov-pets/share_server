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

  function formatTransferSpeed(bytesPerSecond) {
    const formatBytes = global.formatUploadBytes;
    if (!formatBytes || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
    return `${formatBytes(bytesPerSecond)}/с`;
  }

  function bytesFromProgress(item) {
    if (Number.isFinite(item.bytesReceived)) return item.bytesReceived;
    if (item.progress && item.size) {
      return Math.round((item.size * item.progress) / 100);
    }
    return 0;
  }

  function fileMatchesItem(file, item) {
    return item.name === file.name && item.size === file.size;
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
      status: 'paused',
      progress: session.progress || 0,
      bytesReceived: session.bytesReceived || 0,
      etaSeconds: null,
      speedBps: null,
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

    getWaitingForFileItems() {
      return this.items.filter((item) => (
        !item.file && item.sessionId && item.status === 'paused'
      ));
    }

    getRemoteWaitingItems() {
      return this.getWaitingForFileItems();
    }

    formatItemStatus(item) {
      if (item.status === 'uploading') {
        const pct = item.progress ? `${item.progress}%` : '0%';
        const speed = formatTransferSpeed(item.speedBps);
        if (speed) return `Загружается · ${pct} · ${speed}`;
        return `Загружается · ${pct}`;
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
        const pct = item.progress ? ` · ${item.progress}%` : '';
        if (!item.file && item.sessionId) {
          const waiting = this.getWaitingForFileItems();
          const waitingIndex = waiting.findIndex((entry) => entry.id === item.id);
          const order = waiting.length > 1 ? ` · ${waitingIndex + 1}/${waiting.length}` : '';
          return `На паузе · выберите тот же файл${order}${pct}`;
        }
        const speed = formatTransferSpeed(item.speedBps);
        if (speed) return `На паузе${pct} · было ${speed}`;
        return item.progress ? `На паузе · ${item.progress}%` : 'На паузе';
      }

      return STATUS_LABELS[item.status] || item.status;
    }

    formatItemBadge(item) {
      if (item.status === 'uploading') return { text: 'Загружается', className: 'uploading' };
      if (item.status === 'paused') return { text: 'На паузе', className: 'paused' };
      if (item.status === 'pending') return { text: 'Ожидает', className: 'pending' };
      if (item.status === 'ready') return { text: 'Готов', className: 'ready' };
      return null;
    }

    formatItemProgressDetail(item) {
      const formatBytes = global.formatUploadBytes;
      if (!formatBytes || !item.size) return '';
      if (!['pending', 'uploading', 'paused', 'remote'].includes(item.status)) return '';

      const received = bytesFromProgress(item);
      const total = item.size;

      if (item.status === 'paused' && !item.file && item.sessionId) {
        return `Сохранено ${formatBytes(received)} / ${formatBytes(total)} · выберите тот же файл выше`;
      }

      let detail = `${formatBytes(received)} / ${formatBytes(total)}`;

      if (item.status === 'uploading') {
        const speed = formatTransferSpeed(item.speedBps);
        detail += speed ? ` · ${speed}` : ' · …';
      }

      const showEta = item.status === 'uploading' && item.etaSeconds != null;
      const eta = showEta ? formatDuration(item.etaSeconds) : null;
      if (eta) {
        detail += ` · осталось ${eta}`;
      }

      return detail;
    }

    hasRemoteSessionsWaitingForFile() {
      return this.getWaitingForFileItems().length > 0;
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
          item.speedBps = speedBps;
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

      if (elapsedSec >= 0.15 && received > tracker.lastBytes) {
        const instantSpeed = (received - tracker.lastBytes) / elapsedSec;
        if (elapsedSec >= 0.3) {
          tracker.speedBps = tracker.speedBps
            ? tracker.speedBps * 0.7 + instantSpeed * 0.3
            : instantSpeed;
          tracker.lastBytes = received;
          tracker.lastTime = now;
        }
        item.speedBps = tracker.speedBps || instantSpeed;
      }

      if (item.speedBps > 0 && received < total) {
        item.etaSeconds = Math.max(0, (total - received) / item.speedBps);
      } else if (received >= total) {
        item.etaSeconds = 0;
        item.speedBps = null;
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
          if (existing.file || existing.status === 'uploading' || existing.status === 'pending') {
            continue;
          }
          const prevBytes = existing.bytesReceived || 0;
          const nextBytes = session.bytesReceived || 0;
          if (
            existing.serverStatus !== session.status
            || existing.progress !== session.progress
            || existing.status !== 'paused'
            || existing.bytesReceived !== nextBytes
          ) {
            existing.serverStatus = session.status;
            existing.progress = session.progress || 0;
            existing.bytesReceived = nextBytes;
            existing.status = 'paused';
            if (nextBytes > prevBytes) {
              this.updateItemTransferStats(existing, nextBytes, session.totalSize, SERVER_SYNC_MS / 1000);
            }
            changed = true;
          }
          continue;
        }

        const inFlight = this.items.some((item) => (
          item.sessionId === session.sessionId
          || (
            (item.file || item.status === 'uploading' || item.status === 'pending' || this.uploaders.has(item.id))
            && item.name === session.originalName
            && item.size === session.totalSize
          )
        ));
        if (inFlight) continue;

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
        || (item.sessionId && item.status === 'paused' && !item.file)
      ));

      if (shouldTick && !this._displayTimer) {
        this._displayTimer = setInterval(() => {
          let tickChanged = false;
          this.items.forEach((item) => {
            if (item.etaSeconds > 0 && item.status === 'uploading') {
              item.etaSeconds = Math.max(0, item.etaSeconds - DISPLAY_TICK_MS / 1000);
              tickChanged = true;
            }
          });
          if (tickChanged) this.notify(false);
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
      await this.pauseSessionsWithoutFile();
    }

    getNextWaitingForFile() {
      return this.getWaitingForFileItems().find((item) => !this.uploaders.has(item.id)) || null;
    }

    getNextWaitingRemote() {
      return this.getNextWaitingForFile();
    }

    async pauseSessionsWithoutFile() {
      const targets = this.getWaitingForFileItems().filter((item) => !this.uploaders.has(item.id));
      if (!targets.length) return 0;

      let changed = false;
      await Promise.all(targets.map(async (item) => {
        if (item.serverStatus !== 'paused') {
          await this.fetchFn(`${this.apiPrefix}/pause/${item.sessionId}`, {
            method: 'POST',
            body: JSON.stringify({}),
          }).catch(() => {});
          item.serverStatus = 'paused';
          changed = true;
        }
        if (item.status !== 'paused') {
          item.status = 'paused';
          changed = true;
        }
      }));

      if (changed) {
        this.notify();
      }
      return targets.length;
    }

    findRemoteMatchForFile(file) {
      return this.items.find((item) => (
        item.sessionId
        && fileMatchesItem(file, item)
        && item.status === 'paused'
        && !item.file
        && !this.isSessionAlreadyUploading(item.sessionId, item.id)
      )) || null;
    }

    isSessionAlreadyUploading(sessionId, exceptItemId = null) {
      if (!sessionId) return false;
      return this.items.some((item) => (
        item.id !== exceptItemId
        && item.sessionId === sessionId
        && this.uploaders.has(item.id)
      ));
    }

    reattachFileToItem(item, file) {
      if (!item || !file) return false;

      if (item.status === 'ready') return true;

      if ((item.status === 'uploading' || this.uploaders.has(item.id)) && item.file) {
        return true;
      }

      item.file = file;
      item.error = null;

      if (item.sessionId) {
        sessionStorage.setItem(storageKey(this.apiPrefix, file), item.sessionId);
      }

      if (item.sessionId && this.isSessionAlreadyUploading(item.sessionId, item.id)) {
        item.status = 'pending';
        this.notify();
        return true;
      }

      if (['paused', 'error'].includes(item.status)) {
        this.startItemUpload(item);
        return true;
      }

      if (item.status === 'pending') {
        if (!this.uploaders.has(item.id)) {
          this.start();
        }
        this.notify();
        return true;
      }

      return false;
    }

    attachRemoteFile(file) {
      const match = this.findRemoteMatchForFile(file);
      if (!match) return false;

      if (this.isSessionAlreadyUploading(match.sessionId, match.id)) {
        return true;
      }

      return this.reattachFileToItem(match, file);
    }

    async restoreFilesFromStoredHandles(options = {}) {
      const store = global.FileHandleStore;
      if (!store?.getFileBySessionId) {
        return { restored: 0, pendingPermission: 0, waiting: 0 };
      }

      const targets = this.getWaitingForFileItems();

      let restored = 0;
      let pendingPermission = 0;

      for (const item of targets) {
        if (item.file || this.uploaders.has(item.id)) continue;
        if (this.isSessionAlreadyUploading(item.sessionId, item.id)) continue;

        const hasStored = await store.hasStoredSession(item.sessionId);
        if (!hasStored) continue;

        const file = await store.getFileBySessionId(item.sessionId, {
          allowRequest: options.allowRequest === true,
        });

        if (!file) {
          pendingPermission += 1;
          continue;
        }

        if (this.attachRemoteFile(file)) {
          restored += 1;
        }
      }

      return {
        restored,
        pendingPermission,
        waiting: targets.length,
      };
    }

    addFile(file) {
      if (!file) return false;

      if (this.attachRemoteFile(file)) {
        this.notify();
        return true;
      }

      const waiting = this.getWaitingForFileItems();
      if (waiting.length) {
        return false;
      }

      const existing = this.findItemForFile(file);
      if (existing && this.reattachFileToItem(existing, file)) {
        this.notify();
        return true;
      }

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
        speedBps: null,
        uploadId: null,
        error: null,
      });
      this.notify();
      this.start();
      return true;
    }

    findItemForFile(file) {
      return this.items.find((item) => (
        fileMatchesItem(file, item)
        && !['shared', 'cancelled'].includes(item.status)
      ));
    }

    addFiles(fileList) {
      const files = Array.from(fileList || []).filter(Boolean);
      if (!files.length) return;

      for (const file of files) {
        this.addFile(file);
      }
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
      if (item.sessionId && global.FileHandleStore?.removeBySessionId) {
        global.FileHandleStore.removeBySessionId(item.sessionId).catch(() => {});
      }
      if (item.file && global.FileHandleStore?.removeByFile) {
        global.FileHandleStore.removeByFile(item.file).catch(() => {});
      }
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

      if (item.sessionId && item.file && item.status === 'paused') {
        item.status = 'paused';
        item.serverStatus = 'paused';
        const uploader = this.uploaders.get(id);
        if (uploader) {
          uploader.pause().catch(() => {});
        } else {
          this.fetchFn(`${this.apiPrefix}/pause/${item.sessionId}`, {
            method: 'POST',
            body: JSON.stringify({}),
          }).catch(() => {});
        }
        this.notify();
        return;
      }

      if (item.sessionId && !item.file && item.status === 'paused') {
        return;
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
          uploader.resumeUpload()
            .then((result) => {
              if (result?.uploadId) {
                item.uploadId = result.uploadId;
                item.sessionId = null;
                item.serverStatus = null;
                item.status = 'ready';
                item.progress = 100;
                item.bytesReceived = item.size;
                item.etaSeconds = 0;
                item.speedBps = null;
                this.onActiveItem(item);
              }
            })
            .catch((error) => {
              if (!uploader.cancelled) {
                item.status = 'paused';
                item.serverStatus = 'paused';
                item.error = error.message;
              }
            })
            .finally(() => {
              if (!uploader.paused && !uploader.waitingForResume) {
                this.uploaders.delete(id);
              }
              this.notify();
              this.start();
            });
        } else {
          uploader.unpause().catch(() => {});
        }
        this.notify();
        return;
      }

      if (item.sessionId && !item.file) {
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
        if (global.FileHandleStore?.removeBySessionId) {
          global.FileHandleStore.removeBySessionId(item.sessionId).catch(() => {});
        }
      }

      if (item.file && global.FileHandleStore?.removeByFile) {
        global.FileHandleStore.removeByFile(item.file).catch(() => {});
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
        if (this.uploaders.has(next.id)) break;
        this.startItemUpload(next);
      }
    }

    async startItemUpload(item) {
      if (!item?.file || this.uploaders.has(item.id)) return;
      if (item.status === 'uploading') return;

      if (item.sessionId && this.isSessionAlreadyUploading(item.sessionId, item.id)) {
        item.status = 'pending';
        this.notify();
        return;
      }

      if (this.getActiveUploadCount() >= this.maxConcurrent) {
        item.status = 'pending';
        this.notify();
        return;
      }

      item.status = 'uploading';
      item.error = null;
      item.speedBps = null;
      item._etaTracker = null;
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
        onSession: (session) => {
          if (!session?.sessionId || !item.file) return;
          if (item.sessionId && session.sessionId !== item.sessionId && session.resumed !== true) {
            this.fetchFn(`${this.apiPrefix}/cancel/${session.sessionId}`, {
              method: 'DELETE',
            }).catch(() => {});
            return;
          }
          item.sessionId = session.sessionId;
          sessionStorage.setItem(storageKey(this.apiPrefix, item.file), session.sessionId);
          if (global.FileHandleStore?.linkSession) {
            global.FileHandleStore.linkSession(item.file, session.sessionId).catch(() => {});
          }
        },
        onProgress: ({ bytesReceived, totalSize }) => {
          if (uploader.session?.sessionId) {
            item.sessionId = uploader.session.sessionId;
          }
          this.updateItemTransferStats(item, bytesReceived, totalSize);
          item.serverStatus = 'active';
          this.notify(false);
        },
        onStatus: () => {},
      });

      try {
        const result = await uploader.upload(item.file, {
          resumeSessionId: item.sessionId || undefined,
        });
        if (result?.uploadId) {
          item.uploadId = result.uploadId;
          item.sessionId = null;
          item.serverStatus = null;
          item.status = 'ready';
          item.progress = 100;
          item.bytesReceived = item.size;
          item.etaSeconds = 0;
          item.speedBps = null;
          this.onActiveItem(item);
        } else if (uploader.waitingForResume || uploader.paused) {
          item.status = 'paused';
          item.serverStatus = 'paused';
        } else if (uploader.cancelled) {
          item.status = 'cancelled';
        } else if (item.status === 'uploading') {
          item.status = item.file ? 'paused' : 'paused';
          item.serverStatus = 'paused';
          if (!item.file) {
            item.error = item.error || 'Выберите тот же файл выше — загрузка продолжится автоматически';
          } else {
            item.error = item.error || 'Загрузка не удалась';
          }
        }
      } catch (error) {
        if (!uploader.cancelled) {
          if (uploader.waitingForResume || uploader.paused) {
            item.status = 'paused';
            item.serverStatus = 'paused';
            item.error = error.message;
          } else {
            item.status = 'error';
            item.error = error.message;
          }
        }
      } finally {
        if (!uploader.paused && !uploader.waitingForResume) {
          this.uploaders.delete(item.id);
        }
        this.notify();
        this.updateServerSyncTimer();
        this.updateDisplayTimer();
        this.start();
      }
    }
  }

  global.UploadQueue = UploadQueue;
  global.UPLOAD_QUEUE_STATUS_LABELS = STATUS_LABELS;
  global.UPLOAD_MAX_CONCURRENT = MAX_CONCURRENT_UPLOADS;
})(window);
