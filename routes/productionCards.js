const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/productionCards missing dependency: ${name}`);
  return value;
}

module.exports = function createProductionCardsRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const cards = required('productionCards', deps.productionCards);
  const REBAR_WEIGHTS = required('REBAR_WEIGHTS', deps.REBAR_WEIGHTS);
  const rebarKgPerMeter = required('rebarKgPerMeter', deps.rebarKgPerMeter);
  const tryParseJSON = required('tryParseJSON', deps.tryParseJSON);
  const normalizeFactorySegments = required('normalizeFactorySegments', deps.normalizeFactorySegments);
  const normalizeFactoryShapeName = required('normalizeFactoryShapeName', deps.normalizeFactoryShapeName);

// ── PRINT CARDS ───────────────────────────────────────────────────
router.get('/orders/:id/print-cards', requireAnyRole(['office', 'production', 'manager', 'admin']), (req, res) => {
  const order = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
    FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.id);
  if (!order) return res.status(404).send('הזמנה לא נמצאה');

  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=? ORDER BY pallet_num').all(order.id);
  pallets.forEach(p => {
    p.items = db.prepare('SELECT * FROM items WHERE pallet_id=? ORDER BY id').all(p.id);
    p.items.forEach(item => {
      item._palletNum = p.pallet_num;
      const segments = normalizeFactorySegments(item.shape_name, tryParseJSON(item.segments, []));
      item.shape_name = normalizeFactoryShapeName(item.shape_name, segments);
      item.segments = JSON.stringify(segments);
    });
  });
  order.pallets = pallets;

  const allItems = pallets.flatMap(p => p.items);

  // Format date dd-mm-yyyy
  const today = new Date();
  const fmtDate = d => {
    const dt = d ? new Date(d) : today;
    return `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()}`;
  };
  const printDate = fmtDate(order.created_at);
  const delivDate = order.delivery_date ? fmtDate(order.delivery_date) : '';

  // Server-side rendered setup rows and cards
  const setupRowsHtml = allItems.map((it,i) =>
    '<tr><td>'+(i+1)+'</td><td>'+cards.escapeHtml(it.shape_name||'–')+'</td>' +
    '<td><b>\xd8'+(+it.diameter||'?')+'</b></td><td><b>'+(it.quantity||1)+'</b></td>' +
    '<td><input class="split-inp" type="number" min="1" max="'+(it.quantity||1)+'" value="1" id="sp-'+it.id+'" oninput="onSplitChange('+it.id+','+(it.quantity||1)+')"></td>' +
    '<td><div class="split-detail" id="sd-'+it.id+'">כרטיסייה אחת – כל הכמות</div></td></tr>'
  ).join('');

  const serverCardsHtml = (allItems.length
    ? cards.masterCard(allItems, order, printDate, delivDate, pallets.length) +
      allItems.map(it => cards.itemCard(it, order, printDate, REBAR_WEIGHTS)).join('')
    : '<div style="padding:40px;text-align:center;color:#888;">אין פריטים בהזמנה זו</div>'
  );

  console.log('[print-cards] order', req.params.id, '→', allItems.length, 'items server-rendered');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<title>כרטיסיות ייצור – ${order.order_num}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&family=Libre+Barcode+128&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Heebo',Arial,sans-serif;background:#e8e8e8;padding:16px;direction:rtl;}

/* ── Screen-only UI ── */
.screen-only{margin-bottom:14px;}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;}
.print-btn{padding:9px 22px;background:#1a2332;color:#fff;border:none;border-radius:6px;
  cursor:pointer;font-size:14px;font-family:inherit;}
.print-btn:hover{background:#c9621a;}
.gen-btn{padding:9px 22px;background:#1a7a3c;color:#fff;border:none;border-radius:6px;
  cursor:pointer;font-size:14px;font-family:inherit;}
.gen-btn:hover{background:#0f5a2a;}

/* Setup panel */
.setup-panel{background:#fff;border-radius:10px;padding:14px 18px;
  box-shadow:0 2px 8px rgba(0,0,0,0.12);margin-bottom:16px;}
.setup-title{font-size:15px;font-weight:900;color:#1a2332;margin-bottom:12px;}
.setup-tbl{width:100%;border-collapse:collapse;font-size:12px;}
.setup-tbl th{background:#f0f4f8;padding:7px 10px;border:1px solid #dce3ea;
  font-weight:700;color:#1a2332;text-align:right;}
.setup-tbl td{padding:6px 10px;border:1px solid #dce3ea;color:#333;vertical-align:middle;}
.setup-tbl tr:hover td{background:#f8fbff;}
.split-inp{width:52px;text-align:center;border:1px solid #bbc;border-radius:5px;
  padding:4px 6px;font-size:13px;font-family:inherit;}
.split-detail{font-size:11px;color:#666;margin-top:3px;}
.split-summary{margin-top:8px;font-size:12px;font-weight:700;color:#1a2332;}
.split-summary.warn{color:#9f4f00;background:#fff3d7;border:1px solid #ffd6a0;border-radius:6px;padding:7px 9px;}

/* ── Cards ── */
.cards-grid{display:flex;flex-wrap:wrap;gap:8px;}
.prod-card{width:148mm;background:#fff;border:1.5px solid #bbb;border-radius:4px;
  overflow:hidden;page-break-inside:avoid;display:flex;flex-direction:column;
  font-size:11px;box-shadow:0 2px 6px rgba(0,0,0,0.12);}
.pc-head{display:flex;justify-content:space-between;align-items:flex-start;
  padding:7px 10px 5px;border-bottom:2px solid #1a2332;background:#fff;}
.pc-title{font-size:13px;font-weight:900;color:#1a2332;line-height:1.2;}
.pc-date{font-size:10px;color:#666;margin-top:2px;}
.pc-top-barcode{text-align:center;min-width:90px;}
.bc-font-top{font-family:'Libre Barcode 128',cursive;font-size:46px;line-height:1;max-height:48px;overflow:hidden;letter-spacing:0;color:#000;}
.bc-font-mid{font-family:'Libre Barcode 128',cursive;font-size:36px;line-height:1;max-height:38px;overflow:hidden;letter-spacing:0;color:#000;}
.bc-font-footer{font-family:'Libre Barcode 128',cursive;font-size:30px;line-height:1;max-height:32px;overflow:hidden;letter-spacing:0;color:#fff;flex:1;}
.bc-label{font-size:7px;color:#555;margin-top:1px;text-align:center;font-family:monospace;}
.bc-ord-text{font-size:9px;color:#333;font-family:monospace;text-align:center;}
.master-shape-cell{width:90px;padding:2px 4px!important;}
.master-shape-cell svg{width:88px;max-height:44px;}
.split-badge{display:inline-block;background:#e07b39;color:#fff;border-radius:4px;
  font-size:11px;font-weight:900;padding:1px 6px;margin-left:5px;white-space:nowrap;}
.pc-order-row{display:flex;align-items:center;gap:8px;padding:4px 10px;
  border-bottom:1px solid #eee;background:#fafafa;}
.pc-order-label{font-size:10px;color:#555;white-space:nowrap;}
.pc-order-barcode{flex:1;}
.pc-pallet{font-size:11px;color:#333;white-space:nowrap;border-right:1px solid #ddd;padding-right:8px;}
.pc-wq-row{display:flex;align-items:center;padding:5px 10px;gap:4px;
  border-bottom:1px solid #eee;background:#fff;}
.pc-wq-cell{display:flex;align-items:baseline;gap:3px;flex:1;}
.wq-lbl{font-size:10px;color:#666;}
.wq-val{font-size:15px;font-weight:900;color:#1a2332;}
.wq-cust{font-size:10px;font-weight:700;color:#333;}
.pc-wq-sep{width:1px;height:18px;background:#ddd;}
.pc-shape-area{flex:1;min-height:105px;display:flex;align-items:center;
  justify-content:center;padding:6px 8px;background:#fafbfc;border-bottom:1px solid #eee;}
.pc-shape-svg{width:100%;max-height:120px;}
.pc-dims{display:flex;flex-wrap:wrap;gap:4px;padding:4px 10px;
  border-bottom:1px solid #eee;background:#f5f8fb;}
.dim-seg{font-size:10px;background:#e8f0fb;border-radius:3px;padding:2px 5px;color:#1a2332;}
.dim-ang{font-size:10px;background:#fff3e0;border-radius:3px;padding:2px 5px;color:#c9621a;font-weight:700;}
.pc-spec-row{display:flex;align-items:center;gap:0;padding:5px 10px;
  border-bottom:1px solid #eee;background:#fff;}
.pc-spec-cell{font-size:11px;color:#1a2332;flex:1;}
.spec-lbl{color:#666;font-size:10px;}
.pc-spec-sep{width:1px;height:16px;background:#ddd;margin:0 6px;}
.pc-note{padding:3px 10px;background:#fff3cd;font-size:10px;color:#856404;border-bottom:1px solid #f0d060;}
.pc-footer{display:flex;align-items:center;justify-content:space-between;
  padding:5px 10px;background:#1a2332;}
.pc-brand{color:#e07b39;font-weight:900;font-size:12px;line-height:1.1;text-align:center;}
.pc-brand-num{font-size:18px;font-weight:900;color:#fff;}
.master-card{min-height:auto;}
.master-table{width:100%;border-collapse:collapse;font-size:10px;}
.master-table th,.master-table td{border:1px solid #ddd;padding:3px 5px;text-align:center;}
.master-table th{background:#f0f0f0;font-weight:700;}
.check-cell{font-size:14px;color:#aaa;}
.master-totals{padding:5px 10px;font-size:11px;color:#333;background:#f5f5f5;border-top:1px solid #ddd;}
.qr-box-center{display:flex;justify-content:center;padding:8px;}
.qr-box-center canvas,.qr-box-center img{width:72px!important;height:72px!important;}

@media print{
  body{background:#fff;padding:0;}
  .screen-only{display:none!important;}
  .cards-grid{display:block!important;gap:0;}
  .prod-card{display:block!important;margin:2mm;box-shadow:none;break-inside:avoid;page-break-inside:avoid;}
  @page{margin:8mm;}
}
</style>
</head>
<body>

<!-- ── Screen toolbar ── -->
<div class="screen-only">
  <div class="toolbar">
    <button class="print-btn" onclick="printCards()">🖨️ הדפס כרטיסיות</button>
    <span style="font-size:13px;color:#555;">הזמנה ${order.order_num} · ${order.customer_name || ''} · ${allItems.length} פריטים</span>
  </div>

  <!-- Setup / split panel -->
  <div class="setup-panel">
    <div class="setup-title">✂️ הגדר חלוקת כרטיסיות לפני הדפסה</div>
    <table class="setup-tbl">
      <thead><tr>
        <th>#</th><th>צורה</th><th>⌀</th><th>כמות</th><th>מס' כרטיסיות</th><th>חלוקה</th>
      </tr></thead>
      <tbody id="setupBody">${setupRowsHtml}</tbody>
    </table>
    <div style="margin-top:12px;display:flex;gap:10px;align-items:center;">
      <button class="gen-btn" onclick="generateCards()">✅ עדכן כרטיסיות</button>
      <span style="font-size:12px;color:#888;">שנה כמות כרטיסיות ולחץ לעדכון</span>
    </div>
    <div class="split-summary" id="splitSummary"></div>
  </div>
</div>

<!-- ── Card grid – server-rendered, barcodes added by JS ── -->
<div class="cards-grid" id="cardsGrid">${serverCardsHtml}</div>

<script>
// ── Server data ───────────────────────────────────────────────────
var ORDER_NUM     = ${JSON.stringify(order.order_num || '')};
var CUSTOMER      = ${JSON.stringify(order.customer_name || '')};
var PRINT_DATE    = ${JSON.stringify(printDate)};
var DELIV_DATE    = ${JSON.stringify(delivDate)};
var ORDER_STATUS  = ${JSON.stringify(order.status || '')};
var TOTAL_WEIGHT  = ${(order.total_weight||0).toFixed(1)};
var TOTAL_PALLETS = ${pallets.length};
var allItems      = ${JSON.stringify(allItems.map(it => ({
  id:             it.id,
  shape_name:     it.shape_name  || '',
  diameter:       it.diameter    || 12,
  quantity:       it.quantity    || 1,
  total_length_mm:it.total_length_mm || 0,
  total_weight:   +(it.total_weight  || 0),
  weight_per_unit:+(it.weight_per_unit || 0),
  segments:       tryParseJSON(it.segments, []),
  note:           it.note        || '',
  struct_element: it.struct_element || '',
  pallet_num:     it._palletNum  || 1,
  material_grade: it.material_grade || 'B500B',
  is_3d:          it.is_3d       || 0
})))};

// ── Split config: item id -> number of sub-cards ──────────────────
var splitCfg = {};

// ── Setup panel ───────────────────────────────────────────────────
function initSetup() {
  var tbody = document.getElementById('setupBody');
  for (var i = 0; i < allItems.length; i++) {
    var item = allItems[i];
    splitCfg[item.id] = 1;
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + (i+1) + '</td>' +
      '<td>' + (item.shape_name || '–') + '</td>' +
      '<td><b>Ø' + item.diameter + '</b></td>' +
      '<td><b>' + item.quantity + '</b></td>' +
      '<td><input class="split-inp" type="number" min="1" max="' + item.quantity + '" value="1"' +
        ' id="sp-' + item.id + '" oninput="onSplitChange(' + item.id + ',' + item.quantity + ')"></td>' +
      '<td><div class="split-detail" id="sd-' + item.id + '">כרטיסייה אחת – כל הכמות</div></td>';
    tbody.appendChild(tr);
  }
}

function onSplitChange(itemId, qty) {
  var inp = document.getElementById('sp-' + itemId);
  var n = Math.max(1, Math.min(qty, parseInt(inp.value) || 1));
  inp.value = n;
  splitCfg[itemId] = n;
  var el = document.getElementById('sd-' + itemId);
  if (n === 1) {
    el.textContent = 'כרטיסייה אחת – כל הכמות';
  } else {
    var subs = splitQty(qty, n);
    el.textContent = subs.join(' + ') + ' יח';
  }
  updateSplitSummary();
}

function splitQty(total, n) {
  var base = Math.floor(total / n);
  var rem  = total % n;
  var arr  = [];
  for (var i = 0; i < n; i++) arr.push(base + (i < rem ? 1 : 0));
  return arr;
}

function splitWeight(item, subQty) {
  if (!item.quantity) return 0;
  return Number(item.total_weight || 0) * subQty / Number(item.quantity || 1);
}

function cardPlan() {
  var rows = [];
  for (var i=0; i<allItems.length; i++) {
    var item = allItems[i];
    var n = Math.max(1, Math.min(item.quantity || 1, splitCfg[item.id] || 1));
    var subs = splitQty(item.quantity || 1, n);
    for (var ci=0; ci<n; ci++) {
      rows.push({
        item: item,
        subQty: subs[ci],
        totalCards: n,
        cardIdx: ci,
        cardLabel: n > 1 ? (ci + 1) + '/' + n : ''
      });
    }
  }
  return rows;
}

function updateSplitSummary(rows) {
  var el = document.getElementById('splitSummary');
  if (!el) return;
  rows = rows || cardPlan();
  var splitItems = 0;
  for (var i=0; i<allItems.length; i++) {
    if ((splitCfg[allItems[i].id] || 1) > 1) splitItems++;
  }
  var production = /ייצור|production|queue|בייצור|תור/i.test(ORDER_STATUS || '');
  el.textContent = 'המאסטר תואם ' + rows.length + ' כרטיסיות מודפסות מתוך ' + allItems.length + ' פריטי הזמנה'
    + (splitItems ? ' · ' + splitItems + ' פריטים חולקו' : '')
    + (production ? ' · ההזמנה כבר בייצור: להדפיס גם מאסטר מעודכן' : '');
  el.className = production ? 'split-summary warn' : 'split-summary';
}

// ── Shape drawing ─────────────────────────────────────────────────
function drawShape(svgEl, segments) {
  if (!segments || !segments.length) return;
  var sides  = segments.map(function(s){ return s.length_mm; });
  var angles = segments.map(function(s){ return s.angle_deg; }).slice(0, -1);
  var pts = [[0,0]];
  var dir = 0;
  for (var i = 0; i < sides.length; i++) {
    var rad = dir * Math.PI / 180;
    var p = pts[pts.length-1];
    pts.push([p[0] + sides[i]*Math.cos(rad), p[1] + sides[i]*Math.sin(rad)]);
    if (i < angles.length) dir -= (180 - angles[i]);
  }
  var PAD=28, W=220, H=130;
  var xs=pts.map(function(p){return p[0];}), ys=pts.map(function(p){return p[1];});
  var minX=Math.min.apply(null,xs), maxX=Math.max.apply(null,xs);
  var minY=Math.min.apply(null,ys), maxY=Math.max.apply(null,ys);
  var rX=maxX-minX||1, rY=maxY-minY||1;
  var sc=Math.min((W-PAD*2)/rX,(H-PAD*2)/rY);
  var oX=PAD+((W-PAD*2)-rX*sc)/2, oY=PAD+((H-PAD*2)-rY*sc)/2;
  var mp=function(p){return [oX+(p[0]-minX)*sc, oY+(p[1]-minY)*sc];};
  var mapped=pts.map(mp);
  var pd='M '+mapped.map(function(p){return p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' L ');
  var svg='<path d="'+pd+'" fill="none" stroke="#1a2332" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';
  svg+='<path d="'+pd+'" fill="none" stroke="#3a5070" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
  for (var i=0; i<mapped.length-1; i++) {
    var x1=mapped[i][0],y1=mapped[i][1],x2=mapped[i+1][0],y2=mapped[i+1][1];
    var mx=(x1+x2)/2,my=(y1+y2)/2,dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy);
    var nx=-dy/len*10,ny=dx/len*10,lx=mx+nx,ly=my+ny;
    svg+='<rect x="'+(lx-14).toFixed(1)+'" y="'+(ly-7).toFixed(1)+'" width="28" height="12" rx="2" fill="white" fill-opacity="0.85"/>';
    svg+='<text x="'+lx.toFixed(1)+'" y="'+ly.toFixed(1)+'" text-anchor="middle" dominant-baseline="middle" font-size="8.5" font-family="Heebo,Arial" font-weight="700" fill="#1a2332">'+sides[i]+'</text>';
  }
  for (var i=1; i<mapped.length-1; i++) {
    var x=mapped[i][0],y=mapped[i][1];
    if (angles[i-1] !== undefined && angles[i-1] !== 180) {
      svg+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="8" fill="white" stroke="#c9621a" stroke-width="1.2"/>';
      svg+='<text x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" text-anchor="middle" dominant-baseline="middle" font-size="7" font-family="Heebo,Arial" font-weight="700" fill="#c9621a">'+angles[i-1]+'&deg;</text>';
    }
  }
  var ep=mapped[mapped.length-1];
  svg+='<circle cx="'+mapped[0][0].toFixed(1)+'" cy="'+mapped[0][1].toFixed(1)+'" r="3" fill="#1a2332"/>';
  svg+='<circle cx="'+ep[0].toFixed(1)+'" cy="'+ep[1].toFixed(1)+'" r="3" fill="#1a2332"/>';
  svgEl.innerHTML = svg;
}

// ── Build shape SVG string (client-side mirror of pcShapeSVG) ─────
function isRightAngleValue(value) {
  return Math.abs(Number(value) - 90) < 0.001;
}

function isOpenUShapeClient(segments) {
  if (!segments || segments.length !== 3) return false;
  var lengths = segments.map(function(s){ return +(s.length_mm || 0); });
  if (lengths.some(function(length){ return length <= 0; })) return false;
  var leftLeg = lengths[0], bridge = lengths[1], rightLeg = lengths[2];
  var legsSimilar = Math.abs(leftLeg - rightLeg) <= Math.max(10, Math.max(leftLeg, rightLeg) * 0.1);
  var legsShorterThanBridge = leftLeg < bridge && rightLeg < bridge;
  return isRightAngleValue(segments[0].angle_deg)
    && isRightAngleValue(segments[1].angle_deg)
    && legsShorterThanBridge
    && legsSimilar;
}

function buildOpenUShapeSVG(segments) {
  var leftLeg = +(segments[0].length_mm || 0);
  var bridge = +(segments[1].length_mm || 0);
  var rightLeg = +(segments[2].length_mm || 0);
  var W = 220, H = 100, left = 42, right = 178, top = 24, bottom = 78;
  var midY = (top + bottom) / 2, midX = (left + right) / 2;
  var pd = 'M ' + left + ',' + bottom + ' L ' + left + ',' + top + ' L ' + right + ',' + top + ' L ' + right + ',' + bottom;
  var s = '<path d="' + pd + '" fill="none" stroke="#1a2332" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';
  s += '<path d="' + pd + '" fill="none" stroke="#3a5070" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  s += '<rect x="' + (left - 18) + '" y="' + (midY - 7) + '" width="36" height="14" rx="3" fill="white" fill-opacity="0.94"/>';
  s += '<text x="' + left + '" y="' + midY + '" text-anchor="middle" dominant-baseline="middle" font-size="8" font-family="Heebo,Arial" font-weight="800" fill="#1a2332">' + leftLeg + '</text>';
  s += '<rect x="' + (midX - 18) + '" y="' + (top - 19) + '" width="36" height="14" rx="3" fill="white" fill-opacity="0.94"/>';
  s += '<text x="' + midX + '" y="' + (top - 12) + '" text-anchor="middle" dominant-baseline="middle" font-size="8" font-family="Heebo,Arial" font-weight="800" fill="#1a2332">' + bridge + '</text>';
  s += '<rect x="' + (right - 18) + '" y="' + (midY - 7) + '" width="36" height="14" rx="3" fill="white" fill-opacity="0.94"/>';
  s += '<text x="' + right + '" y="' + midY + '" text-anchor="middle" dominant-baseline="middle" font-size="8" font-family="Heebo,Arial" font-weight="800" fill="#1a2332">' + rightLeg + '</text>';
  [[left, top], [right, top]].forEach(function(p) {
    s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="9" fill="white" stroke="#c9621a" stroke-width="1.2"/>';
    s += '<text x="' + p[0] + '" y="' + p[1] + '" text-anchor="middle" dominant-baseline="middle" font-size="7" font-family="Heebo,Arial" font-weight="800" fill="#c9621a">90&deg;</text>';
  });
  return '<svg data-shape-kind="open-u" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-height:100px">' + s + '</svg>';
}

function buildShapeSVG(segments) {
  try {
    if (!segments || !segments.length) {
      return '<svg viewBox="0 0 220 60" style="width:100%;max-height:80px">' +
        '<line x1="12" y1="30" x2="208" y2="30" stroke="#1a2332" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="12" cy="30" r="3" fill="#1a2332"/><circle cx="208" cy="30" r="3" fill="#1a2332"/></svg>';
    }
    if (isOpenUShapeClient(segments)) return buildOpenUShapeSVG(segments);
    var W=220, H=100, PAD=18;
    var sides = segments.map(function(s){ return +(s.length_mm||0); });
    var angs  = segments.map(function(s){ return s.angle_deg; });
    var pts=[[0,0]], dir=0;
    for (var i=0; i<sides.length; i++) {
      var p=pts[pts.length-1], rad=dir*Math.PI/180;
      pts.push([p[0]+sides[i]*Math.cos(rad), p[1]+sides[i]*Math.sin(rad)]);
      if (i<angs.length-1 && angs[i]!=null) dir-=(180-angs[i]);
    }
    var xs=pts.map(function(p){return p[0];}), ys=pts.map(function(p){return p[1];});
    var mnX=Math.min.apply(null,xs), mxX=Math.max.apply(null,xs);
    var mnY=Math.min.apply(null,ys), mxY=Math.max.apply(null,ys);
    var rX=mxX-mnX||1, rY=mxY-mnY||1;
    var sc=Math.min((W-PAD*2)/rX,(H-PAD*2)/rY);
    var oX=PAD+((W-PAD*2)-rX*sc)/2, oY=PAD+((H-PAD*2)-rY*sc)/2;
    var mpts=pts.map(function(p){return [+(oX+(p[0]-mnX)*sc).toFixed(1), +(oY+(p[1]-mnY)*sc).toFixed(1)];});
    var pd='M '+mpts.map(function(p){return p.join(',');}).join(' L ');
    var s='<path d="'+pd+'" fill="none" stroke="#1a2332" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>';
    s+='<path d="'+pd+'" fill="none" stroke="#3a5070" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
    for (var i=0; i<mpts.length-1; i++) {
      var x1=mpts[i][0],y1=mpts[i][1],x2=mpts[i+1][0],y2=mpts[i+1][1];
      var mx=(x1+x2)/2,my=(y1+y2)/2,dx=x2-x1,dy=y2-y1,ln=Math.sqrt(dx*dx+dy*dy)||1;
      var nx=-dy/ln*10,ny=dx/ln*10;
      s+='<rect x="'+(mx+nx-14).toFixed(1)+'" y="'+(my+ny-6).toFixed(1)+'" width="28" height="12" rx="2" fill="white" fill-opacity="0.9"/>';
      s+='<text x="'+(mx+nx).toFixed(1)+'" y="'+(my+ny).toFixed(1)+'" text-anchor="middle" dominant-baseline="middle" font-size="8" font-family="Heebo,Arial" font-weight="700" fill="#1a2332">'+sides[i]+'</text>';
    }
    for (var i=1; i<mpts.length-1; i++) {
      var a=angs[i-1];
      if (a!=null && a!==180) {
        var x=mpts[i][0], y=mpts[i][1];
        s+='<circle cx="'+x+'" cy="'+y+'" r="9" fill="white" stroke="#c9621a" stroke-width="1.2"/>';
        s+='<text x="'+x+'" y="'+y+'" text-anchor="middle" dominant-baseline="middle" font-size="7" font-family="Heebo,Arial" font-weight="700" fill="#c9621a">'+a+'\xb0</text>';
      }
    }
    return '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;max-height:100px">'+s+'</svg>';
  } catch(e) {
    return '<svg viewBox="0 0 220 60"><line x1="10" y1="30" x2="210" y2="30" stroke="#ccc" stroke-width="2"/></svg>';
  }
}

// ── Build one item card ───────────────────────────────────────────
function buildCard(item, subQty, totalCards, cardIdx) {
  var cardNum = totalCards > 1 ? (cardIdx+1) + '/' + totalCards : '';
  var uid     = 'g' + item.id + (totalCards > 1 ? 'c' + (cardIdx+1) : '');
  var barData = ORDER_NUM + '-' + String(item.id).padStart(6,'0') + (totalCards > 1 ? '-C' + (cardIdx+1) + 'OF' + totalCards : '');
  var segs    = item.segments || [];
  var wProp   = item.quantity > 0 ? (item.total_weight * subQty / item.quantity).toFixed(2) : '0.00';
  var title   = item.shape_name ? ('כרטיס כיפוף – ' + item.shape_name) : 'כרטיס כיפוף';
  var badge   = cardNum ? '<span class="split-badge">'+cardNum+'</span>' : '';

  var dimHtml = '';
  for (var i=0; i<segs.length; i++) {
    var lbl = String.fromCharCode(0x05D0+i);
    dimHtml += '<span class="dim-seg">'+lbl+': <b>'+segs[i].length_mm+'</b></span>';
    if (i < segs.length-1 && segs[i].angle_deg && segs[i].angle_deg !== 180)
      dimHtml += '<span class="dim-ang">'+segs[i].angle_deg+'&deg;</span>';
  }

  var h = '<div class="prod-card">';
  h += '<div class="pc-head">';
  h += '<div><div class="pc-title">'+badge+title+'</div><div class="pc-date">'+PRINT_DATE+'</div></div>';
  h += '<div class="pc-top-barcode"><div class="bc-font-top">'+barData+'</div><div class="bc-label">'+barData+'</div></div>';
  h += '</div>';
  h += '<div class="pc-order-row">';
  h += '<div class="pc-order-label">הזמנה מס:</div>';
  h += '<div class="pc-order-barcode"><div class="bc-font-mid">'+ORDER_NUM+'</div><div class="bc-ord-text">'+ORDER_NUM+'</div></div>';
  h += '<div class="pc-pallet">משטח: <b>'+item.pallet_num+'</b></div>';
  h += '</div>';
  h += '<div class="pc-wq-row">';
  h += '<div class="pc-wq-cell"><span class="wq-lbl">ק"ג:</span> <span class="wq-val">'+wProp+'</span></div>';
  h += '<div class="pc-wq-sep"></div>';
  h += '<div class="pc-wq-cell"><span class="wq-lbl">כמות:</span> <span class="wq-val">'+subQty+'</span> יח</div>';
  h += '<div class="pc-wq-sep"></div>';
  h += '<div class="pc-wq-cell"><span class="wq-lbl">לקוח:</span> <span class="wq-cust">'+CUSTOMER+'</span></div>';
  h += '</div>';
  h += '<div class="pc-shape-area">'+buildShapeSVG(segs)+'</div>';
  if (dimHtml) h += '<div class="pc-dims">'+dimHtml+'</div>';
  h += '<div class="pc-spec-row">';
  h += '<div class="pc-spec-cell"><span class="spec-lbl">קוטר:</span> <b>\xd8'+item.diameter+'</b></div>';
  h += '<div class="pc-spec-sep"></div>';
  h += '<div class="pc-spec-cell"><span class="spec-lbl">כיתה:</span> <b>'+(item.material_grade||'B500B')+'</b></div>';
  h += '<div class="pc-spec-sep"></div>';
  h += '<div class="pc-spec-cell"><span class="spec-lbl">אורך:</span> <b>'+item.total_length_mm+'</b> מ"מ</div>';
  if (item.struct_element) h += '<div class="pc-spec-sep"></div><div class="pc-spec-cell"><span class="spec-lbl">איבר:</span> '+item.struct_element+'</div>';
  h += '</div>';
  if (item.note) h += '<div class="pc-note">⚠ '+item.note+'</div>';
  h += '<div class="pc-footer">';
  h += '<div class="bc-font-footer">'+barData+'</div>';
  h += '<div class="pc-brand">SYNTA<br><span class="pc-brand-num">'+item.pallet_num+'</span></div>';
  h += '</div>';
  h += '</div>';
  return h;
}

// ── Build master card ─────────────────────────────────────────────
function buildMaster() {
  var rows = '';
  for (var i=0; i<allItems.length; i++) {
    var it = allItems[i];
    rows += '<tr>'+
      '<td>'+(i+1)+'</td>'+
      '<td><b>\xd8'+it.diameter+'</b></td>'+
      '<td>'+(it.shape_name||'–')+'</td>'+
      '<td class="master-shape-cell">'+buildShapeSVG(it.segments)+'</td>'+
      '<td>'+Math.round((it.total_length_mm||0)/10)+'</td>'+
      '<td><b>'+it.quantity+'</b></td>'+
      '<td>'+(+(it.total_weight)||0).toFixed(1)+'</td>'+
      '<td class="check-cell">◯</td>'+
    '</tr>';
  }
  var h = '<div class="prod-card master-card">';
  h += '<div class="pc-head" style="background:#1a2332;color:#fff;padding:8px 12px;">';
  h += '<div><div class="pc-title" style="color:#e07b39;font-size:14px;">★ כרטיסיית מאסטר</div>';
  h += '<div class="pc-date" style="color:#8aa;">'+PRINT_DATE+'</div></div>';
  h += '<div style="text-align:left"><div style="font-size:16px;font-weight:900;">'+ORDER_NUM+'</div>';
  h += '<div style="font-size:10px;color:#8aa;">'+(DELIV_DATE?'מסירה: '+DELIV_DATE:'')+'</div></div></div>';
  h += '<div style="padding:6px 10px;font-size:12px;font-weight:700;border-bottom:1px solid #eee;">'+CUSTOMER+'</div>';
  h += '<table class="master-table"><thead><tr><th>#</th><th>\xd8</th><th>צורה</th><th>תרשים</th><th>אורך</th><th>כמות</th><th>ק"ג</th><th>✓</th></tr></thead>';
  h += '<tbody>'+rows+'</tbody></table>';
  h += '<div class="master-totals">סה"כ: <b>'+TOTAL_WEIGHT+' ק"ג</b> · '+TOTAL_PALLETS+' משטחים · '+allItems.length+' פריטים</div>';
  h += '<div class="pc-footer" style="background:#1a2332;color:#8aa;font-size:9px;text-align:center;padding:4px;">★ כרטיסיית מאסטר – לא לאיבוד! · '+ORDER_NUM+'</div>';
  h += '</div>';
  return h;
}

function buildSplitMaster() {
  var plan = cardPlan();
  var rows = '';
  for (var i=0; i<plan.length; i++) {
    var row = plan[i];
    var it = row.item;
    var qty = row.subQty;
    var weight = splitWeight(it, qty);
    var cardMark = row.cardLabel ? ' <span class="split-badge">'+row.cardLabel+'</span>' : '';
    rows += '<tr>'+
      '<td>'+(i+1)+'</td>'+
      '<td><b>\xd8'+it.diameter+'</b></td>'+
      '<td>'+(it.shape_name || '-')+cardMark+'</td>'+
      '<td class="master-shape-cell">'+buildShapeSVG(it.segments)+'</td>'+
      '<td>'+Math.round((it.total_length_mm||0)/10)+'</td>'+
      '<td><b>'+qty+'</b></td>'+
      '<td>'+weight.toFixed(1)+'</td>'+
      '<td class="check-cell">□</td>'+
    '</tr>';
  }
  var h = '<div class="prod-card master-card">';
  h += '<div class="pc-head" style="background:#1a2332;color:#fff;padding:8px 12px;">';
  h += '<div><div class="pc-title" style="color:#e07b39;font-size:14px;">★ כרטיסיית מאסטר מעודכנת</div>';
  h += '<div class="pc-date" style="color:#8aa;">'+PRINT_DATE+'</div></div>';
  h += '<div style="text-align:left"><div style="font-size:16px;font-weight:900;">'+ORDER_NUM+'</div>';
  h += '<div style="font-size:10px;color:#8aa;">'+(DELIV_DATE?'מסירה: '+DELIV_DATE:'')+'</div></div></div>';
  h += '<div style="padding:6px 10px;font-size:12px;font-weight:700;border-bottom:1px solid #eee;">'+CUSTOMER+'</div>';
  h += '<table class="master-table"><thead><tr><th>#</th><th>\xd8</th><th>צורה / כרטיס</th><th>תרשים</th><th>אורך</th><th>כמות</th><th>ק"ג</th><th>✓</th></tr></thead>';
  h += '<tbody>'+rows+'</tbody></table>';
  h += '<div class="master-totals">סה"כ: <b>'+TOTAL_WEIGHT+' ק"ג</b> · '+TOTAL_PALLETS+' משטחים · '+plan.length+' כרטיסיות / '+allItems.length+' פריטים</div>';
  h += '<div class="pc-footer" style="background:#1a2332;color:#8aa;font-size:9px;text-align:center;padding:4px;">★ מאסטר לפי חלוקת הכרטיסיות הנוכחית · '+ORDER_NUM+'</div>';
  h += '</div>';
  return h;
}

// ── Generate & render all cards ───────────────────────────────────
function generateCards() {
  var grid = document.getElementById('cardsGrid');
  grid.innerHTML = '';
  var plan = cardPlan();
  updateSplitSummary(plan);
  // Master
  try {
    var d = document.createElement('div');
    d.innerHTML = buildSplitMaster();
    if (d.firstElementChild) grid.appendChild(d.firstElementChild);
  } catch(e) { console.error('buildSplitMaster:', e); }
  // Items
  for (var i=0; i<plan.length; i++) {
    var row = plan[i];
    try {
      var d2 = document.createElement('div');
      d2.innerHTML = buildCard(row.item, row.subQty, row.totalCards, row.cardIdx);
      if (d2.firstElementChild) grid.appendChild(d2.firstElementChild);
    } catch(e2) { console.error('buildCard item', row.item.id, e2); }
  }
}

function printCards() {
  generateCards();
  window.print();
}

// ── Init: read split config from server-rendered rows ────────────
(function() {
  document.querySelectorAll('[id^="sp-"]').forEach(function(inp) {
    splitCfg[inp.id.replace('sp-','')] = 1;
  });
  generateCards();
})();
</script>
</body>
</html>`);
});

