(function (global) {
  const DB_NAME = 'shareUploadFiles';
  const DB_VERSION = 1;
  const STORE = 'handles';

  function fingerprintForFile(file) {
    return `${file.name}\0${file.size}\0${file.lastModified || 0}`;
  }

  function fingerprintForMeta(name, size, lastModified = 0) {
    return `${name}\0${size}\0${lastModified || 0}`;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function runStore(mode, callback) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      Promise.resolve(callback(store))
        .then((value) => { result = value; })
        .catch(reject);
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    }));
  }

  function getRecord(store, key) {
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function putRecord(store, record) {
    return new Promise((resolve, reject) => {
      const request = store.put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error);
    });
  }

  function deleteRecord(store, key) {
    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function buildRecord(file, handle, sessionId = null) {
    const fingerprint = fingerprintForFile(file);
    return {
      key: sessionId ? `session:${sessionId}` : `fp:${fingerprint}`,
      fingerprint,
      sessionId,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified || 0,
      handle,
      updatedAt: Date.now(),
    };
  }

  async function ensureReadPermission(handle, allowRequest) {
    if (!handle?.queryPermission) return true;
    let permission = await handle.queryPermission({ mode: 'read' });
    if (permission === 'granted') return true;
    if (!allowRequest || !handle.requestPermission) return false;
    permission = await handle.requestPermission({ mode: 'read' });
    return permission === 'granted';
  }

  async function readFileFromRecord(record, allowRequest) {
    if (!record?.handle) return null;
    const allowed = await ensureReadPermission(record.handle, allowRequest);
    if (!allowed) return null;
    const file = await record.handle.getFile();
    if (file.name !== record.name || file.size !== record.size) return null;
    return file;
  }

  async function saveHandle(file, handle, sessionId = null) {
    if (!file || !handle) return;
    await runStore('readwrite', async (store) => {
      await putRecord(store, buildRecord(file, handle, null));
      if (sessionId) {
        await putRecord(store, buildRecord(file, handle, sessionId));
      }
    });
  }

  async function linkSession(file, sessionId) {
    if (!file || !sessionId) return;
    const fpKey = `fp:${fingerprintForFile(file)}`;
    const record = await runStore('readonly', (store) => getRecord(store, fpKey));
    if (!record?.handle) return;
    await runStore('readwrite', (store) => putRecord(
      store,
      buildRecord(file, record.handle, sessionId),
    ));
  }

  async function getFileBySessionId(sessionId, options = {}) {
    if (!sessionId) return null;
    const record = await runStore('readonly', (store) => getRecord(store, `session:${sessionId}`));
    return readFileFromRecord(record, options.allowRequest !== false);
  }

  async function getFileByMeta(name, size, lastModified, options = {}) {
    const record = await runStore('readonly', (store) => getRecord(
      store,
      `fp:${fingerprintForMeta(name, size, lastModified)}`,
    ));
    return readFileFromRecord(record, options.allowRequest !== false);
  }

  async function hasStoredSession(sessionId) {
    const record = await runStore('readonly', (store) => getRecord(store, `session:${sessionId}`));
    return Boolean(record?.handle);
  }

  async function removeBySessionId(sessionId) {
    if (!sessionId) return;
    await runStore('readwrite', (store) => deleteRecord(store, `session:${sessionId}`));
  }

  async function removeByFile(file) {
    if (!file) return;
    await runStore('readwrite', async (store) => {
      await deleteRecord(store, `fp:${fingerprintForFile(file)}`);
    });
  }

  function isSupported() {
    return typeof indexedDB !== 'undefined'
      && (typeof global.showOpenFilePicker === 'function'
        || typeof DataTransferItem !== 'undefined');
  }

  global.FileHandleStore = {
    saveHandle,
    linkSession,
    getFileBySessionId,
    getFileByMeta,
    hasStoredSession,
    removeBySessionId,
    removeByFile,
    fingerprintForFile,
    isSupported,
  };
})(window);
