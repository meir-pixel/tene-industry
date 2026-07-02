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

function rightAngleMarkerSvg(previous, corner, next) {
  const a = unitVector(corner, previous);
  const b = unitVector(corner, next);
  const d = 9;
  const p1 = pointAt(corner, a, d);
  const p2 = [p1[0] + b[0] * d, p1[1] + b[1] * d];
  const p3 = pointAt(corner, b, d);
  return '<path d="M ' + p1[0].toFixed(1) + ',' + p1[1].toFixed(1) + ' L ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1) + ' L ' + p3[0].toFixed(1) + ',' + p3[1].toFixed(1) + '" fill="none" stroke="#a8b0ba" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"/>';
}

function dimensionLabelSvg(text, x, y, width = 38) {
  return '<rect x="' + (x - width / 2).toFixed(1) + '" y="' + (y - 7).toFixed(1) + '" width="' + width + '" height="14" rx="3" fill="white" fill-opacity="0.96" stroke="#aeb8c5" stroke-width="0.7"/>' +
    '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="middle" dominant-baseline="middle" font-size="8" font-family="Heebo,Arial" font-weight="800" fill="#1a2332">' + escapeHtml(text) + '</text>';
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
  if (isRightAngle(angle)) return rightAngleMarkerSvg(previous, corner, next);
  const a = unitVector(corner, previous);
  const b = unitVector(corner, next);
  const p1 = pointAt(corner, a, 13);
  const p2 = pointAt(corner, b, 13);
  let vx = corner[0] - center[0];
  let vy = corner[1] - center[1];
  const len = Math.sqrt(vx * vx + vy * vy) || 1;
  vx /= len;
  vy /= len;
  const lx = corner[0] + vx * 20;
  const ly = corner[1] + vy * 20;
  const text = String(Math.round(Number(angle) || 0)) + '°';
  return '<path d="M ' + p1[0].toFixed(1) + ',' + p1[1].toFixed(1) + ' Q ' + corner[0].toFixed(1) + ',' + corner[1].toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1) + '" fill="none" stroke="#c9621a" stroke-width="1.4" stroke-linecap="round"/>' +
    dimensionLabelSvg(text, lx, ly, 30).replace('fill="#1a2332"', 'fill="#c9621a"');
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
  const path = `M ${left},${bottom} L ${left},${top} L ${right},${top} L ${right},${bottom}`;

  let svg = `<path d="${path}" fill="none" stroke="#1a2332" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  svg += `<path d="${path}" fill="none" stroke="#3a5070" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;

  svg += sideDimensionSvg([left, bottom], [left, top], leftLeg, [midX, midY], 22);
  svg += sideDimensionSvg([left, top], [right, top], bridge, [midX, midY], 20);
  svg += sideDimensionSvg([right, top], [right, bottom], rightLeg, [midX, midY], 22);

  [
    [[left, bottom], [left, top], [right, top]],
    [[left, top], [right, top], [right, bottom]],
  ].forEach(([previous, corner, next]) => {
    svg += rightAngleMarkerSvg(previous, corner, next);
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
    svg += rightAngleMarkerSvg(previous, corner, next);
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
  const path = 'M ' + bottomTailEnd.join(',') + ' L ' + left + ',' + bottom + ' L ' + right + ',' + bottom + ' L ' + right + ',' + top + ' L ' + left + ',' + top + ' L ' + topTailEnd.join(',');
  let svg = '<path d="' + path + '" fill="none" stroke="#1a2332" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>';
  svg += '<path d="' + path + '" fill="none" stroke="#3a5070" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';

  svg += dimensionLabelSvg(displayLengthCm(parts.top), (left + right) / 2, top - 14, 34);
  svg += dimensionLabelSvg(displayLengthCm(parts.right), right + 20, (top + bottom) / 2, 34);
  svg += dimensionLabelSvg(displayLengthCm(parts.bottom), (left + right) / 2, bottom + 14, 34);
  svg += dimensionLabelSvg(displayLengthCm(parts.tailA), bottomTailEnd[0] - 16, bottomTailEnd[1] - 8, 34);
  svg += dimensionLabelSvg(displayLengthCm(parts.tailB), topTailEnd[0] - 16, topTailEnd[1] + 8, 34);
  svg += dimensionLabelSvg(Math.round(parts.angleA) + String.fromCharCode(176), left - 4, bottom - 25, 30).replace('fill="#1a2332"', 'fill="#c9621a"');
  svg += dimensionLabelSvg(Math.round(parts.angleD) + String.fromCharCode(176), left - 4, top + 25, 30).replace('fill="#1a2332"', 'fill="#c9621a"');
  svg += rightAngleMarkerSvg([left, top], [right, top], [right, bottom]);
  svg += rightAngleMarkerSvg([right, top], [right, bottom], [left, bottom]);

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
    const points = normalizeShapePointsBaseBottom(calcShapePoints(sides, angles));

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
      if (angle != null && angle !== 180) {
        svg += angleMarkerSvg(mapped[i - 1], mapped[i], mapped[i + 1], angle, center);
      }
    }

    return `<svg data-shape-kind="generic-bar" data-scale-mode="print-fit" preserveAspectRatio="xMidYMid meet" viewBox="0 0 ${width} ${height}" style="width:100%;height:100%;max-height:100px;overflow:visible">${svg}</svg>`;
  } catch {
    return '<svg viewBox="0 0 220 60"><line x1="10" y1="30" x2="210" y2="30" stroke="#ccc" stroke-width="2"/></svg>';
  }
}

