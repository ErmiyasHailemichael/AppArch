'use strict';

/*
 * Automated version of the assignment's QA checklist. Starts the real server on a
 * random port with a temporary database and talks to it over HTTP.
 *   npm test
 */

// bcrypt cost 4 keeps the suite fast. The real app defaults to cost 12.
process.env.BCRYPT_ROUNDS = '4';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const { createApp } = require('../app');

const SECRET = 'test-secret-key-that-is-at-least-32-characters-long';
const ADMIN = { username: 'admin1', password: 'AdminPass123!' };
const USER = { username: 'alice', password: 'AlicePass123!' };

/** A tiny HTTP client that remembers cookies, like a browser would. */
class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  async request(method, url, { json, body, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload = body;
    if (json !== undefined) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(json);
    }
    const res = await fetch(this.base + url, { method, headers: h, body: payload, redirect: 'manual' });
    const setCookie = res.headers.getSetCookie();
    for (const line of setCookie) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const lower = attrs.join(';').toLowerCase();
      const expired = /expires=thu, 01 jan 1970/.test(lower) || /max-age=0(;|$)/.test(lower);
      if (value === '' || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, setCookie, text, data };
  }

  get(url, opts) { return this.request('GET', url, opts); }
  post(url, json, headers) { return this.request('POST', url, { json, headers }); }
}

