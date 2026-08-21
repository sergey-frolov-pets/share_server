(function initUiSettingsModule(global) {
  const STORAGE_THEME = 'share-ui-theme';
  const STORAGE_LANG = 'share-ui-lang';
  const DEFAULT_THEME = 'light';
  const DEFAULT_LANG = 'ru';

  const translations = {
    ru: {
      'settings.language': 'Язык',
      'settings.theme': 'Тема',
      'settings.themeLight': 'Светлая',
      'settings.themeDark': 'Тёмная',
      'admin.disk.legend': 'Диск для обмена',
      'admin.disk.maxMb': 'Макс. объём на диске (МБ)',
      'admin.btn.saveLimit': 'Сохранить лимит',
      'admin.users.title': 'Пользователи',
      'admin.filesLinks.title': 'Файлы и ссылки на сервере',
      'admin.tab.files': 'Файлы',
      'admin.tab.links': 'Ссылки',
      'admin.downloadQueue.title': 'Очередь скачивания',
      'admin.col.email': 'Email',
      'admin.col.files': 'Файлы',
      'admin.col.links': 'Ссылки',
      'admin.col.volume': 'Объём',
      'admin.col.upload': 'Загрузка',
      'admin.col.limits': 'Лимиты',
      'admin.col.file': 'Файл',
      'admin.col.size': 'Размер',
      'admin.col.downloads': 'Скачиваний',
      'admin.col.actions': 'Действия',
      'admin.col.link': 'Ссылка',
      'admin.col.downloaded': 'Скачано',
      'admin.col.remaining': 'Осталось',
      'admin.col.until': 'До',
      'admin.col.status': 'Статус',
      'admin.stat.users': 'Пользователи',
      'admin.stat.uploaders': 'С загрузкой',
      'admin.stat.links': 'Ссылки',
      'admin.stat.files': 'Файлы',
      'admin.stat.disk': 'Диск, МБ',
      'admin.stat.linkDownloads': 'Скачивания (ссылки)',
      'admin.storage.usedWithLimit': 'Использовано: {used} МБ из {max} МБ (свободно {free} МБ)',
      'admin.storage.usedNoLimit': 'Использовано: {used} МБ (лимит не задан)',
      'admin.smtp.ok': 'SMTP настроен — письма (регистрация, сброс пароля) отправляются.',
      'admin.smtp.missing': 'SMTP не настроен — письма не отправляются. Задайте SMTP_HOST, SMTP_USER, SMTP_PASS в .env на сервере.',
      'admin.disk.physical': 'На физическом диске доступно {free} МБ из {total} МБ',
      'admin.disk.physicalUnknown': 'Не удалось определить объём физического диска',
      'admin.user.allow': 'Разрешить',
      'admin.user.placeholder.fileMb': 'МБ файл',
      'admin.user.placeholder.totalMb': 'МБ всего',
      'admin.user.placeholder.files': 'файлов',
      'admin.user.placeholder.days': 'дней',
      'admin.btn.save': 'Сохранить',
      'admin.btn.addLink': 'Добавить ссылку',
      'admin.btn.download': 'Скачать',
      'admin.btn.saveFile': 'Сохранить файл',
      'admin.btn.deleteFile': 'Удалить файл',
      'admin.btn.updateLink': 'Обновить ссылку',
      'admin.btn.deleteLink': 'Удалить ссылку',
      'admin.btn.queuePause': 'Пауза очереди',
      'admin.btn.queueResume': 'Продолжить очередь',
      'admin.btn.queueClear': 'Очистить завершённые',
      'admin.file.until': 'до',
      'admin.file.linksActive': 'активн.',
      'admin.link.active': 'активна',
      'admin.link.inactive': 'неактивна',
      'admin.links.empty': 'Нет ссылок — добавьте из таблицы файлов',
      'admin.filesStats': 'Файлов: {files} · Объём: {size} МБ · Скачиваний файлов: {downloads} · Ссылок: {links} (активных {active})',
      'admin.linksStats': 'Ссылок: {links} · Активных: {active} · Скачиваний по ссылкам: {downloads}',
    },
    en: {
      'settings.language': 'Language',
      'settings.theme': 'Theme',
      'settings.themeLight': 'Light',
      'settings.themeDark': 'Dark',
      'admin.disk.legend': 'Shared disk',
      'admin.disk.maxMb': 'Max disk quota (MB)',
      'admin.btn.saveLimit': 'Save quota',
      'admin.users.title': 'Users',
      'admin.filesLinks.title': 'Files and links on server',
      'admin.tab.files': 'Files',
      'admin.tab.links': 'Links',
      'admin.downloadQueue.title': 'Download queue',
      'admin.col.email': 'Email',
      'admin.col.files': 'Files',
      'admin.col.links': 'Links',
      'admin.col.volume': 'Volume',
      'admin.col.upload': 'Upload',
      'admin.col.limits': 'Limits',
      'admin.col.file': 'File',
      'admin.col.size': 'Size',
      'admin.col.downloads': 'Downloads',
      'admin.col.actions': 'Actions',
      'admin.col.link': 'Link',
      'admin.col.downloaded': 'Downloaded',
      'admin.col.remaining': 'Remaining',
      'admin.col.until': 'Until',
      'admin.col.status': 'Status',
      'admin.stat.users': 'Users',
      'admin.stat.uploaders': 'With upload',
      'admin.stat.links': 'Links',
      'admin.stat.files': 'Files',
      'admin.stat.disk': 'Disk, MB',
      'admin.stat.linkDownloads': 'Link downloads',
      'admin.storage.usedWithLimit': 'Used: {used} MB of {max} MB ({free} MB free)',
      'admin.storage.usedNoLimit': 'Used: {used} MB (no quota)',
      'admin.smtp.ok': 'SMTP configured — registration and password reset emails are sent.',
      'admin.smtp.missing': 'SMTP is not configured — emails are not sent. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env on the server.',
      'admin.disk.physical': 'Physical disk: {free} MB free of {total} MB',
      'admin.disk.physicalUnknown': 'Could not detect physical disk size',
      'admin.user.allow': 'Allow',
      'admin.user.placeholder.fileMb': 'MB per file',
      'admin.user.placeholder.totalMb': 'MB total',
      'admin.user.placeholder.files': 'files',
      'admin.user.placeholder.days': 'days',
      'admin.btn.save': 'Save',
      'admin.btn.addLink': 'Add link',
      'admin.btn.download': 'Download',
      'admin.btn.saveFile': 'Save file',
      'admin.btn.deleteFile': 'Delete file',
      'admin.btn.updateLink': 'Update link',
      'admin.btn.deleteLink': 'Delete link',
      'admin.btn.queuePause': 'Pause queue',
      'admin.btn.queueResume': 'Resume queue',
      'admin.btn.queueClear': 'Clear completed',
      'admin.file.until': 'until',
      'admin.file.linksActive': 'active',
      'admin.link.active': 'active',
      'admin.link.inactive': 'inactive',
      'admin.links.empty': 'No links — add from the files table',
      'admin.filesStats': 'Files: {files} · Size: {size} MB · File downloads: {downloads} · Links: {links} ({active} active)',
      'admin.linksStats': 'Links: {links} · Active: {active} · Link downloads: {downloads}',
    },
  };

  let currentLang = DEFAULT_LANG;
  let currentTheme = DEFAULT_THEME;
  let onLangChange = null;

  function applyTheme(theme) {
    currentTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem(STORAGE_THEME, currentTheme);
    updateToggleState('admin-theme-light', currentTheme === 'light');
    updateToggleState('admin-theme-dark', currentTheme === 'dark');
  }

  function applyLanguage(lang) {
    currentLang = translations[lang] ? lang : DEFAULT_LANG;
    localStorage.setItem(STORAGE_LANG, currentLang);
    document.documentElement.lang = currentLang;
    applyDomI18n(document.getElementById('admin-panel'));
    updateToggleState('admin-lang-ru', currentLang === 'ru');
    updateToggleState('admin-lang-en', currentLang === 'en');
    if (typeof onLangChange === 'function') {
      onLangChange(currentLang);
    }
  }

  function updateToggleState(id, active) {
    const button = document.getElementById(id);
    if (button) {
      button.classList.toggle('active', active);
    }
  }

  function formatTemplate(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => (
      vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : ''
    ));
  }

  function t(key, vars) {
    const dict = translations[currentLang] || translations.ru;
    const value = dict[key] ?? translations.ru[key] ?? key;
    return vars ? formatTemplate(value, vars) : value;
  }

  function applyDomI18n(root) {
    if (!root) return;

    root.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });

    root.querySelectorAll('[data-i18n-title]').forEach((node) => {
      const text = t(node.dataset.i18nTitle);
      node.setAttribute('title', text);
      node.setAttribute('aria-label', text);
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
    });
  }

  function initAdminToolbar() {
    const langRu = document.getElementById('admin-lang-ru');
    const langEn = document.getElementById('admin-lang-en');
    const themeLight = document.getElementById('admin-theme-light');
    const themeDark = document.getElementById('admin-theme-dark');

    langRu?.addEventListener('click', () => applyLanguage('ru'));
    langEn?.addEventListener('click', () => applyLanguage('en'));
    themeLight?.addEventListener('click', () => applyTheme('light'));
    themeDark?.addEventListener('click', () => applyTheme('dark'));

    applyTheme(localStorage.getItem(STORAGE_THEME) || DEFAULT_THEME);
    applyLanguage(localStorage.getItem(STORAGE_LANG) || DEFAULT_LANG);
  }

  const savedTheme = localStorage.getItem(STORAGE_THEME) || DEFAULT_THEME;
  document.documentElement.setAttribute('data-theme', savedTheme === 'dark' ? 'dark' : 'light');

  global.UiSettings = {
    t,
    getLang: () => currentLang,
    getTheme: () => currentTheme,
    applyTheme,
    applyLanguage,
    applyDomI18n,
    set onLangChange(callback) {
      onLangChange = callback;
    },
    get onLangChange() {
      return onLangChange;
    },
    initAdminToolbar,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminToolbar);
  } else {
    initAdminToolbar();
  }
})(window);
