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
const storageDiskHint = document.getElementById('storage-disk-hint');
const smtpStatusHint = document.getElementById('smtp-status-hint');
const globalMaxStorageMb = document.getElementById('global-max-storage-mb');
const storageLimitSuccess = document.getElementById('storage-limit-success');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const shareForm = document.getElementById('share-form');
const shareFileLabel = document.getElementById('share-file-label');
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
const accessEmailsHint = document.getElementById('access-emails-hint');
const accessDomainsHint = document.getElementById('access-domains-hint');
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
const updateAccessEmailsHint = document.getElementById('update-access-emails-hint');
const updateAccessDomainsHint = document.getElementById('update-access-domains-hint');
const resetLinkCountInput = document.getElementById('reset-link-count');
const updateBtn = document.getElementById('update-btn');
const updateError = document.getElementById('update-error');
const updateSuccess = document.getElementById('update-success');
const uploadQueueEl = document.getElementById('upload-queue');
const uploadQueueList = document.getElementById('upload-queue-list');
const uploadQueueResumeHint = document.getElementById('upload-queue-resume-hint');
const uploadQueueResumeText = document.getElementById('upload-queue-resume-text');
const uploadQueueResumeBtn = document.getElementById('upload-queue-resume-btn');
const queuePauseBtn = document.getElementById('queue-pause-btn');
const queueResumeBtn = document.getElementById('queue-resume-btn');
const queueClearBtn = document.getElementById('queue-clear-btn');
const adminFilesBody = document.getElementById('admin-files-body');
const adminFilesMessage = document.getElementById('admin-files-message');
const adminFilesStats = document.getElementById('admin-files-stats');
const adminLinksBody = document.getElementById('admin-links-body');
const adminLinksStats = document.getElementById('admin-links-stats');
const adminFilesPanel = document.getElementById('admin-files-panel');
const adminLinksPanel = document.getElementById('admin-links-panel');
const adminAssetsTabFiles = document.getElementById('admin-assets-tab-files');
const adminAssetsTabLinks = document.getElementById('admin-assets-tab-links');
const downloadQueueEl = document.getElementById('download-queue');
const downloadQueueList = document.getElementById('download-queue-list');
const downloadQueuePauseBtn = document.getElementById('download-queue-pause-btn');
const downloadQueueResumeBtn = document.getElementById('download-queue-resume-btn');
const downloadQueueClearBtn = document.getElementById('download-queue-clear-btn');

let currentUploadId = null;
let activeQueueItemId = null;
let uploadPromise = null;
let updateUploadId = null;
let updateUploadPromise = null;
let updateUploader = null;
let nameCheckTimeout = null;
let editingShortName = null;
let smtpConfigured = false;
let adminAssetsCache = [];

function adminT(key, vars) {
  return window.UiSettings?.t(key, vars) ?? key;
}

const SMTP_ACCESS_UNAVAILABLE_HINT = 'Недоступно без настроенного SMTP на сервере';

function updateAccessRestrictionFields() {
  const enabled = smtpConfigured;
  allowedEmailsInput.disabled = !enabled;
  allowedDomainsInput.disabled = !enabled;
  updateAllowedEmailsInput.disabled = !enabled;
  updateAllowedDomainsInput.disabled = !enabled;

  const hints = [accessEmailsHint, accessDomainsHint, updateAccessEmailsHint, updateAccessDomainsHint];
  hints.forEach((el) => {
    if (!el) return;
    if (enabled) {
      el.textContent = '';
      hide(el);
    } else {
      el.textContent = SMTP_ACCESS_UNAVAILABLE_HINT;
      show(el);
    }
  });

  if (!enabled) {
    allowedEmailsInput.value = '';
    allowedDomainsInput.value = '';
  }
}

function initIconButtons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((btn) => {
    const name = btn.dataset.icon;
    if (name && !btn.querySelector('.icon')) {
      btn.innerHTML = AppIcons.icon(name);
    }
  });
}

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
  uploadPanel.reset();
  activeQueueItemId = null;
  currentUploadId = null;
  uploadPromise = null;
  fileInput.value = '';
  hide(shareForm);
  hide(shareFileLabel);
  hide(result);
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
  hide(queueResumeBtn);
  show(queuePauseBtn);
}

let uploadPanel;

