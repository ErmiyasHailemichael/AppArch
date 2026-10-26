# Authentication & RBAC (Node.js / Express)

AD371 Week 04 hands-on: registration, login, logout, and role-based access control (User / Admin) with server-side enforcement.

**Live URL:** `<paste your Render URL here>`
**Stack:** Node.js 22+, Express, built-in `node:sqlite`, bcryptjs (password hashing), jsonwebtoken (HS256 token in an HttpOnly cookie). Plain HTML/JS frontend.

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

Requires Node **22.13 or newer** (check with `node --version`).

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env`:

- `SECRET_KEY`: at least 32 characters. Generate one:
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- `ADMIN_PASSWORD`: choose a strong password. The admin account (`ADMIN_USERNAME`) is created at startup.
- Keep `COOKIE_SECURE=false` for local http. Use `true` (the default) on https.

```bash
npm start                   # http://127.0.0.1:5000
npm test                    # automated QA suite
npm run inspect-db          # shows the users table with password hashes
```

## Deploy on Render

1. Push this repo to GitHub (`.env` and `*.db` are git-ignored).
2. Render → New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Environment variables: `SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (leave `COOKIE_SECURE` unset so it defaults to `true`). Optionally set the `NODE_VERSION` variable to `22`.
5. The app binds to `0.0.0.0` automatically on Render.

Note: on the free tier the disk is ephemeral, so the SQLite file resets when the service restarts. Registered users disappear; the admin is re-created at startup.

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

- No rate limiting or account lockout (would be next with `express-rate-limit`).
- No email verification or password reset.
- Free-tier SQLite is not persistent.

## AI disclosure and prompt appendix

**Tool used:** Claude (Anthropic).

**What AI generated:** the initial app scaffold, test suite, and this README draft.

**Prompts I used** (paste your real prompts here):

1. `<prompt 1>`
2. `<prompt 2>`
3. `<prompt 3>`

**My audit of the AI output** (fill in what you personally checked and changed, for example: confirmed role is read from the DB, confirmed queries are parameterized, confirmed the JWT algorithm is pinned, confirmed errors do not leak stack traces):

- `<finding 1>`
- `<finding 2>`
- `<finding 3>`

## QA test summary

Automated: `npm test` runs `tests/lib.test.js` (validation, cookies, database) and `tests/qa.test.js` (the full QA checklist against a running server: registration, login, hashing, RBAC 401/403, logout, injection strings, headers, error handling).

```
<paste your npm test output here>
```

Manual (shown in the video):

| Check | Result |
|---|---|
| Register and log in as a user | `<pass/fail>` |
| User visits `/api/admin/users` → 403 | `<pass/fail>` |
| Logged-out visit to `/api/profile` → 401 | `<pass/fail>` |
| Admin visits `/api/admin/users` → 200 | `<pass/fail>` |
| DevTools: cookie is HttpOnly | `<pass/fail>` |
| `npm run inspect-db`: passwords are hashes | `<pass/fail>` |
