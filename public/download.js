function getShortNameFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[0] || '';
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const API_TIMEOUT_MS = 20000;

const shortName = getShortNameFromPath();
const title = document.getElementById('title');
const fileDescription = document.getElementById('file-description');
const fileMeta = document.getElementById('file-meta');
const downloadStatus = document.getElementById('download-status');
const userBar = document.getElementById('user-bar');
const userEmailEl = document.getElementById('user-email');
const userLogoutBtn = document.getElementById('user-logout');
const downloadForm = document.getElementById('download-form');
const emailField = document.getElementById('email-field');
const userPasswordField = document.getElementById('user-password-field');
const registrationHint = document.getElementById('registration-hint');
const downloadPasswordField = document.getElementById('download-password-field');
const accessEmailInput = document.getElementById('access-email');
const userPasswordInput = document.getElementById('user-password');
const downloadPasswordInput = document.getElementById('download-password');
const downloadBtn = document.getElementById('download-btn');
const registrationResendWrap = document.getElementById('registration-resend-wrap');
const resendRegistrationBtn = document.getElementById('resend-registration-btn');
const openDownload = document.getElementById('open-download');
const directDownloadBtn = document.getElementById('direct-download-btn');

let fileInfo = null;
let currentUser = null;
let pageReady = false;
let submitInProgress = false;
let resendInProgress = false;

function show(el) {
  el.classList.remove('hidden');
}

function hide(el) {
  el.classList.add('hidden');
}

