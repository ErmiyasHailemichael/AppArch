'use strict';

// Prints the users table so you can show that passwords are stored as hashes.
// Usage:  npm run inspect-db

try {
  process.loadEnvFile();
} catch {
  /* no .env file: fine */
}

const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const file = process.env.DATABASE_PATH || 'app.db';
if (!fs.existsSync(file)) {
  console.error(`No database at ${file}. Start the app once first.`);
  process.exit(1);
}

const db = new DatabaseSync(file);
console.log(`Database: ${file}\n`);
console.log('id'.padEnd(4) + 'username'.padEnd(18) + 'role'.padEnd(8) + 'password_hash');
console.log('-'.repeat(90));
for (const row of db.prepare('SELECT id, username, role, password_hash FROM users ORDER BY id').all()) {
  console.log(String(row.id).padEnd(4) + row.username.padEnd(18) + row.role.padEnd(8) + row.password_hash);
}
db.close();
