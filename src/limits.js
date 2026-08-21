function parseOptionalPositiveInt(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    return { value: null };
  }
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num < 1) {
    return { error: `${fieldName} должно быть целым числом ≥ 1 или пустым` };
  }
  return { value: num };
}

function daysToDatetime(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function parseRemainingDownloads(value, downloadCount) {
  if (value === null || value === undefined || value === '') {
    return { value: null };
  }
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num < 0) {
    return { error: 'Остаток скачиваний: целое число ≥ 0 или пусто (∞)' };
  }
  return { value: downloadCount + num };
}

function parseExpiresDateInput(value) {
  if (value === null || value === undefined || value === '') {
    return { value: null };
  }
  const trimmed = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    return { error: 'Некорректная дата срока ссылки' };
  }
  return { value: `${match[1]}-${match[2]}-${match[3]} 23:59:59` };
}

function parseLimitFields(body, prefix) {
  const maxDownloadsKey = `${prefix}MaxDownloads`;
  const daysKey = `${prefix}Days`;
  const maxLabel = prefix === 'link' ? 'Лимит скачиваний ссылки' : 'Лимит скачиваний файла';
  const daysLabel = prefix === 'link' ? 'Срок ссылки' : 'Срок хранения файла';

  const maxParsed = parseOptionalPositiveInt(body[maxDownloadsKey], maxLabel);
  if (maxParsed.error) return { error: maxParsed.error };

  const daysParsed = parseOptionalPositiveInt(body[daysKey], daysLabel);
  if (daysParsed.error) return { error: daysParsed.error };

  const expiresAt = daysParsed.value ? daysToDatetime(daysParsed.value) : null;

  return {
    maxDownloads: maxParsed.value,
    days: daysParsed.value,
    expiresAt,
  };
}

function isLinkAvailable(row) {
  if (!row) return false;
  if (row.link_max_downloads !== null && row.link_download_count >= row.link_max_downloads) {
    return false;
  }
  if (row.link_expires_at && new Date(row.link_expires_at) <= new Date()) {
    return false;
  }
  return true;
}

function isLinkExhausted(row) {
  if (!row) return false;
  return row.link_max_downloads !== null && row.link_download_count >= row.link_max_downloads;
}

function isLinkExpired(row) {
  if (!row) return false;
  return row.link_expires_at && new Date(row.link_expires_at) <= new Date();
}

function shouldDeleteStoredFile(row) {
  if (!row) return false;
  if (row.delete_at && new Date(row.delete_at) <= new Date()) {
    return true;
  }
  if (row.delete_max_downloads !== null && row.total_download_count >= row.delete_max_downloads) {
    return true;
  }
  return false;
}

function isStoredFileAvailable(row) {
  if (!row) return false;
  return !shouldDeleteStoredFile(row);
}

module.exports = {
  parseOptionalPositiveInt,
  daysToDatetime,
  parseRemainingDownloads,
  parseExpiresDateInput,
  parseLimitFields,
  isLinkAvailable,
  isLinkExhausted,
  isLinkExpired,
  shouldDeleteStoredFile,
  isStoredFileAvailable,
};
