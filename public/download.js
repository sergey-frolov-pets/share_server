function getShortNameFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[0] || '';
}

const shortName = getShortNameFromPath();
const title = document.getElementById('title');
const fileMeta = document.getElementById('file-meta');
const userBar = document.getElementById('user-bar');
const userEmailEl = document.getElementById('user-email');
const userLogoutBtn = document.getElementById('user-logout');
const downloadForm = document.getElementById('download-form');
const emailField = document.getElementById('email-field');
const userPasswordField = document.getElementById('user-password-field');
const downloadPasswordField = document.getElementById('download-password-field');
const accessEmailInput = document.getElementById('access-email');
const userPasswordInput = document.getElementById('user-password');
const downloadPasswordInput = document.getElementById('download-password');
const downloadError = document.getElementById('download-error');
const downloadInfo = document.getElementById('download-info');
const openDownload = document.getElementById('open-download');
const directDownloadBtn = document.getElementById('direct-download-btn');

let fileInfo = null;
let currentUser = null;

function show(el) {
  el.classList.remove('hidden');
}

function hide(el) {
  el.classList.add('hidden');
}

function setMessage(el, message, isError) {
  if (message) {
    el.textContent = message;
    el.className = isError ? 'error' : 'success';
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
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || 'Ошибка запроса');
    err.payload = data;
    throw err;
  }
  return data;
}

function triggerFileDownload() {
  window.location.href = `/api/download/${encodeURIComponent(shortName)}/file`;
}

async function loadUser() {
  const { user } = await api('/api/user/me');
  currentUser = user;
  if (user) {
    userEmailEl.textContent = user.email;
    show(userBar);
    accessEmailInput.value = user.email;
  } else {
    hide(userBar);
  }
  return user;
}

function renderForm() {
  if (!fileInfo) return;

  title.textContent = fileInfo.originalName;
  fileMeta.textContent = `Скачиваний: ${fileInfo.downloadCount}/${fileInfo.maxDownloads}`;

  if (!fileInfo.hasGates) {
    show(openDownload);
    hide(downloadForm);
    return;
  }

  show(downloadForm);
  hide(openDownload);

  if (fileInfo.requiresAccess) {
    if (currentUser) {
      hide(emailField);
      hide(userPasswordField);
    } else {
      show(emailField);
      show(userPasswordField);
    }
  } else {
    hide(emailField);
    hide(userPasswordField);
  }

  if (fileInfo.requiresDownloadPassword) {
    show(downloadPasswordField);
  } else {
    hide(downloadPasswordField);
  }
}

async function init() {
  if (!shortName) {
    setMessage(downloadError, 'Некорректная ссылка', true);
    return;
  }

  try {
    fileInfo = await api(`/api/file/${encodeURIComponent(shortName)}`);
    if (!fileInfo.available) {
      setMessage(downloadError, 'Файл недоступен', true);
      return;
    }
    await loadUser();
    renderForm();
  } catch (err) {
    setMessage(downloadError, err.message, true);
  }
}

downloadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMessage(downloadError, null);
  setMessage(downloadInfo, null);

  try {
    const body = {};
    if (fileInfo.requiresDownloadPassword) {
      body.downloadPassword = downloadPasswordInput.value;
    }
    if (fileInfo.requiresAccess) {
      body.email = accessEmailInput.value;
      body.password = userPasswordInput.value;
    }

    const result = await api(`/api/download/${encodeURIComponent(shortName)}/authorize`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (result.registrationSent) {
      setMessage(downloadInfo, result.message, false);
      return;
    }

    triggerFileDownload();
  } catch (err) {
    if (err.payload?.needsLogin) {
      setMessage(downloadError, err.message, true);
      show(userPasswordField);
    } else {
      setMessage(downloadError, err.message, true);
    }
  }
});

directDownloadBtn.addEventListener('click', () => {
  triggerFileDownload();
});

userLogoutBtn.addEventListener('click', async () => {
  await api('/api/user/logout', { method: 'POST' });
  await loadUser();
  accessEmailInput.value = '';
  userPasswordInput.value = '';
});

init();
