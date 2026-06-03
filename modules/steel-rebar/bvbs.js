'use strict';

const { rebarKgPerMeter } = require('./weights');

/**
 * פרסר BVBS — פורמט תקני גרמני/ישראלי לקבצי כיפוף ברזל.
 * מקור: routes/bvbs.js — הועבר לכאן כדי שיהיה שייך למודול הפלדה.
 */
function parseBVBSLine(line) {
  line = line.trim();
  if (!line.startsWith('@3') && !line.startsWith('@')) return null;

  const item = {};
  const parts = line.split('^');

  for (const part of parts) {
    if (!part || part === '!' || part.startsWith('@')) continue;

    const m = part.match(/^([a-zA-Z]+)(.+)$/);
    if (!m) {
      // בלוק גיאומטריה [A 500 B 1800 ...]
      const geoM = part.match(/\[([^\]]+)\]/);
      if (geoM) {
        const legs = [];
        const tokens = geoM[1].trim().split(/\s+/);
        for (let i = 0; i < tokens.length - 1; i += 2) {
          const label = tokens[i];
          const len = parseFloat(tokens[i + 1]);
          if (!isNaN(len)) legs.push({ label, length: len });
        }
        item.legs  = legs;
        item.sides = legs.map(l => l.length);
      }
      continue;
    }

    const [, key, val] = m;
    switch (key.toLowerCase()) {
      case 'd':  item.diameter     = parseFloat(val); break;
      case 'l':  item.total_length = parseFloat(val); break;
      case 'n':  item.mark         = val; break;
      case 'p':  item.quantity     = parseInt(val, 10) || 1; break;
      case 'a':  item.shape_code   = val; break;
      case 'r':
        item.grade_code = val;
        item.grade = val === '1' ? 'B500B' : val === '2' ? 'B500C' : 'B500B';
        break;
      case 'w':
        if (!item.angles) item.angles = [];
        item.angles.push(parseFloat(val));
        break;
    }
  }

  if (!item.diameter || !item.quantity) return null;

  const kgPerM = rebarKgPerMeter(item.diameter);
  item.weight_per_unit = (item.total_length / 1000) * kgPerM;
  item.total_weight    = item.weight_per_unit * item.quantity;
  return item;
}

function parseBVBS(content) {
  const lines = content.split(/\r?\n/);
  const items = [];
  let header = {};

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (t.startsWith('@1') || t.startsWith('@2')) {
      const parts = t.split('^');
      for (const p of parts) {
        const m = p.match(/^([A-Za-z]+)(.+)$/);
        if (!m) continue;
        if (m[1].toLowerCase() === 'bs') header.project  = m[2];
        if (m[1].toLowerCase() === 'kd') header.customer = m[2];
        if (m[1].toLowerCase() === 'da') header.date     = m[2];
      }
      continue;
    }

    const item = parseBVBSLine(t);
    if (item) items.push(item);
  }

  return {
    header,
    items,
    total_weight: items.reduce((s, i) => s + i.total_weight, 0),
  };
}

module.exports = { parseBVBS, parseBVBSLine };
