const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/orderPrintA4 missing dependency: ${name}`);
  return value;
}

module.exports = function createOrderPrintA4Router(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const tryParseJSON = required('tryParseJSON', deps.tryParseJSON);

// ── PRINT A4 ──────────────────────────────────────────────────────
router.get('/orders/:id/print-a4', requireAnyRole(['office', 'production', 'manager', 'admin']), (req, res) => {
  const order = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone
    FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.id);
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
  })));

  const safeCustomer = (order.customer_name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const totalWeight  = (order.total_weight || 0).toFixed(1);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<title>הדפסת A4 – ${order.order_num}</title>
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
.hdr{display:flex;justify-content:space-between;align-items:flex-start;
  border-bottom:3px solid #1a2332;padding-bottom:10px;margin-bottom:12px;}
.hdr-title{font-size:22px;font-weight:900;color:#1a2332;}
.hdr-sub{font-size:13px;color:#555;margin-top:3px;}
.hdr-right{text-align:left;}
.order-num{font-size:28px;font-weight:900;color:#c9621a;line-height:1;}
.hdr-meta{font-size:11px;color:#666;margin-top:4px;line-height:1.6;}

/* Summary row */
.summary{display:flex;gap:0;margin-bottom:12px;border:1px solid #ddd;border-radius:6px;overflow:hidden;}
.sum-cell{flex:1;padding:8px 12px;border-left:1px solid #ddd;text-align:center;}
.sum-cell:last-child{border-left:none;}
.sum-label{font-size:10px;color:#888;margin-bottom:2px;}
.sum-val{font-size:16px;font-weight:900;color:#1a2332;}

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
    <div>
      <div class="hdr-title">טופס ייצור – כיפוף ברזל</div>
      <div class="hdr-sub">IronBend Production Sheet</div>
    </div>
    <div class="hdr-right">
      <div class="order-num">${order.order_num}</div>
      <div class="hdr-meta">
        לקוח: <b>${safeCustomer}</b><br>
        תאריך הזמנה: <b>${printDate}</b><br>
        תאריך מסירה: <b>${delivDate}</b>
      </div>
    </div>
  </div>

  <!-- Summary -->
  <div class="summary">
    <div class="sum-cell"><div class="sum-label">סה"כ פריטים</div><div class="sum-val">${allItems.length}</div></div>
    <div class="sum-cell"><div class="sum-label">סה"כ ק"ג</div><div class="sum-val">${totalWeight}</div></div>
    <div class="sum-cell"><div class="sum-label">משטחים</div><div class="sum-val">${pallets.length}</div></div>
    <div class="sum-cell"><div class="sum-label">הזמנה</div><div class="sum-val">${order.order_num}</div></div>
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

function drawShape2D(svgEl, segments, W, H) {
  if (!segments || !segments.length) {
    svgEl.innerHTML = '<text x="'+W/2+'" y="'+H/2+'" text-anchor="middle" font-size="10" fill="#aaa">ישר</text>';
    return;
  }
  var sides  = segments.map(function(s){ return s.length_mm || 0; });
  // angle_deg in DB = bend angle (e.g. 90° = right-angle bend), stored per-segment but used between segments
  var bendAngs = segments.map(function(s){ return s.angle_deg != null ? s.angle_deg : 180; });
  var pts = [[0,0]];
  var dir = 0; // current direction in degrees (0=right, positive=clockwise on screen)
  for (var i = 0; i < sides.length; i++) {
    var rad = dir * Math.PI / 180;
    var p = pts[pts.length-1];
    pts.push([p[0] + sides[i]*Math.cos(rad), p[1] + sides[i]*Math.sin(rad)]);
    // Apply turn: bend angle 90° = turn 90° (dir decreases by 180-angle)
    if (i < bendAngs.length - 1) dir -= (180 - bendAngs[i+1]);
  }
  var PAD=16;
  var xs=pts.map(function(p){return p[0];}), ys=pts.map(function(p){return p[1];});
  var minX=Math.min.apply(null,xs), maxX=Math.max.apply(null,xs);
  var minY=Math.min.apply(null,ys), maxY=Math.max.apply(null,ys);
  var rX=maxX-minX||1, rY=maxY-minY||1;
  var sc=Math.min((W-PAD*2)/rX,(H-PAD*2)/rY);
  var oX=PAD+((W-PAD*2)-rX*sc)/2, oY=PAD+((H-PAD*2)-rY*sc)/2;
  var mp=function(p){return [(oX+(p[0]-minX)*sc).toFixed(1),(oY+(p[1]-minY)*sc).toFixed(1)];};
  var mapped=pts.map(mp);
  var pd='M '+mapped.map(function(p){return p[0]+','+p[1];}).join(' L ');
  var svg='<path d="'+pd+'" fill="none" stroke="#1a2332" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>';
  // Segment length labels
  for (var i=0; i<mapped.length-1; i++) {
    var x1=parseFloat(mapped[i][0]),y1=parseFloat(mapped[i][1]);
    var x2=parseFloat(mapped[i+1][0]),y2=parseFloat(mapped[i+1][1]);
    var mx=(x1+x2)/2,my=(y1+y2)/2,dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy);
    if (len < 6) continue;
    var nx=(-dy/len)*9, ny=(dx/len)*9;
    svg+='<rect x="'+(mx+nx-14).toFixed(1)+'" y="'+(my+ny-6).toFixed(1)+'" width="28" height="11" rx="2" fill="white" fill-opacity="0.9"/>';
    svg+='<text x="'+(mx+nx).toFixed(1)+'" y="'+(my+ny).toFixed(1)+'" text-anchor="middle" dominant-baseline="middle" font-size="8" font-family="Heebo,Arial" font-weight="700" fill="#1a2332">'+sides[i]+'</text>';
  }
  svgEl.setAttribute('viewBox','0 0 '+W+' '+H);
  svgEl.innerHTML = svg;
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
    var SVG_W = 130, SVG_H = 55;
    var uid = 'sv'+i;
    var row = document.createElement('tr');
    row.innerHTML =
      '<td class="row-num">'+it.rowNum+'</td>'+
      '<td class="diam">Ø'+it.diameter+'</td>'+
      '<td class="shape-td"><svg id="'+uid+'" class="shape-svg" width="'+SVG_W+'" height="'+SVG_H+'" viewBox="0 0 '+SVG_W+' '+SVG_H+'"></svg></td>'+
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

  // Draw shapes
  for (var j=0; j<allItems.length; j++) {
    var svgEl = document.getElementById('sv'+j);
    if (svgEl) drawShape2D(svgEl, allItems[j].segments, 130, 55);
  }
}

buildTable();
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
