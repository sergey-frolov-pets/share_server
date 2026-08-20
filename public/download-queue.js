(function (global) {
  const STATUS_LABELS = {
    pending: 'В очереди',
    downloading: 'Скачивание…',
    paused: 'Пауза',
    done: 'Скачано',
    error: 'Ошибка',
    cancelled: 'Отменено',
  };

  function createItemId() {
    return `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  class DownloadQueue {
    constructor(options = {}) {
      this.fetchFn = options.fetchFn || ((url, opts) => fetch(url, { credentials: 'same-origin', ...opts }));
      this.onChange = options.onChange || (() => {});
      this.buildUrl = options.buildUrl || ((fileId) => `/api/admin/files/${fileId}/download`);
      this.items = [];
      this.running = false;
      this.queuePaused = false;
      this.currentAbort = null;
      this.currentItemId = null;
    }

    getState() {
      return {
        items: this.items.map((item) => ({ ...item })),
        running: this.running,
        queuePaused: this.queuePaused,
        currentItemId: this.currentItemId,
      };
    }

    notify() {
      this.onChange(this.getState());
    }

    add(item) {
      if (!item?.fileId || !item?.name) return;
      const exists = this.items.some(
        (entry) => entry.fileId === item.fileId && ['pending', 'downloading', 'paused'].includes(entry.status)
      );
      if (exists) return;

      this.items.push({
        id: createItemId(),
        fileId: item.fileId,
        name: item.name,
        size: item.size || 0,
        status: 'pending',
        progress: 0,
        error: null,
      });
      this.notify();
      this.start();
    }

    pauseQueue() {
      this.queuePaused = true;
      if (this.currentAbort) {
        this.currentAbort.abort();
      }
      this.notify();
    }

    resumeQueue() {
      this.queuePaused = false;
      const paused = this.items.find((item) => item.status === 'paused');
      if (paused) paused.status = 'pending';
      this.notify();
      this.start();
    }

    cancelItem(id) {
      const item = this.items.find((entry) => entry.id === id);
      if (!item) return;
      if (this.currentItemId === id && this.currentAbort) {
        this.currentAbort.abort();
      }
      item.status = 'cancelled';
      if (this.currentItemId === id) this.currentItemId = null;
      this.notify();
      this.start();
    }

    clearFinished() {
      this.items = this.items.filter((item) => !['done', 'cancelled', 'error'].includes(item.status));
      this.notify();
    }

    async start() {
      if (this.running || this.queuePaused) return;
      const next = this.items.find((item) => item.status === 'pending');
      if (!next) return;

      this.running = true;
      this.currentItemId = next.id;
      next.status = 'downloading';
      next.error = null;
      this.notify();

      try {
        await this.downloadItem(next);
        if (next.status === 'downloading') {
          next.status = 'done';
          next.progress = 100;
        }
      } catch (error) {
        if (next.status === 'cancelled') {
          // keep cancelled
        } else if (this.queuePaused || error.name === 'AbortError') {
          next.status = 'paused';
        } else {
          next.status = 'error';
          next.error = error.message || 'Ошибка скачивания';
        }
      }

      this.running = false;
      this.currentItemId = null;
      this.currentAbort = null;
      this.notify();

      if (!this.queuePaused) {
        await this.start();
      }
    }

    async downloadItem(item) {
      const controller = new AbortController();
      this.currentAbort = controller;

      const response = await this.fetchFn(this.buildUrl(item.fileId), {
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Ошибка скачивания');
      }

      const total = Number(response.headers.get('Content-Length')) || item.size || 0;
      const reader = response.body?.getReader();
      if (!reader) {
        const blob = await response.blob();
        this.saveBlob(blob, item.name);
        return;
      }

      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        item.progress = total ? Math.min(100, Math.round((received / total) * 100)) : 0;
        this.notify();
      }

      const blob = new Blob(chunks);
      this.saveBlob(blob, item.name);
    }

    saveBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    }
  }

  global.DownloadQueue = DownloadQueue;
  global.DOWNLOAD_QUEUE_STATUS_LABELS = STATUS_LABELS;
})(window);
