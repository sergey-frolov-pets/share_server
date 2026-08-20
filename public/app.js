const loginSection = document.getElementById('login-section');
const uploadSection = document.getElementById('upload-section');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const tabCreate = document.getElementById('tab-create');
const tabManage = document.getElementById('tab-manage');
const tabAdmin = document.getElementById('tab-admin');
const createPanel = document.getElementById('create-panel');
const managePanel = document.getElementById('manage-panel');
const adminPanel = document.getElementById('admin-panel');
const adminStats = document.getElementById('admin-stats');
const adminUsersBody = document.getElementById('admin-users-body');
const adminError = document.getElementById('admin-error');
const storageLimitForm = document.getElementById('storage-limit-form');
const storageUsage = document.getElementById('storage-usage');
const globalMaxStorageMb = document.getElementById('global-max-storage-mb');
const storageLimitSuccess = document.getElementById('storage-limit-success');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const fileNameEl = document.getElementById('file-name');
const uploadStatusEl = document.getElementById('upload-status');
const shareForm = document.getElementById('share-form');
const shortNameInput = document.getElementById('short-name');
const namePreview = document.getElementById('name-preview');
const nameError = document.getElementById('name-error');
const linkMaxDownloadsInput = document.getElementById('link-max-downloads');
const linkDaysInput = document.getElementById('link-days');
const fileMaxDownloadsInput = document.getElementById('file-max-downloads');
const fileDaysInput = document.getElementById('file-days');
const downloadPasswordInput = document.getElementById('download-password');
const fileDescriptionInput = document.getElementById('file-description');
const allowedEmailsInput = document.getElementById('allowed-emails');
const allowedDomainsInput = document.getElementById('allowed-domains');
const shareBtn = document.getElementById('share-btn');
const shareError = document.getElementById('share-error');
const result = document.getElementById('result');
const shareLink = document.getElementById('share-link');
const newUploadBtn = document.getElementById('new-upload-btn');

const loadLinkForm = document.getElementById('load-link-form');
const manageShortNameInput = document.getElementById('manage-short-name');
const loadError = document.getElementById('load-error');
const updateDropZone = document.getElementById('update-drop-zone');
const updateFileInput = document.getElementById('update-file-input');
const updateFileInfo = document.getElementById('update-file-info');
const updateFileNameEl = document.getElementById('update-file-name');
const updateUploadStatusEl = document.getElementById('update-upload-status');
const updateForm = document.getElementById('update-form');
const newShortNameInput = document.getElementById('new-short-name');
const currentFileNameEl = document.getElementById('current-file-name');
const updateLinkMaxDownloadsInput = document.getElementById('update-link-max-downloads');
const updateLinkDaysInput = document.getElementById('update-link-days');
const updateFileMaxDownloadsInput = document.getElementById('update-file-max-downloads');
const updateFileDaysInput = document.getElementById('update-file-days');
const updateDownloadPasswordInput = document.getElementById('update-download-password');
const updateFileDescriptionInput = document.getElementById('update-file-description');
const updateAllowedEmailsInput = document.getElementById('update-allowed-emails');
const updateAllowedDomainsInput = document.getElementById('update-allowed-domains');
const resetLinkCountInput = document.getElementById('reset-link-count');
const updateBtn = document.getElementById('update-btn');
const updateError = document.getElementById('update-error');
const updateSuccess = document.getElementById('update-success');

const updateSuccess = document.getElementById('update-success');
const uploadQueueEl = document.getElementById('upload-queue');
const uploadQueueList = document.getElementById('upload-queue-list');
const queuePauseBtn = document.getElementById('queue-pause-btn');
const queueResumeBtn = document.getElementById('queue-resume-btn');
const queueClearBtn = document.getElementById('queue-clear-btn');
const adminFilesBody = document.getElementById('admin-files-body');
const adminFilesMessage = document.getElementById('admin-files-message');

