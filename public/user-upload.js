const gateCard = document.getElementById('gate-card');
const gateMessage = document.getElementById('gate-message');
const uploadCard = document.getElementById('upload-card');
const quotaInfo = document.getElementById('quota-info');
const dropZone = document.getElementById('user-drop-zone');
const fileInput = document.getElementById('user-file-input');
const fileInfo = document.getElementById('user-file-info');
const fileNameEl = document.getElementById('user-file-name');
const uploadStatusEl = document.getElementById('user-upload-status');
const shareForm = document.getElementById('user-share-form');
const shortNameInput = document.getElementById('user-short-name');
const nameError = document.getElementById('user-name-error');
const shareError = document.getElementById('user-share-error');
const result = document.getElementById('user-result');
const shareLink = document.getElementById('user-share-link');

let uploadId = null;
let uploadPromise = null;

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function setMsg(el, text, type) {
  if (text) {
    el.textContent = text;
    el.className = type === 'error' ? 'error' : 'success';
    show(el);
  } else {
    hide(el);
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

function limitsPayload() {
  return {
    linkMaxDownloads: document.getElementById('user-link-max').value,
    linkDays: document.getElementById('user-link-days').value,
    fileMaxDownloads: document.getElementById('user-file-max').value,
    fileDays: document.getElementById('user-file-days').value,
  };
}

async function loadQuota() {
  const quota = await api('/api/user/upload-quota');
  if (!quota.canUpload) {
    show(gateCard);
    hide(uploadCard);
    gateMessage.textContent = 'Загрузка файлов не разрешена. Обратитесь к администратору.';
    return false;
  }

  hide(gateCard);
  show(uploadCard);
  quotaInfo.textContent = [
    `Файлов: ${quota.usage.fileCount}/${quota.maxFiles ?? '∞'}`,
    `Объём: ${quota.usage.totalMb} МБ / ${quota.maxTotalSizeMb ?? '∞'} МБ`,
    `Макс. файл: ${quota.maxFileSizeMb ?? '∞'} МБ`,
    quota.uploadExpiresAt ? `до ${quota.uploadExpiresAt}` : '',
  ].filter(Boolean).join(' · ');
  return true;
}

function startUpload(file) {
  uploadId = null;
  uploadPromise = null;
  fileNameEl.textContent = file.name;
  show(fileInfo);
  show(shareForm);
  uploadStatusEl.textContent = 'Загрузка…';
  uploadStatusEl.className = 'status uploading';

  const fd = new FormData();
  fd.append('file', file);
  uploadPromise = api('/api/user/upload-temp', { method: 'POST', body: fd })
    .then((d) => {
      uploadId = d.uploadId;
      uploadStatusEl.textContent = 'Загружено';
      uploadStatusEl.className = 'status done';
      return d;
    })
    .catch((err) => {
      uploadStatusEl.textContent = err.message;
      uploadStatusEl.className = 'status error';
      throw err;
    });
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) startUpload(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) startUpload(fileInput.files[0]);
});

shareForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg(shareError, null);
  try {
    await uploadPromise;
    if (!uploadId) throw new Error('Файл не загружен');
    const data = await api('/api/user/share', {
      method: 'POST',
      body: JSON.stringify({
        uploadId,
        shortName: shortNameInput.value.trim(),
        downloadPassword: document.getElementById('user-download-password').value,
        description: document.getElementById('user-file-description').value,
        ...limitsPayload(),
      }),
    });
    shareLink.href = data.shareUrl;
    shareLink.textContent = data.shareUrl;
    show(result);
    await loadQuota();
  } catch (err) {
    setMsg(shareError, err.message, 'error');
  }
});

async function init() {
  try {
    const { user } = await api('/api/user/me');
    if (!user) {
      show(gateCard);
      gateMessage.textContent = 'Войдите в аккаунт';
      return;
    }
    await loadQuota();
  } catch {
    show(gateCard);
    gateMessage.textContent = 'Войдите в аккаунт';
  }
}

init();