function scrollStatusIntoView() {
  if (!downloadStatus.classList.contains('hidden')) {
    downloadStatus.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function setStatus(message, type) {
  if (!message) {
    downloadStatus.textContent = '';
    downloadStatus.className = 'download-status hidden';
    return;
  }

  downloadStatus.textContent = message;
  downloadStatus.className = type === 'error'
    ? 'download-status download-status-error'
    : type === 'success'
      ? 'download-status download-status-success'
      : 'download-status download-status-info';
  scrollStatusIntoView();
}

function showRegistrationResendOption() {
  if (!fileInfo?.requiresAccess || currentUser) {
    hide(registrationResendWrap);
    return;
  }
  show(registrationResendWrap);
}

function showRegistrationPending(message) {
  setStatus(message, 'success');
  showRegistrationResendOption();
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      signal: controller.signal,
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
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Сервер долго не отвечает. Возможно, проблема с отправкой email — попробуйте позже.');
      timeoutErr.payload = { canResendRegistration: true, requestTimeout: true };
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function triggerFileDownload() {
  window.location.href = `/api/download/${encodeURIComponent(shortName)}/file`;
}

function setButtonsBusy(busy) {
  submitInProgress = busy;
  downloadBtn.disabled = busy;
  downloadBtn.textContent = busy ? 'Проверка…' : 'Скачать';
  if (busy) {
    resendRegistrationBtn.disabled = true;
  } else if (!resendInProgress) {
    resendRegistrationBtn.disabled = false;
  }
}

function validateAccessEmailInput() {
  const email = accessEmailInput.value.trim();
  if (!email) {
    setStatus('Укажите email', 'error');
    accessEmailInput.focus();
    return null;
  }
  if (!EMAIL_PATTERN.test(email)) {
    setStatus('Некорректный email', 'error');
    accessEmailInput.focus();
    return null;
  }
  return email;
}

async function resendRegistrationInvite() {
  if (resendInProgress || submitInProgress || !pageReady) return;

  if (currentUser) {
    setStatus('Вы уже вошли в аккаунт. Нажмите «Выйти», чтобы отправить ссылку на другой email.', 'info');
    return;
  }

  const email = validateAccessEmailInput();
  if (!email) return;

  resendInProgress = true;
  resendRegistrationBtn.disabled = true;
  resendRegistrationBtn.textContent = 'Отправка…';
  setStatus(null);

  try {
    const result = await api(`/api/download/${encodeURIComponent(shortName)}/resend-registration`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    showRegistrationPending(
      result.message || 'Ссылка для регистрации отправлена на email. После регистрации скачайте файл снова.'
    );
  } catch (err) {
    if (err.payload?.needsLogin) {
      setStatus(
        `${err.message} Если вы ещё не регистрировали аккаунт, очистите поле пароля.`,
        'error'
      );
      show(userPasswordField);
    } else {
      setStatus(err.message || 'Не удалось отправить письмо', 'error');
    }
    if (err.payload?.canResendRegistration) {
      showRegistrationResendOption();
    }
  } finally {
    resendInProgress = false;
    resendRegistrationBtn.textContent = 'Отправить ссылку на регистрацию повторно';
    if (!submitInProgress) {
      resendRegistrationBtn.disabled = false;
    }
  }
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
  if (fileInfo.description) {
    fileDescription.textContent = fileInfo.description;
    show(fileDescription);
  } else {
    hide(fileDescription);
  }
  fileMeta.textContent = [
    `Ссылка: ${fileInfo.linkDownloadCount}/${fileInfo.linkMaxDownloads ?? '∞'}`,
    `Файл: ${fileInfo.fileDownloadCount}/${fileInfo.fileMaxDownloads ?? '∞'}`,
  ].join(' · ');

  if (!fileInfo.hasGates) {
    show(openDownload);
    hide(downloadForm);
    return;
  }

  show(downloadForm);
  hide(openDownload);
  hide(registrationResendWrap);

  if (fileInfo.requiresAccess) {
    if (currentUser) {
      hide(emailField);
      hide(userPasswordField);
      hide(registrationHint);
      setStatus('Вы вошли как ' + currentUser.email + '. Нажмите «Скачать» или «Выйти», чтобы использовать другой email.', 'info');
    } else {
      show(emailField);
      show(userPasswordField);
      show(registrationHint);
      showRegistrationResendOption();
    }
  } else {
    hide(emailField);
    hide(userPasswordField);
    hide(registrationHint);
  }

  if (fileInfo.requiresDownloadPassword) {
    show(downloadPasswordField);
  } else {
    hide(downloadPasswordField);
  }
}

async function init() {
  if (!shortName) {
    setStatus('Некорректная ссылка', 'error');
    return;
  }

  try {
    fileInfo = await api(`/api/file/${encodeURIComponent(shortName)}`);
    if (!fileInfo.available) {
      setStatus('Файл недоступен', 'error');
      return;
    }
    await loadUser();
    renderForm();
    pageReady = true;
  } catch (err) {
    setStatus(err.message || 'Не удалось загрузить страницу', 'error');
  }
}

async function handleDownloadSubmit() {
  if (!pageReady || submitInProgress || !fileInfo) {
    return;
  }

  setStatus(null);

  if (fileInfo.requiresAccess && !currentUser) {
    const email = validateAccessEmailInput();
    if (!email) return;
  }

  if (fileInfo.requiresDownloadPassword && !downloadPasswordInput.value) {
    setStatus('Укажите пароль для скачивания', 'error');
    downloadPasswordInput.focus();
    return;
  }

  setButtonsBusy(true);

  try {
    const body = {};
    if (fileInfo.requiresDownloadPassword) {
      body.downloadPassword = downloadPasswordInput.value;
    }
    if (fileInfo.requiresAccess) {
      body.email = accessEmailInput.value.trim();
      body.password = userPasswordInput.value;
    }

    const result = await api(`/api/download/${encodeURIComponent(shortName)}/authorize`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (result.registrationSent) {
      showRegistrationPending(
        result.message || 'На email отправлена ссылка для регистрации. После регистрации скачайте файл снова.'
      );
      return;
    }

    setStatus('Доступ получен, начинаем скачивание…', 'success');
    triggerFileDownload();
  } catch (err) {
    if (err.payload?.needsLogin) {
      setStatus(
        `${err.message} Если вы ещё не регистрировали аккаунт, очистите поле пароля и нажмите «Скачать» снова.`,
        'error'
      );
      show(userPasswordField);
    } else {
      setStatus(err.message || 'Не удалось получить доступ', 'error');
    }
    if (err.payload?.canResendRegistration) {
      showRegistrationResendOption();
    }
  } finally {
    setButtonsBusy(false);
  }
}

downloadBtn.addEventListener('click', handleDownloadSubmit);

directDownloadBtn.addEventListener('click', () => {
  triggerFileDownload();
});

resendRegistrationBtn.addEventListener('click', () => {
  resendRegistrationInvite();
});

userLogoutBtn.addEventListener('click', async () => {
  await api('/api/user/logout', { method: 'POST' });
  await loadUser();
  accessEmailInput.value = '';
  userPasswordInput.value = '';
  setStatus(null);
  renderForm();
});

init();
