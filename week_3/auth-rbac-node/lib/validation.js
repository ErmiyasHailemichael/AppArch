'use strict';

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt only uses the first 72 bytes

/** Returns a message describing the problem, or null if the credentials are acceptable. */
function validateCredentials(username, password) {
  if (!USERNAME_RE.test(username)) {
    return 'Username must be 3-32 characters: letters, numbers, dot, dash or underscore';
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return 'Password must be at least 8 characters';
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return 'Password is too long (72 bytes maximum)';
  }
  return null;
}

/** Reads { username, password } from a parsed JSON body. Returns null if malformed. */
function credentialsFrom(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const { username, password } = body;
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  return { username: username.trim(), password };
}

module.exports = { validateCredentials, credentialsFrom, MIN_PASSWORD_LEN, MAX_PASSWORD_BYTES };
