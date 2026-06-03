'use strict';

// תקן ישראלי IS 193 / BS 4449 — משקל ק"ג למטר לכל קוטר
const REBAR_WEIGHTS = Object.freeze({
  5:  0.154,
  6:  0.222,
  8:  0.395,
  10: 0.617,
  12: 0.888,
  14: 1.21,
  16: 1.58,
  18: 2.00,
  20: 2.47,
  22: 2.98,
  25: 3.85,
  28: 4.83,
  32: 6.31,
  36: 7.99,
  40: 9.86,
});

// טבלה מורחבת — כולל קוטרים לא סטנדרטיים
const REBAR_KG_PER_M = Object.freeze({
  ...REBAR_WEIGHTS,
  24: 3.55,
  26: 4.17,
  30: 5.55,
  34: 7.13,
  38: 8.90,
  45: 12.48,
  50: 15.41,
});

// קוטרים תקניים תמיכה מלאה — לולידציה ו-OCR
const VALID_DIAMETERS = Object.freeze([6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40]);

/**
 * מחזיר ק"ג למטר לפי קוטר.
 * אם הקוטר לא בטבלה — מחשב לפי נוסחת ברזל עגול: d² × 0.00617
 */
function rebarKgPerMeter(diameter) {
  const d = Number(diameter);
  return REBAR_KG_PER_M[d] ?? (d * d * 0.00617);
}

module.exports = { REBAR_WEIGHTS, REBAR_KG_PER_M, VALID_DIAMETERS, rebarKgPerMeter };