let currentUploadId = null;
let activeQueueItemId = null;
let uploadPromise = null;
let updateUploadId = null;
let updateUploadPromise = null;
let updateUploader = null;
let nameCheckTimeout = null;
let editingShortName = null;

function show(el) {
  el.classList.remove('hidden');
}

function hide(el) {
  el.classList.add('hidden');
}

function setMessage(el, message, type) {
  if (message) {
    el.textContent = message;
    el.className = type === 'error' ? 'error' : type === 'success' ? 'success' : 'hint';
    show(el);
  } else {
    el.textContent = '';
    hide(el);
  }
}

function daysFromExpires(expiresAt) {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt) - Date.now();
  if (ms <= 0) return '0';
  return String(Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
}

function updateNamePreview() {
  const name = shortNameInput.value.trim();
  const origin = window.location.origin;
  namePreview.textContent = name ? `${origin}/${name}` : `${origin}/...`;
}

async function checkNameAvailability(name) {
  if (!name || name.length < 2) {
    setMessage(nameError, null);
    return;
  }

  try {
    const data = await api(`/api/check-name/${encodeURIComponent(name)}`);
    if (!data.available) {
      setMessage(nameError, data.error || 'Имя недоступно', 'error');
    } else {
      setMessage(nameError, null);
    }
  } catch (err) {
    setMessage(nameError, err.message, 'error');
  }
}

async function assignDefaultShortName() {
  try {
    const data = await api('/api/random-name');
    shortNameInput.value = data.shortName;
    updateNamePreview();
    setMessage(nameError, null);
  } catch (err) {
    setMessage(nameError, err.message, 'error');
  }
}

function buildLimitPayload(linkMax, linkDays, fileMax, fileDays) {
  return {
    linkMaxDownloads: linkMax,
    linkDays: linkDays,
    fileMaxDownloads: fileMax,
    fileDays: fileDays,
  };
}

function resetCreateState() {
  uploadQueue.items = [];
  uploadQueue.running = false;
  uploadQueue.queuePaused = false;
  uploadQueue.currentUploader = null;
  uploadQueue.currentItemId = null;
  activeQueueItemId = null;
  currentUploadId = null;
  uploadPromise = null;
  fileInput.value = '';
  hide(fileInfo);
  hide(shareForm);
  hide(result);
  hide(uploadQueueEl);
  uploadQueueList.innerHTML = '';
  setMessage(shareError, null);
  setMessage(nameError, null);
  shortNameInput.value = '';
  linkMaxDownloadsInput.value = '';
  linkDaysInput.value = '';
  fileMaxDownloadsInput.value = '';
  fileDaysInput.value = '';
  downloadPasswordInput.value = '';
  fileDescriptionInput.value = '';
  allowedEmailsInput.value = '';
  allowedDomainsInput.value = '';
  updateNamePreview();
  uploadStatusEl.textContent = '';
  uploadStatusEl.className = 'status';
  document.getElementById('upload-progress')?.classList.add('hidden');
  const fill = document.getElementById('upload-progress-fill');
  if (fill) fill.style.width = '0%';
  hide(queueResumeBtn);
  show(queuePauseBtn);
}

const uploadQueue = new UploadQueue({
  apiPrefix: '/api/upload',
  fetchFn: (path, opts) => fetch(path, { credentials: 'same-origin', ...opts }),
  onChange: renderUploadQueue,
  onActiveItem: handleQueueActiveItem,
});

