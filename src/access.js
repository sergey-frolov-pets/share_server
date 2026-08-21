const { getUserByEmail } = require('./db');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function parseAccessList(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseAccessInput(value) {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseDomainInput(value) {
  return parseAccessInput(value).map((domain) => domain.replace(/^@+/, ''));
}

function getEmailDomain(email) {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  if (at < 1 || at === normalized.length - 1) return null;
  return normalized.slice(at + 1);
}

function fileHasAccessRestrictions(file) {
  const emails = parseAccessList(file.allowed_emails);
  const domains = parseAccessList(file.allowed_domains);
  return emails.length > 0 || domains.length > 0;
}

function fileHasDownloadPassword(file) {
  return Boolean(file.download_password_hash);
}

function fileHasGates(file) {
  return fileHasDownloadPassword(file) || fileHasAccessRestrictions(file);
}

function isEmailAllowedForFile(email, file) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const allowedEmails = parseAccessList(file.allowed_emails);
  const allowedDomains = parseAccessList(file.allowed_domains);

  if (allowedEmails.length === 0 && allowedDomains.length === 0) {
    return true;
  }

  if (allowedEmails.includes(normalized)) {
    return true;
  }

  const domain = getEmailDomain(normalized);
  if (domain && allowedDomains.includes(domain)) {
    return true;
  }

  return false;
}

function validateEmailFormat(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return 'Укажите email';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return 'Некорректный email';
  }
  return null;
}

function isUserRegistered(email) {
  return Boolean(getUserByEmail(normalizeEmail(email)));
}

function accessRestrictionsRequireSmtp(access) {
  if (!access) return false;
  const emails = access.emails || [];
  const domains = access.domains || [];
  return emails.length > 0 || domains.length > 0;
}

function validateAccessRestrictionsSmtp(access, smtpConfigured) {
  if (!accessRestrictionsRequireSmtp(access)) return null;
  if (!smtpConfigured) {
    return 'Доступ по email недоступен: на сервере не настроен SMTP. Настройте почту в .env или уберите ограничения.';
  }
  return null;
}

module.exports = {
  normalizeEmail,
  parseAccessList,
  parseAccessInput,
  parseDomainInput,
  getEmailDomain,
  fileHasAccessRestrictions,
  fileHasDownloadPassword,
  fileHasGates,
  isEmailAllowedForFile,
  validateEmailFormat,
  isUserRegistered,
  accessRestrictionsRequireSmtp,
  validateAccessRestrictionsSmtp,
};
