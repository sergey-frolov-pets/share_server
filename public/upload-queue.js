(function (global) {
  const { UPLOAD_CONFIG, UPLOAD_ITEM_STATUS: S, UPLOAD_SERVER_SESSION_STATUS: SS } = global;
  const { sameFileIdentity } = global.UploadFileMatcher;
  const { linkFileToSession, clearSessionKeys } = global.UploadSessionLink;
  const TERMINAL_STATUSES = [S.SHARED, S.CANCELLED];

  function createItemId() {
    return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  function isWaitingForLocalFile(item) {
    return Boolean(item.sessionId && !item.file && item.status === S.WAITING_FILE);
  }

  function createQueueItemFromSession(session) {
    return {
      id: createItemId(),
      file: null,
      sessionId: session.sessionId,
      name: session.originalName,
      size: session.totalSize,
      serverStatus: session.status || SS.ACTIVE,
      status: S.WAITING_FILE,
      progress: session.progress || 0,
      bytesReceived: session.bytesReceived || 0,
      etaSeconds: null,
      speedBps: null,
      uploadId: null,
      error: null,
    };
  }

  function createNewQueueItem(file) {
    return {
      id: createItemId(),
      file,
      sessionId: null,
      serverStatus: null,
      name: file.name,
      size: file.size,
      status: S.PENDING,
      progress: 0,
      bytesReceived: 0,
      etaSeconds: null,
      speedBps: null,
      uploadId: null,
      error: null,
    };
  }

  class UploadQueue {
    constructor(options = {}) {
      this.apiPrefix = options.apiPrefix || UPLOAD_CONFIG.DEFAULT_API_PREFIX;
      this.fetchFn = options.fetchFn;
      this.onChange = options.onChange || (() => {});
      this.onActiveItem = options.onActiveItem || (() => {});
      this.maxConcurrent = options.maxConcurrent || UPLOAD_CONFIG.MAX_CONCURRENT;
      this.items = [];
      this.queuePaused = false;
      this.uploaders = new Map();
      this._syncTimer = null;
      this._displayTimer = null;
      this._notifyTimer = null;
    }

    getState() {
      return {
        items: this.items.map((item) => ({ ...item, file: undefined })),
        queuePaused: this.queuePaused,
        activeUploadCount: this.countByStatus(S.UPLOADING),
        maxConcurrent: this.maxConcurrent,
      };
    }

    notify(immediate = true) {
      if (!immediate) {
        if (this._notifyTimer) return;
        this._notifyTimer = setTimeout(() => {
          this._notifyTimer = null;
          this.onChange(this.getState());
        }, UPLOAD_CONFIG.NOTIFY_THROTTLE_MS);
        return;
      }
      if (this._notifyTimer) {
        clearTimeout(this._notifyTimer);
        this._notifyTimer = null;
      }
      this.onChange(this.getState());
    }

    countByStatus(status) {
      return this.items.filter((item) => item.status === status).length;
    }

    getItem(id) {
      return this.items.find((item) => item.id === id) || null;
    }

    getWaitingItems() {
      return this.items.filter(isWaitingForLocalFile);
    }

    getWaitingForFileItems() {
      return this.getWaitingItems();
    }

    hasRemoteSessionsWaitingForFile() {
      return this.getWaitingItems().length > 0;
    }

    getNextWaitingForFile() {
      return this.getWaitingItems().find((item) => !this.uploaders.has(item.id)) || null;
    }

    getNextWaitingRemote() {
      return this.getNextWaitingForFile();
    }

    formatItemStatus(item) {
      if (item.status === S.UPLOADING) {
        const pct = item.progress ? `${item.progress}%` : '0%';
        const speed = formatTransferSpeed(item.speedBps);
        return speed ? `Загружается · ${pct} · ${speed}` : `Загружается · ${pct}`;
      }

      if (item.status === S.WAITING_FILE) {
        const waiting = this.getWaitingItems();
        const index = waiting.findIndex((entry) => entry.id === item.id);
        const order = waiting.length > 1 ? ` · ${index + 1}/${waiting.length}` : '';
        const pct = item.progress ? ` · ${item.progress}%` : '';
        return `Выберите тот же файл${order}${pct}`;
      }

      if (item.status === S.PENDING) {
        const pending = this.items.filter((entry) => entry.status === S.PENDING);
        const index = pending.findIndex((entry) => entry.id === item.id);
        if (pending.length > 1 && index >= 0) {
          return `Ожидает · ${index + 1}/${pending.length}`;
        }
        return global.UPLOAD_QUEUE_STATUS_LABELS[S.PENDING];
      }

      if (item.status === S.PAUSED) {
        const pct = item.progress ? ` · ${item.progress}%` : '';
        const speed = formatTransferSpeed(item.speedBps);
        if (speed) return `На паузе${pct} · было ${speed}`;
        return item.progress ? `На паузе · ${item.progress}%` : 'На паузе';
      }

      return global.UPLOAD_QUEUE_STATUS_LABELS[item.status] || item.status;
    }

    formatItemBadge(item) {
      if (item.status === S.UPLOADING) return { text: 'Загружается', className: S.UPLOADING };
      if (item.status === S.WAITING_FILE) return { text: 'На паузе', className: S.WAITING_FILE };
      if (item.status === S.PAUSED) return { text: 'На паузе', className: S.PAUSED };
      if (item.status === S.PENDING) return { text: 'Ожидает', className: S.PENDING };
      if (item.status === S.READY) return { text: 'Готов', className: S.READY };
      return null;
    }

    formatItemProgressDetail(item) {
      const formatBytes = global.formatUploadBytes;
      if (!formatBytes || !item.size) return '';
      if (![S.PENDING, S.UPLOADING, S.PAUSED, S.WAITING_FILE, S.ERROR].includes(item.status)) {
        return '';
      }

      const received = bytesFromProgress(item);
      const total = item.size;

      if (isWaitingForLocalFile(item)) {
        return `Сохранено ${formatBytes(received)} / ${formatBytes(total)} · выберите файл выше`;
      }

      let detail = `${formatBytes(received)} / ${formatBytes(total)}`;
      if (item.status === S.UPLOADING) {
        const speed = formatTransferSpeed(item.speedBps);
        detail += speed ? ` · ${speed}` : ' · …';
      }
      if (item.status === S.UPLOADING && item.etaSeconds != null) {
        const eta = formatDuration(item.etaSeconds);
        if (eta) detail += ` · осталось ${eta}`;
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

      if (elapsedSec >= UPLOAD_CONFIG.SPEED_SAMPLE_MIN_SEC && received > tracker.lastBytes) {
        const instantSpeed = (received - tracker.lastBytes) / elapsedSec;
        if (elapsedSec >= UPLOAD_CONFIG.SPEED_SMOOTHING_MIN_SEC) {
          tracker.speedBps = tracker.speedBps
            ? tracker.speedBps * UPLOAD_CONFIG.SPEED_SMOOTHING_PREV_WEIGHT
              + instantSpeed * UPLOAD_CONFIG.SPEED_SMOOTHING_NEW_WEIGHT
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
        if (!item.sessionId || item.file || item.status === S.UPLOADING) return true;
        if (activeSessionIds.has(item.sessionId)) return true;
        changed = true;
        return false;
      });

      for (const session of entries) {
        if (!session?.sessionId) continue;

        const existing = this.items.find((item) => item.sessionId === session.sessionId);
        if (existing) {
          if (existing.file || existing.status === S.UPLOADING || existing.status === S.PENDING) {
            continue;
          }
          const prevBytes = existing.bytesReceived || 0;
          const nextBytes = session.bytesReceived || 0;
          if (
            existing.serverStatus !== session.status
            || existing.progress !== session.progress
            || existing.bytesReceived !== nextBytes
          ) {
            existing.serverStatus = session.status;
            existing.progress = session.progress || 0;
            existing.bytesReceived = nextBytes;
            existing.status = S.WAITING_FILE;
            if (nextBytes > prevBytes) {
              this.updateItemTransferStats(
                existing,
                nextBytes,
                session.totalSize,
                UPLOAD_CONFIG.SERVER_SYNC_MS / 1000,
              );
            }
            changed = true;
          }
          continue;
        }

        const duplicate = this.items.some((item) => (
          item.sessionId === session.sessionId
          || (
            item.name === session.originalName
            && item.size === session.totalSize
            && (item.file || item.status === S.UPLOADING || item.status === S.PENDING || this.uploaders.has(item.id))
          )
        ));
        if (duplicate) continue;

        this.items.push(createQueueItemFromSession(session));
        changed = true;
      }

      if (changed) this.notify();
      this.updateServerSyncTimer();
      this.updateDisplayTimer();
      return entries.length > 0;
    }

    async refreshFromServer() {
      const response = await this.fetchFn(`${this.apiPrefix}/sessions`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
      this.syncSessionsFromServer(data.sessions || []);
    }

    async pauseSessionsWithoutFile() {
      const targets = this.getWaitingItems().filter((item) => !this.uploaders.has(item.id));
      if (!targets.length) return 0;

      let changed = false;
      await Promise.all(targets.map(async (item) => {
        if (item.serverStatus !== SS.PAUSED) {
          await this.fetchFn(`${this.apiPrefix}/pause/${item.sessionId}`, {
            method: 'POST',
            body: JSON.stringify({}),
          }).catch(() => {});
          item.serverStatus = SS.PAUSED;
          changed = true;
        }
        if (item.status !== S.WAITING_FILE) {
          item.status = S.WAITING_FILE;
          changed = true;
        }
      }));

      if (changed) this.notify();
      return targets.length;
    }

    findMatchForFile(file) {
      return this.items.find((item) => (
        sameFileIdentity(file, item)
        && !TERMINAL_STATUSES.includes(item.status)
        && item.status !== S.UPLOADING
        && !this.uploaders.has(item.id)
      )) || null;
    }

    async submitFile(file) {
      if (!file) return { ok: false, reason: 'no_file' };

      const waitingMatch = this.findMatchForFile(file);
      if (waitingMatch && (isWaitingForLocalFile(waitingMatch) || waitingMatch.status === S.ERROR)) {
        return this.attachAndUpload(waitingMatch, file);
      }

      if (this.getWaitingItems().some((item) => sameFileIdentity(file, item))) {
        return { ok: false, reason: 'resume_failed' };
      }

      const existing = this.items.find((item) => (
        sameFileIdentity(file, item)
        && !TERMINAL_STATUSES.includes(item.status)
        && item.file
        && item.status !== S.UPLOADING
      ));
      if (existing) {
        return this.attachAndUpload(existing, file);
      }

      if (this.getWaitingItems().length) {
        return { ok: false, reason: 'wrong_file' };
      }

      this.items.push(createNewQueueItem(file));
      this.notify();
      this.processQueue();
      return { ok: true, reason: 'enqueued' };
    }

    async attachAndUpload(item, file) {
      if (!item || !file) return { ok: false, reason: 'invalid' };
      if (this.uploaders.has(item.id)) {
        return { ok: false, reason: 'already_uploading' };
      }

      item.file = file;
      item.error = null;
      if (item.sessionId) {
        linkFileToSession(this.apiPrefix, file, item.sessionId);
      }

      try {
        await this.startUpload(item);
        return { ok: true, reason: 'resumed' };
      } catch (error) {
        item.status = S.ERROR;
        item.error = error.message || 'Не удалось возобновить загрузку';
        this.notify();
        return { ok: false, reason: 'upload_error', error: item.error };
      }
    }

    addFile(file) {
      return this.submitFile(file).then((result) => result.ok);
    }

    async restoreFilesFromStoredHandles(options = {}) {
      const store = global.FileHandleStore;
      if (!store?.getFileBySessionId) {
        return { restored: 0, pendingPermission: 0, waiting: 0 };
      }

      const targets = this.getWaitingItems();
      let restored = 0;
      let pendingPermission = 0;

      for (const item of targets) {
        if (item.file || this.uploaders.has(item.id)) continue;
        const hasStored = await store.hasStoredSession(item.sessionId);
        if (!hasStored) continue;

        const file = await store.getFileBySessionId(item.sessionId, {
          allowRequest: options.allowRequest === true,
        });
        if (!file) {
          pendingPermission += 1;
          continue;
        }

        const result = await this.attachAndUpload(item, file);
        if (result.ok) restored += 1;
      }

      return { restored, pendingPermission, waiting: targets.length };
    }

    processQueue() {
      if (this.queuePaused) return;
      while (this.countByStatus(S.UPLOADING) < this.maxConcurrent) {
        const next = this.items.find((item) => item.status === S.PENDING && item.file);
        if (!next || this.uploaders.has(next.id)) break;
        this.startUpload(next).catch((error) => {
          next.status = S.ERROR;
          next.error = error.message;
          this.notify();
        });
      }
    }

    async resumeServerSession(item) {
      if (!item.sessionId) return;
      await this.fetchFn(`${this.apiPrefix}/resume/${item.sessionId}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      item.serverStatus = SS.ACTIVE;
    }

    async startUpload(item) {
      if (!item?.file || this.uploaders.has(item.id) || item.status === S.UPLOADING) return;

      if (this.countByStatus(S.UPLOADING) >= this.maxConcurrent) {
        item.status = S.PENDING;
        this.notify();
        this.processQueue();
        return;
      }

      item.status = S.UPLOADING;
      item.error = null;
      item.speedBps = null;
      item._etaTracker = null;
      this.onActiveItem(item);
      this.notify();
      this.updateServerSyncTimer();
      this.updateDisplayTimer();

      if (item.sessionId) {
        linkFileToSession(this.apiPrefix, item.file, item.sessionId);
        if (item.serverStatus === SS.PAUSED) {
          await this.resumeServerSession(item).catch(() => {});
        }
      }

      const uploader = new global.ChunkUploader({
        apiPrefix: this.apiPrefix,
        fetchFn: this.fetchFn,
      });
      this.uploaders.set(item.id, uploader);

      uploader.setHandlers({
        onSession: (session) => {
          if (!session?.sessionId || !item.file) return;
          item.sessionId = session.sessionId;
          linkFileToSession(this.apiPrefix, item.file, session.sessionId);
          if (global.FileHandleStore?.linkSession) {
            global.FileHandleStore.linkSession(item.file, session.sessionId).catch(() => {});
          }
        },
        onProgress: ({ bytesReceived, totalSize }) => {
          if (uploader.session?.sessionId) item.sessionId = uploader.session.sessionId;
          this.updateItemTransferStats(item, bytesReceived, totalSize);
          item.serverStatus = SS.ACTIVE;
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
          item.status = S.READY;
          item.progress = 100;
          item.bytesReceived = item.size;
          item.etaSeconds = 0;
          item.speedBps = null;
          this.onActiveItem(item);
        } else if (uploader.waitingForResume || uploader.paused) {
          item.status = S.PAUSED;
          item.serverStatus = SS.PAUSED;
        } else if (uploader.cancelled) {
          item.status = S.CANCELLED;
        } else {
          throw new Error('Загрузка прервана');
        }
      } catch (error) {
        if (uploader.cancelled) return;
        if (uploader.waitingForResume || uploader.paused) {
          item.status = S.PAUSED;
          item.serverStatus = SS.PAUSED;
          item.error = error.message;
          return;
        }
        item.status = S.ERROR;
        item.error = error.message || 'Ошибка загрузки';
        throw error;
      } finally {
        if (!uploader.paused && !uploader.waitingForResume) {
          this.uploaders.delete(item.id);
        }
        this.notify();
        this.updateServerSyncTimer();
        this.updateDisplayTimer();
        this.processQueue();
      }
    }

    updateDisplayTimer() {
      const shouldTick = this.items.some((item) => (
        item.status === S.UPLOADING
        || isWaitingForLocalFile(item)
      ));

      if (shouldTick && !this._displayTimer) {
        this._displayTimer = setInterval(() => {
          let changed = false;
          this.items.forEach((item) => {
            if (item.etaSeconds > 0 && item.status === S.UPLOADING) {
              item.etaSeconds = Math.max(0, item.etaSeconds - UPLOAD_CONFIG.DISPLAY_TICK_MS / 1000);
              changed = true;
            }
          });
          if (changed) this.notify(false);
        }, UPLOAD_CONFIG.DISPLAY_TICK_MS);
      } else if (!shouldTick && this._displayTimer) {
        clearInterval(this._displayTimer);
        this._displayTimer = null;
      }
    }

    updateServerSyncTimer() {
      const needsSync = this.items.some((item) => isWaitingForLocalFile(item));
      if (needsSync && !this._syncTimer) {
        this._syncTimer = setInterval(() => {
          this.refreshFromServer().catch(() => {});
        }, UPLOAD_CONFIG.SERVER_SYNC_MS);
      } else if (!needsSync && this._syncTimer) {
        clearInterval(this._syncTimer);
        this._syncTimer = null;
      }
    }

    setActiveItem(id) {
      const item = this.getItem(id);
      if (!item || ![S.READY, S.UPLOADING, S.PAUSED].includes(item.status)) return;
      this.onActiveItem(item);
      this.notify();
    }

    markShared(id) {
      const item = this.getItem(id);
      if (!item) return;
      item.status = S.SHARED;
      if (item.sessionId && global.FileHandleStore?.removeBySessionId) {
        global.FileHandleStore.removeBySessionId(item.sessionId).catch(() => {});
      }
      if (item.file && global.FileHandleStore?.removeByFile) {
        global.FileHandleStore.removeByFile(item.file).catch(() => {});
      }
      const next = this.items.find((entry) => entry.status === S.READY);
      if (next) this.onActiveItem(next);
      this.notify();
      this.processQueue();
    }

    pauseItem(id) {
      const item = this.getItem(id);
      if (!item) return;
      const uploader = this.uploaders.get(id);

      if (item.status === S.UPLOADING && uploader) {
        item.status = S.PAUSED;
        item.serverStatus = SS.PAUSED;
        uploader.pause().catch(() => {});
        this.notify();
        this.processQueue();
        return;
      }

      if (item.status === S.PENDING) {
        item.status = S.PAUSED;
        this.notify();
      }
    }

    resumeItem(id) {
      const item = this.getItem(id);
      if (!item || item.status !== S.PAUSED || !item.file) return;
      item.status = S.PENDING;
      this.notify();
      this.processQueue();
    }

    pauseQueue() {
      this.queuePaused = true;
      this.items.forEach((item) => {
        if (item.status === S.UPLOADING) this.pauseItem(item.id);
        else if (item.status === S.PENDING) item.status = S.PAUSED;
      });
      this.notify();
    }

    resumeQueue() {
      this.queuePaused = false;
      this.items.forEach((item) => {
        if (item.status === S.PAUSED && item.file && !this.uploaders.has(item.id)) {
          item.status = S.PENDING;
        }
      });
      this.notify();
      this.processQueue();
    }

    cancelItem(id) {
      const item = this.getItem(id);
      if (!item) return;

      const uploader = this.uploaders.get(id);
      if (uploader) {
        uploader.cancel().catch(() => {});
        this.uploaders.delete(id);
      } else if (item.sessionId) {
        this.fetchFn(`${this.apiPrefix}/cancel/${item.sessionId}`, { method: 'DELETE' }).catch(() => {});
        clearSessionKeys(item.sessionId);
        if (global.FileHandleStore?.removeBySessionId) {
          global.FileHandleStore.removeBySessionId(item.sessionId).catch(() => {});
        }
      }

      if (item.file && global.FileHandleStore?.removeByFile) {
        global.FileHandleStore.removeByFile(item.file).catch(() => {});
      }

      item.status = S.CANCELLED;
      this.notify();
      this.updateServerSyncTimer();
      this.updateDisplayTimer();
      this.processQueue();
    }

    clearFinished() {
      this.items = this.items.filter((item) => ![S.SHARED, S.CANCELLED, S.ERROR].includes(item.status));
      this.notify();
      this.updateServerSyncTimer();
      this.updateDisplayTimer();
    }

    start() {
      this.processQueue();
    }
  }

  global.UploadQueue = UploadQueue;
})(window);
