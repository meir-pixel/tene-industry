const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { ensureAuthSchema, migratePlaintextPins } = require('../auth-core');

const apply = process.argv.includes('--apply');
const dbPath = path.resolve(process.env.DB_PATH || './ironbend.db');
if (!fs.existsSync(dbPath)) {
  throw new Error(`[Auth migration] Database does not exist: ${dbPath}`);
}
const db = new Database(dbPath);

try {
  const columns = db.pragma('table_info(users)').map(row => row.name);
  const hasPinHash = columns.includes('pin_hash');
  const pending = db.prepare(
    hasPinHash
      ? "SELECT COUNT(*) AS count FROM users WHERE pin IS NOT NULL AND pin<>'' AND (pin_hash IS NULL OR pin_hash='')"
      : "SELECT COUNT(*) AS count FROM users WHERE pin IS NOT NULL AND pin<>''"
  ).get().count;
  if (!apply) {
    console.log(`[Auth migration] Dry run: ${pending} PIN values require hashing.`);
    console.log('[Auth migration] Re-run with --apply to create a backup and hash them.');
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${dbPath}.bak.auth-${stamp}`;
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
    fs.copyFileSync(dbPath, backupPath);
    ensureAuthSchema(db);
    const migrated = migratePlaintextPins(db);
    console.log(`[Auth migration] Backup: ${backupPath}`);
    console.log(`[Auth migration] Hashed ${migrated} PIN values. Plaintext PINs were retained for the 48-hour rollback window.`);
  }
} finally {
  db.close();
}
