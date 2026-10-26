'use strict';

// Load .env for local development. Hosts like Render set real environment variables instead.
try {
  process.loadEnvFile();
} catch {
  /* no .env file: fine */
}

const { createApp } = require('./app');

const app = createApp();
const port = parseInt(process.env.PORT || '5000', 10);
// Render sets RENDER=true and needs the server reachable from outside the container.
const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');

app.listen(port, host, () => {
  console.log(`Listening on http://${host}:${port}`);
});
