const params = new URLSearchParams(window.location.search);
const token = params.get('token');

const registerInfo = document.getElementById('register-info');
const registerForm = document.getElementById('register-form');
const registerEmail = document.getElementById('register-email');
const registerPassword = document.getElementById('register-password');
const registerError = document.getElementById('register-error');
const registerSuccess = document.getElementById('register-success');

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
  if (!token) {
    setMessage(registerError, 'Ссылка регистрации недействительна', true);
    registerForm.classList.add('hidden');
    return;
  }

  try {
    const info = await api(`/api/user/register-info?token=${encodeURIComponent(token)}`);
    registerEmail.value = info.email;
    if (info.shortName) {
      registerInfo.textContent = `После регистрации откройте ссылку: /${info.shortName}`;
    }
  } catch (err) {
    setMessage(registerError, err.message, true);
    registerForm.classList.add('hidden');
  }
}

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMessage(registerError, null);
  setMessage(registerSuccess, null);

  try {
    const result = await api('/api/user/register', {
      method: 'POST',
      body: JSON.stringify({
        token,
        password: registerPassword.value,
      }),
    });

    setMessage(registerSuccess, 'Регистрация успешна. Теперь вы можете скачать файл.', false);
    if (result.shortName) {
      registerInfo.textContent = `Перейдите к файлу: /${result.shortName}`;
    }
  } catch (err) {
    setMessage(registerError, err.message, true);
  }
});

init();
