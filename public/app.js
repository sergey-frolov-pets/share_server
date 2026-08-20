const loginSection = document.getElementById('login-section');
const uploadSection = document.getElementById('upload-section');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const fileNameEl = document.getElementById('file-name');
const uploadStatusEl = document.getElementById('upload-status');
const shareForm = document.getElementById('share-form');
const shortNameInput = document.getElementById('short-name');
const namePreview = document.getElementById('name-preview');
const nameError = document.getElementById('name-error');
const maxDownloadsInput = document.getElementById('max-downloads');
const storageDaysInput = document.getElementById('storage-days');
const downloadPasswordInput = document.getElementById('download-password');
const allowedEmailsInput = document.getElementById('allowed-emails');
const allowedDomainsInput = document.getElementById('allowed-domains');
const shareBtn = document.getElementById('share-btn');
const shareError = document.getElementById('share-error');
const result = document.getElementById('result');
const shareLink = document.getElementById('share-link');
const newUploadBtn = document.getElementById('new-upload-btn');

let currentUploadId = null;
let uploadPromise = null;
let nameCheckTimeout = null;

function show(el) {
  el.classList.remove('hidden');
}

function hide(el) {
  el.classList.add('hidden');
}

function setError(el, message) {
  if (message) {
    el.textContent = message;
    show(el);
  } else {
    el.textContent = '';
    hide(el);
  }
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
    setError(nameError, null);
    return;
  }

  try {
    const data = await api(`/api/check-name/${encodeURIComponent(name)}`);
    if (!data.available) {
      setError(nameError, data.error || 'Имя недоступно');
    } else {
      setError(nameError, null);
    }
  } catch (err) {
    setError(nameError, err.message);
  }
}

function resetUploadState() {
  currentUploadId = null;
  uploadPromise = null;
  fileInput.value = '';
  hide(fileInfo);
  hide(shareForm);
  hide(result);
  setError(shareError, null);
  setError(nameError, null);
  shortNameInput.value = '';
  maxDownloadsInput.value = '2';
  storageDaysInput.value = '2';
  downloadPasswordInput.value = '';
  allowedEmailsInput.value = '';
  allowedDomainsInput.value = '';
  updateNamePreview();
  uploadStatusEl.textContent = '';
  uploadStatusEl.className = 'status';
}

function startUpload(file) {
  resetUploadState();

  fileNameEl.textContent = file.name;
  show(fileInfo);
  show(shareForm);
  uploadStatusEl.textContent = 'Загрузка…';
  uploadStatusEl.className = 'status uploading';

  const formData = new FormData();
  formData.append('file', file);

  uploadPromise = api('/api/upload-temp', {
    method: 'POST',
    body: formData,
  })
    .then((data) => {
      currentUploadId = data.uploadId;
      uploadStatusEl.textContent = 'Загружено';
      uploadStatusEl.className = 'status done';
      return data;
    })
    .catch((err) => {
      uploadStatusEl.textContent = err.message;
      uploadStatusEl.className = 'status error';
      throw err;
    });
}

function handleFile(file) {
  if (!file) return;
  startUpload(file);
}

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (e.dataTransfer.files.length > 1) {
    setError(shareError, 'Загрузите только один файл');
    return;
  }
  handleFile(file);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  handleFile(file);
});

shortNameInput.addEventListener('input', () => {
  updateNamePreview();
  clearTimeout(nameCheckTimeout);
  const name = shortNameInput.value.trim();
  nameCheckTimeout = setTimeout(() => checkNameAvailability(name), 300);
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setError(loginError, null);

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
    setError(loginError, err.message);
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showLogin();
});

shareForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setError(shareError, null);
  shareBtn.disabled = true;

  try {
    if (!uploadPromise) {
      throw new Error('Сначала выберите файл');
    }

    await uploadPromise;

    if (!currentUploadId) {
      throw new Error('Файл ещё не загружен');
    }

    const data = await api('/api/share', {
      method: 'POST',
      body: JSON.stringify({
        uploadId: currentUploadId,
        shortName: shortNameInput.value.trim(),
        maxDownloads: maxDownloadsInput.value,
        storageDays: storageDaysInput.value,
        downloadPassword: downloadPasswordInput.value,
        allowedEmails: allowedEmailsInput.value,
        allowedDomains: allowedDomainsInput.value,
      }),
    });

    hide(shareForm);
    hide(dropZone);
    hide(fileInfo);
    shareLink.href = data.shareUrl;
    shareLink.textContent = data.shareUrl;
    show(result);
  } catch (err) {
    setError(shareError, err.message);
  } finally {
    shareBtn.disabled = false;
  }
});

newUploadBtn.addEventListener('click', () => {
  resetUploadState();
  show(dropZone);
});

function showLogin() {
  hide(uploadSection);
  show(loginSection);
  loginForm.reset();
  setError(loginError, null);
}

function showUpload() {
  hide(loginSection);
  show(uploadSection);
  resetUploadState();
  show(dropZone);
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
