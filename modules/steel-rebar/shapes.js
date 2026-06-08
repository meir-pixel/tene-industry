'use strict';

function shapeText(value) {
  return String(value || '').toLowerCase();
}

function toLengths(segments) {
  return (segments || []).map(segment => Number(segment.length_mm) || 0);
}

function isKnownOpenUName(shape) {
  return /open|hook|anchor|צורת ח|צורת u|פתוח|פתוחה|\bu\b/.test(shape);
}

function isKnownFactoryName(shape) {
  return /open|hook|anchor|closed|stirrup|overlap|צורת ח|צורת u|פתוח|פתוחה|חפיפה|אצבע|מסגרת|חישוק|\bu\b/.test(shape);
}

function isKnownClosedName(shape) {
  return /closed|stirrup|overlap|חפיפה|אצבע|מסגרת|חישוק/.test(shape);
}

function normalizeOpenU(segments) {
  if (segments.length !== 3) return null;
  const [a, b, c] = toLengths(segments);
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
  return segments;
}

function normalizeClosedStirrup(segments) {
  if (segments.length !== 6) return null;
  const [a, b, c, d, e, f] = toLengths(segments);

  // Preferred factory path: [tail,height,width,height,width,tail].
  if (b === d && c === e && a === f && a < Math.max(b, c)) return segments;

  // Legacy OCR path: [height,width,height,width,tail,tail].
  if (a === c && b === d && e === f && e < Math.max(a, b)) {
    return [
      { ...segments[4], angle_deg: 90 },
      { ...segments[0], angle_deg: 90 },
      { ...segments[1], angle_deg: 90 },
      { ...segments[2], angle_deg: 90 },
      { ...segments[3], angle_deg: 90 },
      { ...segments[5], angle_deg: segments[5].angle_deg ?? 0 },
    ];
  }

  return segments;
}

function normalizeFactorySegments(shapeName, sourceSegments) {
  const segments = (sourceSegments || []).map(segment => ({ ...segment }));
  const shape = shapeText(shapeName);

  if (isKnownClosedName(shape)) {
    const closed = normalizeClosedStirrup(segments);
    if (closed) return closed;
  }

  if (isKnownOpenUName(shape) || isKnownFactoryName(shape)) {
    const openU = normalizeOpenU(segments);
    if (openU) return openU;
  }

  return segments;
}

function normalizeFactoryShapeName(shapeName, segments) {
  const shape = String(shapeName || '');
  const lower = shapeText(shape);
  const lengths = toLengths(segments);
  const isSpiralOrRing = /spiral|ring|coil|ספיר|טבעת|סליל|לולאה/.test(lower);

  if (isSpiralOrRing && lengths.length <= 1) return 'straight bar';
  if ((isKnownOpenUName(lower) || isKnownFactoryName(lower)) && lengths.length === 3 && lengths[0] === lengths[2]) {
    return 'open U-shaped bar';
  }
  if (isKnownClosedName(lower) && lengths.length === 6 && lengths[0] === lengths[5] && lengths[1] === lengths[3] && lengths[2] === lengths[4]) {
    return 'closed stirrup 90-degree overlap';
  }
  return shape;
}

module.exports = { normalizeFactorySegments, normalizeFactoryShapeName };
