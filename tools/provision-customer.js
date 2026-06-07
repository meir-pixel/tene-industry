#!/usr/bin/env node
'use strict';

/**
 * tools/provision-customer.js — הקמת לקוח חדש (צד-ספק Tene Industry)
 *
 * יוצר רישיון בשרת הרישיונות, מגריל סודות, ומדפיס בלוק env + צ'קליסט מוכנים ל-Render.
 *
 * שימוש:
 *   node tools/provision-customer.js --name "מפעל כהן" --module steel-rebar --domain cohen.ironbend.app
 *
 * משתני סביבה נדרשים:
 *   LICENSE_SERVER    — כתובת שרת הרישיונות (למשל https://tene-license.onrender.com)
 *   LICENSE_ADMIN_PW  — סיסמת ניהול שרת הרישיונות
 * אופציונלי:
 *   SUPPORT_PHONE     — טלפון תמיכה
 *   YEARS             — שנות תוקף רישיון (ברירת מחדל 1)
 */

const crypto = require('crypto');
const https  = require('https');
const http   = require('http');

// ── parse args ────────────────────────────────────────────────────
function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const name   = arg('--name');
const module_ = arg('--module', 'steel-rebar');
const domain = arg('--domain', '');
const phone  = arg('--phone', '');

if (!name) {
  console.error('שגיאה: חסר --name. דוגמה:');
  console.error('  node tools/provision-customer.js --name "מפעל כהן" --module steel-rebar --domain cohen.ironbend.app');
  process.exit(1);
}

const LICENSE_SERVER   = process.env.LICENSE_SERVER || 'https://tene-license.onrender.com';
const LICENSE_ADMIN_PW = process.env.LICENSE_ADMIN_PW || '';
const SUPPORT_PHONE    = process.env.SUPPORT_PHONE || '050-0000000';
const YEARS            = Number(process.env.YEARS || 1);

// ── secrets ───────────────────────────────────────────────────────
const licenseKey    = crypto.randomUUID();
const jwtSecret     = crypto.randomBytes(32).toString('hex');
const sessionSecret = crypto.randomBytes(32).toString('hex');
const expiresAt     = new Date(Date.now() + YEARS * 365 * 24 * 60 * 60 * 1000)
  .toISOString().slice(0, 10);

// ── create license on the server ──────────────────────────────────
function postForm(urlStr, form, basicPass) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = new URLSearchParams(form).toString();
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': 'Basic ' + Buffer.from('admin:' + basicPass).toString('base64'),
      },
      timeout: 12000,
    }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  let licenseCreated = false;
  if (LICENSE_ADMIN_PW) {
    try {
      const r = await postForm(`${LICENSE_SERVER}/admin/create`, {
        customer_name: name,
        customer_phone: phone,
        expires_at: expiresAt,
        license_key: licenseKey,
        notes: `provisioned ${new Date().toISOString().slice(0, 10)} | module=${module_}`,
      }, LICENSE_ADMIN_PW);
      licenseCreated = r.status >= 200 && r.status < 400;
      if (!licenseCreated) console.warn(`[אזהרה] שרת הרישיונות החזיר סטטוס ${r.status}`);
    } catch (e) {
      console.warn(`[אזהרה] לא ניתן ליצור רישיון בשרת (${e.message}). ה-env עדיין מודפס; צור רישיון ידנית.`);
    }
  } else {
    console.warn('[אזהרה] LICENSE_ADMIN_PW לא מוגדר — מדלג על יצירת רישיון. צור ידנית ב-/admin.');
  }

  const baseUrl = domain ? `https://${domain}` : 'https://CHANGE-ME.ironbend.app';

  const env = [
    'NODE_ENV=production',
    `LICENSE_KEY=${licenseKey}`,
    `LICENSE_SERVER=${LICENSE_SERVER}`,
    `JWT_SECRET=${jwtSecret}`,
    `SESSION_SECRET=${sessionSecret}`,
    `BASE_URL=${baseUrl}`,
    `ACTIVE_INDUSTRY_MODULE=${module_}`,
    'DB_PATH=/data/ironbend.db',
    'BACKUP_DIR=/data/backups',
    'ALLOW_EMPTY_DB_INIT=true',
    'ALLOW_DATABASE_UPLOAD=false',
    'AI_ENABLED=false',
    'INTAKE_AI_ENABLED=false',
    `SUPPORT_PHONE=${SUPPORT_PHONE}`,
  ].join('\n');

  console.log('\n════════════════════════════════════════════════');
  console.log(`✅ לקוח: ${name}`);
  console.log(`   רישיון: ${licenseCreated ? 'נוצר בשרת' : 'לא נוצר — ידני'}`);
  console.log(`   מודול: ${module_}   תוקף: ${expiresAt}`);
  console.log('════════════════════════════════════════════════');
  console.log('\n── הדבק ב-Render Environment ──\n');
  console.log(env);
  console.log('\n── צ\'קליסט ──');
  console.log('[ ] New → Web Service מהריפו');
  console.log('[ ] הדבק את ה-env למעלה');
  console.log('[ ] הוסף Disk: mountPath=/data, sizeGB=1');
  console.log('[ ] Deploy');
  console.log('[ ] ודא health ירוק → שנה ALLOW_EMPTY_DB_INIT ל-false → Deploy שוב');
  console.log('[ ] בדוק כניסה למערכת\n');
}

main().catch(e => { console.error(e); process.exit(1); });