function renderUploadQueue(state) {
  if (!state.items.length) {
    hide(uploadQueueEl);
    uploadQueueList.innerHTML = '';
    return;
  }

  show(uploadQueueEl);
  uploadQueueList.innerHTML = state.items.map((item) => {
    const label = UPLOAD_QUEUE_STATUS_LABELS[item.status] || item.status;
    const activeClass = item.id === state.currentItemId ? ' active' : '';
    const progressHtml = ['pending', 'uploading', 'paused'].includes(item.status)
      ? `<div class="upload-queue-item-progress"><div class="upload-queue-item-progress-fill" style="width:${item.progress || 0}%"></div></div>`
      : '';
    const errorHtml = item.error ? `<div class="upload-queue-item-meta">${item.error}</div>` : '';
    return `
      <li class="upload-queue-item${activeClass}" data-queue-id="${item.id}">
        <div class="upload-queue-item-main">
          <strong>${item.name}</strong>
          <span>${label}${item.progress ? ` · ${item.progress}%` : ''}</span>
        </div>
        <div class="upload-queue-item-meta">${formatUploadBytes(item.size)}</div>
        ${progressHtml}
        ${errorHtml}
        <div class="upload-queue-item-actions">
          ${item.status === 'ready' ? `<button type="button" class="btn-small queue-select-btn" data-queue-id="${item.id}">Создать ссылку</button>` : ''}
          ${['pending', 'uploading', 'paused', 'ready'].includes(item.status) ? `<button type="button" class="btn-small btn-secondary queue-cancel-btn" data-queue-id="${item.id}">Убрать</button>` : ''}
        </div>
      </li>
    `;
  }).join('');

  uploadQueueList.querySelectorAll('.queue-select-btn').forEach((btn) => {
    btn.addEventListener('click', () => uploadQueue.setActiveItem(btn.dataset.queueId));
  });
  uploadQueueList.querySelectorAll('.queue-cancel-btn').forEach((btn) => {
    btn.addEventListener('click', () => uploadQueue.cancelItem(btn.dataset.queueId));
  });

  if (state.queuePaused) {
    hide(queuePauseBtn);
    show(queueResumeBtn);
  } else {
    show(queuePauseBtn);
    hide(queueResumeBtn);
  }
}

async function handleQueueActiveItem(item) {
  if (!item) {
    hide(shareForm);
    hide(fileInfo);
    currentUploadId = null;
    activeQueueItemId = null;
    return;
  }

  activeQueueItemId = item.id;
  fileNameEl.textContent = item.name;
  uploadStatusEl.textContent = UPLOAD_QUEUE_STATUS_LABELS[item.status] || item.status;
  uploadStatusEl.className = 'status uploading';
  show(fileInfo);

  if (item.status === 'ready' && item.uploadId) {
    currentUploadId = item.uploadId;
    uploadStatusEl.textContent = 'Готов к публикации';
    uploadStatusEl.className = 'status done';
    show(shareForm);
    shareBtn.disabled = false;
    await assignDefaultShortName();
    return;
  }

  if (item.status === 'uploading') {
    hide(shareForm);
    shareBtn.disabled = true;
  } else {
    hide(shareForm);
    shareBtn.disabled = true;
  }
}

function enqueueFiles(fileList) {
  if (!fileList || !fileList.length) return;
  uploadQueue.addFiles(fileList);
  show(uploadQueueEl);
  hide(result);
  setMessage(shareError, null);
}

function resetManageState() {
  if (updateUploader) {
    updateUploader.cancel().catch(() => {});
    updateUploader = null;
  }
  editingShortName = null;
  updateUploadId = null;
  updateUploadPromise = null;
  updateFileInput.value = '';
  hide(updateForm);
  hide(updateDropZone);
  hide(updateFileInfo);
  setMessage(loadError, null);
  setMessage(updateError, null);
  setMessage(updateSuccess, null);
  manageShortNameInput.value = '';
  newShortNameInput.value = '';
}

function createChunkUploader(isUpdate) {
  const prefix = isUpdate ? 'update' : 'upload';
  const uploader = new ChunkUploader({ apiPrefix: '/api/upload' });
  bindChunkUploadControls(uploader, {
    progressWrap: document.getElementById(`${prefix}-upload-progress`),
    progressFill: document.getElementById(`${prefix}-upload-progress-fill`),
    progressText: document.getElementById(`${prefix}-upload-progress-text`),
    statusEl: document.getElementById(isUpdate ? 'update-upload-status' : 'upload-status'),
    pauseBtn: document.getElementById(`${prefix}-upload-pause-btn`),
    resumeBtn: document.getElementById(`${prefix}-upload-resume-btn`),
    cancelBtn: document.getElementById(`${prefix}-upload-cancel-btn`),
  });
  return uploader;
}

