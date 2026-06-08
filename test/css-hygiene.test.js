'use strict';

/**
 * test/css-hygiene.test.js
 *
 * שומר היגיינת frontend — "מקור אחד לכל סלקטור".
 *
 * 1. אכיפה קשה: רכיב הניווט/חיפוש (#ib-* / .ib-*) מוגדר רק ב-nav.js.
 *    מסך שמגדיר אותו ב-<style> שלו = התנגשות (זה הבאג שפתח את חלון
 *    החיפוש אוטומטית). הבדיקה נכשלת אם זה חוזר.
 *
 * 2. דיווח (לא נכשל): רכיבים משותפים (.btn .card .tab-btn ...) שמוגדרים
 *    מחדש בכמה מסכים — רשימת ניקוי מצטמצמת. מודפס, לא שובר build.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');

function htmlFiles() {
  return fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'));
}

// מחלץ את תוכן כל בלוקי <style> בקובץ, ללא הערות CSS
function styleCss(file) {
  const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
  return blocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, ''); // הסר הערות
}

// סלקטורים מובהקים (id/class) שמופיעים לפני '{'
function selectorsIn(css) {
  const found = new Set();
  for (const m of css.matchAll(/([#.][A-Za-z0-9_-]+)[^{};]*\{/g)) {
    found.add(m[1]);
  }
  return found;
}

// ── 1. אכיפה קשה: ניווט = בעל יחיד (nav.js) ──────────────────────
test('css-hygiene: no screen redefines nav/search component (#ib-* / .ib-*)', () => {
  const offenders = [];
  for (const file of htmlFiles()) {
    const css = styleCss(file);
    const sels = selectorsIn(css);
    const ib = [...sels].filter(s => /^[#.]ib-/.test(s));
    if (ib.length) offenders.push(`${file}: ${ib.join(', ')}`);
  }
  assert.deepStrictEqual(
    offenders, [],
    `סגנון ניווט/חיפוש (#ib-*) חייב להיות רק ב-nav.js. נמצא במסכים:\n${offenders.join('\n')}`
  );
});

// ── 2. דיווח: רכיבים משותפים שמוגדרים בכמה מסכים ─────────────────
test('css-hygiene: report shared components duplicated across screens', () => {
  const SHARED = ['.btn', '.card', '.tab-btn', '.tabs', '.table-wrap', '.modal', '.badge', '.field'];
  const counts = {};
  for (const file of htmlFiles()) {
    const sels = selectorsIn(styleCss(file));
    for (const s of SHARED) if (sels.has(s)) (counts[s] ??= []).push(file);
  }
  const dup = Object.entries(counts).filter(([, files]) => files.length >= 2);
  if (dup.length) {
    console.log('\n[css-hygiene] רכיבים משותפים מוגדרים בכמה מסכים (מועמדים ל-theme.css):');
    for (const [sel, files] of dup) console.log(`  ${sel} — ${files.length} מסכים`);
  }
  // דיווח בלבד — לא שובר build (ניקוי הדרגתי)
  assert.ok(true);
});