function masterCard(allItems, order, printDate, deliveryDate, numPallets) {
  const rows = allItems.map((item, index) => '<tr>' +
    `<td>${index + 1}</td>` +
    `<td><b>Ø${escapeHtml(item.diameter || '?')}</b></td>` +
    `<td>${escapeHtml(item.shape_name || '-')}</td>` +
    `<td class="master-shape-cell">${shapeSvg(item.segments)}</td>` +
    `<td>${Math.round((item.total_length_mm || 0) / 10)}</td>` +
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
  const barcode = `${order.order_num || ''}-${String(item.id).padStart(6, '0')}`;
  const segments = parseSegments(item.segments);
  const title = item.shape_name ? `כרטיס כיפוף - ${item.shape_name}` : 'כרטיס כיפוף';
  const note = printableItemNote(item.note);
  const kgPerMeter = rebarWeights[Math.round(item.diameter || 0)];
  const weight = item.total_weight && item.total_weight > 0
    ? Number(item.total_weight).toFixed(2)
    : (kgPerMeter ? (Math.round((item.total_length_mm || 0) / 1000 * kgPerMeter * (item.quantity || 1) * 10) / 10).toFixed(2) : '0.00');

  let dimensions = '';
  for (let i = 0; i < segments.length; i += 1) {
    const label = String.fromCharCode(0x05D0 + i);
    dimensions += `<span class="dim-seg">${label}: <b>${escapeHtml(displayLengthCm(segments[i].length_mm || 0))}</b> ס״מ</span>`;
    if (i < segments.length - 1 && segments[i].angle_deg && segments[i].angle_deg !== 180) {
      dimensions += `<span class="dim-ang">${escapeHtml(segments[i].angle_deg)}°</span>`;
    }
  }

  return '<div class="prod-card">' +
    '<div class="pc-head">' +
      `<div><div class="pc-title">${escapeHtml(title)}</div><div class="pc-date">${escapeHtml(printDate)}</div></div>` +
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
    `<div class="pc-shape-area">${shapeSvg(item.segments)}</div>` +
    (dimensions ? `<div class="pc-dims">${dimensions}</div>` : '') +
    '<div class="pc-spec-row">' +
      `<div class="pc-spec-cell"><span class="spec-lbl">קוטר:</span> <b>Ø${escapeHtml(item.diameter || '?')}</b></div>` +
      '<div class="pc-spec-sep"></div>' +
      `<div class="pc-spec-cell"><span class="spec-lbl">אורך פיתוח:</span> <b>${Math.round((Number(item.total_length_mm || 0)) / 10)}</b> ס״מ</div>` +
      (item.struct_element ? `<div class="pc-spec-sep"></div><div class="pc-spec-cell"><span class="spec-lbl">איבר:</span> ${escapeHtml(item.struct_element)}</div>` : '') +
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
  masterCard,
  itemCard,
  parseSegments,
};