function handleFile(file, isUpdate = false) {
  if (!file) return;
  if (isUpdate) {
    startUpdateUpload(file);
    return;
  }
  enqueueFiles([file]);
}

function startUpdateUpload(file) {
  if (updateUploader) updateUploader.cancel().catch(() => {});
  updateUploadId = null;
  updateUploadPromise = null;
  updateFileNameEl.textContent = file.name;
  show(updateFileInfo);
  updateUploader = createChunkUploader(true);

  updateUploadPromise = updateUploader.upload(file)
    .then((data) => {
      if (!data) return data;
      updateUploadId = data.uploadId;
      return data;
    })
    .catch((err) => {
      if (updateUploader.waitingForResume) return null;
      throw err;
    });
}

function switchTab(active) {
  tabCreate.classList.toggle('active', active === 'create');
  tabManage.classList.toggle('active', active === 'manage');
  tabAdmin.classList.toggle('active', active === 'admin');
  hide(createPanel);
  hide(managePanel);
  hide(adminPanel);
  if (active === 'create') show(createPanel);
  if (active === 'manage') show(managePanel);
  if (active === 'admin') {
    show(adminPanel);
    loadAdminPanel();
  }
}

async function loadAdminPanel() {
  setMessage(adminError, null);
  try {
    const stats = await api('/api/admin/stats');
    storageUsage.textContent = stats.maxStorageMb
      ? `Использовано: ${stats.storageMb} МБ из ${stats.maxStorageMb} МБ (свободно ${stats.storageFreeMb} МБ)`
      : `Использовано: ${stats.storageMb} МБ (лимит не задан)`;
    globalMaxStorageMb.value = stats.maxStorageMb ?? '';

    adminStats.innerHTML = [
      { label: 'Пользователи', value: stats.users },
      { label: 'С загрузкой', value: stats.uploaders },
      { label: 'Ссылки', value: stats.links },
      { label: 'Файлы', value: stats.files },
      { label: 'Диск, МБ', value: stats.maxStorageMb ? `${stats.storageMb}/${stats.maxStorageMb}` : stats.storageMb },
      { label: 'Скачивания (ссылки)', value: stats.linkDownloads },
    ].map((s) => `<div class="stat-card"><strong>${s.value}</strong><span>${s.label}</span></div>`).join('');

    const { users } = await api('/api/admin/users');
    adminUsersBody.innerHTML = users.map((u) => `
      <tr data-user-id="${u.id}">
        <td>${u.email}</td>
        <td>${u.fileCount}</td>
        <td>${u.linkCount}</td>
        <td>${u.storageMb ?? 0}</td>
        <td>
          <label class="checkbox-label">
            <input type="checkbox" class="user-can-upload" ${u.canUpload ? 'checked' : ''}>
            Разрешить
          </label>
        </td>
        <td>
          <div class="user-limits">
            <input type="number" class="user-max-file" min="1" placeholder="МБ файл" value="${u.maxFileSizeMb ?? ''}">
            <input type="number" class="user-max-total" min="1" placeholder="МБ всего" value="${u.maxTotalSizeMb ?? ''}">
            <input type="number" class="user-max-files" min="1" placeholder="файлов" value="${u.maxFiles ?? ''}">
            <input type="number" class="user-valid-days" min="1" placeholder="дней" value="">
          </div>
        </td>
        <td><button type="button" class="btn-small user-save">Сохранить</button></td>
      </tr>
    `).join('');

    adminUsersBody.querySelectorAll('.user-save').forEach((btn) => {
      btn.addEventListener('click', saveUserRow);
    });

    await loadAdminFiles();
  } catch (err) {
    setMessage(adminError, err.message, 'error');
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadAdminFiles() {
  setMessage(adminFilesMessage, null);
  const { files } = await api('/api/admin/files');

  adminFilesBody.innerHTML = files.map((file) => {
    const linksHtml = file.links.length
      ? file.links.map((link) => `
          <div class="admin-file-link-row" data-link-id="${link.id}">
            <input type="text" class="admin-link-short-name" value="${escapeHtml(link.shortName)}" title="Короткое имя ссылки">
            <span class="upload-queue-item-meta">
              ${link.shareUrl}
              <span class="link-badge ${link.active ? 'active' : 'inactive'}">${link.active ? 'активна' : 'неактивна'}</span>
            </span>
          </div>
        `).join('')
      : '<span class="hint">Нет ссылок</span>';

    const warning = file.activeLinkCount > 0
      ? `<div class="upload-queue-item-meta">Активных ссылок: ${file.activeLinkCount}</div>`
      : '';

    return `
      <tr data-file-id="${file.id}">
        <td>
          <div class="admin-file-actions">
            <input type="text" class="admin-file-name" value="${escapeHtml(file.originalName)}">
            ${warning}
            <span class="hint">${file.createdAt}${file.isChunked ? ' · чанки' : ''}</span>
          </div>
        </td>
        <td>${file.sizeMb ?? 0} МБ</td>
        <td><div class="admin-file-links">${linksHtml}</div></td>
        <td>
          <div class="admin-file-actions">
            <button type="button" class="btn-small admin-file-save">Сохранить</button>
            <button type="button" class="btn-small btn-danger admin-file-delete">Удалить</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  adminFilesBody.querySelectorAll('.admin-file-save').forEach((btn) => {
    btn.addEventListener('click', saveAdminFileRow);
  });
  adminFilesBody.querySelectorAll('.admin-file-delete').forEach((btn) => {
    btn.addEventListener('click', deleteAdminFileRow);
  });
}

async function saveAdminFileRow(e) {
  const row = e.target.closest('tr');
  const fileId = row.dataset.fileId;
  const originalName = row.querySelector('.admin-file-name').value.trim();
  const links = [...row.querySelectorAll('.admin-file-link-row')].map((linkRow) => ({
    id: parseInt(linkRow.dataset.linkId, 10),
    shortName: linkRow.querySelector('.admin-link-short-name').value.trim(),
  }));

  try {
    const data = await api(`/api/admin/files/${fileId}`, {
      method: 'PUT',
      body: JSON.stringify({ originalName, links }),
    });
    setMessage(adminFilesMessage, data.warning || 'Файл и ссылки обновлены', data.warning ? 'error' : 'success');
    await loadAdminFiles();
  } catch (err) {
    setMessage(adminError, err.message, 'error');
  }
}

async function deleteAdminFileRow(e) {
  const row = e.target.closest('tr');
  const fileId = row.dataset.fileId;
  const fileName = row.querySelector('.admin-file-name').value.trim();

  try {
    await api(`/api/admin/files/${fileId}`, { method: 'DELETE', body: JSON.stringify({}) });
  } catch (err) {
    if (!err.message.includes('активных')) {
      setMessage(adminError, err.message, 'error');
      return;
    }

    const force = window.confirm(
      `${err.message}\n\nУдалить файл «${fileName}» и все связанные ссылки?`
    );
    if (!force) return;

    try {
      const data = await api(`/api/admin/files/${fileId}`, {
        method: 'DELETE',
        body: JSON.stringify({ force: true }),
      });
      setMessage(adminFilesMessage, data.warning || 'Файл удалён', data.warning ? 'error' : 'success');
      await loadAdminPanel();
      return;
    } catch (forceErr) {
      setMessage(adminError, forceErr.message, 'error');
      return;
    }
  }

  setMessage(adminFilesMessage, 'Файл удалён', 'success');
  await loadAdminPanel();
}

async function saveUserRow(e) {
  const row = e.target.closest('tr');
  const userId = row.dataset.userId;
  const canUpload = row.querySelector('.user-can-upload').checked;

  try {
    await api(`/api/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({
        canUpload,
        maxFileSizeMb: row.querySelector('.user-max-file').value,
        maxTotalSizeMb: row.querySelector('.user-max-total').value,
        maxFiles: row.querySelector('.user-max-files').value,
        uploadValidDays: row.querySelector('.user-valid-days').value,
      }),
    });
    await loadAdminPanel();
  } catch (err) {
    setMessage(adminError, err.message, 'error');
  }
}

tabCreate.addEventListener('click', () => switchTab('create'));
tabManage.addEventListener('click', () => switchTab('manage'));
tabAdmin.addEventListener('click', () => switchTab('admin'));

storageLimitForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMessage(storageLimitSuccess, null);
  setMessage(adminError, null);
  try {
    await api('/api/admin/storage', {
      method: 'PUT',
      body: JSON.stringify({ maxStorageMb: globalMaxStorageMb.value }),
    });
    setMessage(storageLimitSuccess, 'Лимит диска сохранён', 'success');
    await loadAdminPanel();
  } catch (err) {
    setMessage(adminError, err.message, 'error');
  }
});

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const files = [...e.dataTransfer.files];
  if (!files.length) return;
  enqueueFiles(files);
});

