const crypto = require('crypto');

const KEY_LENGTH = 64;

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(secret, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

function verifySecret(secret, stored) {
  if (!stored || !secret) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashVerify = crypto.scryptSync(secret, salt, KEY_LENGTH).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hashVerify, 'hex'));
}

module.exports = {
  hashSecret,
  verifySecret,
};
