const crypto = require('crypto');
const config = require('./config');
const { isShortNameTaken } = require('./db');

const DEFAULT_LENGTH = 6;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const MAX_ATTEMPTS = 50;

const RESERVED = new Set([
  'api',
  'register',
  'reset-password',
  'account',
]);

function generateRandomLetters(length = DEFAULT_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += LETTERS[bytes[i] % LETTERS.length];
  }
  return result;
}

function isReservedShortName(name) {
  return RESERVED.has(name.toLowerCase());
}

function findAvailableRandomShortName(length = DEFAULT_LENGTH) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const name = generateRandomLetters(length);
    if (isReservedShortName(name)) continue;
    if (!isShortNameTaken(name)) {
      return name;
    }
  }
  return null;
}

function handleRandomName(req, res) {
  const name = findAvailableRandomShortName(DEFAULT_LENGTH);
  if (!name) {
    res.status(503).json({ error: 'Не удалось сгенерировать свободное имя' });
    return;
  }
  res.json({ shortName: name });
}

module.exports = {
  findAvailableRandomShortName,
  handleRandomName,
  DEFAULT_LENGTH,
};