// ── DELIVERY CERTIFICATE ─────────────────────────────────────────
router.get('/orders/:id/delivery-certificate', requireAnyRole(['office', 'warehouse', 'driver', 'manager', 'admin']), (req, res) => {
  const order = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
    FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.id);
  if (!order) return res.status(404).send('הזמנה לא נמצאה');

  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=? ORDER BY pallet_num').all(order.id);
  pallets.forEach(p => { p.items = db.prepare('SELECT * FROM items WHERE pallet_id=? ORDER BY id').all(p.id); });
  const allItems = pallets.flatMap(p => p.items);

  const fmtDate = d => {
    const dt = d ? new Date(d) : new Date();
    return `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()}`;
  };
  const today = fmtDate();
  const delivDate = order.delivery_date ? fmtDate(order.delivery_date) : '—';

  // Classify each item: מכופף or ישר
  const parseSegs = raw => { try { return JSON.parse(raw) || []; } catch { return []; } };
  const isBent = item => {
    const segs = parseSegs(item.segments);
    const angles = segs.map(s => s.angle_deg).filter(a => a !== undefined);
    return angles.some(a => a < 175);
  };

  const calcItemWeight = it => {
    if (it.total_weight && it.total_weight > 0) return it.total_weight;
    const kgm = rebarKgPerMeter(Math.round(it.diameter));
    if (!kgm) return 0;
    return Math.round((it.total_length_mm / 1000) * kgm * (it.quantity || 1) * 10) / 10;
  };

  // Weight totals
  let wBent = 0, wStraight = 0;
  allItems.forEach(item => {
    const w = calcItemWeight(item);
    if (isBent(item)) wBent += w; else wStraight += w;
  });
  const wTotal = wBent + wStraight;
  const fmt1 = v => v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fmtTon = v => (v / 1000).toFixed(2);

  // Position range label
  const bentCount = allItems.filter(isBent).length;
  const posLabel = allItems.length > 0
    ? `ריכוז קומפלט: ברזל מכופף (פוז' 1-${bentCount}) ותוספות מוטות ישרים`
    : 'ריכוז קומפלט';

  // Build table rows
  let rows = '';
  allItems.forEach((item, idx) => {
    const segs   = parseSegs(item.segments);
    const bent   = isBent(item);
    const posNum = idx + 1;
    const diam   = item.diameter || '–';
    const type   = bent ? "מכופף (ח')" : 'ישר';
    const lenCm  = item.total_length_mm ? Math.round(item.total_length_mm / 10) : '–';
    const qty    = item.quantity || 1;
    const wt     = fmt1(calcItemWeight(item));
    const notes  = [item.struct_element, item.struct_floor, item.sheet_num, item.note].filter(Boolean).join(' · ') || '–';

    // Inline SVG shape (80×52)
    const svgShape = (() => {
      if (!segs.length) {
        // Straight bar — show a simple horizontal line with length label
        const lenLabel = item.total_length_mm ? Math.round(item.total_length_mm) + '' : '–';
        return `<line x1="8" y1="26" x2="72" y2="26" stroke="#1a2332" stroke-width="2.5" stroke-linecap="round"/>
                <circle cx="8" cy="26" r="2.5" fill="#1a2332"/>
                <circle cx="72" cy="26" r="2.5" fill="#1a2332"/>
                <rect x="25" y="16" width="30" height="9" rx="1.5" fill="white" fill-opacity="0.9"/>
                <text x="40" y="23" text-anchor="middle" dominant-baseline="middle" font-size="6.5" font-family="Heebo,Arial" font-weight="700" fill="#1a2332">${lenLabel}</text>`;
      }
      const sides  = segs.map(s => s.length_mm);
      const angles = segs.map(s => s.angle_deg).slice(0, -1);
      const pts    = [[0, 0]];
      let dir = 0;
      for (let i = 0; i < sides.length; i++) {
        const rad = dir * Math.PI / 180;
        const p   = pts[pts.length - 1];
        pts.push([p[0] + sides[i] * Math.cos(rad), p[1] + sides[i] * Math.sin(rad)]);
        if (i < angles.length) dir -= (180 - angles[i]);
      }
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const W = 80, H = 52, PAD = 10;
      const rX = maxX - minX || 1, rY = maxY - minY || 1;
      const sc = Math.min((W - PAD * 2) / rX, (H - PAD * 2) / rY);
      const oX = PAD + ((W - PAD * 2) - rX * sc) / 2;
      const oY = PAD + ((H - PAD * 2) - rY * sc) / 2;
      const mp = p => [oX + (p[0] - minX) * sc, oY + (p[1] - minY) * sc];
      const mapped = pts.map(mp);
      const pd = 'M ' + mapped.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L ');
      let svg = `<path d="${pd}" fill="none" stroke="#1a2332" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      // Segment length labels
      for (let i = 0; i < mapped.length - 1; i++) {
        const [x1,y1] = mapped[i], [x2,y2] = mapped[i+1];
        const mx=(x1+x2)/2, my=(y1+y2)/2;
        const len=Math.sqrt((x2-x1)**2+(y2-y1)**2)||1;
        const nx=-(y2-y1)/len*8, ny=(x2-x1)/len*8;
        svg += `<rect x="${(mx+nx-11).toFixed(1)}" y="${(my+ny-4.5).toFixed(1)}" width="22" height="9" rx="1.5" fill="white" fill-opacity="0.9"/>`;
        svg += `<text x="${(mx+nx).toFixed(1)}" y="${(my+ny+0.5).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="6.5" font-family="Heebo,Arial" font-weight="700" fill="#1a2332">${sides[i]}</text>`;
      }
      // Angle labels
      for (let i = 1; i < mapped.length - 1; i++) {
        const [x,y] = mapped[i];
        const a = angles[i-1];
        if (a !== undefined && a < 175) {
          svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="white" stroke="#c9621a" stroke-width="1"/>`;
          svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="5.5" font-family="Heebo,Arial" font-weight="700" fill="#c9621a">${a}°</text>`;
        }
      }
      return svg;
    })();

    rows += `
      <tr>
        <td class="c">${posNum}</td>
        <td class="c"><b>Ø${diam}</b></td>
        <td class="c">${type}</td>
        <td class="c">${lenCm}</td>
        <td class="c">${qty}</td>
        <td class="c"><b>${wt}</b></td>
        <td class="shape-cell">
          <svg viewBox="0 0 80 52" width="80" height="52" xmlns="http://www.w3.org/2000/svg">${svgShape}</svg>
        </td>
        <td>${notes}</td>
      </tr>`;
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<title>ריכוז תעודת משלוח – ${order.order_num}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Heebo',Arial,sans-serif;direction:rtl;background:#f0f2f5;padding:18px;color:#1a2332;}

/* ── Screen toolbar ── */
.toolbar{margin-bottom:14px;display:flex;gap:10px;align-items:center;}
.btn-print{padding:9px 22px;background:#1a2332;color:#fff;border:none;border-radius:6px;
  cursor:pointer;font-size:14px;font-family:inherit;font-weight:700;}
.btn-print:hover{background:#c9621a;}
.btn-back{padding:9px 16px;background:#eee;color:#1a2332;border:1px solid #ccc;
  border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit;text-decoration:none;display:inline-block;}

/* ── A4 page ── */
.page{background:#fff;width:210mm;min-height:297mm;margin:0 auto;padding:14mm 12mm;
  box-shadow:0 4px 20px rgba(0,0,0,0.15);}

/* ── Header ── */
.doc-title{text-align:center;font-size:22px;font-weight:900;color:#1a2332;letter-spacing:0.5px;margin-bottom:4px;}
.doc-subtitle{text-align:center;font-size:12px;color:#555;font-style:italic;margin-bottom:14px;}
.meta-row{display:flex;justify-content:space-between;font-size:11px;color:#444;
  border-top:1px solid #ddd;border-bottom:1px solid #ddd;padding:6px 4px;margin-bottom:14px;}
.meta-item{display:flex;gap:5px;}
.meta-lbl{color:#888;}
.meta-val{font-weight:700;}

/* ── Summary box ── */
.summary-box{background:#f0f4f8;border:1.5px solid #1a2332;border-radius:6px;
  padding:10px 16px;margin-bottom:16px;display:inline-block;float:left;}
.summary-title{font-size:11px;font-weight:900;color:#1a2332;margin-bottom:7px;text-align:center;}
.sum-row{display:flex;justify-content:space-between;gap:24px;font-size:11.5px;margin-bottom:4px;}
.sum-lbl{color:#444;}
.sum-val{font-weight:700;color:#1a2332;}
.sum-total{border-top:1.5px solid #1a2332;margin-top:6px;padding-top:6px;}
.sum-total .sum-val{font-size:14px;color:#c9621a;}
.clearfix::after{content:'';display:table;clear:both;}

/* ── Table ── */
.section-title{font-size:13px;font-weight:900;color:#1a2332;margin-bottom:8px;
  border-bottom:2px solid #1a2332;padding-bottom:4px;}
table{width:100%;border-collapse:collapse;font-size:10.5px;}
thead th{background:#1a2332;color:#fff;padding:7px 5px;text-align:center;font-weight:700;
  border:1px solid #1a2332;}
tbody tr:nth-child(even){background:#f7f9fc;}
tbody tr:hover{background:#eaf2ff;}
tbody td{padding:5px 5px;border:1px solid #d0d8e4;vertical-align:middle;}
td.c{text-align:center;}
.shape-cell{text-align:center;padding:2px 4px;}
tfoot td{background:#1a2332;color:#fff;font-weight:900;padding:8px 6px;
  border:1px solid #1a2332;text-align:center;}
tfoot .total-val{font-size:14px;color:#f0a060;}

/* ── Footer ── */
.doc-footer{margin-top:18px;border-top:1px solid #ddd;padding-top:8px;
  display:flex;justify-content:space-between;font-size:10px;color:#888;}
.company-name{font-weight:900;color:#1a2332;font-size:12px;}

@media print{
  body{background:#fff;padding:0;}
  .toolbar{display:none!important;}
  .page{box-shadow:none;padding:10mm 10mm;width:100%;}
  @page{size:A4 portrait;margin:8mm;}
}
</style>
</head>
<body>

<div class="toolbar">
  <a href="/orders.html" class="btn-back">← חזור להזמנות</a>
  <button class="btn-print" onclick="window.print()">🖨️ הדפס / שמור PDF</button>
  <span style="font-size:13px;color:#666;">הזמנה ${order.order_num} · ${order.customer_name || ''}</span>
</div>

<div class="page">

  <!-- Header -->
  <div class="doc-title">ריכוז תעודת משלוח וסיכום משקלים סופי</div>
  <div class="doc-subtitle">${posLabel}</div>

  <div class="meta-row">
    <div class="meta-item"><span class="meta-lbl">לקוח:</span><span class="meta-val">${order.customer_name || '—'}</span></div>
    <div class="meta-item"><span class="meta-lbl">הזמנה מס':</span><span class="meta-val">${order.order_num}</span></div>
    <div class="meta-item"><span class="meta-lbl">תאריך אספקה:</span><span class="meta-val">${delivDate}</span></div>
    <div class="meta-item"><span class="meta-lbl">תאריך הפקה:</span><span class="meta-val">${today}</span></div>
  </div>

  <!-- Summary box -->
  <div class="clearfix">
    <div class="summary-box">
      <div class="summary-title">סיכום משקלי משלוח קומפלט</div>
      <div class="sum-row">
        <span class="sum-lbl">סה"כ משקל ברזל מכופף:</span>
        <span class="sum-val">${fmt1(wBent)} ק"ג (${fmtTon(wBent)} טון)</span>
      </div>
      <div class="sum-row">
        <span class="sum-lbl">סה"כ משקל ברזל ישר:</span>
        <span class="sum-val">${fmt1(wStraight)} ק"ג (${fmtTon(wStraight)} טון)</span>
      </div>
      <div class="sum-row sum-total">
        <span class="sum-lbl"><b>סך הכל משקל כללי:</b></span>
        <span class="sum-val"><b>${fmt1(wTotal)} ק"ג (כ-${fmtTon(wTotal)} טון)</b></span>
      </div>
    </div>
  </div>

  <!-- Detail table -->
  <div class="section-title">טבלת פירוט אלמנטים מלאה ומאוחדת</div>
  <table>
    <thead>
      <tr>
        <th>פוזיציה</th>
        <th>קוטר<br>(מ"מ)</th>
        <th>סוג ברזל</th>
        <th>אורך<br>(ס"מ)</th>
        <th>כמות<br>(יח')</th>
        <th>משקל<br>(ק"ג)</th>
        <th>צורה</th>
        <th>מקור המידע / הערות</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="5" style="text-align:right;">משקל כולל סופי ומאושר לעסקה</td>
        <td class="total-val">${fmt1(wTotal)}</td>
        <td></td>
        <td>סה"כ כללי קומפלט · ${allItems.length} פריטים</td>
      </tr>
    </tfoot>
  </table>

  <!-- Footer -->
  <div class="doc-footer">
    <div>
      <div class="company-name">טנא תעשיות ברזל בע"מ</div>
      <div>תעודה זו מהווה אישור לפרטי המשלוח המפורטים לעיל</div>
    </div>
    <div style="text-align:left;">
      <div>חתימה ואישור: _______________</div>
      <div style="margin-top:4px;">תאריך קבלה: _______________</div>
    </div>
  </div>

</div><!-- /page -->
</body>
</html>`);
});

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
