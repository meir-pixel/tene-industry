'use strict';

const MAX_DIAMETER_DECIMAL_PLACES = 3;

function normalizeDiameter(value) {
  let text;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim().replace(/\s+/g, '').replace(/^Ø/i, '').replace(',', '.');
  } else {
    return null;
  }

  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2] && match[2].length > MAX_DIAMETER_DECIMAL_PLACES)) return null;
  const integer = String(Number(match[1]));
  const fraction = (match[2] || '').replace(/0+$/, '');
  const key = fraction ? `${integer}.${fraction}` : integer;
  const numeric = Number(key);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100) return null;
  return { key, numeric, display: `Ø${key}` };
}

function seedLegacyDiameterCatalog(db) {
  const rows = db.prepare('SELECT DISTINCT diameter FROM raw_material WHERE diameter IS NOT NULL').all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO diameter_catalog (diameter_key, diameter_display, status, source)
    VALUES (?, ?, 'active', 'legacy')
  `);
  for (const row of rows) {
    const diameter = normalizeDiameter(row.diameter);
    if (diameter) insert.run(diameter.key, diameter.display);
  }
}

module.exports = {
  MAX_DIAMETER_DECIMAL_PLACES,
  normalizeDiameter,
  seedLegacyDiameterCatalog,
};
