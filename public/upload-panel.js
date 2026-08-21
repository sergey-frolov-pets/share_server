(function (global) {
  const { UPLOAD_CONFIG, UPLOAD_ITEM_STATUS: S } = global;
  const { basename } = global.UploadFileMatcher;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  class UploadPanel {
    constructor(options) {
      this.queue = options.queue;
      this.onActiveItem = options.onActiveItem || (() => {});
      this.onFileAccepted = options.onFileAccepted || (() => {});
      this.onError = options.onError || (() => {});

      this.elements = options.elements;
      this.lastSnapshot = null;
      this.lastRestoreState = null;
      this.pickingFile = false;

      this.bindEvents();
    }

    bindEvents() {
      const { dropZone, fileInput, queuePauseBtn, queueResumeBtn, queueClearBtn, restoreBtn } = this.elements;

      dropZone.addEventListener('click', () => this.openFilePicker());
      dropZone.addEventListener('dragover', (event) => {
        event.preventDefault();
        dropZone.classList.add('dragover');
      });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
      dropZone.addEventListener('drop', (event) => {
        event.preventDefault();
        dropZone.classList.remove('dragover');
        this.handleDrop(event).catch(() => {});
      });

      fileInput.addEventListener('change', () => {
        this.pickingFile = false;
        const file = fileInput.files?.[0];
        if (file) this.handleFile(file).catch(() => {});
        fileInput.value = '';
      });

      fileInput.addEventListener('cancel', () => {
        this.pickingFile = false;
      });

      queuePauseBtn.addEventListener('click', () => this.queue.pauseQueue());
      queueResumeBtn.addEventListener('click', () => this.queue.resumeQueue());
      queueClearBtn.addEventListener('click', () => this.queue.clearFinished());

      if (restoreBtn) {
        restoreBtn.addEventListener('click', () => {
          this.tryRestoreStoredFiles(true).catch(() => {});
        });
      }
    }

    openFilePicker() {
      if (this.pickingFile) return;
      this.pickingFile = true;
      const onWindowFocus = () => {
        window.removeEventListener('focus', onWindowFocus);
        setTimeout(() => {
          if (!this.elements.fileInput.files?.length) this.pickingFile = false;
        }, UPLOAD_CONFIG.FILE_PICKER_CANCEL_MS);
      };
      window.addEventListener('focus', onWindowFocus);
      this.elements.fileInput.click();
    }

    async handleDrop(event) {
      const file = await this.readDropFile(event);
      if (!file) return;
      await this.handleFile(file);
    }

    async readDropFile(event) {
      const items = [...(event.dataTransfer?.items || [])];
      for (const item of items) {
        if (item.kind !== 'file') continue;
        if (typeof item.getAsFileSystemHandle === 'function') {
          try {
            const handle = await item.getAsFileSystemHandle();
            if (handle?.kind === 'file') {
              const file = await handle.getFile();
              if (global.FileHandleStore?.saveHandle) {
                await global.FileHandleStore.saveHandle(file, handle);
              }
              return file;
            }
          } catch (_err) {
            // fallback below
          }
        }
        const file = item.getAsFile();
        if (file) return file;
      }
      return event.dataTransfer?.files?.[0] || null;
    }

    async handleFile(file, handle = null) {
      if (global.FileHandleStore?.saveHandle && handle) {
        await global.FileHandleStore.saveHandle(file, handle);
      }

      const result = await this.queue.submitFile(file);
      if (result.ok) {
        this.onFileAccepted();
        this.updateDropHint();
        return result;
      }

      if (result.reason === 'wrong_file') {
        this.onError('Выберите тот же файл, что в очереди');
      } else if (result.reason === 'already_uploading') {
        // Файл уже прикреплён и загрузка идёт — не показываем ошибку.
      } else if (result.reason === 'resume_failed' || result.reason === 'upload_error') {
        this.onError(result.error || 'Не удалось возобновить загрузку — попробуйте ещё раз');
      }
      return result;
    }

    async restoreAfterLogin() {
      try {
        const response = await fetch('/api/upload/sessions', { credentials: 'same-origin' });
        const data = await response.json();
        if (response.ok && this.queue.syncSessionsFromServer(data.sessions || [])) {
          this.showQueue();
        }
        await this.queue.pauseSessionsWithoutFile();
        await this.tryRestoreStoredFiles(false);
        this.updateDropHint();
      } catch (_err) {
        // ignore restore errors on load
      }
    }

    async tryRestoreStoredFiles(allowRequest = false) {
      const result = await this.queue.restoreFilesFromStoredHandles({ allowRequest });
      this.lastRestoreState = result;
      this.render(this.queue.getState());
      return result;
    }

    showQueue() {
      this.elements.queueEl.classList.remove('hidden');
    }

    hideQueue() {
      this.elements.queueEl.classList.add('hidden');
    }

    reset() {
      this.queue.uploaders.forEach((uploader) => uploader.cancel().catch(() => {}));
      this.queue.uploaders.clear();
      this.queue.items = [];
      this.queue.queuePaused = false;
      this.lastSnapshot = null;
      this.elements.queueList.innerHTML = '';
      this.hideQueue();
      this.updateDropHint(true);
    }

    updateDropHint(forceDefault = false) {
      const hintEl = this.elements.dropZone.querySelector('.hint');
      if (!hintEl) return;

      if (forceDefault) {
        hintEl.textContent = this.defaultHintText();
        return;
      }

      const waiting = this.queue.getWaitingItems();
      if (!waiting.length) {
        hintEl.textContent = this.defaultHintText();
        return;
      }

      if (waiting.length === 1) {
        const name = basename(waiting[0].name);
        const shortName = name.length > UPLOAD_CONFIG.DROP_HINT_MAX_NAME_LENGTH
          ? `${name.slice(0, UPLOAD_CONFIG.DROP_HINT_MAX_NAME_LENGTH - 1)}…`
          : name;
        hintEl.textContent = `выберите тот же файл: ${shortName}`;
        return;
      }

      hintEl.textContent = `выберите файлы из очереди (${waiting.length}) — по одному`;
    }

    defaultHintText() {
      return `или нажмите — один файл, до ${UPLOAD_CONFIG.MAX_CONCURRENT} параллельно`;
    }

    isProgressOnlyUpdate(prev, state) {
      if (!prev || prev.items.length !== state.items.length) return false;
      if (prev.queuePaused !== state.queuePaused) return false;
      if (prev.activeUploadCount !== state.activeUploadCount) return false;
      return state.items.every((item, index) => {
        const previous = prev.items[index];
        return previous
          && previous.id === item.id
          && previous.status === item.status
          && previous.error === item.error
          && previous.uploadId === item.uploadId
          && previous.sessionId === item.sessionId
          && previous.serverStatus === item.serverStatus;
      });
    }

    render(state) {
      const {
        queueEl,
        queueList,
        queueHint,
        queueHintText,
        queueRestoreBtn,
        queuePauseBtn,
        queueResumeBtn,
      } = this.elements;

      if (!state.items.length) {
        this.hideQueue();
        queueHint.classList.add('hidden');
        queueList.innerHTML = '';
        this.lastSnapshot = null;
        this.updateDropHint();
        return;
      }

      this.showQueue();
      this.updateWaitingHint(state);
      this.updateDropHint();

      if (this.isProgressOnlyUpdate(this.lastSnapshot, state)) {
        state.items.forEach((item) => this.updateRow(item));
        this.lastSnapshot = this.cloneSnapshot(state);
        return;
      }

      queueList.innerHTML = state.items.map((item) => this.renderRow(item)).join('');
      queueList.querySelectorAll('.upload-queue-item--ready').forEach((row) => {
        row.addEventListener('click', () => this.queue.setActiveItem(row.dataset.queueId));
      });

      if (state.queuePaused) {
        queuePauseBtn.classList.add('hidden');
        queueResumeBtn.classList.remove('hidden');
      } else {
        queuePauseBtn.classList.remove('hidden');
        queueResumeBtn.classList.add('hidden');
      }

      this.lastSnapshot = this.cloneSnapshot(state);
    }

    cloneSnapshot(state) {
      return {
        queuePaused: state.queuePaused,
        activeUploadCount: state.activeUploadCount,
        items: state.items.map((item) => ({ ...item })),
      };
    }

    updateWaitingHint(state) {
      const { queueHint, queueHintText, queueRestoreBtn } = this.elements;
      const waiting = state.items.filter((item) => item.status === S.WAITING_FILE);
      const uploading = state.items.some((item) => item.status === S.UPLOADING);

      if (!waiting.length || uploading) {
        queueHint.classList.add('hidden');
        if (queueRestoreBtn) queueRestoreBtn.classList.add('hidden');
        return;
      }

      queueHint.classList.remove('hidden');
      if (this.lastRestoreState?.pendingPermission > 0) {
        queueHintText.textContent = 'Разрешите доступ к файлам или выберите их в зоне выше.';
        if (queueRestoreBtn) queueRestoreBtn.classList.remove('hidden');
        return;
      }

      queueHintText.textContent = 'Выберите тот же файл в зоне выше — загрузка продолжится автоматически.';
      if (queueRestoreBtn) queueRestoreBtn.classList.add('hidden');
    }

    renderRow(item) {
      const activeClass = item.status === S.UPLOADING ? ' active' : '';
      const statusClass = ` upload-queue-item--${item.status}`;
      const clickableClass = item.status === S.READY ? ' upload-queue-item--clickable' : '';
      const badge = this.queue.formatItemBadge(item);
      const badgeHtml = badge
        ? `<span class="upload-queue-badge upload-queue-badge--${badge.className}">${escapeHtml(badge.text)}</span>`
        : '';
      const progressDetail = this.queue.formatItemProgressDetail(item);
      const progressMetaClass = item.status === S.UPLOADING
        ? 'upload-queue-item-progress-meta upload-queue-item-progress-meta--active'
        : 'upload-queue-item-progress-meta';
      const progressDetailHtml = progressDetail
        ? `<div class="${progressMetaClass}">${escapeHtml(progressDetail)}</div>`
        : '';
      const progressHtml = [S.PENDING, S.UPLOADING, S.PAUSED, S.WAITING_FILE].includes(item.status)
        ? `<div class="upload-queue-item-progress${item.status === S.UPLOADING ? '' : ' upload-queue-item-progress--idle'}"><div class="upload-queue-item-progress-fill" style="width:${item.progress || 0}%"></div></div>`
        : '';
      const errorHtml = item.error
        ? `<div class="upload-queue-item-meta upload-queue-item-error">${escapeHtml(item.error)}</div>`
        : '';

      return `
        <li class="upload-queue-item${activeClass}${statusClass}${clickableClass}" data-queue-id="${item.id}" data-status="${item.status}">
          <div class="upload-queue-item-row">
            <div class="upload-queue-item-text">
              <div class="upload-queue-item-title-row">
                <span class="upload-queue-item-name">${escapeHtml(item.name)}</span>
                ${badgeHtml}
              </div>
              ${this.queue.formatItemStatus(item) ? `<div class="upload-queue-item-sub"><span class="upload-queue-item-status">${escapeHtml(this.queue.formatItemStatus(item))}</span></div>` : ''}
            </div>
          </div>
          ${progressDetailHtml}
          ${progressHtml}
          ${errorHtml}
        </li>
      `;
    }

    updateRow(item) {
      const row = this.elements.queueList.querySelector(`[data-queue-id="${item.id}"]`);
      if (!row) return;

      row.className = `upload-queue-item${item.status === S.UPLOADING ? ' active' : ''} upload-queue-item--${item.status}${item.status === S.READY ? ' upload-queue-item--clickable' : ''}`;
      row.dataset.status = item.status;

      const badge = this.queue.formatItemBadge(item);
      let badgeEl = row.querySelector('.upload-queue-badge');
      if (badge) {
        if (!badgeEl) {
          const titleRow = row.querySelector('.upload-queue-item-title-row');
          if (titleRow) {
            titleRow.insertAdjacentHTML(
              'beforeend',
              `<span class="upload-queue-badge upload-queue-badge--${badge.className}">${escapeHtml(badge.text)}</span>`,
            );
            badgeEl = row.querySelector('.upload-queue-badge');
          }
        } else {
          badgeEl.className = `upload-queue-badge upload-queue-badge--${badge.className}`;
          badgeEl.textContent = badge.text;
        }
      } else if (badgeEl) {
        badgeEl.remove();
      }

      const statusEl = row.querySelector('.upload-queue-item-status');
      const statusText = this.queue.formatItemStatus(item);
      const subEl = row.querySelector('.upload-queue-item-sub');
      if (statusText) {
        if (statusEl) statusEl.textContent = statusText;
        else if (subEl) {
          subEl.innerHTML = `<span class="upload-queue-item-status">${escapeHtml(statusText)}</span>`;
        } else {
          const textEl = row.querySelector('.upload-queue-item-text');
          if (textEl) {
            textEl.insertAdjacentHTML(
              'beforeend',
              `<div class="upload-queue-item-sub"><span class="upload-queue-item-status">${escapeHtml(statusText)}</span></div>`,
            );
          }
        }
        if (subEl) subEl.classList.remove('hidden');
      } else if (subEl) {
        subEl.remove();
      }

      const progressMetaEl = row.querySelector('.upload-queue-item-progress-meta');
      const progressDetail = this.queue.formatItemProgressDetail(item);
      if (progressMetaEl) {
        progressMetaEl.textContent = progressDetail;
        progressMetaEl.className = item.status === S.UPLOADING
          ? 'upload-queue-item-progress-meta upload-queue-item-progress-meta--active'
          : 'upload-queue-item-progress-meta';
        progressMetaEl.classList.toggle('hidden', !progressDetail);
      }

      const fill = row.querySelector('.upload-queue-item-progress-fill');
      if (fill) fill.style.width = `${item.progress || 0}%`;
    }
  }

  global.UploadPanel = UploadPanel;
})(window);
