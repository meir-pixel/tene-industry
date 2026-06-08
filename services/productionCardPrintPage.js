function renderPrintCardsPage({
  order,
  pallets,
  allItems,
  printDate,
  delivDate,
  cards,
  industry,
  tryParseJSON,
}) {
// Server-side rendered setup rows and cards
const setupRowsHtml = allItems.map((it,i) =>
  '<tr><td>'+(i+1)+'</td><td>'+cards.escapeHtml(it.shape_name||'–')+'</td>' +
  '<td><b>\xd8'+(+it.diameter||'?')+'</b></td><td><b>'+(it.quantity||1)+'</b></td>' +
  '<td><input class="split-inp" type="number" min="1" max="'+(it.quantity||1)+'" value="1" id="sp-'+it.id+'" oninput="onSplitChange('+it.id+','+(it.quantity||1)+')"></td>' +
  '<td><div class="split-detail" id="sd-'+it.id+'">כרטיסייה אחת – כל הכמות</div></td></tr>'
).join('');

const serverCardsHtml = (allItems.length
  ? cards.masterCard(allItems, order, printDate, delivDate, pallets.length) +
    allItems.map(it => cards.itemCard(it, order, printDate, (industry.REBAR_WEIGHTS || {}))).join('')
  : '<div style="padding:40px;text-align:center;color:#888;">אין פריטים בהזמנה זו</div>'
);




  return `<!DOCTYPE html>
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

@media screen and (max-width: 760px){
  body{padding:8px;overflow-x:hidden;}
  .toolbar{gap:8px;}
  .print-btn,.gen-btn{width:100%;padding:11px 14px;}
  .setup-panel{padding:10px;border-radius:8px;overflow-x:auto;}
  .setup-title{font-size:14px;}
  .setup-tbl{min-width:620px;}
  .cards-grid{display:grid;grid-template-columns:1fr;gap:10px;}
  .prod-card{width:100%;max-width:100%;font-size:10px;}
  .pc-head{gap:8px;padding:8px;align-items:center;}
  .pc-title{font-size:12px;}
  .bc-font-top{font-size:34px;max-height:36px;}
  .bc-font-mid{font-size:28px;max-height:30px;}
  .pc-wq-row,.pc-spec-row{flex-wrap:wrap;gap:6px;}
  .pc-wq-cell,.pc-spec-cell{min-width:42%;flex:1 1 42%;}
  .pc-wq-sep,.pc-spec-sep{display:none;}
  .pc-shape-area{min-height:130px;padding:10px;}
  .pc-shape-area svg{max-height:128px!important;}
  .master-card{overflow-x:auto;}
  .master-table{min-width:560px;}
}

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

function isSimilarDimensionClient(a, b, tolerance) {
  var max = Math.max(+(a || 0), +(b || 0));
  if (max <= 0) return false;
  return Math.abs(+(a || 0) - +(b || 0)) <= Math.max(10, max * (tolerance || 0.12));
}

function closedStirrupPartsClient(segments) {
  if (!segments || segments.length < 4) return null;
  var values = segments.map(function(s){ return +(s.length_mm || 0); });
  if (values.some(function(v){ return v <= 0; })) return null;
  var checkedAngles = segments.slice(0, Math.min(4, segments.length - 1));
  if (checkedAngles.length && !checkedAngles.every(function(s){ return isRightAngleValue(s.angle_deg); })) return null;

  if (values.length >= 5) {
    var tailStart = values[0], verticalA = values[1], horizontalA = values[2], verticalB = values[3], horizontalB = values[4], tailEnd = values[5] || 0;
    var maxBody = Math.max(verticalA, horizontalA, verticalB, horizontalB);
    if (
      tailStart <= maxBody * 0.45 &&
      (!tailEnd || tailEnd <= maxBody * 0.45) &&
      isSimilarDimensionClient(verticalA, verticalB) &&
      isSimilarDimensionClient(horizontalA, horizontalB)
    ) {
      return { top: horizontalA, right: verticalA, bottom: horizontalB, left: verticalB, tailStart: tailStart, tailEnd: tailEnd };
    }
  }

  if (isSimilarDimensionClient(values[0], values[2]) && isSimilarDimensionClient(values[1], values[3])) {
    return { top: values[0], right: values[1], bottom: values[2], left: values[3], tailStart: values[4] || 0, tailEnd: 0 };
  }

  return null;
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

function buildClosedStirrupSVG(parts) {
  var W = 220, H = 120;
  var horizontal = Math.max(parts.top || 0, parts.bottom || 0, 1);
  var vertical = Math.max(parts.left || 0, parts.right || 0, 1);
  var ratio = horizontal / vertical;
  var maxBoxW = 126, maxBoxH = 82;
  var boxW = ratio >= 1 ? maxBoxW : Math.max(54, Math.min(maxBoxW, maxBoxH * ratio));
  var boxH = ratio >= 1 ? Math.max(54, Math.min(maxBoxH, maxBoxW / ratio)) : maxBoxH;
  var x = (W - boxW) / 2, y = (H - boxH) / 2 + 4, right = x + boxW, bottom = y + boxH;
  var midX = x + boxW / 2, midY = y + boxH / 2;
  var pd = 'M ' + x.toFixed(1) + ',' + y.toFixed(1) + ' L ' + right.toFixed(1) + ',' + y.toFixed(1) + ' L ' + right.toFixed(1) + ',' + bottom.toFixed(1) + ' L ' + x.toFixed(1) + ',' + bottom.toFixed(1) + ' Z';
  var hookX = right - Math.min(24, boxW * 0.22), hookY = y + Math.min(24, boxH * 0.28);
  var s = '<path d="' + pd + '" fill="none" stroke="#1a2332" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';
  s += '<path d="' + pd + '" fill="none" stroke="#3a5070" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  s += '<path d="M ' + right.toFixed(1) + ',' + y.toFixed(1) + ' L ' + hookX.toFixed(1) + ',' + y.toFixed(1) + ' L ' + hookX.toFixed(1) + ',' + hookY.toFixed(1) + '" fill="none" stroke="#c9621a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
  [
    { x: midX, y: y - 11, value: parts.top },
    { x: right + 20, y: midY, value: parts.right },
    { x: midX, y: bottom + 13, value: parts.bottom },
    { x: x - 20, y: midY, value: parts.left }
  ].forEach(function(label) {
    s += '<rect x="' + (label.x - 18).toFixed(1) + '" y="' + (label.y - 7).toFixed(1) + '" width="36" height="14" rx="3" fill="white" fill-opacity="0.94"/>';
    s += '<text x="' + label.x.toFixed(1) + '" y="' + label.y.toFixed(1) + '" text-anchor="middle" dominant-baseline="middle" font-size="8" font-family="Heebo,Arial" font-weight="800" fill="#1a2332">' + label.value + '</text>';
  });
  if (parts.tailStart || parts.tailEnd) {
    s += '<text x="' + (right - 4).toFixed(1) + '" y="' + (hookY + 14).toFixed(1) + '" text-anchor="end" font-size="7.5" font-family="Heebo,Arial" font-weight="800" fill="#c9621a">overlap ' + [parts.tailStart, parts.tailEnd].filter(Boolean).join(' / ') + '</text>';
  }
  return '<svg data-shape-kind="closed-stirrup" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-height:112px">' + s + '</svg>';
}

function buildShapeSVG(segments) {
  try {
    if (!segments || !segments.length) {
      return '<svg viewBox="0 0 220 60" style="width:100%;max-height:80px">' +
        '<line x1="12" y1="30" x2="208" y2="30" stroke="#1a2332" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="12" cy="30" r="3" fill="#1a2332"/><circle cx="208" cy="30" r="3" fill="#1a2332"/></svg>';
    }
    if (isOpenUShapeClient(segments)) return buildOpenUShapeSVG(segments);
    var stirrup = closedStirrupPartsClient(segments);
    if (stirrup) return buildClosedStirrupSVG(stirrup);
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
</html>`;
}

module.exports = {
  renderPrintCardsPage,
};
