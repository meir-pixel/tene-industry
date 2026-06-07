'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function snapshotDatabaseFiles(sourcePath, backupBase) {
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${sourcePath}${suffix}`;
    if (fs.existsSync(source)) fs.copyFileSync(source, `${backupBase}${suffix}`);
  }
}

function createDatabaseConnection({ env = process.env, rootDir = __dirname } = {}) {
  const dbPath = env.DB_PATH || path.join(rootDir, 'ironbend.db');
  const dbExistsAtStartup = fs.existsSync(dbPath);
  const skipStartupDbSnapshot = env.SKIP_STARTUP_DB_SNAPSHOT === 'true' && env.NODE_ENV !== 'production';

  if (env.NODE_ENV === 'production' && !dbExistsAtStartup && env.ALLOW_EMPTY_DB_INIT !== 'true') {
    throw new Error(`[DB Safety] Refusing to create a new production database at ${dbPath}. Verify the persistent disk mount or set ALLOW_EMPTY_DB_INIT=true only for the first intentional initialization.`);
  }

  if (dbExistsAtStartup && !skipStartupDbSnapshot) {
    const startupBackup = `${dbPath}.bak.startup`;
    snapshotDatabaseFiles(dbPath, startupBackup);
    console.log(`[DB Safety] Startup snapshot created: ${startupBackup}`);
  } else if (dbExistsAtStartup && skipStartupDbSnapshot) {
    console.log('[DB Safety] Startup snapshot skipped for local development.');
  }

  const db = new Database(dbPath);

  if (env.NODE_ENV === 'production' && dbExistsAtStartup && env.ALLOW_EMPTY_DB_INIT !== 'true') {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    if (!tables.has('orders')) {
      db.close();
      throw new Error(`[DB Safety] Refusing to initialize an empty production database at ${dbPath}. Verify that the expected persistent database is mounted.`);
    }
  }

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return {
    db,
    dbPath,
    dbExistsAtStartup,
    skipStartupDbSnapshot,
    snapshotDatabaseFiles,
  };
}

module.exports = {
  createDatabaseConnection,
  snapshotDatabaseFiles,
};
