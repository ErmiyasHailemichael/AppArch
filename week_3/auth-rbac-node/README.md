# Authentication & RBAC (Node.js / Express)

AD371 Week 04 hands-on: registration, login, logout, and role-based access control (User / Admin) with server-side enforcement.

**Live URL:** https://auth-rbac-node.onrender.com
**Repo:** https://github.com/ErmiyasHailemichael/AppArch (folder `week_3/auth-rbac-node`)
**Stack:** Node.js 22+, Express, built-in `node:sqlite`, bcryptjs (password hashing), jsonwebtoken (HS256 token in an HttpOnly cookie). Plain HTML/JS frontend.

Note: the live site runs on Render's free tier, so the first request after idle can take about 30 seconds, and the database resets when the service restarts.

## Features

| Endpoint | Access | Behavior |
|---|---|---|
| `GET /api/public` | Anyone | Public info |
| `POST /api/register` | Anyone | Creates a **user** (role is never taken from the request) |
| `POST /api/login` | Anyone | Sets the `access_token` cookie; generic error on failure |
| `POST /api/logout` | Logged in | Invalidates the token server-side and clears the cookie |
| `GET /api/session` | Anyone | Shows who you are (or logged out) |
| `GET /api/profile` | Logged in | 401 if not logged in |
| `GET /api/admin/users` | Admin only | 401 if not logged in, 403 if not admin |

## Setup (local)

Requires Node **22.13 or newer** (check with `node --version`). The app uses Node's built-in `node:sqlite`, which Node 20 does not have.

```bash
cd week_3/auth-rbac-node
npm install
cp .env.example .env       
```

Edit `.env`:

- `SECRET_KEY`: at least 32 characters. Generate one:
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- `ADMIN_PASSWORD`: choose a strong password (8+ characters). The admin account (`ADMIN_USERNAME`) is created when the app starts, so restart the app after changing it.
- Keep `COOKIE_SECURE=false` for local http. Use `true` (the default) on https.

```bash
npm start                   # http://127.0.0.1:5000
npm test                    # automated QA suite (38 tests)
npm run inspect-db          # shows the users table with password hashes
```

## Deploy on Render

1. Push this repo to GitHub (`.env` and `*.db` are git-ignored).
2. Render → New → Web Service → connect the repo.
3. **Root Directory:** `week_3/auth-rbac-node`. Build command: `npm install`. Start command: `npm start`. Instance type: Free.
4. Environment variables: `NODE_VERSION=22`, `SECRET_KEY` (a new random value, different from local), `ADMIN_USERNAME`, `ADMIN_PASSWORD` (different from local). `COOKIE_SECURE` is left unset so it defaults to `true`.
5. The app binds to `0.0.0.0` automatically on Render.

## Security design

| Concern | What the code does |
|---|---|
| Password storage | bcrypt (12 rounds), salted per user; plaintext never stored or logged. Hashes start with `$2a$12$`. |
| Authentication | Signed JWT (HS256, algorithm pinned) in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie; 30 min expiry. |
| Authorization | Checked **on the server** for every protected route. The role is read from the database, never from the token or request body. |
| Logout | Bumps the user's `token_version`, so a copied old token stops working. |
| Login errors | One generic message for unknown user and wrong password; a dummy hash comparison keeps timing similar. |
| SQL injection | All queries are parameterized; usernames are validated by an allow-list regex. |
| CSRF | Origin must match Host; POST bodies must be JSON. |
| XSS | Frontend uses `textContent`; CSP `default-src 'self'`. |
| Information leaks | `X-Powered-By` removed; errors return a generic 500; `Cache-Control: no-store` on `/api/`. |

### Known limitations

- No rate limiting or account lockout (next step: `express-rate-limit`).
- No email verification or password reset.
- Free-tier SQLite is not persistent across restarts.
- Tokens are not refreshed; users log in again after 30 minutes.

## AI disclosure and prompt appendix

**Tool used:** Claude (Anthropic), in a chat session.

**What AI generated:** the app scaffold (server, database layer, frontend, tests) and the first draft of this README. I ran, tested, and deployed it myself.

**Prompts I used (in order):**

1. Act as a senior security engineer. Build a lightweight full-stack application (or REST API with a simple frontend) demonstrating basic Authentication and Role-Based Access Control (RBAC) using Node/Express.js 
2. Guide me how to delpoy on Render

**What I checked and found while auditing the output:**

