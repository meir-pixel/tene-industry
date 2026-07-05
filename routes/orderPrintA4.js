const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/orderPrintA4 missing dependency: ${name}`);
  return value;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrintNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return digits === 0 ? '0' : '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function productionBucketForA4Item(item, segments, snapshot) {
  const text = [item.shape_name, item.struct_element, snapshot && snapshot.kind, snapshot && snapshot.type, snapshot && snapshot.family]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/mesh|wire|רשת/.test(text)) return 'mesh';
  if (/cage|pile|כלוב|כלונס/.test(text)) return 'cage';
  return Array.isArray(segments) && segments.length > 1 ? 'bending' : 'cutting';
}

function buildA4ProductionSummary({ order, allItems, tryParseJSON }) {
  const totals = { quantity: 0, weight: 0, lengthMm: 0, cuttingWeight: 0, bendingWeight: 0, meshWeight: 0, cageWeight: 0 };
  const bucketLabels = {
    cutting: '\u05d7\u05d9\u05ea\u05d5\u05da / \u05de\u05d5\u05d8\u05d5\u05ea \u05d9\u05e9\u05e8\u05d9\u05dd',
    bending: '\u05db\u05d9\u05e4\u05d5\u05e3',
    mesh: '\u05e8\u05e9\u05ea\u05d5\u05ea',
    cage: '\u05db\u05dc\u05d5\u05d1\u05d9\u05dd / \u05db\u05dc\u05d5\u05e0\u05e1\u05d0\u05d5\u05ea',
  };
  const byBucket = new Map();

  allItems.forEach((item) => {
    const qty = Number(item.quantity || 0);
    const weight = Number(item.total_weight || 0);
    const lengthMm = Number(item.total_length_mm || 0) * qty;
    const segments = tryParseJSON(item.segments, []);
    const snapshot = tryParseJSON(item.shape_snapshot_json || item.shapeSnapshot, {}) || {};
    const bucket = productionBucketForA4Item(item, segments, snapshot);

    totals.quantity += qty;
    totals.weight += weight;
    totals.lengthMm += lengthMm;
    totals[bucket + 'Weight'] += weight;

    const row = byBucket.get(bucket) || { quantity: 0, weight: 0, lengthMm: 0, items: 0 };
    row.quantity += qty;
    row.weight += weight;
    row.lengthMm += lengthMm;
    row.items += 1;
    byBucket.set(bucket, row);
  });

  const optionalWeightRows = [
    ['meshWeight', '\u05de\u05e9\u05e7\u05dc \u05e8\u05e9\u05ea\u05d5\u05ea'],
    ['cageWeight', '\u05de\u05e9\u05e7\u05dc \u05db\u05dc\u05d5\u05d1\u05d9\u05dd'],
  ]
    .map(([key, label]) => Number(totals[key] || 0) > 0
      ? '<tr><td>' + label + '</td><td>' + formatPrintNumber(totals[key], 2) + ' \u05e7\u05d2</td></tr>'
      : '')
    .filter(Boolean)
    .join('');

  const bucketRows = ['cutting', 'bending', 'mesh', 'cage']
    .map((bucket) => {
      const row = byBucket.get(bucket);
      if (!row || row.weight <= 0) return '';
      const details = formatPrintNumber(row.weight, 2) + ' \u05e7\u05d2 | ' + formatPrintNumber(row.quantity, 0) + ' \u05d9\u05d7 | ' + formatPrintNumber(row.lengthMm / 1000, 2) + ' \u05de';
      return '<tr><td>' + bucketLabels[bucket] + '</td><td>' + details + '</td></tr>';
    })
    .filter(Boolean)
    .join('') || '<tr><td colspan="2">\u05d0\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9 \u05e1\u05d9\u05db\u05d5\u05dd \u05dc\u05e4\u05d9 \u05e1\u05d5\u05d2 \u05e2\u05d1\u05d5\u05d3\u05d4</td></tr>';

  const notes = [order.notes, order.general_notes, order.production_notes, order.driver_notes]
    .filter(Boolean)
    .join(' / ');

  return {
    totals,
    bucketRows,
    optionalWeightRows,
    notes: escapeHtml(notes || '-'),
    project: escapeHtml(order.project_name || order.project || '-'),
    site: escapeHtml(order.site_name || order.building || order.delivery_address || '-'),
  };
}

module.exports = function createOrderPrintA4Router(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const tryParseJSON = required('tryParseJSON', deps.tryParseJSON);
  const productionCards = deps.productionCards || require('../services/productionCards');

// ── PRINT A4 ──────────────────────────────────────────────────────
router.get('/orders/:id/print-a4', requireAnyRole(['office', 'production', 'manager', 'admin']), (req, res) => {
  const order = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone,
      p.name as project_name, COALESCE(cs.name, legacy_site.name) as site_name
    FROM orders o
    LEFT JOIN customers c ON o.customer_id=c.id
    LEFT JOIN projects p ON o.project_id=p.id
    LEFT JOIN customer_sites cs ON o.site_id=cs.id
    LEFT JOIN sites legacy_site ON o.site_id=legacy_site.id
    WHERE o.id=?`).get(req.params.id);
  if (!order) return res.status(404).send('הזמנה לא נמצאה');

  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=? ORDER BY pallet_num').all(order.id);
  pallets.forEach(p => {
    p.items = db.prepare('SELECT * FROM items WHERE pallet_id=? ORDER BY id').all(p.id);
    p.items.forEach(item => { item._palletNum = p.pallet_num; });
  });
  const allItems = pallets.flatMap(p => p.items);

  const fmtDate = d => {
    const dt = d ? new Date(d) : new Date();
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
  };
  const printDate = fmtDate(order.created_at);
  const delivDate = order.delivery_date ? fmtDate(order.delivery_date) : '—';

  const allItemsJson = JSON.stringify(allItems.map((it, idx) => ({
    rowNum:         idx + 1,
    segments:       tryParseJSON(it.segments, []),
    diameter:       it.diameter || '',
    shape_name:     it.shape_name || '',
    quantity:       it.quantity || 1,
    total_length_mm:it.total_length_mm || 0,
    total_length_cm:(Math.round((it.total_length_mm||0)/10)),
    total_weight:   it.total_weight || 0,
    material_grade: it.material_grade || 'B500B',
    struct_element: it.struct_element || '',
    note:           it.note || '',
    pallet_num:     it._palletNum || 1,
    shape_svg:      productionCards.shapeSvg(it.segments),
  })));

  const safeCustomer = (order.customer_name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const totalWeight  = (order.total_weight || 0).toFixed(1);
  const productionSummary = buildA4ProductionSummary({ order, allItems, tryParseJSON });
  const fullOrderUrl = '/orders.html?order=' + encodeURIComponent(order.id);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<title>הדפסת A4 – ${order.order_num}</title>
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Heebo',Arial,sans-serif;background:#f5f5f5;color:#1a2332;direction:rtl;padding:14px;}

/* Screen toolbar */
.no-print{margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.btn-print{padding:9px 24px;background:#1a2332;color:#fff;border:none;border-radius:7px;
  cursor:pointer;font-size:14px;font-family:inherit;font-weight:700;}
.btn-print:hover{background:#c9621a;}

/* Page wrapper */
.page{background:#fff;max-width:210mm;margin:0 auto;padding:14mm 12mm 12mm;
  box-shadow:0 2px 12px rgba(0,0,0,0.12);}

/* Header */
.hdr{display:grid;grid-template-columns:34mm 1fr 30mm;gap:8mm;align-items:center;
  border-bottom:3px solid #1a2332;padding-bottom:10px;margin-bottom:12px;}
.hdr-logo{width:32mm;height:auto;display:block;}
.hdr-main{min-width:0;}
.hdr-title{font-size:22px;font-weight:900;color:#1a2332;}
.hdr-sub{font-size:13px;color:#555;margin-top:3px;}
.hdr-right{text-align:left;}
.order-qr{width:27mm;height:27mm;border:1px solid #cfd8e3;display:flex;align-items:center;justify-content:center;background:#fff;justify-self:end;}
.order-qr canvas,.order-qr img{width:25mm!important;height:25mm!important;display:block;}
.order-num{font-size:28px;font-weight:900;color:#c9621a;line-height:1;}
.hdr-meta{font-size:11px;color:#666;margin-top:4px;line-height:1.6;}

/* Summary row */
.summary{display:flex;gap:0;margin-bottom:12px;border:1px solid #ddd;border-radius:6px;overflow:hidden;}
.sum-cell{flex:1;padding:8px 12px;border-left:1px solid #ddd;text-align:center;}
.sum-cell:last-child{border-left:none;}
.sum-label{font-size:10px;color:#888;margin-bottom:2px;}
.sum-val{font-size:16px;font-weight:900;color:#1a2332;}
.production-summary{display:grid;grid-template-columns:1.1fr .9fr;gap:10px;margin-bottom:12px;}
.prod-summary-box{border:1px solid #d0d7e0;border-radius:6px;overflow:hidden;background:#fff;}
.prod-summary-box h2{font-size:12px;background:#eef3fb;color:#1a2332;padding:6px 9px;border-bottom:1px solid #d0d7e0;}
.prod-summary-grid{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #d0d7e0;}
.prod-summary-grid div{padding:6px 8px;border-left:1px solid #d0d7e0;text-align:center;min-width:0;}
.prod-summary-grid div:last-child{border-left:none;}
.prod-summary-grid span{display:block;font-size:9px;color:#667;font-weight:700;}
.prod-summary-grid b{display:block;font-size:13px;color:#1a2332;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.prod-breakdown{width:100%;border-collapse:collapse;font-size:10.5px;}
.prod-breakdown td{border-bottom:1px solid #e1e6ed;padding:5px 8px;}
.prod-breakdown td:last-child{text-align:left;direction:ltr;font-weight:900;}
.prod-notes{font-size:10px;line-height:1.45;padding:7px 9px;color:#333;min-height:24px;}

/* Table */
.items-table{width:100%;border-collapse:collapse;font-size:11px;}
.items-table th{background:#1a2332;color:#fff;padding:7px 6px;text-align:center;
  font-size:11px;font-weight:700;border:1px solid #1a2332;}
.items-table td{padding:5px 5px;border:1px solid #d0d7e0;vertical-align:middle;text-align:center;}
.items-table tr:nth-child(even) td{background:#f7f9fc;}
.items-table tr:hover td{background:#eef3fb;}
.row-num{font-weight:900;font-size:13px;color:#1a2332;min-width:20px;}
.diam{font-weight:900;font-size:13px;color:#c9621a;}
.shape-td{min-width:120px;max-width:180px;padding:3px!important;}
.shape-svg{display:block;margin:0 auto;}
.dims-td{text-align:right;font-size:10px;line-height:1.7;min-width:90px;}
.seg-dim{white-space:nowrap;}
.seg-lbl{font-weight:700;color:#1a2332;}
.seg-ang{color:#c9621a;font-size:9px;}
.len-val{font-size:13px;font-weight:900;}
.qty-val{font-size:15px;font-weight:900;color:#1a2332;}
.wt-val{font-size:12px;font-weight:700;}
.note-row td{background:#fff8e1!important;color:#856404;font-size:10px;padding:3px 8px!important;text-align:right!important;}
.check-box{width:18px;height:18px;border:1.5px solid #aaa;border-radius:3px;display:inline-block;}

/* Totals */
.totals-row{background:#1a2332!important;}
.totals-row td{color:#fff!important;font-weight:900;font-size:12px;padding:7px 6px!important;
  border-color:#1a2332!important;}

/* Footer */
.footer{margin-top:14px;display:flex;justify-content:space-between;align-items:center;
  border-top:2px solid #1a2332;padding-top:8px;font-size:10px;color:#888;}
.footer-brand{font-weight:900;color:#c9621a;font-size:13px;}

@media print{
  body{background:#fff;padding:0;}
  .no-print{display:none!important;}
  .page{box-shadow:none;padding:8mm 8mm 8mm;max-width:100%;}
  .production-summary{grid-template-columns:1.1fr .9fr;gap:8px;}
  @page{size:A4 portrait;margin:0;}
}
</style>
</head>
<body>

<div class="no-print">
  <button class="btn-print" onclick="window.print()">🖨️ הדפס A4</button>
  <span style="font-size:13px;color:#555;">הזמנה ${order.order_num} · ${safeCustomer} · ${allItems.length} פריטים</span>
</div>

<div class="page">
  <!-- Header -->
  <div class="hdr">
    <img class="hdr-logo" src="/brand/tene-pdf-logo.jpg" alt="TENA">
    <div class="hdr-main">
      <div class="hdr-title">טופס ייצור – כיפוף ברזל</div>
      <div class="hdr-sub">IronBend Production Sheet</div>
      <div class="hdr-meta">פרויקט: <b>${productionSummary.project}</b> · אתר / בניין: <b>${productionSummary.site}</b></div>
    </div>
    <div class="hdr-right">
      <div class="order-num">${order.order_num}</div>
      <div class="hdr-meta">
        לקוח: <b>${safeCustomer}</b><br>
        תאריך הזמנה: <b>${printDate}</b><br>
        תאריך מסירה: <b>${delivDate}</b>
      </div>
    </div>
      <div class="order-qr" data-order-url="${fullOrderUrl}"></div>
  </div>

  <!-- Summary -->
  <div class="summary">
    <div class="sum-cell"><div class="sum-label">סה"כ פריטים</div><div class="sum-val">${allItems.length}</div></div>
    <div class="sum-cell"><div class="sum-label">סה"כ ק"ג</div><div class="sum-val">${totalWeight}</div></div>
    <div class="sum-cell"><div class="sum-label">משטחים</div><div class="sum-val">${pallets.length}</div></div>
    <div class="sum-cell"><div class="sum-label">הזמנה</div><div class="sum-val">${order.order_num}</div></div>
  </div>
  <!-- Production summary -->
  <div class="production-summary">
    <div class="prod-summary-box">
      <h2>סיכום משקלים לייצור</h2>
      <div class="prod-summary-grid">
        <div><span>כמות / מוטות</span><b>${formatPrintNumber(productionSummary.totals.quantity, 0)}</b></div>
        <div><span>אורך כולל</span><b>${formatPrintNumber(productionSummary.totals.lengthMm / 1000, 2)} מ</b></div>
        <div><span>משקל חיתוך</span><b>${formatPrintNumber(productionSummary.totals.cuttingWeight, 2)} קג</b></div>
        <div><span>משקל כיפוף</span><b>${formatPrintNumber(productionSummary.totals.bendingWeight, 2)} קג</b></div>
      </div>
      ${productionSummary.optionalWeightRows ? '<table class="prod-breakdown"><tbody>' + productionSummary.optionalWeightRows + '</tbody></table>' : ''}
      <div class="prod-notes"><b>הערות:</b> ${productionSummary.notes}</div>
    </div>
    <div class="prod-summary-box">
      <h2>פירוט לפי סוג עבודה</h2>
      <table class="prod-breakdown"><tbody>${productionSummary.bucketRows}</tbody></table>
    </div>
  </div>
  <!-- Items table -->
  <table class="items-table" id="itemsTable">
    <thead>
      <tr>
        <th>#</th>
        <th>⌀ נ'</th>
        <th>צורה</th>
        <th>מידות (מ"מ)</th>
        <th>L סה"כ<br>(ס"מ)</th>
        <th>כמות</th>
        <th>ק"ג</th>
        <th>✓</th>
      </tr>
    </thead>
    <tbody id="tableBody"></tbody>
  </table>

  <!-- Footer -->
  <div class="footer">
    <div>הודפס: ${printDate} · IronBend</div>
    <div class="footer-brand">הזמנה ${order.order_num}</div>
    <div>חתימה: _______________</div>
  </div>
</div>

<script>
var allItems = ${allItemsJson};

function renderOrderQrCodes() {
  document.querySelectorAll('[data-order-url]').forEach(function(node) {
    var target = new URL(node.getAttribute('data-order-url'), window.location.origin).href;
    node.innerHTML = '';
    if (window.QRCode && window.QRCode.toCanvas) {
      var canvas = document.createElement('canvas');
      node.appendChild(canvas);
      window.QRCode.toCanvas(canvas, target, { width: 112, margin: 0 }, function(){});
    } else {
      node.textContent = 'QR';
      node.title = target;
    }
  });
}

function buildDimsHtml(segments) {
  if (!segments || !segments.length) return '<span style="color:#aaa;font-size:10px;">—</span>';
  var html = '';
  for (var i=0; i<segments.length; i++) {
    var lbl = String.fromCharCode(0x05D0+i); // א,ב,ג...
    html += '<div class="seg-dim"><span class="seg-lbl">'+lbl+':</span> '+segments[i].length_mm+'</div>';
    if (i < segments.length-1 && segments[i].angle_deg != null && segments[i].angle_deg !== 180) {
      html += '<div class="seg-ang">∠ '+segments[i].angle_deg+'°</div>';
    }
  }
  return html;
}

function buildTable() {
  var tbody = document.getElementById('tableBody');
  var totalQty = 0, totalWt = 0;
  for (var i=0; i<allItems.length; i++) {
    var it = allItems[i];
    totalQty += it.quantity;
    totalWt  += it.total_weight;
    var SVG_W = 130, SVG_H = 68;
    var uid = 'sv'+i;
    var row = document.createElement('tr');
    row.innerHTML =
      '<td class="row-num">'+it.rowNum+'</td>'+
      '<td class="diam">Ø'+it.diameter+'</td>'+
      '<td class="shape-td"><div class="shape-svg" id="'+uid+'">'+(it.shape_svg||'')+'</div></td>'+
      '<td class="dims-td">'+buildDimsHtml(it.segments)+'</td>'+
      '<td><span class="len-val">'+it.total_length_cm+'</span></td>'+
      '<td><span class="qty-val">'+it.quantity+'</span></td>'+
      '<td><span class="wt-val">'+(it.total_weight||0).toFixed(1)+'</span></td>'+
      '<td><span class="check-box"></span></td>';
    tbody.appendChild(row);
    if (it.note) {
      var noteRow = document.createElement('tr');
      noteRow.className = 'note-row';
      noteRow.innerHTML = '<td colspan="8">⚠ '+it.note+'</td>';
      tbody.appendChild(noteRow);
    }
  }
  // Totals row
  var totRow = document.createElement('tr');
  totRow.className = 'totals-row';
  totRow.innerHTML =
    '<td colspan="5" style="text-align:right;padding-right:10px!important;">סה"כ</td>'+
    '<td>'+totalQty+'</td>'+
    '<td>'+totalWt.toFixed(1)+'</td>'+
    '<td></td>';
  tbody.appendChild(totRow);

}

buildTable();
renderOrderQrCodes();
</script>
</body>
</html>`);
});

  return router;
};

module.exports.manifest = {
  screens: [],
  access: { default: 'hidden', roles: { admin: 'edit' } },
  "id": "order-print-a4",
  "label": "Order A4 Print",
  "consumes": [
    {
      "table": "orders"
    },
    {
      "table": "items"
    }
  ],
  "produces": []
};