const uploadQueue = new UploadQueue({
  apiPrefix: '/api/upload',
  fetchFn: (path, opts) => fetch(path, { credentials: 'same-origin', ...opts }),
  onChange: (state) => uploadPanel.render(state),
  onActiveItem: handleQueueActiveItem,
});

uploadPanel = new UploadPanel({
  queue: uploadQueue,
  onActiveItem: handleQueueActiveItem,
  onFileAccepted: () => {
    hide(result);
    setMessage(shareError, null);
  },
  onError: (message) => setMessage(shareError, message, 'error'),
  elements: {
    dropZone,
    fileInput,
    queueEl: uploadQueueEl,
    queueList: uploadQueueList,
    queueHint: uploadQueueResumeHint,
    queueHintText: uploadQueueResumeText,
    queueRestoreBtn: uploadQueueResumeBtn,
    queuePauseBtn,
    queueResumeBtn,
    queueClearBtn,
  },
});

const downloadQueue = new DownloadQueue({
  onChange: renderDownloadQueue,
});

function renderDownloadQueue(state) {
  if (!state.items.length) {
    hide(downloadQueueEl);
    downloadQueueList.innerHTML = '';
    return;
  }

  show(downloadQueueEl);
  downloadQueueList.innerHTML = state.items.map((item) => {
    const label = DOWNLOAD_QUEUE_STATUS_LABELS[item.status] || item.status;
    const activeClass = item.id === state.currentItemId ? ' active' : '';
    const statusText = item.progress && ['pending', 'downloading', 'paused'].includes(item.status)
      ? `${label} · ${item.progress}%`
      : label;
    const progressHtml = ['pending', 'downloading', 'paused'].includes(item.status)
      ? `<div class="upload-queue-item-progress"><div class="upload-queue-item-progress-fill" style="width:${item.progress || 0}%"></div></div>`
      : '';
    const errorHtml = item.error ? `<div class="upload-queue-item-meta upload-queue-item-error">${escapeHtml(item.error)}</div>` : '';
    const cancelBtn = ['pending', 'downloading', 'paused'].includes(item.status)
      ? AppIcons.iconButton('cancel', { className: 'btn-secondary download-queue-cancel-btn', title: 'Отмена', attrs: `data-download-id="${item.id}"` })
      : '';

    return `
      <li class="upload-queue-item${activeClass}">
        <div class="upload-queue-item-row">
          <div class="upload-queue-item-text">
            <span class="upload-queue-item-name">${escapeHtml(item.name)}</span>
            <div class="upload-queue-item-sub">
              <span class="upload-queue-item-size">${formatUploadBytes(item.size)}</span>
              <span class="upload-queue-item-status">${statusText}</span>
            </div>
          </div>
          ${cancelBtn ? `<div class="upload-queue-item-actions icon-actions">${cancelBtn}</div>` : ''}
        </div>
        ${progressHtml}
        ${errorHtml}
      </li>
    `;
  }).join('');

  downloadQueueList.querySelectorAll('.download-queue-cancel-btn').forEach((btn) => {
    btn.addEventListener('click', () => downloadQueue.cancelItem(btn.dataset.downloadId));
  });

  if (state.queuePaused) {
    hide(downloadQueuePauseBtn);
    show(downloadQueueResumeBtn);
  } else {
    show(downloadQueuePauseBtn);
    hide(downloadQueueResumeBtn);
  }
  initIconButtons(downloadQueueList);
}

function enqueueDownload(file) {
  downloadQueue.add({
    fileId: file.id,
    name: file.originalName,
    size: file.sizeBytes || 0,
  });
}

async function handleQueueActiveItem(item) {
  if (!item) {
    hide(shareForm);
    hide(shareFileLabel);
    currentUploadId = null;
    activeQueueItemId = null;
    return;
  }

  activeQueueItemId = item.id;

  if (item.status === 'ready' && item.uploadId) {
    currentUploadId = item.uploadId;
    shareFileLabel.textContent = `Файл: ${item.name}`;
    show(shareFileLabel);
    show(shareForm);
    shareBtn.disabled = false;
    await assignDefaultShortName();
    return;
  }

  hide(shareForm);
  hide(shareFileLabel);
  shareBtn.disabled = true;
}

