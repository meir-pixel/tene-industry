'use strict';

/**
 * tene-license-server
 *
 * שרת ניהול רישיונות וגיבויים — Tene Industry
 *
 * Endpoints:
 *   POST /api/check           ← בדיקת רישיון מאפליקציות לקוחות
 *   POST /api/backup/upload   ← קבלת גיבוי מוצפן מאפליקציות לקוחות
 *   GET  /admin               ← ממשק ניהול (מוגן בסיסמה)
 *
 * הגדרות (.env):
 *   ADMIN_PASSWORD   ← סיסמת ממשק הניהול
 *   PORT             ← ברירת מחדל: 4000
 *   BACKUP_DIR       ← ברירת מחדל: ./backups
 *   DB_PATH          ← ברירת מחדל: ./licenses.db
 */

// dotenv אופציונלי — בענן (Render) המשתנים מגיעים מההגדרות, אין קובץ .env
try { require('dotenv').config(); } catch {}
const express = require('express');
const multer  = require('multer');
const Database = require('better-sqlite3');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');

const PORT         = Number(process.env.PORT || 4000);
const ADMIN_PASS   = process.env.ADMIN_PASSWORD || 'changeme';
const BACKUP_DIR   = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
const DB_PATH      = process.env.DB_PATH    || path.join(__dirname, 'licenses.db');
const MAX_BACKUPS  = 30;

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ── DB ────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    id             INTEGER PRIMARY KEY,
    license_key    TEXT UNIQUE NOT NULL,
    customer_name  TEXT NOT NULL,
    customer_phone TEXT,
    machine_id     TEXT,
    expires_at     TEXT NOT NULL,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    revoked_at     TEXT,
    notes          TEXT
  );
  CREATE TABLE IF NOT EXISTS backups (
    id           INTEGER PRIMARY KEY,
    license_key  TEXT NOT NULL,
    filename     TEXT NOT NULL,
    size_bytes   INTEGER,
    uploaded_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    storage_path TEXT NOT NULL
  );
