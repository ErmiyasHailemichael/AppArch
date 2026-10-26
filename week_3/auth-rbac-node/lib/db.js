'use strict';

// node:sqlite ships with Node 22, so there is nothing extra to install.
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`;

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

function isUniqueViolation(err) {
  return /UNIQUE constraint failed/i.test(String(err && err.message));
}

/** Every query uses ? placeholders, so user input is always data, never SQL. */
function makeUserStore(db) {
  return {
    create({ username, passwordHash, role }) {
      return db
        .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
        .run(username, passwordHash, role, nowIso());
    },
    findByName(username) {
      return db
        .prepare('SELECT id, username, role, token_version, password_hash FROM users WHERE username = ?')
        .get(username);
    },
    findById(id) {
      return db
        .prepare('SELECT id, username, role, token_version, created_at FROM users WHERE id = ?')
        .get(id);
    },
    list() {
      return db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
    },
    bumpTokenVersion(id) {
      db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(id);
    },
    count() {
      return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    },
  };
}

module.exports = { openDb, makeUserStore, isUniqueViolation };
