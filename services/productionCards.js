function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function shapeSvg(segmentsRaw) {
  try {
    const segments = parseSegments(segmentsRaw);
    const width = 220;
    const height = 100;
    const padding = 18;
    if (!segments.length) {
      return '<svg viewBox="0 0 220 60" style="width:100%;max-height:80px">' +
        '<line x1="12" y1="30" x2="208" y2="30" stroke="#1a2332" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="12" cy="30" r="3" fill="#1a2332"/><circle cx="208" cy="30" r="3" fill="#1a2332"/></svg>';
    }

    const sides = segments.map(segment => Number(segment.length_mm || 0));
    const angles = segments.map(segment => segment.angle_deg);
    const points = [[0, 0]];
    let direction = 0;
    for (let i = 0; i < sides.length; i += 1) {
      const previous = points[points.length - 1];
      const radians = direction * Math.PI / 180;
      points.push([
        previous[0] + sides[i] * Math.cos(radians),
        previous[1] + sides[i] * Math.sin(radians),
      ]);
      if (i < angles.length - 1 && angles[i] != null) direction -= (180 - angles[i]);
    }

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

    for (let i = 0; i < mapped.length - 1; i += 1) {
      const [x1, y1] = mapped[i];
      const [x2, y2] = mapped[i + 1];
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lineLength = Math.sqrt(dx * dx + dy * dy) || 1;
      const normalX = -dy / lineLength * 10;
      const normalY = dx / lineLength * 10;
      svg += `<rect x="${(midX + normalX - 14).toFixed(1)}" y="${(midY + normalY - 6).toFixed(1)}" width="28" height="12" rx="2" fill="white" fill-opacity="0.9"/>`;
      svg += `<text x="${(midX + normalX).toFixed(1)}" y="${(midY + normalY).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="8" font-family="Heebo,Arial" font-weight="700" fill="#1a2332">${escapeHtml(sides[i])}</text>`;
    }

    for (let i = 1; i < mapped.length - 1; i += 1) {
      const angle = angles[i - 1];
      if (angle != null && angle !== 180) {
        const [x, y] = mapped[i];
        svg += `<circle cx="${x}" cy="${y}" r="9" fill="white" stroke="#c9621a" stroke-width="1.2"/>`;
        svg += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="7" font-family="Heebo,Arial" font-weight="700" fill="#c9621a">${escapeHtml(angle)}°</text>`;
      }
    }

    return `<svg viewBox="0 0 ${width} ${height}" style="width:100%;max-height:100px">${svg}</svg>`;
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
  const kgPerMeter = rebarWeights[Math.round(item.diameter || 0)];
  const weight = item.total_weight && item.total_weight > 0
    ? Number(item.total_weight).toFixed(2)
    : (kgPerMeter ? (Math.round((item.total_length_mm || 0) / 1000 * kgPerMeter * (item.quantity || 1) * 10) / 10).toFixed(2) : '0.00');

  let dimensions = '';
  for (let i = 0; i < segments.length; i += 1) {
    const label = String.fromCharCode(0x05D0 + i);
    dimensions += `<span class="dim-seg">${label}: <b>${escapeHtml(segments[i].length_mm || '')}</b></span>`;
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
      `<div class="pc-spec-cell"><span class="spec-lbl">אורך פיתוח:</span> <b>${item.total_length_mm || 0}</b> מ"מ</div>` +
      (item.struct_element ? `<div class="pc-spec-sep"></div><div class="pc-spec-cell"><span class="spec-lbl">איבר:</span> ${escapeHtml(item.struct_element)}</div>` : '') +
    '</div>' +
    (item.note ? `<div class="pc-note">⚠ ${escapeHtml(item.note)}</div>` : '') +
    '<div class="pc-footer">' +
      `<div class="bc-font-footer">${escapeHtml(barcode)}</div>` +
      `<div class="pc-brand">SYNTA<br><span class="pc-brand-num">${item._palletNum || 1}</span></div>` +
    '</div>' +
  '</div>';
}

module.exports = {
  escapeHtml,
  shapeSvg,
  masterCard,
  itemCard,
  parseSegments,
};
