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
const updateAllowedEmailsInput = document.getElementById('update-allowed-emails');
const updateAllowedDomainsInput = document.getElementById('update-allowed-domains');
const resetLinkCountInput = document.getElementById('reset-link-count');
const updateBtn = document.getElementById('update-btn');
const updateError = document.getElementById('update-error');
const updateSuccess = document.getElementById('update-success');

let currentUploadId = null;
let uploadPromise = null;
let updateUploadId = null;
let updateUploadPromise = null;
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

function buildLimitPayload(linkMax, linkDays, fileMax, fileDays) {
  return {
    linkMaxDownloads: linkMax,
    linkDays: linkDays,
    fileMaxDownloads: fileMax,
    fileDays: fileDays,
  };
}

function resetCreateState() {
  currentUploadId = null;
  uploadPromise = null;
  fileInput.value = '';
  hide(fileInfo);
  hide(shareForm);
  hide(result);
  setMessage(shareError, null);
  setMessage(nameError, null);
  shortNameInput.value = '';
  linkMaxDownloadsInput.value = '';
  linkDaysInput.value = '';
  fileMaxDownloadsInput.value = '';
  fileDaysInput.value = '';
  downloadPasswordInput.value = '';
  allowedEmailsInput.value = '';
  allowedDomainsInput.value = '';
  updateNamePreview();
  uploadStatusEl.textContent = '';
  uploadStatusEl.className = 'status';
}

function resetManageState() {
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

function startUpload(file, isUpdate = false) {
  if (isUpdate) {
    updateUploadId = null;
    updateUploadPromise = null;
    updateFileNameEl.textContent = file.name;
    show(updateFileInfo);
    updateUploadStatusEl.textContent = 'Загрузка…';
    updateUploadStatusEl.className = 'status uploading';
  } else {
    resetCreateState();
    fileNameEl.textContent = file.name;
    show(fileInfo);
    show(shareForm);
    uploadStatusEl.textContent = 'Загрузка…';
    uploadStatusEl.className = 'status uploading';
  }

  const formData = new FormData();
  formData.append('file', file);

  const promise = api('/api/upload-temp', {
    method: 'POST',
    body: formData,
  })
    .then((data) => {
      if (isUpdate) {
        updateUploadId = data.uploadId;
        updateUploadStatusEl.textContent = 'Загружено';
        updateUploadStatusEl.className = 'status done';
      } else {
        currentUploadId = data.uploadId;
        uploadStatusEl.textContent = 'Загружено';
        uploadStatusEl.className = 'status done';
      }
      return data;
    })
    .catch((err) => {
      if (isUpdate) {
        updateUploadStatusEl.textContent = err.message;
        updateUploadStatusEl.className = 'status error';
      } else {
        uploadStatusEl.textContent = err.message;
        uploadStatusEl.className = 'status error';
      }
      throw err;
    });

  if (isUpdate) {
    updateUploadPromise = promise;
  } else {
    uploadPromise = promise;
  }
}

function handleFile(file, isUpdate = false) {
  if (!file) return;
  startUpload(file, isUpdate);
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
    adminStats.innerHTML = [
      { label: 'Пользователи', value: stats.users },
      { label: 'С загрузкой', value: stats.uploaders },
      { label: 'Ссылки', value: stats.links },
      { label: 'Файлы', value: stats.files },
      { label: 'Объём, МБ', value: stats.storageMb },
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
  } catch (err) {
    setMessage(adminError, err.message, 'error');
  }
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

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (e.dataTransfer.files.length > 1) {
    setMessage(shareError, 'Загрузите только один файл', 'error');
    return;
  }
  handleFile(file, false);
});

fileInput.addEventListener('change', () => handleFile(fileInput.files[0], false));

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
    if (!uploadPromise) throw new Error('Сначала выберите файл');
    await uploadPromise;
    if (!currentUploadId) throw new Error('Файл ещё не загружен');

    const data = await api('/api/share', {
      method: 'POST',
      body: JSON.stringify({
        uploadId: currentUploadId,
        shortName: shortNameInput.value.trim(),
        downloadPassword: downloadPasswordInput.value,
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
    hide(dropZone);
    hide(fileInfo);
    shareLink.href = data.shareUrl;
    shareLink.textContent = data.shareUrl;
    show(result);
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
      await updateUploadPromise;
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