`);
// migration: סוג אחסון לכל גיבוי (disk | s3)
try { db.exec("ALTER TABLE backups ADD COLUMN storage_type TEXT DEFAULT 'disk'"); } catch {}

// שכבת אחסון — דיסק או ענן זול (S3/B2) לפי משתני סביבה
const { createStorage } = require('./storage');
const storage = createStorage(BACKUP_DIR);
console.log(`[Storage] mode: ${storage.type}`);

// ── Helpers ───────────────────────────────────────────────────────
function generateLicenseKey() {
  return crypto.randomUUID();
}

function getLicense(key) {
  return db.prepare('SELECT * FROM licenses WHERE license_key=?').get(key);
}

function isExpired(license) {
  return new Date(license.expires_at) < new Date();
}

function daysUntilExpiry(license) {
  return Math.ceil((new Date(license.expires_at) - new Date()) / (1000 * 60 * 60 * 24));
}

// ── App ───────────────────────────────────────────────────────────
const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiting (פשוט — ללא חבילות) ────────────────────────────
const checkCounts = new Map();
setInterval(() => checkCounts.clear(), 60 * 1000); // איפוס כל דקה
function rateLimit(req, res, next) {
  const ip = req.ip;
  const count = (checkCounts.get(ip) || 0) + 1;
  checkCounts.set(ip, count);
  if (count > 30) return res.status(429).json({ error: 'Too many requests' });
  next();
}

// ════════════════════════════════════════════════════════════════
// API — לאפליקציות הלקוחות
// ════════════════════════════════════════════════════════════════

// POST /api/check — בדיקת רישיון
app.post('/api/check', rateLimit, (req, res) => {
  const { licenseKey, machineId } = req.body;
  if (!licenseKey) return res.status(400).json({ valid: false, message: 'licenseKey required' });

  const lic = getLicense(licenseKey);
  if (!lic)            return res.json({ valid: false, message: 'רישיון לא קיים' });
  if (lic.revoked_at)  return res.json({ valid: false, message: 'הרישיון בוטל' });
  if (isExpired(lic))  return res.json({ valid: false, message: `הרישיון פג ב-${lic.expires_at}` });

  // קישור מכונה — בפעם הראשונה נשמר, בהמשך מאומת
  if (!lic.machine_id && machineId) {
    db.prepare('UPDATE licenses SET machine_id=? WHERE license_key=?').run(machineId, licenseKey);
  } else if (lic.machine_id && machineId && lic.machine_id !== machineId) {
    return res.json({ valid: false, message: 'הרישיון מחובר למחשב אחר. צור קשר עם Tene Industry.' });
  }

  res.json({
    valid:        true,
    expiresAt:    lic.expires_at,
    customerName: lic.customer_name,
    daysLeft:     daysUntilExpiry(lic),
  });
});

// POST /api/backup/upload — קבלת גיבוי מוצפן
app.post('/api/backup/upload', upload.single('file'), async (req, res) => {
  const licenseKey = req.headers['x-license-key'];
  const machineId  = req.headers['x-machine-id'];

  if (!licenseKey || !req.file) return res.status(400).json({ error: 'Missing license key or file' });

  const lic = getLicense(licenseKey);
  if (!lic || lic.revoked_at || isExpired(lic)) {
    return res.status(403).json({ error: 'Invalid or expired license' });
  }
  if (lic.machine_id && machineId && lic.machine_id !== machineId) {
    return res.status(403).json({ error: 'Machine mismatch' });
  }

  const filename = req.file.originalname || `backup_${Date.now()}.db.enc`;

  try {
    // שמירה דרך שכבת האחסון (דיסק או ענן)
    const saved = await storage.save(licenseKey, filename, req.file.buffer);

    db.prepare('INSERT INTO backups (license_key,filename,size_bytes,storage_path,storage_type) VALUES (?,?,?,?,?)')
      .run(licenseKey, filename, req.file.size, saved.path, saved.type);

    // שמור MAX_BACKUPS אחרונים בלבד
    const old = db.prepare(
      'SELECT id,storage_path,storage_type FROM backups WHERE license_key=? ORDER BY uploaded_at DESC LIMIT -1 OFFSET ?'
    ).all(licenseKey, MAX_BACKUPS);
    for (const row of old) {
      await storage.remove(row.storage_path, row.storage_type);
      db.prepare('DELETE FROM backups WHERE id=?').run(row.id);
    }

    res.json({ success: true, filename, size: req.file.size, storage: saved.type });
  } catch (err) {
    console.error('[Backup] upload failed:', err.message);
    res.status(500).json({ error: 'Backup storage failed' });
  }
});

// ════════════════════════════════════════════════════════════════
// ADMIN — ממשק ניהול
// ════════════════════════════════════════════════════════════════

// Basic Auth
function adminAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const b64  = auth.replace('Basic ', '');
  const [, pass] = Buffer.from(b64, 'base64').toString().split(':');
  if (pass === ADMIN_PASS) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="Tene Admin"');
  res.status(401).send('Authentication required');
}
app.use('/admin', adminAuth);

// GET /admin — לוח בקרה ראשי
app.get('/admin', (req, res) => {
  const licenses = db.prepare('SELECT * FROM licenses ORDER BY created_at DESC').all();
  const now = new Date();

  const rows = licenses.map(lic => {
    const days    = daysUntilExpiry(lic);
    const expired = isExpired(lic);
    const revoked = Boolean(lic.revoked_at);
    const lastBackup = db.prepare(
      'SELECT uploaded_at FROM backups WHERE license_key=? ORDER BY uploaded_at DESC LIMIT 1'
    ).get(lic.license_key);

    let status = '✅ פעיל';
    let color  = '#27ae60';
    if (revoked)       { status = '🔒 בוטל';  color = '#7f8c8d'; }
    else if (expired)  { status = '❌ פג';    color = '#e74c3c'; }
    else if (days <= 30) { status = `⚠️ ${days} ימים`; color = '#f39c12'; }

    return `
      <tr>
        <td><strong>${lic.customer_name}</strong><br><small>${lic.customer_phone || ''}</small></td>
        <td>${lic.expires_at}</td>
        <td style="color:${color}">${status}</td>
        <td>${lastBackup ? lastBackup.uploaded_at.slice(0,16) : '—'}</td>
        <td>
          ${!revoked ? `
            <form method="POST" action="/admin/extend/${lic.license_key}" style="display:inline">
              <input type="number" name="days" value="365" style="width:55px">
              <button>הארך</button>
            </form>
            <form method="POST" action="/admin/release-machine/${lic.license_key}" style="display:inline">
              <button onclick="return confirm('לשחרר מכונה?')">שחרר מכונה</button>
            </form>
            <form method="POST" action="/admin/revoke/${lic.license_key}" style="display:inline">
              <button style="color:red" onclick="return confirm('לבטל רישיון?')">בטל</button>
            </form>
          ` : ''}
          <a href="/admin/backups/${lic.license_key}">גיבויים</a>
        </td>
      </tr>`;
  }).join('');

  res.send(`<!DOCTYPE html><html dir="rtl" lang="he">
  <head><meta charset="UTF-8"><title>Tene License Admin</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
    h1 { color: #e07b39; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; }
    th { background: #e07b39; color: white; padding: 10px; text-align: right; }
    td { padding: 10px; border-bottom: 1px solid #eee; }
    button { background: #e07b39; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; margin: 2px; }
    a { color: #e07b39; }
    .new-btn { background: #27ae60; color: white; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; margin-bottom: 20px; }
  </style></head>
  <body>
    <h1>🔑 Tene Industry — ניהול רישיונות</h1>
    <a href="/admin/new"><button class="new-btn">+ רישיון חדש</button></a>
    <table>
      <tr><th>לקוח</th><th>תוקף</th><th>סטטוס</th><th>גיבוי אחרון</th><th>פעולות</th></tr>
      ${rows || '<tr><td colspan="5" style="text-align:center">אין רישיונות</td></tr>'}
    </table>
  </body></html>`);
});

// GET /admin/new — טופס רישיון חדש
app.get('/admin/new', (req, res) => {
  const key = generateLicenseKey();
  const defaultExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  res.send(`<!DOCTYPE html><html dir="rtl" lang="he">
  <head><meta charset="UTF-8"><title>רישיון חדש</title>
  <style>body{font-family:Arial;padding:20px} input,textarea{width:100%;padding:8px;margin:5px 0 15px;border:1px solid #ccc;border-radius:4px} button{background:#27ae60;color:white;padding:10px 20px;border:none;border-radius:6px;cursor:pointer;font-size:16px}</style></head>
  <body>
    <h2>רישיון חדש</h2>
    <form method="POST" action="/admin/create">
      <label>שם לקוח</label><input name="customer_name" required>
      <label>טלפון</label><input name="customer_phone" type="tel">
      <label>תוקף עד</label><input name="expires_at" type="date" value="${defaultExpiry}" required>
      <label>הערות</label><textarea name="notes" rows="2"></textarea>
      <label>מפתח רישיון (נוצר אוטומטית)</label>
      <input name="license_key" value="${key}" readonly style="background:#f9f9f9;font-family:monospace">
      <button type="submit">צור רישיון</button>
    </form>
  </body></html>`);
});

// POST /admin/create
app.post('/admin/create', (req, res) => {
  const { license_key, customer_name, customer_phone, expires_at, notes } = req.body;
  if (!license_key || !customer_name || !expires_at) {
    return res.status(400).send('חסרים פרטים');
  }
  db.prepare('INSERT INTO licenses (license_key,customer_name,customer_phone,expires_at,notes) VALUES (?,?,?,?,?)')
    .run(license_key, customer_name, customer_phone || null, expires_at, notes || null);

  res.send(`<!DOCTYPE html><html dir="rtl" lang="he">
  <head><meta charset="UTF-8"><title>רישיון נוצר</title>
  <style>body{font-family:Arial;padding:20px} .key{font-family:monospace;font-size:18px;background:#f0f0f0;padding:15px;border-radius:6px;word-break:break-all} button{background:#e07b39;color:white;padding:10px 20px;border:none;border-radius:6px;cursor:pointer}</style></head>
  <body>
    <h2>✅ רישיון נוצר בהצלחה</h2>
    <p><strong>לקוח:</strong> ${customer_name}</p>
    <p><strong>תוקף עד:</strong> ${expires_at}</p>
    <p><strong>מפתח לשים ב-.env של הלקוח:</strong></p>
    <div class="key">LICENSE_KEY=${license_key}</div>
    <br>
    <a href="/admin"><button>חזרה לרשימה</button></a>
  </body></html>`);
});

// POST /admin/extend/:key
app.post('/admin/extend/:key', (req, res) => {
  const lic  = getLicense(req.params.key);
  if (!lic) return res.status(404).send('לא נמצא');
  const days = Number(req.body.days) || 365;
  const base = isExpired(lic) ? new Date() : new Date(lic.expires_at);
  const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  db.prepare('UPDATE licenses SET expires_at=?, revoked_at=NULL WHERE license_key=?').run(newExpiry, req.params.key);
  res.redirect('/admin');
});

// POST /admin/revoke/:key
app.post('/admin/revoke/:key', (req, res) => {
  db.prepare('UPDATE licenses SET revoked_at=CURRENT_TIMESTAMP WHERE license_key=?').run(req.params.key);
  res.redirect('/admin');
});

// POST /admin/release-machine/:key — שחרור קישור מכונה
app.post('/admin/release-machine/:key', (req, res) => {
  db.prepare('UPDATE licenses SET machine_id=NULL WHERE license_key=?').run(req.params.key);
  res.redirect('/admin');
});

// GET /admin/backups/:key — רשימת גיבויים ללקוח
app.get('/admin/backups/:key', (req, res) => {
  const lic     = getLicense(req.params.key);
  if (!lic) return res.status(404).send('לא נמצא');
  const backups = db.prepare('SELECT * FROM backups WHERE license_key=? ORDER BY uploaded_at DESC').all(req.params.key);

  const rows = backups.map(b => `
    <tr>
      <td>${b.uploaded_at.slice(0,16)}</td>
      <td>${b.filename}</td>
      <td>${(b.size_bytes / 1024).toFixed(0)} KB</td>
      <td><a href="/admin/backup/${b.id}">הורד</a></td>
    </tr>`).join('');

  res.send(`<!DOCTYPE html><html dir="rtl" lang="he">
  <head><meta charset="UTF-8"><title>גיבויים — ${lic.customer_name}</title>
  <style>body{font-family:Arial;padding:20px} table{width:100%;border-collapse:collapse;background:white} th{background:#e07b39;color:white;padding:8px} td{padding:8px;border-bottom:1px solid #eee} a{color:#e07b39}</style></head>
  <body>
    <h2>גיבויים — ${lic.customer_name}</h2>
    <a href="/admin">← חזרה</a>
    <br><br>
    <table>
      <tr><th>תאריך</th><th>קובץ</th><th>גודל</th><th>הורדה</th></tr>
      ${rows || '<tr><td colspan="4" style="text-align:center">אין גיבויים</td></tr>'}
    </table>
  </body></html>`);
});

// GET /admin/backup/:id — הורדת גיבוי
app.get('/admin/backup/:id', async (req, res) => {
  const backup = db.prepare('SELECT * FROM backups WHERE id=?').get(req.params.id);
  if (!backup) return res.status(404).send('לא נמצא');
  try {
    const buf = await storage.getBuffer(backup.storage_path, backup.storage_type || 'disk');
    if (!buf) return res.status(404).send('לא נמצא');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
    res.send(buf);
  } catch (err) {
    console.error('[Backup] download failed:', err.message);
    res.status(500).send('שגיאה בהורדת הגיבוי');
  }
});

// ════════════════════════════════════════════════════════════════
// CRON — התראות 30 יום לפני פקיעה
// ════════════════════════════════════════════════════════════════
function checkExpiringLicenses() {
  const expiring = db.prepare(`
    SELECT * FROM licenses
    WHERE revoked_at IS NULL
      AND date(expires_at) BETWEEN date('now') AND date('now', '+30 days')
  `).all();

  expiring.forEach(lic => {
    const days = daysUntilExpiry(lic);
    console.log(`[License] ⚠️  ${lic.customer_name} — פג תוך ${days} ימים (${lic.expires_at})`);
    // TODO: שלח WA אליך — process.env.TENE_NOTIFY_PHONE
    // כשמחברים intake.sendWhatsApp — להוסיף כאן
  });
}

// בדיקה כל יום ב-09:00
setInterval(() => {
  const hour = new Date().getHours();
  if (hour === 9) checkExpiringLicenses();
}, 60 * 60 * 1000); // כל שעה

// ── Health check ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const total   = db.prepare('SELECT COUNT(*) as c FROM licenses').get().c;
  const active  = db.prepare("SELECT COUNT(*) as c FROM licenses WHERE revoked_at IS NULL AND expires_at > date('now')").get().c;
  res.json({ ok: true, total, active });
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Tene License Server`);
  console.log(`   Admin: http://localhost:${PORT}/admin`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
  checkExpiringLicenses(); // בדיקה בהפעלה
});

module.exports = app;
