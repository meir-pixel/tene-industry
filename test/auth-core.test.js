const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { createAuthService, ensureAuthSchema, migratePlaintextPins } = require('../auth-core');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT DEFAULT 'operator',
      pin TEXT,
      active INTEGER DEFAULT 1,
      last_login DATETIME
    );
    INSERT INTO users (username,display_name,role,pin) VALUES ('admin','Admin','admin','1234');
  `);
  ensureAuthSchema(db);
  return db;
}

test('PIN migration hashes values but retains plaintext for rollback', () => {
  const db = makeDb();
  assert.equal(migratePlaintextPins(db, { rounds: 4 }), 1);
  const user = db.prepare('SELECT pin,pin_hash FROM users WHERE username=?').get('admin');
  assert.equal(user.pin, '1234');
  assert.equal(bcrypt.compareSync('1234', user.pin_hash), true);
  db.close();
});

test('login issues JWT and rotating refresh token', () => {
  const db = makeDb();
  migratePlaintextPins(db, { rounds: 4 });
  const auth = createAuthService(db, { jwtSecret: 'test-secret', rounds: 4 });
  const login = auth.authenticate({ username: 'admin', pin: '1234' });
  assert.equal(login.ok, true);
  assert.equal(auth.verifyAccessToken(login.accessToken).role, 'admin');
  const refreshed = auth.refresh(login.refreshToken);
  assert.equal(refreshed.ok, true);
  assert.notEqual(refreshed.refreshToken, login.refreshToken);
  assert.equal(auth.refresh(login.refreshToken).ok, false);
  db.close();
});

test('five invalid PIN attempts lock account', () => {
  const db = makeDb();
  migratePlaintextPins(db, { rounds: 4 });
  const auth = createAuthService(db, { jwtSecret: 'test-secret', rounds: 4 });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(auth.authenticate({ username: 'admin', pin: '0000' }).ok, false);
  }
  assert.equal(auth.authenticate({ username: 'admin', pin: '1234' }).status, 423);
  db.close();
});
