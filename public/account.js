const loginCard = document.getElementById('login-card');
const accountCard = document.getElementById('account-card');
const userLoginForm = document.getElementById('user-login-form');
const loginError = document.getElementById('login-error');
const accountEmail = document.getElementById('account-email');
const logoutBtn = document.getElementById('logout-btn');
const changePasswordForm = document.getElementById('change-password-form');
const changeError = document.getElementById('change-error');
const changeSuccess = document.getElementById('change-success');

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
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
}

const uploadAccess = document.getElementById('upload-access');
const uploadAccessInfo = document.getElementById('upload-access-info');

async function loadAccount() {
  const { user } = await api('/api/user/me');
  if (user) {
    hide(loginCard);
    show(accountCard);
    accountEmail.textContent = user.email;
    if (user.upload?.canUpload) {
      show(uploadAccess);
      uploadAccessInfo.textContent = [
        `Файлов: ${user.upload.usage.fileCount}/${user.upload.maxFiles ?? '∞'}`,
        `Объём: ${user.upload.usage.totalMb ?? 0} / ${user.upload.maxTotalSizeMb ?? '∞'} МБ`,
      ].join(' · ');
    } else {
      hide(uploadAccess);
    }
  } else {
    show(loginCard);
    hide(accountCard);
    hide(uploadAccess);
  }
}

userLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMessage(loginError, null);

  try {
    await api('/api/user/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value,
      }),
    });
    await loadAccount();
  } catch (err) {
    setMessage(loginError, err.message, true);
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/user/logout', { method: 'POST' });
  await loadAccount();
});

changePasswordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMessage(changeError, null);
  setMessage(changeSuccess, null);

  try {
    await api('/api/user/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: document.getElementById('current-password').value,
        newPassword: document.getElementById('new-password').value,
      }),
    });
    setMessage(changeSuccess, 'Пароль изменён', false);
    changePasswordForm.reset();
  } catch (err) {
    setMessage(changeError, err.message, true);
  }
});

loadAccount();
