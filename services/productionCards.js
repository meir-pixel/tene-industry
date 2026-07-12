const { isTechnicalRecognitionNote } = require('./intakeWorkflow');

const REVIEW_NOTE_LABEL = '\u05d3\u05d5\u05e8\u05e9 \u05d0\u05d9\u05de\u05d5\u05ea \u05de\u05d5\u05dc \u05de\u05e7\u05d5\u05e8 \u05d4\u05e7\u05dc\u05d9\u05d8\u05d4';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function printableItemNote(note) {
  if (!note) return '';
  return isTechnicalRecognitionNote(note) ? REVIEW_NOTE_LABEL : note;
}

function parseSegments(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRightAngle(value) {
  return Math.abs(Number(value) - 90) < 0.001;
}

function normalizeAngleValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isPrintableBendAngle(angle) {
  const n = normalizeAngleValue(angle);
  if (n === null) return false;
  if (Math.abs(n) < 0.001) return false;
  if (Math.abs(n - 180) < 0.001) return false;
  return true;
}

function angleText(angle) {
  const n = normalizeAngleValue(angle);
  if (n === null) return '';
  return (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '')) + '°';
}

function isOpenUShape(segments) {
  if (!Array.isArray(segments) || segments.length !== 3) return false;
  const lengths = segments.map(segment => Number(segment.length_mm || 0));
  if (lengths.some(length => length <= 0)) return false;

  const [leftLeg, bridge, rightLeg] = lengths;
  const legsSimilar = Math.abs(leftLeg - rightLeg) <= Math.max(10, Math.max(leftLeg, rightLeg) * 0.1);
  const legsShorterThanBridge = leftLeg < bridge && rightLeg < bridge;

  return isRightAngle(segments[0].angle_deg)
    && isRightAngle(segments[1].angle_deg)
    && legsShorterThanBridge
    && legsSimilar;
}

function isSimilarDimension(a, b, tolerance = 0.12) {
  const max = Math.max(Number(a) || 0, Number(b) || 0);
  if (max <= 0) return false;
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= Math.max(10, max * tolerance);
}

function proportionalPrintSides(sides) {
  const clean = (Array.isArray(sides) ? sides : []).map(value => Math.max(0, Number(value || 0)));
  const max = Math.max(0, ...clean);
  if (!max) return clean;
  return clean.map(length => {
    if (!length) return 0;
    const ratio = max / length;
    if (ratio < 6) return length;
    return Math.min(max, Math.max(length, max * 0.14));
  });
}

function calcShapePoints(sides, angles) {
  const points = [[0, 0]];
  let direction = 0;
  for (let i = 0; i < sides.length; i += 1) {
    const previous = points[points.length - 1];
    const radians = direction * Math.PI / 180;
    points.push([
      previous[0] + sides[i] * Math.cos(radians),
      previous[1] + sides[i] * Math.sin(radians),
    ]);
    if (i < angles.length) {
      direction -= (180 - Number(angles[i] ?? 180));
    }
  }
  return points;
}

function normalizeShapePointsBaseBottom(points) {
  if (!Array.isArray(points) || points.length < 2) return points;
  let longest = { index: 0, length: 0, angle: 0 };
  for (let i = 0; i < points.length - 1; i += 1) {
    const dx = points[i + 1][0] - points[i][0];
    const dy = points[i + 1][1] - points[i][1];
    const length = Math.hypot(dx, dy);
    if (length > longest.length) longest = { index: i, length, angle: Math.atan2(dy, dx) };
  }
  if (!longest.length) return points;

  const cos = Math.cos(-longest.angle);
  const sin = Math.sin(-longest.angle);
  let rotated = points.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
  const base = rotated[longest.index];
  const baseNext = rotated[longest.index + 1];
  const baseY = (base[1] + baseNext[1]) / 2;
  const bodyY = rotated.reduce((sum, point) => sum + point[1], 0) / rotated.length;
  if (bodyY > baseY) rotated = rotated.map(([x, y]) => [x, baseY + (baseY - y)]);
  return rotated;
}

function closedStirrupParts(segments) {
  if (!Array.isArray(segments) || segments.length < 4) return null;
  const lengths = segments.map(segment => Number(segment.length_mm || 0));
  if (lengths.some(length => length <= 0)) return null;
  const rightAngles = segments.slice(0, Math.min(4, segments.length - 1))
    .filter(segment => segment.angle_deg != null)
    .every(segment => isRightAngle(segment.angle_deg));
  if (!rightAngles) return null;

  if (segments.length >= 5) {
    const [tailStart, verticalA, horizontalA, verticalB, horizontalB] = lengths;
    const tailEnd = lengths[5] || 0;
    const maxBody = Math.max(verticalA, horizontalA, verticalB, horizontalB);
    const hasSmallTails = tailStart <= maxBody * 0.45 && (!tailEnd || tailEnd <= maxBody * 0.45);
    if (
      hasSmallTails &&
      isSimilarDimension(verticalA, verticalB) &&
      isSimilarDimension(horizontalA, horizontalB)
    ) {
      return {
        top: horizontalA,
        right: verticalA,
        bottom: horizontalB,
        left: verticalB,
        tailStart,
        tailEnd,
      };
    }
  }

  const [top, right, bottom, left] = lengths;
  if (isSimilarDimension(top, bottom) && isSimilarDimension(right, left)) {
    return { top, right, bottom, left, tailStart: lengths[4] || 0, tailEnd: 0 };
  }

  return null;
}


function displayLengthCm(value) {
  const cm = (Number(value) || 0) / 10;
  if (!Number.isFinite(cm)) return '';
  return Number.isInteger(cm) ? String(cm) : cm.toFixed(1).replace(/\.0$/, '');
}

function pointAt(point, vector, distance) {
  return [point[0] + vector[0] * distance, point[1] + vector[1] * distance];
}

