(function (global) {
  const STATUS_LABELS = {
    pending: 'В очереди',
    uploading: 'Загрузка…',
    paused: 'Пауза',
    ready: 'Готов к публикации',
    shared: 'Ссылка создана',
    error: 'Ошибка',
    cancelled: 'Отменено',
  };

  function createItemId() {
    return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

    notify() {
      this.onChange(this.getState());
    }

    addFiles(fileList) {
      const files = Array.from(fileList || []).filter(Boolean);
      if (!files.length) return;

      for (const file of files) {
        this.items.push({
          id: createItemId(),
          file,
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

      const next = this.items.find((item) => item.status === 'pending');
      if (!next) return;

      this.running = true;
      this.currentItemId = next.id;
      next.status = 'uploading';
      next.error = null;
      this.onActiveItem(next);
      this.notify();

      const uploader = new global.ChunkUploader({
        apiPrefix: this.apiPrefix,
        fetchFn: this.fetchFn,
      });
      this.currentUploader = uploader;

      uploader.setHandlers({
        onProgress: ({ percent }) => {
          next.progress = percent;
          this.notify();
        },
        onStatus: () => {},
      });

      try {
        const result = await uploader.upload(next.file);
        this.currentUploader = null;
        if (result?.uploadId) {
          next.uploadId = result.uploadId;
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