async function restoreActiveUploads() {
  await uploadPanel.restoreAfterLogin();
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
  uploadPanel.handleFile(file).catch(() => {});
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
      ? adminT('admin.storage.usedWithLimit', {
        used: stats.storageMb,
        max: stats.maxStorageMb,
        free: stats.storageFreeMb,
      })
      : adminT('admin.storage.usedNoLimit', { used: stats.storageMb });
    if (storageDiskHint) {
      storageDiskHint.textContent = formatPhysicalDiskHint(stats);
    }
    if (smtpStatusHint) {
      if (stats.smtpConfigured) {
        smtpStatusHint.textContent = adminT('admin.smtp.ok');
        smtpStatusHint.className = 'hint';
      } else {
        smtpStatusHint.textContent = adminT('admin.smtp.missing');
        smtpStatusHint.className = 'error';
      }
    }
    smtpConfigured = Boolean(stats.smtpConfigured);
    updateAccessRestrictionFields();
    globalMaxStorageMb.value = stats.maxStorageMb ?? '';

    adminStats.innerHTML = [
      { label: adminT('admin.stat.users'), value: stats.users },
      { label: adminT('admin.stat.uploaders'), value: stats.uploaders },
      { label: adminT('admin.stat.links'), value: stats.links },
      { label: adminT('admin.stat.files'), value: stats.files },
      { label: adminT('admin.stat.disk'), value: stats.maxStorageMb ? `${stats.storageMb}/${stats.maxStorageMb}` : stats.storageMb },
      { label: adminT('admin.stat.linkDownloads'), value: stats.linkDownloads },
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
            ${adminT('admin.user.allow')}
          </label>
        </td>
        <td>
          <div class="user-limits">
            <input type="number" class="user-max-file" min="1" placeholder="${adminT('admin.user.placeholder.fileMb')}" value="${u.maxFileSizeMb ?? ''}">
            <input type="number" class="user-max-total" min="1" placeholder="${adminT('admin.user.placeholder.totalMb')}" value="${u.maxTotalSizeMb ?? ''}">
            <input type="number" class="user-max-files" min="1" placeholder="${adminT('admin.user.placeholder.files')}" value="${u.maxFiles ?? ''}">
            <input type="number" class="user-valid-days" min="1" placeholder="${adminT('admin.user.placeholder.days')}" value="">
          </div>
        </td>
        <td><button type="button" class="btn-icon user-save" data-icon="save" title="${adminT('admin.btn.save')}" aria-label="${adminT('admin.btn.save')}"></button></td>
      </tr>
    `).join('');

    adminUsersBody.querySelectorAll('.user-save').forEach((btn) => {
      btn.addEventListener('click', saveUserRow);
    });
    initIconButtons(adminUsersBody);

    await loadAdminFiles();
  } catch (err) {
    setMessage(adminError, err.message, 'error');
  }
}

function formatPhysicalDiskHint(stats) {
  if (stats.diskAvailableMb == null || stats.diskTotalMb == null) {
    return adminT('admin.disk.physicalUnknown');
  }
  return adminT('admin.disk.physical', {
    free: stats.diskAvailableMb,
    total: stats.diskTotalMb,
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDownloadLimit(count, max) {
  return max ? `${count}/${max}` : `${count}/∞`;
}

function parseServerDateTime(value) {
  if (!value) return null;
  const normalized = String(value).includes('T') ? value : String(value).replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatCompactDateTime(value) {
  const date = parseServerDateTime(value);
  if (!date) return value || '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yy} ${hh}:${min}`;
}

function formatCompactDate(value) {
  const date = parseServerDateTime(value);
  if (!date) return value || '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

function formatExpiresLabel(expiresAt) {
  if (!expiresAt) return 'без срока';
  return formatCompactDate(expiresAt);
}

function toDateInputValue(expiresAt) {
  if (!expiresAt) return '';
  const date = parseServerDateTime(expiresAt);
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatLinkRemainingValue(link) {
  if (link.maxDownloads == null) return '';
  return String(Math.max(0, link.maxDownloads - link.downloadCount));
}

function getLinkRowSnapshot(row) {
  return {
    shortName: row.querySelector('.admin-link-short-name').value.trim(),
    remaining: row.querySelector('.admin-link-remaining').value.trim(),
    expires: row.querySelector('.admin-link-expires').value,
  };
}

function bindLinkRowChangeDetection(row, baseline) {
  const saveBtn = row.querySelector('.admin-link-save');
  const inputs = row.querySelectorAll('input');
  const check = () => {
    const current = getLinkRowSnapshot(row);
    const changed = current.shortName !== baseline.shortName
      || current.remaining !== baseline.remaining
      || current.expires !== baseline.expires;
    saveBtn.disabled = !changed;
  };
  inputs.forEach((input) => {
    input.addEventListener('input', check);
    input.addEventListener('change', check);
  });
  check();
}

function switchAdminAssetsTab(tab) {
  const isFiles = tab === 'files';
  adminAssetsTabFiles.classList.toggle('active', isFiles);
  adminAssetsTabLinks.classList.toggle('active', !isFiles);
  if (isFiles) {
    show(adminFilesPanel);
    hide(adminLinksPanel);
  } else {
    hide(adminFilesPanel);
    show(adminLinksPanel);
  }
}

function updateAdminAssetsCache(files) {
  adminAssetsCache = files;
  renderAdminAssetsStats();
  renderAdminFilesTable();
  renderAdminLinksTable();
}

function renderAdminAssetsStats() {
  const files = adminAssetsCache;
  const allLinks = files.flatMap((file) => file.links || []);
  const activeLinks = allLinks.filter((link) => link.active);
  const totalDownloads = files.reduce((sum, file) => sum + (file.fileDownloadCount || 0), 0);
  const linkDownloads = allLinks.reduce((sum, link) => sum + (link.downloadCount || 0), 0);
  const totalSizeMb = files.reduce((sum, file) => sum + (file.sizeMb || 0), 0);

  if (adminFilesStats) {
    adminFilesStats.textContent = adminT('admin.filesStats', {
      files: files.length,
      size: totalSizeMb.toFixed(1),
      downloads: totalDownloads,
      links: allLinks.length,
      active: activeLinks.length,
    });
  }

  if (adminLinksStats) {
    adminLinksStats.textContent = adminT('admin.linksStats', {
      links: allLinks.length,
      active: activeLinks.length,
      downloads: linkDownloads,
    });
  }
}

function renderAdminFilesTable() {
  adminFilesBody.innerHTML = adminAssetsCache.map((file) => {
    const linksStat = `${file.linkCount} (${adminT('admin.file.linksActive')} ${file.activeLinkCount})`;
    const downloadsStat = formatDownloadLimit(file.fileDownloadCount || 0, file.fileMaxDownloads);
    const metaParts = [formatCompactDateTime(file.createdAt)];
    if (file.fileDeleteAt) {
      metaParts.push(`${adminT('admin.file.until')} ${formatCompactDate(file.fileDeleteAt)}`);
    }
    const meta = metaParts.join(' · ');

    return `
      <tr data-file-id="${file.id}">
        <td data-label="${adminT('admin.col.file')}">
          <input type="text" class="admin-file-name" value="${escapeHtml(file.originalName)}">
          <span class="hint admin-file-meta">${escapeHtml(meta)}</span>
        </td>
        <td data-label="${adminT('admin.col.size')}" class="admin-cell-num">${file.sizeMb ?? 0} МБ</td>
        <td data-label="${adminT('admin.col.downloads')}" class="admin-cell-num">${downloadsStat}</td>
        <td data-label="${adminT('admin.col.links')}" class="admin-cell-num">${linksStat}</td>
        <td data-label="${adminT('admin.col.actions')}">
          <div class="admin-row-actions icon-actions">
            ${AppIcons.iconButton('link', { className: 'admin-file-add-link', title: adminT('admin.btn.addLink') })}
            ${AppIcons.iconButton('download', { className: 'admin-file-download', title: adminT('admin.btn.download') })}
            ${AppIcons.iconButton('save', { className: 'admin-file-save', title: adminT('admin.btn.saveFile') })}
            ${AppIcons.iconButton('delete', { className: 'btn-danger admin-file-delete', title: adminT('admin.btn.deleteFile') })}
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
  adminFilesBody.querySelectorAll('.admin-file-download').forEach((btn) => {
    btn.addEventListener('click', downloadAdminFileRow);
  });
  adminFilesBody.querySelectorAll('.admin-file-add-link').forEach((btn) => {
    btn.addEventListener('click', addAdminFileLink);
  });
  initIconButtons(adminFilesBody);
}

function renderAdminLinksTable() {
  const rows = adminAssetsCache.flatMap((file) => (
    (file.links || []).map((link) => ({ link, file }))
  ));

  adminLinksBody.innerHTML = rows.length
    ? rows.map(({ link, file }) => {
      const remainingValue = formatLinkRemainingValue(link);
      const expiresValue = toDateInputValue(link.expiresAt);
      return `
        <tr data-link-id="${link.id}" data-file-id="${file.id}">
          <td data-label="${adminT('admin.col.link')}">
            <input type="text" class="admin-link-short-name" value="${escapeHtml(link.shortName)}">
            <a class="hint admin-link-url" href="${escapeHtml(link.shareUrl)}" target="_blank" rel="noopener">${escapeHtml(link.shareUrl)}</a>
          </td>
          <td data-label="${adminT('admin.col.file')}">
            <span class="admin-link-file-name">${escapeHtml(file.originalName)}</span>
          </td>
          <td data-label="${adminT('admin.col.downloaded')}" class="admin-cell-num">${link.downloadCount}</td>
          <td data-label="${adminT('admin.col.remaining')}">
            <input type="number" class="admin-link-remaining" min="0" step="1" placeholder="∞" value="${escapeHtml(remainingValue)}">
          </td>
          <td data-label="${adminT('admin.col.until')}">
            <input type="date" class="admin-link-expires" value="${escapeHtml(expiresValue)}">
          </td>
          <td data-label="${adminT('admin.col.status')}">
            <span class="link-badge ${link.active ? 'active' : 'inactive'}">${link.active ? adminT('admin.link.active') : adminT('admin.link.inactive')}</span>
          </td>
          <td data-label="${adminT('admin.col.actions')}">
            <div class="admin-row-actions icon-actions">
              ${AppIcons.iconButton('save', { className: 'admin-link-save', title: adminT('admin.btn.updateLink'), attrs: 'disabled' })}
              ${AppIcons.iconButton('delete', { className: 'btn-danger admin-link-delete', title: adminT('admin.btn.deleteLink') })}
            </div>
          </td>
        </tr>
      `;
    }).join('')
    : `<tr><td colspan="7" class="hint admin-assets-empty">${adminT('admin.links.empty')}</td></tr>`;

  adminLinksBody.querySelectorAll('tr[data-link-id]').forEach((row) => {
    const linkId = parseInt(row.dataset.linkId, 10);
    const link = adminAssetsCache
      .flatMap((file) => file.links || [])
      .find((entry) => entry.id === linkId);
    if (link) {
      bindLinkRowChangeDetection(row, {
        shortName: link.shortName,
        remaining: formatLinkRemainingValue(link),
        expires: toDateInputValue(link.expiresAt),
      });
    }
  });

  adminLinksBody.querySelectorAll('.admin-link-save').forEach((btn) => {
    btn.addEventListener('click', saveAdminLinkRow);
  });
  adminLinksBody.querySelectorAll('.admin-link-delete').forEach((btn) => {
    btn.addEventListener('click', deleteAdminLinkRow);
  });
  initIconButtons(adminLinksBody);
}

async function loadAdminFiles() {
  setMessage(adminFilesMessage, null);
  const { files } = await api('/api/admin/files');
  updateAdminAssetsCache(files);
}

function downloadAdminFileRow(e) {
  const row = e.target.closest('tr');
  const fileId = parseInt(row.dataset.fileId, 10);
  const file = adminAssetsCache.find((entry) => entry.id === fileId);
  if (!file) return;
  enqueueDownload({
    id: fileId,
    originalName: row.querySelector('.admin-file-name').value.trim() || file.originalName,
    sizeBytes: file.sizeBytes || Math.round((file.sizeMb || 0) * 1024 * 1024),
  });
}

async function saveAdminFileRow(e) {
  const row = e.target.closest('tr');
  const fileId = row.dataset.fileId;
  const originalName = row.querySelector('.admin-file-name').value.trim();

  try {
    const data = await api(`/api/admin/files/${fileId}`, {
      method: 'PUT',
      body: JSON.stringify({ originalName }),
    });
    setMessage(adminFilesMessage, data.warning || 'Файл обновлён', data.warning ? 'error' : 'success');
    if (data.file) {
      adminAssetsCache = adminAssetsCache.map((entry) => (
        entry.id === data.file.id ? data.file : entry
      ));
      renderAdminAssetsStats();
      renderAdminFilesTable();
      renderAdminLinksTable();
    } else {
      await loadAdminFiles();
    }
  } catch (err) {
    setMessage(adminError, err.message, 'error');
  }
}

async function addAdminFileLink(e) {
  const row = e.target.closest('tr');
  const fileId = row.dataset.fileId;

  try {
    const data = await api(`/api/admin/files/${fileId}/links`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setMessage(adminFilesMessage, `Ссылка создана: ${data.shareUrl}`, 'success');
    if (data.file) {
      adminAssetsCache = adminAssetsCache.map((entry) => (
        entry.id === data.file.id ? data.file : entry
      ));
      renderAdminAssetsStats();
      renderAdminFilesTable();
      renderAdminLinksTable();
    } else {
      await loadAdminFiles();
    }
  } catch (err) {
    setMessage(adminError, err.message, 'error');
  }
}

async function saveAdminLinkRow(e) {
  const row = e.target.closest('tr');
  const linkId = row.dataset.linkId;
  const shortName = row.querySelector('.admin-link-short-name').value.trim();
  const linkRemainingDownloads = row.querySelector('.admin-link-remaining').value.trim();
  const linkExpiresAt = row.querySelector('.admin-link-expires').value;

  try {
    const data = await api(`/api/admin/links/${linkId}`, {
      method: 'PUT',
      body: JSON.stringify({
        shortName,
        linkRemainingDownloads,
        linkExpiresAt,
      }),
    });
    setMessage(adminFilesMessage, 'Ссылка обновлена', 'success');
    if (data.file) {
      adminAssetsCache = adminAssetsCache.map((entry) => (
        entry.id === data.file.id ? data.file : entry
      ));
      renderAdminAssetsStats();
      renderAdminFilesTable();
      renderAdminLinksTable();
    } else {
      await loadAdminFiles();
    }
  } catch (err) {
    setMessage(adminError, err.message, 'error');
  }
}

async function deleteAdminLinkRow(e) {
  const row = e.target.closest('tr');
  const linkId = parseInt(row.dataset.linkId, 10);
  const shortName = row.querySelector('.admin-link-short-name').value.trim();

  if (!window.confirm(`Удалить ссылку «${shortName}»? Файл на сервере останется.`)) {
    return;
  }

  try {
    const data = await api(`/api/admin/links/${linkId}`, { method: 'DELETE', body: JSON.stringify({}) });
    setMessage(adminFilesMessage, 'Ссылка удалена', 'success');
    if (data.file) {
      adminAssetsCache = adminAssetsCache.map((entry) => (
        entry.id === data.file.id ? data.file : entry
      ));
    } else {
      adminAssetsCache = adminAssetsCache.map((entry) => ({
        ...entry,
        links: (entry.links || []).filter((link) => link.id !== linkId),
        linkCount: (entry.links || []).filter((link) => link.id !== linkId).length,
        activeLinkCount: (entry.links || []).filter((link) => link.id !== linkId && link.active).length,
      }));
    }
    renderAdminAssetsStats();
    renderAdminFilesTable();
    renderAdminLinksTable();
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
adminAssetsTabFiles.addEventListener('click', () => switchAdminAssetsTab('files'));
adminAssetsTabLinks.addEventListener('click', () => switchAdminAssetsTab('links'));

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

downloadQueuePauseBtn.addEventListener('click', () => downloadQueue.pauseQueue());
downloadQueueResumeBtn.addEventListener('click', () => downloadQueue.resumeQueue());
downloadQueueClearBtn.addEventListener('click', () => downloadQueue.clearFinished());

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
    const me = await api('/api/me');
    smtpConfigured = Boolean(me.smtpConfigured);
    updateAccessRestrictionFields();
    showUpload();
    await restoreActiveUploads();
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
    hide(shareFileLabel);
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
  initIconButtons();
  if (window.UiSettings) {
    UiSettings.onLangChange = () => {
      if (!adminPanel.classList.contains('hidden')) {
        loadAdminPanel();
      } else {
        UiSettings.applyDomI18n(adminPanel);
      }
    };
  }
  updateNamePreview();
  const me = await api('/api/me');
  if (me.authenticated) {
    smtpConfigured = Boolean(me.smtpConfigured);
    updateAccessRestrictionFields();
    showUpload();
    await restoreActiveUploads();
  } else {
    showLogin();
  }
}

init();