function unitVector(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return [dx / len, dy / len];
}

function angleLabelSvg(text, x, y, color = '#c9621a') {
  return '<text data-angle-label="1" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="middle" dominant-baseline="middle" font-size="9.5" font-family="Heebo,Arial" font-weight="900" fill="' + color + '" stroke="white" stroke-width="3" paint-order="stroke fill" stroke-linejoin="round">' + escapeHtml(text) + '</text>';
}

function angleLabelPosition(corner, center, distance = 22) {
  let vx = center ? corner[0] - center[0] : 1;
  let vy = center ? corner[1] - center[1] : -1;
  const len = Math.sqrt(vx * vx + vy * vy) || 1;
  vx /= len;
  vy /= len;
  return [corner[0] + vx * distance, corner[1] + vy * distance];
}

function rightAngleMarkerSvg(previous, corner, next, center) {
  const a = unitVector(corner, previous);
  const b = unitVector(corner, next);
  const d = 9;
  const p1 = pointAt(corner, a, d);
  const p2 = [p1[0] + b[0] * d, p1[1] + b[1] * d];
  const p3 = pointAt(corner, b, d);
  const label = angleLabelPosition(corner, center, 22);
  return '<path d="M ' + p1[0].toFixed(1) + ',' + p1[1].toFixed(1) + ' L ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1) + ' L ' + p3[0].toFixed(1) + ',' + p3[1].toFixed(1) + '" fill="none" stroke="#a8b0ba" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"/>' +
    angleLabelSvg('90°', label[0], label[1]);
}

function dimensionLabelSvg(text, x, y, width = 38) {
  return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="middle" dominant-baseline="middle" font-size="8" font-family="Heebo,Arial" font-weight="900" fill="#1a2332" stroke="white" stroke-width="2.4" paint-order="stroke fill" stroke-linejoin="round">' + escapeHtml(text) + '</text>';
}

function sideDimensionSvg(start, end, value, center, distance = 18) {
  const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if ((mid[0] + nx * distance - center[0]) * nx + (mid[1] + ny * distance - center[1]) * ny < 0) {
    nx *= -1;
    ny *= -1;
  }
  const label = [mid[0] + nx * distance, mid[1] + ny * distance];
  const text = displayLengthCm(value);
  const width = Math.max(30, Math.min(48, text.length * 7 + 14));
  return '<line x1="' + mid[0].toFixed(1) + '" y1="' + mid[1].toFixed(1) + '" x2="' + label[0].toFixed(1) + '" y2="' + label[1].toFixed(1) + '" stroke="#aeb8c5" stroke-width="0.8"/>' +
    dimensionLabelSvg(text, label[0], label[1], width);
}

function angleMarkerSvg(previous, corner, next, angle, center) {
  if (!isPrintableBendAngle(angle)) return '';
  if (isRightAngle(angle)) return rightAngleMarkerSvg(previous, corner, next, center);
  const a = unitVector(corner, previous);
  const b = unitVector(corner, next);
  const p1 = pointAt(corner, a, 13);
  const p2 = pointAt(corner, b, 13);
  const label = angleLabelPosition(corner, center, 22);
  return '<path d="M ' + p1[0].toFixed(1) + ',' + p1[1].toFixed(1) + ' Q ' + corner[0].toFixed(1) + ',' + corner[1].toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1) + '" fill="none" stroke="#c9621a" stroke-width="1.4" stroke-linecap="round"/>' +
    angleLabelSvg(angleText(angle), label[0], label[1]);
}

function straightShapeSvg(segment) {
  const length = Number(segment && segment.length_mm || 0);
  const width = 220;
  const height = 80;
  const y = 40;
  const x1 = 22;
  const x2 = 198;
  const text = displayLengthCm(length);
  let svg = '<line x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" stroke="#1a2332" stroke-width="4" stroke-linecap="round"/>';
  svg += '<line x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" stroke="#3a5070" stroke-width="1.5" stroke-linecap="round"/>';
  svg += dimensionLabelSvg(text, width / 2, 18, Math.max(34, Math.min(54, text.length * 7 + 18)));
  svg += '<line x1="' + (width / 2).toFixed(1) + '" y1="25" x2="' + (width / 2).toFixed(1) + '" y2="' + (y - 5) + '" stroke="#aeb8c5" stroke-width="0.8"/>';
  return '<svg data-shape-kind="straight-bar" data-scale-mode="print-fit" preserveAspectRatio="xMidYMid meet" viewBox="0 0 ' + width + ' ' + height + '" style="width:100%;height:100%;max-height:90px;overflow:visible">' + svg + '</svg>';
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function shapeSnapshotFromItem(item = {}) {
  return parseJsonObject(item.shape_snapshot_json || item.shapeSnapshot || item.shape_snapshot || item.shapeData || item.shape_data) || {};
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = numberOrNull(value);
    if (n !== null) return n;
  }
  return null;
}

function normalizeSnapshotSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments.map(segment => ({
    length_mm: Number(segment.length_mm ?? segment.lengthMm ?? segment.length ?? 0),
    angle_deg: normalizeAngleValue(segment.bendAfterDeg ?? segment.bend_after_deg ?? segment.angle_deg ?? segment.angleDeg ?? segment.angle),
  })).filter(segment => Number.isFinite(segment.length_mm) && segment.length_mm > 0);
}

function snapshotSegments(snapshot = {}) {
  const generic = snapshot.machineOutput && snapshot.machineOutput.generic ? snapshot.machineOutput.generic : {};
  const data = snapshot.data || {};
  const genericSegments = normalizeSnapshotSegments(generic.segments);
  if (genericSegments.length) return genericSegments;
  const dataSegments = normalizeSnapshotSegments(data.segments);
  if (dataSegments.length) return dataSegments;
  const sides = Array.isArray(data.sides) ? data.sides : [];
  const angles = Array.isArray(data.angles) ? data.angles : [];
  return sides.map((length, index) => ({
    length_mm: Number(length) || 0,
    angle_deg: index < sides.length - 1 ? normalizeAngleValue(angles[index]) : null,
  })).filter(segment => segment.length_mm > 0);
}

