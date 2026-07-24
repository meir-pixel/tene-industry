const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashPin(pin, rounds = Number(process.env.BCRYPT_ROUNDS || 10)) {
  return pin ? bcrypt.hashSync(String(pin), Number(rounds)) : null;
}

function addColumn(db, table, column, definition) {
  const columns = db.pragma(`table_info(${table})`).map(row => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureAuthSchema(db) {
  addColumn(db, 'users', 'pin_hash', 'TEXT');
  addColumn(db, 'users', 'failed_attempts', 'INTEGER DEFAULT 0');
  addColumn(db, 'users', 'locked_until', 'DATETIME');
  addColumn(db, 'users', 'password_changed_at', 'DATETIME');
  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      revoked INTEGER DEFAULT 0,
      revoked_at DATETIME,
      user_agent TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, revoked);
  `);
}

function migratePlaintextPins(db, options = {}) {
  const rounds = Number(options.rounds || process.env.BCRYPT_ROUNDS || 10);
  const users = db.prepare(
    "SELECT id,pin FROM users WHERE pin IS NOT NULL AND pin<>'' AND (pin_hash IS NULL OR pin_hash='')"
  ).all();
  const update = db.prepare(
    'UPDATE users SET pin_hash=?,password_changed_at=COALESCE(password_changed_at,?) WHERE id=?'
  );
  const migratedAt = new Date().toISOString();
  db.transaction(() => {
    users.forEach(user => update.run(bcrypt.hashSync(String(user.pin), rounds), migratedAt, user.id));
  })();
  return users.length;
}

function createAuthService(db, options = {}) {
  const jwtSecret = options.jwtSecret || process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET is required');
  const rounds = Number(options.rounds || process.env.BCRYPT_ROUNDS || 10);
  const refreshDays = Number(options.refreshDays || process.env.REFRESH_TOKEN_DAYS || 7);
  const maxFailedAttempts = Number(options.maxFailedAttempts || 5);
  const lockMinutes = Number(options.lockMinutes || 15);
  const now = options.now || (() => new Date());

  // Access tokens are long-lived (default 3h) so an active shift never hits a
  // re-login prompt; the refresh cookie renews silently for longer gaps.
  const accessTokenTtl = options.accessTokenTtl || process.env.ACCESS_TOKEN_TTL || '3h';

  function accessTokenFor(user) {
    return jwt.sign(
      { sub: String(user.id), role: user.role, display_name: user.display_name },
      jwtSecret,
      { expiresIn: accessTokenTtl }
    );
  }

  function storeRefreshToken(userId, meta = {}) {
    const token = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(now().getTime() + refreshDays * 86400000).toISOString();
    db.prepare(
      'INSERT INTO refresh_tokens (user_id,token_hash,expires_at,user_agent,ip_address) VALUES (?,?,?,?,?)'
    ).run(userId, sha256(token), expiresAt, meta.userAgent || null, meta.ipAddress || null);
    return token;
  }

  function publicUser(user) {
    return { id: user.id, username: user.username, display_name: user.display_name, role: user.role };
  }

  function authenticate({ username, pin }, meta = {}) {
    if (!pin) return { ok: false, status: 400, error: 'PIN is required' };
    const candidates = username
      ? [db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username)].filter(Boolean)
      : db.prepare("SELECT * FROM users WHERE active=1 AND (pin_hash IS NOT NULL OR pin IS NOT NULL)").all();
    const user = candidates.find(candidate => candidate.pin_hash
      ? bcrypt.compareSync(String(pin), candidate.pin_hash)
      : String(candidate.pin) === String(pin));

    if (!user) {
      if (username && candidates[0]) recordFailure(candidates[0]);
      return { ok: false, status: 401, error: 'Invalid credentials' };
    }
    if (user.locked_until && new Date(user.locked_until) > now()) {
      return { ok: false, status: 423, error: 'Account is temporarily locked' };
    }
    if (!user.pin_hash) {
      db.prepare('UPDATE users SET pin_hash=?,password_changed_at=COALESCE(password_changed_at,?) WHERE id=?')
        .run(bcrypt.hashSync(String(pin), rounds), now().toISOString(), user.id);
    }
    db.prepare('UPDATE users SET failed_attempts=0,locked_until=NULL,last_login=? WHERE id=?')
      .run(now().toISOString(), user.id);
    return {
      ok: true,
      accessToken: accessTokenFor(user),
      refreshToken: storeRefreshToken(user.id, meta),
      user: publicUser(user),
    };
  }

  function recordFailure(user) {
    const failedAttempts = Number(user.failed_attempts || 0) + 1;
    const lockedUntil = failedAttempts >= maxFailedAttempts
      ? new Date(now().getTime() + lockMinutes * 60000).toISOString()
      : null;
    db.prepare('UPDATE users SET failed_attempts=?,locked_until=? WHERE id=?')
      .run(failedAttempts, lockedUntil, user.id);
  }

  function refresh(refreshToken, meta = {}) {
    if (!refreshToken) return { ok: false, status: 401, error: 'Refresh token is required' };
    const row = db.prepare(`
      SELECT rt.*,u.username,u.display_name,u.role,u.active
      FROM refresh_tokens rt JOIN users u ON u.id=rt.user_id
      WHERE rt.token_hash=? AND rt.revoked=0
    `).get(sha256(refreshToken));
    if (!row || !row.active || new Date(row.expires_at) <= now()) {
      return { ok: false, status: 401, error: 'Refresh token is invalid or expired' };
    }
    db.prepare('UPDATE refresh_tokens SET revoked=1,revoked_at=? WHERE id=?')
      .run(now().toISOString(), row.id);
    const user = { ...row, id: row.user_id };
    return {
      ok: true,
      accessToken: accessTokenFor(user),
      refreshToken: storeRefreshToken(row.user_id, meta),
      user: publicUser(user),
    };
  }

  function logout(refreshToken) {
    if (!refreshToken) return false;
    return db.prepare('UPDATE refresh_tokens SET revoked=1,revoked_at=? WHERE token_hash=? AND revoked=0')
      .run(now().toISOString(), sha256(refreshToken)).changes > 0;
  }

  return {
    authenticate,
    logout,
    refresh,
    verifyAccessToken: token => jwt.verify(token, jwtSecret),
  };
}

module.exports = { createAuthService, ensureAuthSchema, hashPin, migratePlaintextPins, sha256 };
