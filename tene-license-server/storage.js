'use strict';

/**
 * storage.js — שכבת אחסון גיבויים
 *
 * שני מצבים:
 *   disk  — ברירת מחדל. שומר על הדיסק המקומי (BACKUP_DIR). פשוט, מוגבל בנפח.
 *   s3    — אחסון ענן תואם S3 (Backblaze B2 / AWS S3 / כל ספק תואם).
 *           זול, גדל ללא הגבלה. מופעל אם כל משתני S3 מוגדרים.
 *
 * משתני סביבה ל-S3 (אם ריקים → מצב disk):
 *   S3_BUCKET       — שם הדלי
 *   S3_ENDPOINT     — כתובת השירות (למשל https://s3.us-west-004.backblazeb2.com)
 *   S3_ACCESS_KEY   — מפתח גישה
 *   S3_SECRET_KEY   — מפתח סודי
 *   S3_REGION       — אזור (ברירת מחדל: auto)
 */

const fs   = require('fs');
const path = require('path');

const S3_ENABLED = Boolean(
  process.env.S3_BUCKET &&
  process.env.S3_ENDPOINT &&
  process.env.S3_ACCESS_KEY &&
  process.env.S3_SECRET_KEY
);

let s3 = null;
let PutObjectCommand, GetObjectCommand, DeleteObjectCommand;
const S3_BUCKET = process.env.S3_BUCKET;

if (S3_ENABLED) {
  const aws = require('@aws-sdk/client-s3');
  ({ PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = aws);
  s3 = new aws.S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region:   process.env.S3_REGION || 'auto',
    credentials: {
      accessKeyId:     process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
    forcePathStyle: true, // נדרש ל-Backblaze B2 ולרוב הספקים התואמים
  });
}

function createStorage(backupDir) {
  const activeType = S3_ENABLED ? 's3' : 'disk';

  // שמירת גיבוי — מחזיר { path, type }
  async function save(licenseKey, filename, buffer) {
    if (S3_ENABLED) {
      const key = `${licenseKey}/${filename}`;
      await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: buffer }));
      return { path: key, type: 's3' };
    }
    const dir = path.join(backupDir, licenseKey);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buffer);
    return { path: filePath, type: 'disk' };
  }

  // קריאת גיבוי — מחזיר Buffer או null
  async function getBuffer(storagePath, type) {
    if (type === 's3') {
      if (!s3) return null;
      const out = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: storagePath }));
      const chunks = [];
      for await (const chunk of out.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    }
    if (!fs.existsSync(storagePath)) return null;
    return fs.readFileSync(storagePath);
  }

  // מחיקת גיבוי ישן
  async function remove(storagePath, type) {
    if (type === 's3') {
      if (!s3) return;
      try { await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: storagePath })); } catch {}
      return;
    }
    try { fs.unlinkSync(storagePath); } catch {}
  }

  return { type: activeType, save, getBuffer, remove };
}

module.exports = { createStorage, S3_ENABLED };