fileInput.addEventListener('change', () => {
  const files = [...fileInput.files];
  if (files.length) enqueueFiles(files);
  fileInput.value = '';
});

queuePauseBtn.addEventListener('click', () => uploadQueue.pauseQueue());
queueResumeBtn.addEventListener('click', () => uploadQueue.resumeQueue());
queueClearBtn.addEventListener('click', () => uploadQueue.clearFinished());

updateDropZone.addEventListener('click', () => updateFileInput.click());
updateDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  updateDropZone.classList.add('dragover');
});
updateDropZone.addEventListener('dragleave', () => updateDropZone.classList.remove('dragover'));
updateDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  updateDropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  handleFile(file, true);
});
updateFileInput.addEventListener('change', () => handleFile(updateFileInput.files[0], true));

shortNameInput.addEventListener('input', () => {
  updateNamePreview();
  clearTimeout(nameCheckTimeout);
  const name = shortNameInput.value.trim();
  nameCheckTimeout = setTimeout(() => checkNameAvailability(name), 300);
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMessage(loginError, null);

  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('login-username').value,
        password: document.getElementById('login-password').value,
      }),
    });
    showUpload();
  } catch (err) {
    setMessage(loginError, err.message, 'error');
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showLogin();
});

shareForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMessage(shareError, null);
  shareBtn.disabled = true;

  try {
    if (!currentUploadId) throw new Error('Дождитесь загрузки файла или выберите элемент очереди');
    if (!activeQueueItemId) throw new Error('Выберите файл в очереди для публикации');

    const data = await api('/api/share', {
      method: 'POST',
      body: JSON.stringify({
        uploadId: currentUploadId,
        shortName: shortNameInput.value.trim(),
        downloadPassword: downloadPasswordInput.value,
        description: fileDescriptionInput.value,
        allowedEmails: allowedEmailsInput.value,
        allowedDomains: allowedDomainsInput.value,
        ...buildLimitPayload(
          linkMaxDownloadsInput.value,
          linkDaysInput.value,
          fileMaxDownloadsInput.value,
          fileDaysInput.value
        ),
      }),
    });

    hide(shareForm);
    hide(fileInfo);
    shareLink.href = data.shareUrl;
    shareLink.textContent = data.shareUrl;
    show(result);
    uploadQueue.markShared(activeQueueItemId);
    shareBtn.disabled = false;
  } catch (err) {
    setMessage(shareError, err.message, 'error');
  } finally {
    shareBtn.disabled = false;
  }
});

loadLinkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMessage(loadError, null);
  setMessage(updateSuccess, null);

  const name = manageShortNameInput.value.trim();
  try {
    const data = await api(`/api/share/${encodeURIComponent(name)}`);
    editingShortName = data.shortName;

    currentFileNameEl.textContent = [
      `Файл: ${data.originalName}`,
      `Ссылка: ${data.linkDownloadCount}/${data.linkMaxDownloads ?? '∞'} скачиваний`,
      `Файл на сервере: ${data.fileDownloadCount}/${data.fileMaxDownloads ?? '∞'} скачиваний`,
    ].join(' · ');

    updateLinkMaxDownloadsInput.value = data.linkMaxDownloads ?? '';
    updateLinkDaysInput.value = daysFromExpires(data.linkExpiresAt);
    updateFileMaxDownloadsInput.value = data.fileMaxDownloads ?? '';
    updateFileDaysInput.value = daysFromExpires(data.fileDeleteAt);
    updateAllowedEmailsInput.value = (data.allowedEmails || []).join(', ');
    updateAllowedDomainsInput.value = (data.allowedDomains || []).join(', ');
    updateFileDescriptionInput.value = data.description || '';
    updateDownloadPasswordInput.value = '';
    newShortNameInput.value = '';
    resetLinkCountInput.checked = true;

    show(updateDropZone);
    show(updateForm);
  } catch (err) {
    setMessage(loadError, err.message, 'error');
    hide(updateForm);
    hide(updateDropZone);
  }
});

updateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMessage(updateError, null);
  setMessage(updateSuccess, null);
  updateBtn.disabled = true;

  try {
    if (!editingShortName) throw new Error('Сначала загрузите ссылку');

    if (updateUploadPromise) {
      const updateResult = await updateUploadPromise;
      if (updateResult === null && updateUploader?.waitingForResume) {
        throw new Error('Дождитесь окончания загрузки или нажмите «Продолжить»');
      }
    }

    const body = {
      newShortName: newShortNameInput.value.trim() || undefined,
      allowedEmails: updateAllowedEmailsInput.value,
      allowedDomains: updateAllowedDomainsInput.value,
      resetLinkCount: resetLinkCountInput.checked,
      ...buildLimitPayload(
        updateLinkMaxDownloadsInput.value,
        updateLinkDaysInput.value,
        updateFileMaxDownloadsInput.value,
        updateFileDaysInput.value
      ),
    };

    if (updateDownloadPasswordInput.value) {
      body.downloadPassword = updateDownloadPasswordInput.value;
    }
    body.description = updateFileDescriptionInput.value;

    if (updateUploadId) {
      body.uploadId = updateUploadId;
    }

    const data = await api(`/api/share/${encodeURIComponent(editingShortName)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });

    editingShortName = data.shortName;
    manageShortNameInput.value = data.shortName;
    setMessage(updateSuccess, `Ссылка обновлена: ${data.shareUrl}`, 'success');

    updateUploadId = null;
    updateUploadPromise = null;
    hide(updateFileInfo);
    updateFileInput.value = '';

    if (data.originalName) {
      currentFileNameEl.textContent = `Файл: ${data.originalName}`;
    }
  } catch (err) {
    setMessage(updateError, err.message, 'error');
  } finally {
    updateBtn.disabled = false;
  }
});

newUploadBtn.addEventListener('click', () => {
  resetCreateState();
  show(dropZone);
  hide(result);
});

function showLogin() {
  hide(uploadSection);
  show(loginSection);
  loginForm.reset();
  setMessage(loginError, null);
}

function showUpload() {
  hide(loginSection);
  show(uploadSection);
  resetCreateState();
  resetManageState();
  show(dropZone);
  switchTab('create');
}

async function init() {
  updateNamePreview();
  const { authenticated } = await api('/api/me');
  if (authenticated) {
    showUpload();
  } else {
    showLogin();
  }
}

init();