function shapeSegmentsFromItem(item = {}) {
  const fromSnapshot = snapshotSegments(shapeSnapshotFromItem(item));
  return fromSnapshot.length ? fromSnapshot : normalizeSnapshotSegments(parseSegments(item.segments));
}

function hasPrintableBends(segments) {
  return Array.isArray(segments) && segments.length > 1 && segments.slice(0, -1).some(segment => isPrintableBendAngle(segment.angle_deg));
}

function shapeSvgHasAngleLabels(svg) {
  return /data-angle-label|\u00b0|&deg;/.test(String(svg || ''));
}

function shapeSvgForProductionCard(item = {}, segments = shapeSegmentsFromItem(item)) {
  const snapshot = shapeSnapshotFromItem(item);
  if (isSpiralItem(item, snapshot)) return spiralShapeSvg(item, snapshot);
  const cleanSegments = Array.isArray(segments) ? segments : [];
  const generated = itemShapeSvg({ ...item, segments: JSON.stringify(cleanSegments), shape_svg: '' });
  if (cleanSegments.length) return generated;
  return item.shape_svg ? String(item.shape_svg) : generated;
}

function shapeDiameterFromItem(item = {}) {
  const snapshot = shapeSnapshotFromItem(item);
  if (isSpiralItem(item, snapshot)) {
    const spiral = spiralMetricsFromItem(item, snapshot);
    if (spiral.rebarDiameter !== null) return spiral.rebarDiameter;
  }
  const data = snapshot.data || {};
  const generic = snapshot.machineOutput && snapshot.machineOutput.generic ? snapshot.machineOutput.generic : {};
  const value = item.diameter ?? item.diameterMm ?? data.diameter ?? data.diameterMm ?? data.barDiameter ?? data.barDiameterMm ?? generic.diameter ?? generic.diameterMm;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function shapeTotalLengthMmFromItem(item = {}) {
  const snapshot = shapeSnapshotFromItem(item);
  const generic = snapshot.machineOutput && snapshot.machineOutput.generic ? snapshot.machineOutput.generic : {};
  const value = item.total_length_mm ?? item.totalLengthMm ?? snapshot.calculated?.totalLengthMm ?? generic.totalLengthMm ?? generic.lengthMm;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function attachOrderLineNumbers(items = []) {
  const groups = new Map();
  for (const item of items || []) {
    const orderKey = item.order_id || item.orderNum || item.order_num || 'unknown';
    if (!groups.has(orderKey)) groups.set(orderKey, []);
    groups.get(orderKey).push(item);
  }

  const result = [];
  for (const orderItems of groups.values()) {
    const sorted = orderItems.slice().sort((a, b) => {
      const aLine = Number(a.order_line_no || a.line_no || a.position || 0);
      const bLine = Number(b.order_line_no || b.line_no || b.position || 0);
      if (aLine && bLine && aLine !== bLine) return aLine - bLine;
      const aCreated = String(a.created_at || '');
      const bCreated = String(b.created_at || '');
      if (aCreated && bCreated && aCreated !== bCreated) return aCreated.localeCompare(bCreated);
      return Number(a.id || 0) - Number(b.id || 0);
    });
    const total = sorted.length;
    sorted.forEach((item, index) => {
      result.push({
        ...item,
        orderLineNo: Number(item.order_line_no || item.line_no || item.position || 0) || index + 1,
        orderTotalLines: total,
      });
    });
  }
  return result;
}

function orderLineLabel(item = {}) {
  const line = Number(item.orderLineNo || item.order_line_no || item.line_no || item.position || 0);
  const total = Number(item.orderTotalLines || item.order_total_lines || 0);
  if (line > 0 && total > 0) return `${line}/${total}`;
  if (line > 0) return String(line);
  return '';
}

function orderLineTitle(item = {}) {
  const label = orderLineLabel(item);
  return label ? `פריט ${label}` : 'פריט';
}
function isSpiralName(value) {
  return /spiral|ring|coil|spring|helix|\u05e1\u05e4\u05d9\u05e8|\u05d8\u05d1\u05e2\u05ea|\u05e1\u05dc\u05d9\u05dc|\u05dc\u05d5\u05dc\u05d0\u05d4|\u05e7\u05e4\u05d9\u05e5|׳¡׳₪׳™׳¨|׳¡׳₪׳™׳¨׳׳”|׳˜׳‘׳¢׳×|׳¡׳׳™׳|׳׳•׳׳׳”|׳§׳₪׳™׳¥/i.test(String(value || ''));
}

function isSpiralItem(item = {}, snapshot = shapeSnapshotFromItem(item)) {
  if (item.pile_component_type || item.pile_card_type || item.componentType === 'spiral_zone') return false;
  const data = snapshot.data || {};
  const generic = snapshot.machineOutput && snapshot.machineOutput.generic ? snapshot.machineOutput.generic : {};
  const family = String(snapshot.family || data.family || generic.family || item.family || '').toLowerCase();
  const shapeType = String(snapshot.shapeType || snapshot.shape_type || data.shapeType || data.shape_type || generic.shapeType || item.shapeType || item.shape_type || '').toLowerCase();
  const name = String(item.shape_name || item.shapeName || item.shape || snapshot.shapeName || snapshot.displayName || snapshot.shapeId || '').toLowerCase();
  return family.includes('spiral') || family.includes('spirals') || shapeType.includes('spiral') || isSpiralName(shapeType) || isSpiralName(name);
}

function spiralMetricsFromItem(item = {}, snapshot = shapeSnapshotFromItem(item)) {
  const data = snapshot.data || {};
  const calculated = snapshot.calculated || snapshot.metrics || {};
  const generic = snapshot.machineOutput && snapshot.machineOutput.generic ? snapshot.machineOutput.generic : {};
  const spiral = data.spiral && typeof data.spiral === 'object' ? data.spiral : {};
  return {
    rebarDiameter: firstNumber(item.diameter, item.diameterMm, data.rebarDiameter, data.rebarDiameterMm, data.barDiameter, data.barDiameterMm, data.diameter, generic.rebarDiameter, generic.rebarDiameterMm, generic.diameter, generic.diameterMm),
    spiralDiameterMm: firstNumber(item.spiral_diameter_mm, item.spiralDiameterMm, item.spiralDiameter, snapshot.spiralDiameterMm, snapshot.spiral_diameter_mm, spiral.diameterMm, spiral.diameter, data.spiralDiameterMm, data.coilDiameterMm, data.diameterMm, data.outerDiameterMm, data.spiralDiameter, data.spiral_diameter_mm, generic.spiralDiameterMm, generic.coilDiameterMm, generic.diameterMm, generic.spiralDiameter),
    turns: firstNumber(item.spiral_turns, item.spiralTurns, item.turns, item.coils, snapshot.spiralTurns, snapshot.spiral_turns, spiral.turns, data.spiralTurns, data.turns, data.coils, data.wraps, data.rings, data.spiral_turns, generic.spiralTurns, generic.turns, generic.coils, generic.wraps, generic.rings),
    pitchMm: firstNumber(item.pitch_mm, item.pitchMm, data.pitchMm, data.spacingMm, data.stepMm, spiral.pitchMm, spiral.spacingMm, generic.pitchMm, generic.spacingMm),
    totalLengthMm: firstNumber(item.total_length_mm, item.totalLengthMm, calculated.totalLengthMm, data.totalLengthMm, generic.totalLengthMm, generic.lengthMm),
  };
}

function spiralParamsFromItem(item = {}) {
  const snapshot = shapeSnapshotFromItem(item);
  const metrics = spiralMetricsFromItem(item, snapshot);
  return {
    isSpiral: isSpiralItem(item, snapshot),
    spiralDiameterMm: metrics.spiralDiameterMm || 0,
    turns: metrics.turns || 0,
  };
}

function spiralDimensionsHtml(item = {}, snapshot = shapeSnapshotFromItem(item)) {
  const metrics = spiralMetricsFromItem(item, snapshot);
  const parts = [];
  if (metrics.spiralDiameterMm !== null) {
    parts.push('<span class="dim-seg">' + escapeHtml('\u05e7\u05d5\u05d8\u05e8 \u05e1\u05e4\u05d9\u05e8\u05dc\u05d4') + ': <b>' + escapeHtml(Math.round(metrics.spiralDiameterMm)) + '</b> ' + escapeHtml('\u05de"\u05de') + '</span>');
  }
  if (metrics.turns !== null) {
    parts.push('<span class="dim-seg">' + escapeHtml('\u05db\u05e8\u05d9\u05db\u05d5\u05ea') + ': <b>' + escapeHtml(Number.isInteger(metrics.turns) ? metrics.turns : metrics.turns.toFixed(1)) + '</b></span>');
  }
  if (metrics.pitchMm !== null) {
    parts.push('<span class="dim-seg">' + escapeHtml('\u05e4\u05e1\u05d9\u05e2\u05d4') + ': <b>' + escapeHtml(Math.round(metrics.pitchMm)) + '</b> ' + escapeHtml('\u05de"\u05de') + '</span>');
  }
  if (!parts.length) {
    parts.push('<span class="dim-seg"><b>' + escapeHtml('\u05e1\u05e4\u05d9\u05e8\u05dc\u05d4') + '</b> ' + escapeHtml('\u05e0\u05ea\u05d5\u05e0\u05d9 \u05e7\u05d5\u05d8\u05e8/\u05db\u05e8\u05d9\u05db\u05d5\u05ea \u05d7\u05e1\u05e8\u05d9\u05dd') + '</span>');
  }
  return parts.join('');
}

function spiralShapeSvg(item = {}, snapshot = shapeSnapshotFromItem(item)) {
  if (!isSpiralItem(item, snapshot)) return '';
  const metrics = spiralMetricsFromItem(item, snapshot);
  const spiralDiameterLabel = metrics.spiralDiameterMm !== null ? String(Math.round(metrics.spiralDiameterMm)) : '?';
  const turnsLabel = metrics.turns !== null ? String(Number.isInteger(metrics.turns) ? metrics.turns : metrics.turns.toFixed(1)) : '?';
  const rebarDiameterLabel = metrics.rebarDiameter !== null ? String(Number.isInteger(metrics.rebarDiameter) ? metrics.rebarDiameter : metrics.rebarDiameter.toFixed(1)) : '?';
  const width = 220;
  const height = 140;
  const cx = 110;
  const cy = 62;
  const outerR = 38;
  const midR = 28;
  const innerR = 17;
  const dimLeft = cx - outerR;
  const dimRight = cx + outerR;
  const labelDiameter = '&#216;' + escapeHtml(spiralDiameterLabel);
  const labelRebar = '&#216;' + escapeHtml(rebarDiameterLabel);

  function topViewShell(extraAttrs = '') {
    let svg = '<desc>' + escapeHtml('\u05e7\u05d5\u05d8\u05e8 \u05e1\u05e4\u05d9\u05e8\u05d0\u05dc\u05d4') + ' ' + escapeHtml('\u05de\u05e1\u05e4\u05e8 \u05db\u05e8\u05d9\u05db\u05d5\u05ea') + '</desc>';
    svg += '<text x="' + cx + '" y="13" text-anchor="middle" font-size="10" font-family="Heebo,Arial" font-weight="900" fill="#1a2332">' + escapeHtml('\u05e1\u05e4\u05d9\u05e8\u05dc\u05d4') + '</text>';
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + outerR + '" fill="none" stroke="#1a2332" stroke-width="4"/>';
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + outerR + '" fill="none" stroke="#3a5070" stroke-width="1.4"/>';
    svg += '<path d="M ' + (cx + outerR) + ' ' + cy +
      ' C ' + (cx + outerR) + ' ' + (cy - 29) + ', ' + (cx - midR) + ' ' + (cy - 31) + ', ' + (cx - midR) + ' ' + cy +
      ' C ' + (cx - midR) + ' ' + (cy + 22) + ', ' + (cx + innerR) + ' ' + (cy + 20) + ', ' + (cx + innerR) + ' ' + cy +
      ' C ' + (cx + innerR) + ' ' + (cy - 11) + ', ' + (cx - 5) + ' ' + (cy - 10) + ', ' + (cx - 5) + ' ' + cy + '"' +
      ' fill="none" stroke="#3a5070" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
    svg += '<line x1="' + dimLeft + '" y1="' + cy + '" x2="' + dimRight + '" y2="' + cy + '" stroke="#c9621a" stroke-width="1.8"/>';
    svg += '<line x1="' + dimLeft + '" y1="' + (cy - 8) + '" x2="' + dimLeft + '" y2="' + (cy + 8) + '" stroke="#c9621a" stroke-width="1.4"/>';
    svg += '<line x1="' + dimRight + '" y1="' + (cy - 8) + '" x2="' + dimRight + '" y2="' + (cy + 8) + '" stroke="#c9621a" stroke-width="1.4"/>';
    svg += '<rect x="' + (cx - 30) + '" y="' + (cy - 18) + '" width="60" height="15" rx="4" fill="white" fill-opacity="0.96" stroke="#f2c199" stroke-width="0.8"/>';
    svg += '<text x="' + cx + '" y="' + (cy - 7) + '" text-anchor="middle" font-size="9" font-family="Heebo,Arial" font-weight="900" fill="#c9621a">' + labelDiameter + ' ' + escapeHtml('\u05de"\u05de') + '</text>';
    svg += '<g data-spiral-visual-labels="1" font-family="Heebo,Arial">';
    svg += '<rect x="24" y="103" width="58" height="24" rx="5" fill="#fff7ed" stroke="#c9621a" stroke-width="1.1"/>';
    svg += '<text x="53" y="113" text-anchor="middle" font-size="7" font-weight="900" fill="#9a4b10">' + escapeHtml('\u05e7\u05d5\u05d8\u05e8') + '</text>';
    svg += '<text x="53" y="124" text-anchor="middle" font-size="10" font-weight="900" fill="#1a2332">' + labelDiameter + '</text>';
    svg += '<rect x="89" y="103" width="58" height="24" rx="5" fill="#fff7ed" stroke="#c9621a" stroke-width="1.1"/>';
    svg += '<text x="118" y="113" text-anchor="middle" font-size="7" font-weight="900" fill="#9a4b10">' + escapeHtml('\u05db\u05e8\u05d9\u05db\u05d5\u05ea') + '</text>';
    svg += '<text x="118" y="124" text-anchor="middle" font-size="10" font-weight="900" fill="#1a2332">' + escapeHtml(turnsLabel) + '</text>';
    svg += '<rect x="154" y="103" width="42" height="24" rx="5" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1"/>';
    svg += '<text x="175" y="113" text-anchor="middle" font-size="7" font-weight="900" fill="#64748b">' + escapeHtml('\u05d1\u05e8\u05d6\u05dc') + '</text>';
    svg += '<text x="175" y="124" text-anchor="middle" font-size="10" font-weight="900" fill="#1a2332">' + labelRebar + '</text>';
    svg += '</g>';
    return '<svg class="pc-shape-svg pc-spiral-top-svg" data-spiral-label-alt="spiral diameter" data-shape-kind="spiral" data-spiral-diameter-mm="' + escapeHtml(spiralDiameterLabel) + '" data-spiral-turns="' + escapeHtml(turnsLabel) + '" data-rebar-diameter-mm="' + escapeHtml(rebarDiameterLabel) + '"' + extraAttrs + ' data-scale-mode="print-fit" preserveAspectRatio="xMidYMid meet" viewBox="0 0 ' + width + ' ' + height + '" style="width:100%;height:100%;max-height:124px;overflow:visible">' + svg + '</svg>';
  }

  if (metrics.spiralDiameterMm === null || metrics.turns === null) {
    return topViewShell(' data-spiral-incomplete="1"');
  }

  return topViewShell();
}

function itemShapeSvg(item = {}) {
  const spiralSvg = spiralShapeSvg(item);
  return spiralSvg || shapeSvg(shapeSegmentsFromItem(item));
}

function openUShapeSvg(segments) {
  const [leftLeg, bridge, rightLeg] = segments.map(segment => Number(segment.length_mm || 0));
  const width = 220;
  const height = 100;
  const left = 42;
  const right = 178;
  const top = 24;
  const bottom = 78;
  const midY = (top + bottom) / 2;
  const midX = (left + right) / 2;
  const path = `M ${left},${top} L ${left},${bottom} L ${right},${bottom} L ${right},${top}`;

  let svg = `<path d="${path}" fill="none" stroke="#1a2332" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  svg += `<path d="${path}" fill="none" stroke="#3a5070" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;

  svg += sideDimensionSvg([left, top], [left, bottom], leftLeg, [midX, midY], 22);
  svg += sideDimensionSvg([left, bottom], [right, bottom], bridge, [midX, midY], 20);
  svg += sideDimensionSvg([right, bottom], [right, top], rightLeg, [midX, midY], 22);

  [
    [[left, top], [left, bottom], [right, bottom]],
    [[left, bottom], [right, bottom], [right, top]],
  ].forEach(([previous, corner, next]) => {
    svg += rightAngleMarkerSvg(previous, corner, next, [midX, midY]);
  });

  return `<svg data-shape-kind="open-u" data-scale-mode="print-fit" preserveAspectRatio="xMidYMid meet" viewBox="0 0 ${width} ${height}" style="width:100%;height:100%;max-height:100px;overflow:visible">${svg}</svg>`;
}

function angledOpenStirrupParts(segments) {
  if (!Array.isArray(segments) || segments.length !== 5) return null;
  const lengths = segments.map(segment => Number(segment.length_mm || 0));
  if (lengths.some(length => length <= 0)) return null;
  const [tailA, sideA, sideB, sideC, tailB] = lengths;
  const angleA = Math.abs(Number(segments[0].angle_deg || 0));
  const angleB = Number(segments[1].angle_deg || 0);
  const angleC = Number(segments[2].angle_deg || 0);
  const angleD = Math.abs(Number(segments[3].angle_deg || 0));
  const tailsSimilar = isSimilarDimension(tailA, tailB, 0.2);
  const longSidesSimilar = isSimilarDimension(sideA, sideC, 0.12);
  const hasAngledTails = Math.abs(angleA - 45) <= 2 && Math.abs(angleD - 45) <= 2;
  const hasRectBody = isRightAngle(angleB) && isRightAngle(angleC) && longSidesSimilar;
  if (!tailsSimilar || !hasAngledTails || !hasRectBody) return null;
  return { tailA, bottom: sideA, right: sideB, top: sideC, tailB, angleA, angleD };
}

function closedStirrupSvg(parts) {
  const width = 240;
  const height = 120;
  const horizontal = Math.max(parts.top || 0, parts.bottom || 0, 1);
  const vertical = Math.max(parts.left || 0, parts.right || 0, 1);
  const maxBoxW = 126;
  const maxBoxH = 82;
  const rawRatio = horizontal / vertical;
  const boxW = rawRatio >= 1
    ? maxBoxW
    : Math.max(54, Math.min(maxBoxW, maxBoxH * rawRatio));
  const boxH = rawRatio >= 1
    ? Math.max(54, Math.min(maxBoxH, maxBoxW / rawRatio))
    : maxBoxH;
  const x = (width - boxW) / 2 - 10;
  const y = (height - boxH) / 2 + 4;
  const right = x + boxW;
  const bottom = y + boxH;
  const midX = x + boxW / 2;
  const midY = y + boxH / 2;
  const path = `M ${x.toFixed(1)},${y.toFixed(1)} L ${right.toFixed(1)},${y.toFixed(1)} L ${right.toFixed(1)},${bottom.toFixed(1)} L ${x.toFixed(1)},${bottom.toFixed(1)} Z`;
  const marker = Math.min(28, Math.max(14, Math.min(boxW, boxH) * 0.28));
  const markerX = right - marker;
  const markerY = y + marker;
  const markerPath = `M ${markerX.toFixed(1)},${y.toFixed(1)} L ${markerX.toFixed(1)},${markerY.toFixed(1)} L ${right.toFixed(1)},${markerY.toFixed(1)}`;

  let svg = `<path d="${path}" fill="none" stroke="#1a2332" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  svg += `<path d="${path}" fill="none" stroke="#3a5070" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  svg += `<path data-stirrup-marker="overlap" d="${markerPath}" fill="none" stroke="#1a2332" stroke-width="4" stroke-linecap="square" stroke-linejoin="miter"/>`;
  svg += `<path d="${markerPath}" fill="none" stroke="#3a5070" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"/>`;

  [
    { x: midX, y: y - 11, value: parts.top },
    { x: right + 20, y: midY, value: parts.right },
    { x: midX, y: bottom + 13, value: parts.bottom },
    { x: x - 20, y: midY, value: parts.left },
  ].forEach(label => {
    svg += `<rect x="${(label.x - 18).toFixed(1)}" y="${(label.y - 7).toFixed(1)}" width="36" height="14" rx="3" fill="white" fill-opacity="0.94"/>`;
    svg += `<text x="${label.x.toFixed(1)}" y="${label.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="8" font-family="Heebo,Arial" font-weight="800" fill="#1a2332">${escapeHtml(displayLengthCm(label.value))}</text>`;
  });

  [
    [[x, bottom], [x, y], [right, y]],
    [[x, y], [right, y], [right, bottom]],
    [[right, y], [right, bottom], [x, bottom]],
    [[right, bottom], [x, bottom], [x, y]],
  ].forEach(([previous, corner, next]) => {
    svg += rightAngleMarkerSvg(previous, corner, next, [midX, midY]);
  });

  return `<svg data-shape-kind="closed-stirrup" data-scale-mode="print-fit" preserveAspectRatio="xMidYMid meet" viewBox="0 0 ${width} ${height}" style="width:100%;height:100%;max-height:112px;overflow:visible">${svg}</svg>`;
}

function angledOpenStirrupSvg(parts) {
  const width = 260;
  const height = 140;
  const left = 64;
  const right = 198;
  const top = 32;
  const bottom = 104;
  const tailInset = 24;
  const topTailEnd = [left + tailInset, top + tailInset];
  const bottomTailEnd = [left + tailInset, bottom - tailInset];
  const points = [
    bottomTailEnd,
    [left, bottom],
    [right, bottom],
    [right, top],
    [left, top],
    topTailEnd,
  ];
  const path = 'M ' + points.map(point => point.join(',')).join(' L ');
  const center = [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
  let svg = '<path d="' + path + '" fill="none" stroke="#1a2332" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>';
  svg += '<path d="' + path + '" fill="none" stroke="#3a5070" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';

  [parts.tailA, parts.bottom, parts.right, parts.top, parts.tailB].forEach((value, index) => {
    svg += sideDimensionSvg(points[index], points[index + 1], value, center, index === 0 || index === 4 ? 20 : 18);
  });

  svg += angleMarkerSvg(points[0], points[1], points[2], parts.angleA, center);
  svg += rightAngleMarkerSvg(points[1], points[2], points[3], center);
  svg += rightAngleMarkerSvg(points[2], points[3], points[4], center);
  svg += angleMarkerSvg(points[3], points[4], points[5], parts.angleD, center);

  return '<svg data-shape-kind="angled-open-stirrup" data-scale-mode="print-fit" preserveAspectRatio="xMidYMid meet" viewBox="0 0 ' + width + ' ' + height + '" style="width:100%;height:100%;max-height:112px;overflow:visible">' + svg + '</svg>';
}
function shapeSvg(segmentsRaw) {
  try {
    const segments = parseSegments(segmentsRaw);
    const width = 260;
    const height = 140;
    const padding = 46;
    if (!segments.length) {
      return '<svg viewBox="0 0 220 60" style="width:100%;max-height:80px">' +
        '<line x1="12" y1="30" x2="208" y2="30" stroke="#1a2332" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="12" cy="30" r="3" fill="#1a2332"/><circle cx="208" cy="30" r="3" fill="#1a2332"/></svg>';
    }

    if (segments.length === 1) return straightShapeSvg(segments[0]);
    if (isOpenUShape(segments)) return openUShapeSvg(segments);
    const stirrup = closedStirrupParts(segments);
    if (stirrup) return closedStirrupSvg(stirrup);
    const angledOpenStirrup = angledOpenStirrupParts(segments);
    if (angledOpenStirrup) return angledOpenStirrupSvg(angledOpenStirrup);

    const sides = segments.map(segment => Number(segment.length_mm || 0));
    const angles = segments.map(segment => segment.angle_deg);
    const visualSides = proportionalPrintSides(sides);
    const points = normalizeShapePointsBaseBottom(calcShapePoints(visualSides, angles));

    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scale = Math.min((width - padding * 2) / rangeX, (height - padding * 2) / rangeY);
    const offsetX = padding + ((width - padding * 2) - rangeX * scale) / 2;
    const offsetY = padding + ((height - padding * 2) - rangeY * scale) / 2;
    const mapped = points.map(point => [
      Number((offsetX + (point[0] - minX) * scale).toFixed(1)),
      Number((offsetY + (point[1] - minY) * scale).toFixed(1)),
    ]);
    const path = `M ${mapped.map(point => point.join(',')).join(' L ')}`;
    let svg = `<path d="${path}" fill="none" stroke="#1a2332" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    svg += `<path d="${path}" fill="none" stroke="#3a5070" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;

    const center = [mapped.reduce((sum, point) => sum + point[0], 0) / mapped.length, mapped.reduce((sum, point) => sum + point[1], 0) / mapped.length];
    for (let i = 0; i < mapped.length - 1; i += 1) {
      svg += sideDimensionSvg(mapped[i], mapped[i + 1], sides[i], center, 15);
    }

    for (let i = 1; i < mapped.length - 1; i += 1) {
      const angle = angles[i - 1];
      if (isPrintableBendAngle(angle)) {
        svg += angleMarkerSvg(mapped[i - 1], mapped[i], mapped[i + 1], angle, center);
      }
    }

    return `<svg data-shape-kind="generic-bar" data-scale-mode="print-fit" data-proportional-short-bends="1" preserveAspectRatio="xMidYMid meet" viewBox="0 0 ${width} ${height}" style="width:100%;height:100%;max-height:100px;overflow:visible">${svg}</svg>`;
  } catch {
    return '<svg viewBox="0 0 220 60"><line x1="10" y1="30" x2="210" y2="30" stroke="#ccc" stroke-width="2"/></svg>';
  }
}

function masterCard(allItems, order, printDate, deliveryDate, numPallets) {
  const rows = allItems.map((item, index) => '<tr>' +
    `<td>${index + 1}</td>` +
    `<td><b>Ø${escapeHtml(shapeDiameterFromItem(item) || '?')}</b></td>` +
    `<td>${escapeHtml(item.shape_name || '-')}</td>` +
    `<td class="master-shape-cell">${itemShapeSvg(item)}</td>` +
    `<td>${Math.round((shapeTotalLengthMmFromItem(item) || 0) / 10)}</td>` +
    `<td><b>${item.quantity || 1}</b></td>` +
    `<td>${Number(item.total_weight || 0).toFixed(1)}</td>` +
    '<td class="check-cell">□</td>' +
  '</tr>').join('');

  return '<div class="prod-card master-card">' +
    '<div class="pc-head" style="background:#1a2332;color:#fff;padding:8px 12px;">' +
      '<div><div class="pc-title" style="color:#e07b39;font-size:14px;">★ כרטיסיית מאסטר</div>' +
      `<div class="pc-date" style="color:#8aa;">${escapeHtml(printDate)}</div></div>` +
      `<div style="text-align:left"><div style="font-size:16px;font-weight:900;">${escapeHtml(order.order_num || '')}</div>` +
      `<div style="font-size:10px;color:#8aa;">${deliveryDate ? `מסירה: ${escapeHtml(deliveryDate)}` : ''}</div></div></div>` +
    `<div style="padding:6px 10px;font-size:12px;font-weight:700;border-bottom:1px solid #eee;">${escapeHtml(order.customer_name || '')}</div>` +
    '<table class="master-table"><thead><tr><th>#</th><th>Ø</th><th>צורה</th><th>תרשים</th><th>אורך</th><th>כמות</th><th>ק"ג</th><th>✓</th></tr></thead>' +
    `<tbody>${rows}</tbody></table>` +
    `<div class="master-totals">סה"כ: <b>${Number(order.total_weight || 0).toFixed(1)} ק"ג</b> · ${numPallets} משטחים · ${allItems.length} פריטים</div>` +
    `<div class="pc-footer" style="background:#1a2332;color:#8aa;font-size:9px;text-align:center;padding:4px;">★ כרטיסיית מאסטר - לא לאיבוד! · ${escapeHtml(order.order_num || '')}</div>` +
  '</div>';
}

function itemCard(item, order, printDate, rebarWeights) {
  const scanSuffix = item.scan_suffix ? `-${String(item.scan_suffix).replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
  const barcode = `${order.order_num || ''}-${String(item.id).padStart(6, '0')}${scanSuffix}`;
  const snapshot = shapeSnapshotFromItem(item);
  const spiralItem = isSpiralItem(item, snapshot);
  const segments = spiralItem ? [] : shapeSegmentsFromItem(item);
  const visualShapeSvg = shapeSvgForProductionCard(item, segments);
  const title = orderLineTitle(item);
  const elementName = item.struct_element || item.elementName || item.element_name || item.element || '';
  const shapeSubtitle = [printDate, item.shape_name].filter(Boolean).join(' · ');
  const note = printableItemNote(item.note);
  const diameter = shapeDiameterFromItem(item);
  const totalLengthMm = shapeTotalLengthMmFromItem(item);
  const kgPerMeter = rebarWeights[Math.round(diameter || 0)];
  const weight = item.total_weight && item.total_weight > 0
    ? Number(item.total_weight).toFixed(2)
    : (kgPerMeter ? (Math.round((totalLengthMm || 0) / 1000 * kgPerMeter * (item.quantity || 1) * 10) / 10).toFixed(2) : '0.00');

  let dimensions = '';
  if (spiralItem) {
    dimensions = spiralDimensionsHtml(item, snapshot);
  } else {
    for (let i = 0; i < segments.length; i += 1) {
      const label = String.fromCharCode(0x05D0 + i);
      dimensions += `<span class="dim-seg">${label}: <b>${escapeHtml(displayLengthCm(segments[i].length_mm || 0))}</b> ס״מ</span>`;
      if (i < segments.length - 1 && isPrintableBendAngle(segments[i].angle_deg)) {
        dimensions += `<span class="dim-ang">${escapeHtml(angleText(segments[i].angle_deg))}</span>`;
      }
    }
  }

  return '<div class="prod-card">' +
    '<div class="pc-head">' +
      `<div><div class="pc-title">${escapeHtml(title)}</div><div class="pc-date">${escapeHtml(shapeSubtitle)}</div></div>` +
      `<div class="pc-top-barcode"><div class="bc-font-top">${escapeHtml(barcode)}</div><div class="bc-label">${escapeHtml(barcode)}</div></div>` +
    '</div>' +
    '<div class="pc-order-row">' +
      '<div class="pc-order-label">הזמנה מס:</div>' +
      `<div class="pc-order-barcode"><div class="bc-font-mid">${escapeHtml(order.order_num || '')}</div><div class="bc-ord-text">${escapeHtml(order.order_num || '')}</div></div>` +
      `<div class="pc-pallet">משטח: <b>${item._palletNum || 1}</b></div>` +
    '</div>' +
    '<div class="pc-wq-row">' +
      `<div class="pc-wq-cell"><span class="wq-lbl">ק"ג:</span> <span class="wq-val">${weight}</span></div>` +
      '<div class="pc-wq-sep"></div>' +
      `<div class="pc-wq-cell"><span class="wq-lbl">כמות:</span> <span class="wq-val">${item.quantity || 1}</span> יח</div>` +
      '<div class="pc-wq-sep"></div>' +
      `<div class="pc-wq-cell"><span class="wq-lbl">לקוח:</span> <span class="wq-cust">${escapeHtml(order.customer_name || '')}</span></div>` +
    '</div>' +
    `<div class="pc-shape-area">${visualShapeSvg}</div>` +
    (dimensions ? `<div class="pc-dims">${dimensions}</div>` : '') +
    '<div class="pc-spec-row">' +
      `<div class="pc-spec-cell"><span class="spec-lbl">קוטר:</span> <b>Ø${escapeHtml(shapeDiameterFromItem(item) || '?')}</b></div>` +
      '<div class="pc-spec-sep"></div>' +
      `<div class="pc-spec-cell"><span class="spec-lbl">אורך פיתוח:</span> <b>${Math.round((Number(totalLengthMm || 0)) / 10)}</b> ס״מ</div>` +
      (elementName ? `<div class="pc-spec-sep"></div><div class="pc-spec-cell"><span class="spec-lbl">אלמנט:</span> ${escapeHtml(elementName)}</div>` : '') +
    '</div>' +
    (note ? `<div class="pc-note">⚠ ${escapeHtml(note)}</div>` : '') +
    '<div class="pc-footer">' +
      `<div class="bc-font-footer">${escapeHtml(barcode)}</div>` +
      `<div class="pc-brand">SYNTA<br><span class="pc-brand-num">${item._palletNum || 1}</span></div>` +
    '</div>' +
  '</div>';
}

module.exports = {
  escapeHtml,
  printableItemNote,
  shapeSvg,
  itemShapeSvg,
  spiralShapeSvg,
  spiralDimensionsHtml,
  masterCard,
  itemCard,
  parseSegments,
  shapeSegmentsFromItem,
  isSpiralItem,
  spiralMetricsFromItem,
  attachOrderLineNumbers,
  orderLineLabel,
  orderLineTitle,
  shapeDiameterFromItem,
  shapeTotalLengthMmFromItem,
  isPrintableBendAngle,
  shapeSvgHasAngleLabels,
};
