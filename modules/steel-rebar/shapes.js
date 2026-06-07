'use strict';

/**
 * נורמליזציה של צלעות לפי שם הצורה.
 * מטרה: לוודא שסדר הצלעות תואם לאופן הכיפוף הפיזי.
 *
 * קודים מטופלים:
 *   open U / hook / anchor   — חפיפה פתוחה, 3 צלעות
 *   closed stirrup / overlap — אחוזה סגורה עם חפיפה 90°, 6 צלעות
 */
function normalizeFactorySegments(shapeName, sourceSegments) {
  const segments = (sourceSegments || []).map(s => ({ ...s }));
  const shape = String(shapeName || '').toLowerCase();
  const isOpenU = /open|hook|anchor|closed|stirrup|overlap|אנקר|פתוח|צורת ח|חפיפה|אצבע|מסגרת|\bu\b/.test(shape);
  const isClosedOverlap = /closed|stirrup|overlap|חפיפה|אצבע|מסגרת/.test(shape);

  if (isOpenU && segments.length === 3) {
    const [a, b, c] = segments.map(s => Number(s.length_mm) || 0);
    if (a === b && b !== c) {
      return [
        { ...segments[0], angle_deg: 90 },
        { ...segments[2], angle_deg: 90 },
        { ...segments[1], angle_deg: segments[1].angle_deg ?? 0 },
      ];
    }
    if (b === c && a !== b) {
      return [
        { ...segments[1], angle_deg: 90 },
        { ...segments[0], angle_deg: 90 },
        { ...segments[2], angle_deg: segments[2].angle_deg ?? 0 },
      ];
    }
  }

  if (isClosedOverlap && segments.length === 6) {
    const [a, b, c, d, e, f] = segments.map(s => Number(s.length_mm) || 0);
    if (a === c && b === d && e === f && e < Math.max(a, b)) {
      return [segments[4], segments[0], segments[1], segments[2], segments[3], segments[5]];
    }
  }

  return segments;
}

/**
 * נורמליזציה של שם צורה לשם קנוני של המפעל.
 */
function normalizeFactoryShapeName(shapeName, segments) {
  const shape = String(shapeName || '');
  const lower = shape.toLowerCase();
  const lengths = (segments || []).map(s => Number(s.length_mm) || 0);
  const isSpiralOrRing = /spiral|ring|coil|ספיר|טבעת|סליל|לולאה/.test(lower);
  const isFactory = /open|hook|anchor|closed|stirrup|overlap|אנקר|פתוח|צורת ח|חפיפה|אצבע|מסגרת|\bu\b/.test(lower);

  if (isSpiralOrRing && lengths.length <= 1) return 'straight bar';
  if (isFactory && lengths.length === 3 && lengths[0] === lengths[2]) return 'open U-shaped bar';
  if (isFactory && lengths.length === 6 && lengths[0] === lengths[5]) return 'closed stirrup 90-degree overlap';
  return shape;
}

module.exports = { normalizeFactorySegments, normalizeFactoryShapeName };
