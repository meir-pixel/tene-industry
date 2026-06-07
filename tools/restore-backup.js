#!/usr/bin/env node
'use strict';

/**
 * tools/restore-backup.js — שחזור גיבוי לקוח (צד-ספק Tene Industry)
 *
 * מפענח קובץ גיבוי מוצפן (.db.enc) שהורד מפאנל הגיבוי, ומחזיר אותו ל-SQLite תקין.
 * חייב להשתמש באותו LICENSE_KEY + machineId שבהם הגיבוי הוצפן.
 *
 * פורמט הצפנה (תואם services/backup.js):
 *   key  = HMAC-SHA256(licenseKey).update(machineId)   → 32 bytes
 *   קובץ = [iv 16b][authTag 16b][ciphertext]           AES-256-GCM
 *
 * שימוש:
 *   node tools/restore-backup.js --in backup.db.enc --key <LICENSE_KEY> --machine <machineId> --out restored.db
 *
 * אם לא יודעים את ה-machineId: הוא נשמר ב-DB של הלקוח (settings: machine_id),
 * או מופיע בפאנל הרישיונות. בלעדיו אי אפשר לפענח — זו ההגנה.
 */

const fs     = require('fs');
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inPath  = arg('--in');
const licKey  = arg('--key');
const machine = arg('--machine');
const outPath = arg('--out', 'restored.db');
const verify  = process.argv.includes('--verify');

if (!inPath || !licKey || !machine) {
  console.error('שגיאה: חסרים פרמטרים. דוגמה:');
  console.error('  node tools/restore-backup.js --in backup.db.enc --key <LICENSE_KEY> --machine <machineId> --out restored.db');
  console.error('  הוסף --verify כדי לבדוק שה-DB המשוחזר תקין (דורש better-sqlite3).');
  process.exit(1);
}

function deriveKey(licenseKey, machineId) {
  return crypto.createHmac('sha256', licenseKey).update(machineId).digest();
}

function decrypt(buffer, key) {
  if (buffer.length < 32) throw new Error('קובץ קטן מדי / פגום');
  const iv         = buffer.subarray(0, 16);
  const authTag    = buffer.subarray(16, 32);
  const ciphertext = buffer.subarray(32);
  const decipher   = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

try {
  console.log(`[Restore] קורא ${inPath}...`);
  const enc = fs.readFileSync(inPath);
  const key = deriveKey(licKey, machine);

  console.log('[Restore] מפענח...');
  const plain = decrypt(enc, key);

  // ודא שזה SQLite אמיתי (חתימה: "SQLite format 3\0")
  const header = plain.subarray(0, 16).toString('latin1');
  if (!header.startsWith('SQLite format 3')) {
    throw new Error('הפענוח הצליח אבל זה לא קובץ SQLite תקין — בדוק key/machine');
  }

  fs.writeFileSync(outPath, plain);
  console.log(`[Restore] ✅ שוחזר: ${outPath} (${(plain.length / 1024).toFixed(0)} KB)`);

  if (verify) {
    console.log('[Restore] בודק תקינות DB...');
    const Database = require('better-sqlite3');
    const db = new Database(outPath, { readonly: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    const tables = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'").get().c;
    const orders = (() => { try { return db.prepare('SELECT COUNT(*) AS c FROM orders').get().c; } catch { return 'אין טבלת orders'; } })();
    db.close();
    console.log(`[Restore] integrity_check: ${integrity}`);
    console.log(`[Restore] טבלאות: ${tables} | הזמנות: ${orders}`);
    if (integrity !== 'ok') { console.error('[Restore] ⚠️ ה-DB פגום!'); process.exit(2); }
    console.log('[Restore] ✅ ה-DB תקין ומוכן לשימוש.');
  }
} catch (err) {
  console.error(`[Restore] ❌ ${err.message}`);
  process.exit(1);
}
