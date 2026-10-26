'use strict';

/*
 * Authentication + role-based access control (RBAC) with Express.
 *  - Passwords: bcrypt hashes (lib/passwords.js)
 *  - Login:     short-lived JWT in an HttpOnly cookie
 *  - RBAC:      enforced on the server for every protected route
 */

const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');

const { openDb, makeUserStore, isUniqueViolation } = require('./lib/db');
const { hashPassword, hashPasswordSync, verifyPassword, DUMMY_HASH } = require('./lib/passwords');
const { validateCredentials, credentialsFrom } = require('./lib/validation');
const { readCookie } = require('./lib/cookies');

const COOKIE_NAME = 'access_token';

function loadConfig() {
  return {
    secretKey: process.env.SECRET_KEY || '',
    databasePath: process.env.DATABASE_PATH || 'app.db',
    // Secure cookies by default; set COOKIE_SECURE=false only for plain-http local development.
    cookieSecure: String(process.env.COOKIE_SECURE || 'true').toLowerCase() !== 'false',
    tokenMinutes: parseInt(process.env.TOKEN_MINUTES || '30', 10),
    adminUsername: process.env.ADMIN_USERNAME || '',
    adminPassword: process.env.ADMIN_PASSWORD || '',
  };
}

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

// Express 4 does not catch errors thrown inside async handlers, so wrap them.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp(overrides = {}) {
  const cfg = { ...loadConfig(), ...overrides };
  if (cfg.secretKey.length < 32) {
    // Fail closed: refuse to start with a missing or weak signing key.
    throw new Error('SECRET_KEY must be set in the environment and be at least 32 characters. See .env.example.');
  }

  const db = openDb(cfg.databasePath);
  const users = makeUserStore(db);
  seedAdmin(users, cfg);

  const app = express();
  app.disable('x-powered-by'); // do not advertise "Express"
  app.locals.db = db;

  // ---------- tokens and guards ----------
  function issueToken(user) {
    return jwt.sign({ tv: user.token_version }, cfg.secretKey, {
      algorithm: 'HS256',
      subject: String(user.id),
      expiresIn: cfg.tokenMinutes * 60,
    });
  }

  /** Returns the logged-in user row, or null. The role always comes from the database. */
  function currentUser(req) {
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    if (!token) return null;
    let claims;
    try {
      claims = jwt.verify(token, cfg.secretKey, { algorithms: ['HS256'] }); // pinned: rejects "none"
    } catch {
      return null;
    }
    if (typeof claims.sub !== 'string' || !Number.isInteger(claims.tv) || typeof claims.exp !== 'number') {
      return null;
    }
    const id = Number(claims.sub);
    if (!Number.isInteger(id)) return null;
    const user = users.findById(id);
    if (!user || user.token_version !== claims.tv) return null; // unknown user, or logged out
    return user;
  }

  function requireLogin(req, res, next) {
    const user = currentUser(req);
    if (!user) return fail(res, 401, 'Authentication required');
    req.user = user;
    return next();
  }

  const requireRole = (role) => [
    requireLogin,
    (req, res, next) => (req.user.role === role ? next() : fail(res, 403, 'Forbidden')),
  ];

  // ---------- request/response hardening ----------
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
    });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });

  // CSRF defence in depth: JSON-only writes and an Origin check (plus SameSite=Lax cookies).
  app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      let originHost = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (originHost !== req.get('host')) return fail(res, 403, 'Cross-origin request blocked');
    }
    if (!req.is('application/json')) return fail(res, 415, 'Content-Type must be application/json');
    return next();
  });

  app.use(express.json({ limit: '16kb' }));

  // ---------- routes ----------
  app.use('/static', express.static(path.join(__dirname, 'public')));
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  app.get('/api/public', (req, res) => {
    res.json({ message: 'Public endpoint: anyone can read this.' });
  });

  app.get('/api/session', (req, res) => {
    const user = currentUser(req);
    if (!user) return res.json({ authenticated: false });
    return res.json({ authenticated: true, username: user.username, role: user.role });
  });

  app.post(
    '/api/register',
    wrap(async (req, res) => {
      const creds = credentialsFrom(req.body);
      if (!creds || !creds.username || !creds.password) {
        return fail(res, 400, 'Username and password are required');
      }
      const problem = validateCredentials(creds.username, creds.password);
      if (problem) return fail(res, 400, problem);
      try {
        // The role is never read from the request: every new account is 'user'.
        users.create({
          username: creds.username,
          passwordHash: await hashPassword(creds.password),
          role: 'user',
        });
      } catch (err) {
        if (isUniqueViolation(err)) return fail(res, 409, 'That username is not available');
        throw err;
      }
      return res.status(201).json({ username: creds.username, role: 'user' });
    })
  );

  app.post(
    '/api/login',
    wrap(async (req, res) => {
      const creds = credentialsFrom(req.body);
      if (!creds || !creds.username || !creds.password) {
        return fail(res, 400, 'Username and password are required');
      }
      const row = users.findByName(creds.username);
      const stored = row ? row.password_hash : DUMMY_HASH;
      const passwordOk = await verifyPassword(creds.password, stored);
      if (!row || !passwordOk) {
        // Same message and status for "no such user" and "wrong password".
        return fail(res, 401, 'Invalid username or password');
      }
      res.cookie(COOKIE_NAME, issueToken(row), {
        httpOnly: true,
        secure: cfg.cookieSecure,
        sameSite: 'lax',
        maxAge: cfg.tokenMinutes * 60 * 1000,
        path: '/',
      });
      return res.json({ username: row.username, role: row.role });
    })
  );

  app.post('/api/logout', (req, res) => {
    const user = currentUser(req);
    if (user) users.bumpTokenVersion(user.id); // old copies of the token stop working
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: cfg.cookieSecure,
      sameSite: 'lax',
      path: '/',
    });
    res.json({ message: 'Logged out' });
  });

  app.get('/api/profile', requireLogin, (req, res) => {
    const { id, username, role, created_at: createdAt } = req.user;
    res.json({ id, username, role, created_at: createdAt });
  });

  app.get('/api/admin/users', ...requireRole('admin'), (req, res) => {
    res.json({ users: users.list() });
  });

  // ---------- errors ----------
  app.use((req, res) => fail(res, 404, 'Not Found'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.too.large') return fail(res, 413, 'Request too large');
    if (err.type === 'entity.parse.failed') return fail(res, 400, 'Invalid JSON');
    console.error('Unhandled error:', err); // details stay in the server log
    return fail(res, 500, 'Internal server error');
  });

  return app;
}

/** Creates the first admin from environment variables (never hard-coded). */
function seedAdmin(users, cfg) {
  if (!cfg.adminUsername || !cfg.adminPassword) return;
  const problem = validateCredentials(cfg.adminUsername, cfg.adminPassword);
  if (problem) throw new Error(`ADMIN_USERNAME/ADMIN_PASSWORD rejected: ${problem}`);
  if (users.findByName(cfg.adminUsername)) return;
  try {
    users.create({
      username: cfg.adminUsername,
      passwordHash: hashPasswordSync(cfg.adminPassword),
      role: 'admin',
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err; // another process created it first
  }
}

module.exports = { createApp };
