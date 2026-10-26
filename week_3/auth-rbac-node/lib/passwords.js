'use strict';

const bcrypt = require('bcryptjs');

// Cost factor 12 by default. Never lower it in production.
// (The tests lower it to 4 only so the suite runs quickly.)
const ROUNDS = Math.max(4, parseInt(process.env.BCRYPT_ROUNDS || '12', 10));

/** Salted, slow bcrypt hash. The random salt is stored inside the hash string. */
function hashPassword(password) {
  return bcrypt.hash(password, ROUNDS);
}

/** Used once at startup to create the admin account. */
function hashPasswordSync(password) {
  return bcrypt.hashSync(password, ROUNDS);
}

async function verifyPassword(password, storedHash) {
  try {
    return await bcrypt.compare(password, storedHash);
  } catch {
    return false; // malformed hash
  }
}

// Used when a login names a user that does not exist, so the response takes
// about as long as a real password check (limits user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-used-for-timing', ROUNDS);

module.exports = { hashPassword, hashPasswordSync, verifyPassword, DUMMY_HASH };
