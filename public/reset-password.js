const params = new URLSearchParams(window.location.search);
const token = params.get('token');

const forgotForm = document.getElementById('forgot-form');
const resetForm = document.getElementById('reset-form');
const forgotEmail = document.getElementById('forgot-email');
const resetEmail = document.getElementById('reset-email');
const resetPassword = document.getElementById('reset-password');
const forgotError = document.getElementById('forgot-error');
const forgotSuccess = document.getElementById('forgot-success');
const resetError = document.getElementById('reset-error');
const resetSuccess = document.getElementById('reset-success');

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

async function init() {
  if (!token) return;

  hide(forgotForm);
  show(resetForm);

  try {
    const info = await api(`/api/user/reset-info?token=${encodeURIComponent(token)}`);
    resetEmail.value = info.email;
  } catch (err) {
    setMessage(resetError, err.message, true);
    resetForm.classList.add('hidden');
  }
}

forgotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMessage(forgotError, null);
  setMessage(forgotSuccess, null);

  try {
    const result = await api('/api/user/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: forgotEmail.value }),
    });
    setMessage(forgotSuccess, result.message, false);
  } catch (err) {
    setMessage(forgotError, err.message, true);
  }
});

resetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMessage(resetError, null);
  setMessage(resetSuccess, null);

  try {
    await api('/api/user/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        token,
        password: resetPassword.value,
      }),
    });
    setMessage(resetSuccess, 'Пароль обновлён. Теперь вы можете войти.', false);
  } catch (err) {
    setMessage(resetError, err.message, true);
  }
});

init();
