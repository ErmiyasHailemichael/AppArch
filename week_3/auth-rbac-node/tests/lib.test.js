'use strict';

// Tests for the building blocks that need no installed packages.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateCredentials, credentialsFrom } = require('../lib/validation');
const { readCookie } = require('../lib/cookies');
const { openDb, makeUserStore, isUniqueViolation } = require('../lib/db');

function tempStore() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'authdb-')), 'test.db');
  const db = openDb(file);
  return { db, users: makeUserStore(db), file };
}

test('validation: accepts normal credentials', () => {
  assert.equal(validateCredentials('alice_01', 'GoodPassword1'), null);
});

test('validation: rejects bad usernames (SQL-like, spaces, too short, too long)', () => {
  for (const name of ["' OR '1'='1' --", 'a b c', 'ab', 'x'.repeat(33), 'bob\n', '<script>']) {
    assert.ok(validateCredentials(name, 'GoodPassword1'), `should reject ${JSON.stringify(name)}`);
  }
});

test('validation: rejects short and over-72-byte passwords', () => {
  assert.ok(validateCredentials('alice', 'short'));
  assert.ok(validateCredentials('alice', 'a'.repeat(73)));
  assert.ok(validateCredentials('alice', 'é'.repeat(37))); // 74 bytes
  assert.equal(validateCredentials('alice', 'a'.repeat(72)), null);
});

test('credentialsFrom: only accepts an object with two strings', () => {
  assert.deepEqual(credentialsFrom({ username: ' bob ', password: 'x' }), { username: 'bob', password: 'x' });
  for (const bad of [null, undefined, [], 'str', 5, {}, { username: 1, password: 2 }, { username: 'a' }]) {
    assert.equal(credentialsFrom(bad), null, JSON.stringify(bad));
  }
});

test('cookies: reads the named cookie, ignores others and junk', () => {
  assert.equal(readCookie('a=1; access_token=abc.def.ghi; b=2', 'access_token'), 'abc.def.ghi');
  assert.equal(readCookie('a=1', 'access_token'), null);
  assert.equal(readCookie(undefined, 'access_token'), null);
  assert.equal(readCookie('access_token=%E0%A4%A', 'access_token'), null); // bad escape: no crash
  assert.equal(readCookie('noequals; access_token=ok', 'access_token'), 'ok');
});

test('db: create, find, list, and duplicate usernames (case-insensitive)', () => {
  const { users } = tempStore();
  users.create({ username: 'Alice', passwordHash: 'hash1', role: 'user' });
  assert.equal(users.findByName('alice').username, 'Alice');
  assert.equal(users.findById(1).role, 'user');
  assert.deepEqual(users.list().map((u) => u.username), ['Alice']);
  assert.throws(
    () => users.create({ username: 'ALICE', passwordHash: 'hash2', role: 'user' }),
    (err) => isUniqueViolation(err)
  );
});

test('db: list() never includes password hashes', () => {
  const { users } = tempStore();
  users.create({ username: 'bob', passwordHash: '$2a$12$secret-hash-value', role: 'user' });
  assert.ok(!JSON.stringify(users.list()).includes('secret-hash-value'));
  assert.ok(!('password_hash' in users.findById(1)));
});

test('db: role column only allows user or admin', () => {
  const { users } = tempStore();
  assert.throws(() => users.create({ username: 'eve', passwordHash: 'h', role: 'superuser' }));
});

test('db: SQL injection strings are treated as plain data', () => {
  const { users } = tempStore();
  users.create({ username: 'alice', passwordHash: 'h', role: 'user' });
  for (const attack of ["' OR '1'='1' --", "alice'--", "'; DROP TABLE users; --", '" OR ""="']) {
    assert.equal(users.findByName(attack), undefined, attack);
  }
  assert.equal(users.count(), 1); // table still exists and is unchanged
});

test('db: token version increases (used to invalidate tokens on logout)', () => {
  const { users } = tempStore();
  users.create({ username: 'alice', passwordHash: 'h', role: 'user' });
  assert.equal(users.findById(1).token_version, 0);
  users.bumpTokenVersion(1);
  assert.equal(users.findById(1).token_version, 1);
});