describe('QA checklist', () => {
  let app, server, base, dbFile;

  async function start(overrides = {}) {
    dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-')), 'test.db');
    app = createApp({
      secretKey: SECRET,
      databasePath: dbFile,
      cookieSecure: false, // the test client talks plain http
      adminUsername: ADMIN.username,
      adminPassword: ADMIN.password,
      ...overrides,
    });
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  }

  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    try { app.locals.db.close(); } catch { /* already closed by a test */ }
  }

  beforeEach(() => start());
  afterEach(() => stop());

  const newClient = () => new Client(base);
  const register = (c, creds = USER) => c.post('/api/register', creds);
  const login = (c, creds = USER) => c.post('/api/login', creds);
  async function loggedIn(creds = USER, doRegister = true) {
    const c = newClient();
    if (doRegister) assert.equal((await register(c, creds)).status, 201);
    assert.equal((await login(c, creds)).status, 200);
    return c;
  }
  const signToken = (claims, secret = SECRET, options = {}) =>
    jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: 600, ...options });

  // ---- 1. Authentication functional tests ----
  describe('1. Authentication', () => {
    test('1a registration succeeds', async () => {
      const res = await register(newClient());
      assert.equal(res.status, 201);
      assert.deepEqual(res.data, { username: 'alice', role: 'user' });
    });

    test('1b login sets an HttpOnly session cookie', async () => {
      const c = newClient();
      await register(c);
      const res = await login(c);
      assert.equal(res.status, 200);
      const cookie = res.setCookie.join('\n');
      assert.match(cookie, /access_token=/);
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
    });

    test('1c failed login error is generic (same for wrong password and unknown user)', async () => {
      await register(newClient());
      const wrongPassword = await login(newClient(), { username: USER.username, password: 'WrongPassword1' });
      const unknownUser = await login(newClient(), { username: 'nobody', password: 'WrongPassword1' });
      assert.equal(wrongPassword.status, 401);
      assert.equal(unknownUser.status, 401);
      assert.deepEqual(wrongPassword.data, unknownUser.data);
      assert.deepEqual(wrongPassword.data, { error: 'Invalid username or password' });
    });

    test('1d logout removes the cookie and kills a copied token', async () => {
      const c = await loggedIn();
      const stolen = c.cookies.get('access_token');
      assert.equal((await c.post('/api/logout', {})).status, 200);
      assert.equal(c.cookies.has('access_token'), false);
      assert.equal((await c.get('/api/profile')).status, 401);
      const replay = newClient();
      replay.cookies.set('access_token', stolen);
      assert.equal((await replay.get('/api/profile')).status, 401);
    });

    test('1e cookie has the Secure flag when configured', async () => {
      await stop();
      await start({ cookieSecure: true });
      const c = newClient();
      await register(c);
      const res = await login(c);
      assert.match(res.setCookie.join('\n'), /Secure/i);
    });
  });

  // ---- 2. Authorization and privilege boundaries ----
  describe('2. Authorization', () => {
    test('2a a user reaches the user dashboard', async () => {
      const c = await loggedIn();
      const res = await c.get('/api/profile');
      assert.equal(res.status, 200);
      assert.equal(res.data.role, 'user');
    });

    test('2b a user gets 403 on the admin endpoint', async () => {
      const c = await loggedIn();
      const res = await c.get('/api/admin/users');
      assert.equal(res.status, 403);
      assert.deepEqual(res.data, { error: 'Forbidden' });
    });

    test('2c an admin reaches both user and admin endpoints', async () => {
      const c = await loggedIn(ADMIN, false);
      assert.equal((await c.get('/api/profile')).status, 200);
      const res = await c.get('/api/admin/users');
      assert.equal(res.status, 200);
      assert.ok(res.data.users.some((u) => u.username === 'admin1'));
    });

    test('2d logged-out requests get 401', async () => {
      const c = newClient();
      assert.equal((await c.get('/api/profile')).status, 401);
      assert.equal((await c.get('/api/admin/users')).status, 401);
    });

    test('2e the public endpoint needs no login', async () => {
      assert.equal((await newClient().get('/api/public')).status, 200);
    });

    test('2f registration cannot choose a role', async () => {
      const res = await newClient().post('/api/register', {
        username: 'mallory', password: 'MalloryPass1!', role: 'admin',
      });
      assert.equal(res.status, 201);
      assert.equal(res.data.role, 'user');
      const row = app.locals.db.prepare("SELECT role FROM users WHERE username = 'mallory'").get();
      assert.equal(row.role, 'user');
    });

    test('2g forged and invalid tokens are rejected', async () => {
      await register(newClient());
      const b64 = (s) => Buffer.from(s).toString('base64url');
      const tokens = {
        'wrong secret': signToken({ tv: 0 }, 'x'.repeat(40), { subject: '2' }),
        expired: signToken({ tv: 0 }, SECRET, { subject: '2', expiresIn: -60 }),
        'unknown user': signToken({ tv: 0 }, SECRET, { subject: '999' }),
        'wrong token version': signToken({ tv: 5 }, SECRET, { subject: '2' }),
        'no exp (never expires)': jwt.sign({ tv: 0 }, SECRET, { algorithm: 'HS256', subject: '2' }),
        'alg none': `${b64('{"alg":"none","typ":"JWT"}')}.${b64('{"sub":"2","tv":0,"iat":1,"exp":9999999999}')}.`,
        garbage: 'not-a-jwt',
      };
      for (const [name, token] of Object.entries(tokens)) {
        const c = newClient();
        c.cookies.set('access_token', token);
        assert.equal((await c.get('/api/profile')).status, 401, `${name}: profile`);
        assert.equal((await c.get('/api/admin/users')).status, 401, `${name}: admin`);
      }
    });

    test('2h role comes from the database, not from the token', async () => {
      const c = await loggedIn();
      assert.equal((await c.get('/api/admin/users')).status, 403);
      app.locals.db.prepare("UPDATE users SET role = 'admin' WHERE username = 'alice'").run();
      assert.equal((await c.get('/api/admin/users')).status, 200);
    });
  });

  // ---- 3. Input validation and edge cases ----
  describe('3. Input validation', () => {
    test('3a empty, missing or wrong-type credentials are rejected on the server', async () => {
      const bodies = [{ username: '', password: '' }, { username: 'bob' }, {}, { username: 1, password: 2 }, []];
      for (const url of ['/api/register', '/api/login']) {
        for (const body of bodies) {
          assert.equal((await newClient().post(url, body)).status, 400, `${url} ${JSON.stringify(body)}`);
        }
      }
    });

    test('3b non-JSON body is rejected', async () => {
      const res = await newClient().request('POST', '/api/login', { body: 'username=a&password=b' });
      assert.equal(res.status, 415);
    });

    test('3c malformed JSON is rejected cleanly', async () => {
      const res = await newClient().request('POST', '/api/login', {
        body: '{"username": ', headers: { 'content-type': 'application/json' },
      });
      assert.equal(res.status, 400);
      assert.deepEqual(res.data, { error: 'Invalid JSON' });
    });

    test('3d short and oversized passwords are rejected', async () => {
      assert.equal((await newClient().post('/api/register', { username: 'bobby', password: 'short' })).status, 400);
      assert.equal((await newClient().post('/api/register', { username: 'bobby', password: 'a'.repeat(73) })).status, 400);
    });

    test('3e SQL-like input does not break anything', async () => {
      await register(newClient());
      const before = app.locals.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      for (const attack of ["' OR '1'='1' --", "admin1'--", "'; DROP TABLE users; --", '" OR ""="']) {
        const l = await login(newClient(), { username: attack, password: attack });
        assert.equal(l.status, 401, `login ${attack}`);
        const r = await newClient().post('/api/register', { username: attack, password: 'ValidPass123' });
        assert.equal(r.status, 400, `register ${attack}`);
      }
      assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, before);
    });

    test('3f duplicate usernames are rejected, ignoring case', async () => {
      await register(newClient());
      const res = await newClient().post('/api/register', { username: 'ALICE', password: 'AnotherPass1!' });
      assert.equal(res.status, 409);
    });

    test('3g oversized body is rejected', async () => {
      const res = await newClient().post('/api/login', { username: 'a', password: 'p'.repeat(20000) });
      assert.equal(res.status, 413);
    });
  });

  // ---- 4. Storage, headers and error handling ----
  describe('4. Storage and errors', () => {
    test('4a passwords are stored as bcrypt hashes', async () => {
      await register(newClient());
      const { password_hash: stored } = app.locals.db
        .prepare("SELECT password_hash FROM users WHERE username = 'alice'").get();
      assert.ok(!stored.includes(USER.password));
      assert.match(stored, /^\$2[aby]\$\d\d\$/);
      assert.equal(stored.length, 60);
    });

    test('4b responses never contain password hashes', async () => {
      const c = await loggedIn(ADMIN, false);
      for (const url of ['/api/profile', '/api/admin/users', '/api/session']) {
        const text = (await c.get(url)).text.toLowerCase();
        assert.ok(!text.includes('password'), url);
        assert.ok(!text.includes('$2'), url);
      }
    });

    test('4c a cross-origin POST is blocked', async () => {
      const res = await newClient().post('/api/login', { username: 'a', password: 'b' }, { origin: 'https://evil.example' });
      assert.equal(res.status, 403);
    });

    test('4d security headers are set and the framework is not advertised', async () => {
      const res = await newClient().get('/api/public');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('x-powered-by'), null);
    });

    test('4e unknown routes return a clean JSON 404', async () => {
      const res = await newClient().get('/api/does-not-exist');
      assert.equal(res.status, 404);
      assert.deepEqual(res.data, { error: 'Not Found' });
    });

    test('4f an unexpected server error returns a generic 500 with no details', async () => {
      const c = await loggedIn();
      app.locals.db.close(); // force a failure inside the app
      const quiet = console.error;
      console.error = () => {};
      try {
        const res = await c.get('/api/profile');
        assert.equal(res.status, 500);
        assert.deepEqual(res.data, { error: 'Internal server error' });
        assert.ok(!/sqlite|database|stack|at /i.test(res.text));
      } finally {
        console.error = quiet;
      }
    });

    test('4g the app refuses to start without a strong SECRET_KEY', () => {
      assert.throws(() => createApp({ secretKey: 'too-short', databasePath: ':memory:' }), /SECRET_KEY/);
    });

    test('4h the pages and scripts are served', async () => {
      const page = await newClient().get('/');
      assert.equal(page.status, 200);
      assert.match(page.text, /Auth \+ RBAC Demo/);
      assert.equal((await newClient().get('/static/app.js')).status, 200);
      assert.equal((await newClient().get('/static/style.css')).status, 200);
    });
  });
});