- **Stack mismatch:** the first version used a stack I did not know (Flask). I caught that and had it rebuilt in Node/Express so I could understand and explain it.
- **Node version:** the app needs Node 22.13+ for `node:sqlite`. My machine had Node 20.20.1. I upgraded with `nvm install 22`, reinstalled, and re-ran the tests.
- **Test script bug:** the AI's first `npm test` script pointed at a folder, which Node 22 does not accept. It was changed to `tests/*.test.js`.
- **Login and roles (manual):** I confirmed a normal user gets 403 on the admin endpoint, a logged-out request gets 401, and only `admin` gets 200.
- **Passwords:** I confirmed with `npm run inspect-db` that both accounts store `$2a$12$...` bcrypt hashes, not passwords.
- **Cookie:** I confirmed in DevTools that the `access_token` cookie is HttpOnly, Secure, and SameSite=Lax on the live site.
- **Secrets:** the real secrets live in `.env` locally and in Render's environment variables; `.env` is not in the repo. The `SECRET_KEY` and `ADMIN_PASSWORD` on Render differ from the local ones.

## QA test summary

Automated (`npm test`, Node v22.23.4, real `express`, `bcryptjs` and `jsonwebtoken`): **38 tests, 38 pass, 0 fail.** `tests/lib.test.js` covers validation, cookies, and the database. `tests/qa.test.js` runs the full QA checklist against a running server. Timings omitted below.

```
✔ validation: accepts normal credentials
✔ validation: rejects bad usernames (SQL-like, spaces, too short, too long)
✔ validation: rejects short and over-72-byte passwords
✔ credentialsFrom: only accepts an object with two strings
✔ cookies: reads the named cookie, ignores others and junk
✔ db: create, find, list, and duplicate usernames (case-insensitive)
✔ db: list() never includes password hashes
✔ db: role column only allows user or admin
✔ db: SQL injection strings are treated as plain data
✔ db: token version increases (used to invalidate tokens on logout)
▶ QA checklist
  ▶ 1. Authentication
    ✔ 1a registration succeeds
    ✔ 1b login sets an HttpOnly session cookie
    ✔ 1c failed login error is generic (same for wrong password and unknown user)
    ✔ 1d logout removes the cookie and kills a copied token
    ✔ 1e cookie has the Secure flag when configured
  ▶ 2. Authorization
    ✔ 2a a user reaches the user dashboard
    ✔ 2b a user gets 403 on the admin endpoint
    ✔ 2c an admin reaches both user and admin endpoints
    ✔ 2d logged-out requests get 401
    ✔ 2e the public endpoint needs no login
    ✔ 2f registration cannot choose a role
    ✔ 2g forged and invalid tokens are rejected
    ✔ 2h role comes from the database, not from the token
  ▶ 3. Input validation
    ✔ 3a empty, missing or wrong-type credentials are rejected on the server
    ✔ 3b non-JSON body is rejected
    ✔ 3c malformed JSON is rejected cleanly
    ✔ 3d short and oversized passwords are rejected
    ✔ 3e SQL-like input does not break anything
    ✔ 3f duplicate usernames are rejected, ignoring case
    ✔ 3g oversized body is rejected
  ▶ 4. Storage and errors
    ✔ 4a passwords are stored as bcrypt hashes
    ✔ 4b responses never contain password hashes
    ✔ 4c a cross-origin POST is blocked
    ✔ 4d security headers are set and the framework is not advertised
    ✔ 4e unknown routes return a clean JSON 404
    ✔ 4f an unexpected server error returns a generic 500 with no details
    ✔ 4g the app refuses to start without a strong SECRET_KEY
    ✔ 4h the pages and scripts are served
ℹ tests 38   ℹ pass 38   ℹ fail 0
```

Manual checks, run locally and again on the live site:

| Check | Result |
|---|---|
| Register a user → 201, role is `user` | Pass |
| Log in as the user → session shows `authenticated: true` | Pass |
| User `GET /api/profile` → 200 | Pass |
| User `GET /api/admin/users` → 403 Forbidden | Pass |
| Logged-out `GET /api/admin/users` → 401 Authentication required | Pass |
| Logout → 200 | Pass |
| Admin `GET /api/admin/users` → 200 with user list, no hashes | Pass (local); live admin login confirmed |
| Wrong password → generic 401 "Invalid username or password" | Pass |
| DevTools: `access_token` is HttpOnly, Secure, SameSite=Lax (live site) | Pass |
| `npm run inspect-db`: passwords stored as `$2a$12$...` hashes (local DB) | Pass |