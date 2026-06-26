const { isTechnicalRecognitionNote } = require('./intakeWorkflow');

const REVIEW_NOTE_LABEL = '\u05d3\u05d5\u05e8\u05e9 \u05d0\u05d9\u05de\u05d5\u05ea \u05de\u05d5\u05dc \u05de\u05e7\u05d5\u05e8 \u05d4\u05e7\u05dc\u05d9\u05d8\u05d4';

function printableItemNote(note) {
  if (!note) return '';
  return isTechnicalRecognitionNote(note) ? REVIEW_NOTE_LABEL : note;
}

function renderPrintCardsPage({
  order,
  pallets,
  allItems,
  printDate,
  delivDate,
  cards,
  industry,
  tryParseJSON,
  previewOnly = false,
}) {
const isPreviewOnly = !!previewOnly;
const previewNoticeHtml = isPreviewOnly
  ? '<div class="preview-lock"><b>תצוגה בלבד</b><span>ההזמנה עדיין לא מאושרת/מתוכננת לייצור, לכן אפשר לראות את הכרטיסיות אבל אי אפשר להדפיס אותן.</span><a href="/orders.html?id=' + encodeURIComponent(order.id || '') + '">פתח הזמנה לאישור</a></div>'
  : '';
const printButtonHtml = isPreviewOnly
  ? '<span class="preview-pill">תצוגה בלבד - הדפסה חסומה</span>'
  : '<button class="print-btn" onclick="printCards()">🖨️ הדפס כרטיסיות</button>';

const serverCardsHtml = (allItems.length
  ? allItems.map(it => cards.itemCard(it, order, printDate, (industry.REBAR_WEIGHTS || {}))).join('')
  : '<div style="padding:40px;text-align:center;color:#888;">אין פריטים בהזמנה זו</div>'
);




  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<title>כרטיסיות ייצור – ${order.order_num}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&family=Libre+Barcode+128&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Heebo',Arial,sans-serif;background:#e8e8e8;padding:16px;direction:rtl;}
.preview-lock{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#fff3d7;border:1px solid #ffd6a0;color:#8a4b00;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px;font-weight:700;}
.preview-lock b{font-size:14px;color:#1a2332}.preview-lock a{color:#1a2332;font-weight:900;text-decoration:underline}.preview-pill{display:inline-flex;align-items:center;padding:9px 14px;border-radius:6px;background:#fff3d7;border:1px solid #ffd6a0;color:#8a4b00;font-weight:900;font-size:13px}.print-blocked-page{display:none;}

/* ── Screen-only UI ── */
.screen-only{margin-bottom:14px;}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;}
.print-btn{padding:9px 22px;background:#1a2332;color:#fff;border:none;border-radius:6px;
  cursor:pointer;font-size:14px;font-family:inherit;}
.print-btn:hover{background:#c9621a;}
.pc-weight-entry{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;align-items:end;padding:7px 10px;background:#eef8f2;border-bottom:1px solid #d8eadf;}
.pc-weight-entry label{display:block;font-size:9px;font-weight:900;color:#45645a;margin-bottom:2px;}
.pc-weight-entry input{width:100%;border:1px solid #aac7b4;border-radius:5px;padding:5px 6px;font-family:inherit;font-size:12px;background:#fff;}
.pc-weight-entry button{border:0;border-radius:6px;background:#1a7a3c;color:#fff;padding:7px 8px;font-family:inherit;font-weight:900;cursor:pointer;}
.pc-weight-chip{min-height:30px;border-radius:6px;background:#fff;border:1px solid #c8ddcf;padding:5px 6px;font-size:11px;font-weight:900;color:#1a2332;display:flex;align-items:center;}
.pc-weight-chip.warn{color:#9f4f00;background:#fff7ed;border-color:#fed7aa;}
.pc-weight-chip.bad{color:#991b1b;background:#fef2f2;border-color:#fecaca;}

/* ── Cards ── */
.cards-grid{display:grid;grid-template-columns:repeat(2,105mm);grid-auto-rows:74.25mm;gap:0;align-items:stretch;justify-content:start;width:210mm;margin:0 auto;background:#fff;}
.prod-card{width:105mm;height:74.25mm;margin:0;background:#fff;border:0.25mm solid #1a2332;border-radius:0;
  overflow:hidden;page-break-inside:avoid;break-inside:avoid;display:flex;flex-direction:column;
  font-size:8px;box-shadow:none;}
.prod-card>:not(.pc-print-face){display:none!important;}
.pc-print-face{display:grid;grid-template-columns:78mm 27mm;width:105mm;height:74.25mm;background:#fff;direction:ltr;}
.pc-print-main{display:grid;grid-template-rows:11mm 7mm 38mm 18.25mm;width:78mm;height:74.25mm;border-right:0.25mm solid #1a2332;overflow:hidden;direction:ltr;}
.pc-print-head{display:flex;align-items:center;justify-content:space-between;padding:2mm 3mm;border-bottom:0.25mm solid #1a2332;font-size:12px;font-weight:900;line-height:1;}
.pc-print-ref{padding:1.5mm 3mm;border-bottom:0.25mm solid #d8dee8;font-size:8px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:right;}
.pc-print-shape{display:flex;align-items:center;justify-content:center;padding:1.5mm 3mm;overflow:hidden;}
.pc-print-shape svg{max-width:72mm!important;max-height:35mm!important;}
.pc-print-bottom{display:grid;grid-template-columns:1.25fr 1fr 1fr;align-items:center;border-top:0.25mm solid #1a2332;font-size:11px;font-weight:900;text-align:center;}
.pc-print-bottom span{height:100%;display:flex;align-items:center;justify-content:center;border-left:0.25mm solid #1a2332;white-space:nowrap;overflow:hidden;}
.pc-print-bottom span:first-child{border-left:0;}
.pc-print-qr-panel{display:grid;grid-template-rows:52mm 22.25mm;align-items:center;justify-items:center;width:27mm;height:74.25mm;overflow:hidden;}
.pc-print-qr-code{width:22mm;height:22mm;display:flex;align-items:center;justify-content:center;}
.pc-print-qr-code canvas,.pc-print-qr-code img{width:22mm!important;height:22mm!important;display:block;}
.pc-print-status{width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-top:0.25mm solid #1a2332;font-size:9px;font-weight:900;letter-spacing:0;text-align:center;line-height:1.1;}
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
.pc-scan-row{display:flex;align-items:center;gap:6px;padding:3px 10px;background:#f7fbff;border-bottom:1px solid #e3edf5;}
.pc-scan-qr{width:46px;height:46px;flex:0 0 46px;background:#fff;border:1px solid #cfd8e3;border-radius:4px;display:flex;align-items:center;justify-content:center;}
.pc-scan-qr canvas,.pc-scan-qr img{width:42px!important;height:42px!important;display:block;}
.pc-scan-text{min-width:0;font-size:8px;line-height:1.25;color:#1a2332;font-family:monospace;direction:ltr;overflow:hidden;text-overflow:ellipsis;}
.pc-scan-label{font-size:8px;font-weight:900;color:#45645a;white-space:nowrap;}

@media screen and (max-width: 760px){
  body{padding:8px;overflow-x:hidden;}
  .toolbar{gap:8px;}
  .pc-head{gap:8px;padding:8px;align-items:center;}
  .pc-title{font-size:12px;}
  .bc-font-top{font-size:34px;max-height:36px;}
  .bc-font-mid{font-size:28px;max-height:30px;}
  .pc-wq-row,.pc-spec-row{flex-wrap:wrap;gap:6px;}
  .pc-wq-cell,.pc-spec-cell{min-width:42%;flex:1 1 42%;}
  .pc-wq-sep,.pc-spec-sep{display:none;}
  .pc-shape-area{min-height:130px;padding:10px;}
  .pc-shape-area svg{max-height:128px!important;}
}

@media print{
  html,body{width:210mm;margin:0!important;background:#fff;padding:0;}
  .screen-only{display:none!important;}
  body.preview-locked .cards-grid{display:none!important;}
  body.preview-locked .print-blocked-page{display:flex!important;width:210mm;height:297mm;align-items:center;justify-content:center;text-align:center;font-family:'Heebo',Arial,sans-serif;font-size:18px;font-weight:900;color:#1a2332;padding:20mm;}
  .cards-grid{
    display:grid!important;
    grid-template-columns:repeat(2, 105mm);
    grid-auto-rows:74.25mm;
    gap:0;
    align-items:stretch;
    justify-content:start;
  }
  .cards-grid{break-before:auto;page-break-before:auto;}
  .prod-card{border:0.25mm solid #1a2332!important;border-radius:0!important;overflow:hidden!important;}
  .prod-card>:not(.pc-print-face){display:none!important;}
  .pc-print-face{display:grid!important;grid-template-columns:78mm 27mm;width:105mm;height:74.25mm;background:#fff;direction:ltr;}
  .pc-print-main{display:grid;grid-template-rows:11mm 7mm 38mm 18.25mm;width:78mm;height:74.25mm;border-right:0.25mm solid #1a2332;overflow:hidden;direction:ltr;}
  .pc-print-head{display:flex;align-items:center;justify-content:space-between;padding:2mm 3mm;border-bottom:0.25mm solid #1a2332;font-size:12px;font-weight:900;line-height:1;}
  .pc-print-ref{padding:1.5mm 3mm;border-bottom:0.25mm solid #d8dee8;font-size:8px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:right;}
  .pc-print-shape{display:flex;align-items:center;justify-content:center;padding:1.5mm 3mm;overflow:hidden;}
  .pc-print-shape svg{max-width:72mm!important;max-height:35mm!important;}
  .pc-print-bottom{display:grid;grid-template-columns:1.25fr 1fr 1fr;align-items:center;border-top:0.25mm solid #1a2332;font-size:11px;font-weight:900;text-align:center;}
  .pc-print-bottom span{height:100%;display:flex;align-items:center;justify-content:center;border-left:0.25mm solid #1a2332;white-space:nowrap;overflow:hidden;}
  .pc-print-bottom span:first-child{border-left:0;}
  .pc-print-qr-panel{display:grid;grid-template-rows:52mm 22.25mm;align-items:center;justify-items:center;width:27mm;height:74.25mm;overflow:hidden;}
  .pc-print-qr-code{width:22mm;height:22mm;display:flex;align-items:center;justify-content:center;}
  .pc-print-qr-code canvas,.pc-print-qr-code img{width:22mm!important;height:22mm!important;display:block;}
  .pc-print-status{width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-top:0.25mm solid #1a2332;font-size:9px;font-weight:900;letter-spacing:0;text-align:center;line-height:1.1;}
  .prod-card{
    width:105mm!important;
    height:74.25mm!important;
    margin:0!important;
    box-shadow:none;
    break-inside:avoid;
    page-break-inside:avoid;
    border-width:1px;
    border-radius:2px;
    font-size:8px;
  }
  .prod-card{border:0.25mm solid #1a2332!important;border-radius:0!important;overflow:hidden!important;}
  .pc-head{padding:3px 5px 2px;border-bottom-width:1px;}
  .pc-title{font-size:9px;line-height:1.1;}
  .pc-date{font-size:7px;margin-top:0;}
  .bc-font-top{font-size:28px;max-height:28px;}
  .bc-font-mid{font-size:23px;max-height:24px;}
  .bc-font-footer{font-size:18px;max-height:18px;}
  .bc-label,.bc-ord-text{font-size:6px;}
  .split-badge{font-size:7px;padding:0 3px;margin-left:2px;}
  .pc-order-row{gap:3px;padding:2px 5px;}
  .pc-order-label,.pc-pallet{font-size:7px;}
  .pc-wq-row{padding:2px 5px;gap:2px;}
  .wq-lbl,.spec-lbl{font-size:7px;}
  .wq-val{font-size:10px;}
  .wq-cust{font-size:7px;}
  .pc-wq-sep{height:11px;}
  .pc-shape-area{min-height:33mm;padding:2mm 3mm;}
  .pc-shape-svg,.pc-shape-area svg{max-height:31mm!important;}
  .pc-dims{gap:2px;padding:2px 5px;}
  .dim-seg,.dim-ang{font-size:6.5px;padding:1px 3px;}
  .pc-spec-row{padding:2px 5px;}
  .pc-spec-cell{font-size:7px;}
  .pc-spec-sep{height:10px;margin:0 3px;}
  .pc-note{padding:1px 5px;font-size:7px;}
  .pc-scan-row{padding:1px 5px;gap:3px;}
  .pc-scan-qr{width:28px;height:28px;flex-basis:28px;}
  .pc-scan-qr canvas,.pc-scan-qr img{width:25px!important;height:25px!important;}
  .pc-scan-text,.pc-scan-label{font-size:5.5px;}
  .pc-weight-entry{display:none!important;}
  .pc-footer{padding:2px 5px;}
  .pc-brand{font-size:7px;}
  .pc-brand-num{font-size:11px;}
  @page{size:A4 portrait;margin:0!important;}
}
</style>
</head>
<body${isPreviewOnly ? ' class="preview-locked"' : ''}>

<div class="print-blocked-page">הכרטיסיות בתצוגה בלבד. יש לאשר/לתכנן את ההזמנה לפני הדפסה.</div>

<!-- ── Screen toolbar ── -->
<div class="screen-only">
  ${previewNoticeHtml}
  <div class="toolbar">
    ${printButtonHtml}
    <span style="font-size:13px;color:#555;">הזמנה ${order.order_num} · ${order.customer_name || ''} · ${allItems.length} פריטים</span>
  </div>

<!-- ── Card grid – server-rendered, barcodes added by JS ── -->
</div>

<div class="cards-grid" id="cardsGrid">${serverCardsHtml}</div>

<script>
// ── Server data ───────────────────────────────────────────────────
var ORDER_ID      = ${Number(order.id) || 0};
var ORDER_NUM     = ${JSON.stringify(order.order_num || '')};
var CUSTOMER      = ${JSON.stringify(order.customer_name || '')};
var SHORT_REF     = ${JSON.stringify([order.customer_name, order.project_name || order.site_name].filter(Boolean).join(' / '))};
var PRINT_DATE    = ${JSON.stringify(printDate)};
var DELIV_DATE    = ${JSON.stringify(delivDate)};
var ORDER_STATUS  = ${JSON.stringify(order.status || '')};
var TOTAL_WEIGHT  = ${(order.total_weight||0).toFixed(1)};
var TOTAL_PALLETS = ${pallets.length};
var PREVIEW_ONLY  = ${isPreviewOnly ? 'true' : 'false'};
var allItems      = ${JSON.stringify(allItems.map(it => ({
  id:             it.id,
  shape_name:     it.shape_name  || '',
  diameter:       it.diameter    || 12,
  quantity:       it.quantity    || 1,
  total_length_mm:it.total_length_mm || 0,
  total_weight:   +(it.total_weight  || 0),
  weight_per_unit:+(it.weight_per_unit || 0),
  segments:       tryParseJSON(it.segments, []),
  note:           printableItemNote(it.note),
  struct_element: it.struct_element || '',
  pallet_num:     it._palletNum  || 1,
  material_grade: it.material_grade || 'B500B',
  actual_weight_kg:+(it.actual_weight_kg || 0),
  card_weights:   Array.isArray(it.card_weights) ? it.card_weights.map(function(weight){ return {
    card_index: +(weight.card_index || 0),
    card_total: +(weight.card_total || 0),
    card_qty: +(weight.card_qty || 0),
    target_weight_kg: +(weight.target_weight_kg || 0),
    actual_weight_kg: +(weight.actual_weight_kg || 0),
    weight_deviation_pct: weight.weight_deviation_pct == null ? null : +(weight.weight_deviation_pct || 0)
  }; }) : [],
  is_3d:          it.is_3d       || 0
})))};

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

function cardWeightFor(item, cardTotal, cardIdx) {
  var weights = item.card_weights || [];
  for (var i = 0; i < weights.length; i++) {
    if (Number(weights[i].card_total) === Number(cardTotal) && Number(weights[i].card_index) === cardIdx + 1) return weights[i];
  }
  return null;
}

function deviationClass(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return '';
  var abs = Math.abs(Number(pct));
  if (abs >= 10) return ' bad';
  if (abs >= 3) return ' warn';
  return '';
}

function fmtPct(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return '-';
  return (Number(pct) > 0 ? '+' : '') + Number(pct).toFixed(1) + '%';
}

function cardPlan() {
  var rows = [];
  for (var i=0; i<allItems.length; i++) {
    var item = allItems[i];
    var n = 1;
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
  var W = 240, H = 120;
  var horizontal = Math.max(parts.top || 0, parts.bottom || 0, 1);
  var vertical = Math.max(parts.left || 0, parts.right || 0, 1);
  var ratio = horizontal / vertical;
  var maxBoxW = 126, maxBoxH = 82;
  var boxW = ratio >= 1 ? maxBoxW : Math.max(54, Math.min(maxBoxW, maxBoxH * ratio));
  var boxH = ratio >= 1 ? Math.max(54, Math.min(maxBoxH, maxBoxW / ratio)) : maxBoxH;
  var x = (W - boxW) / 2 - 10, y = (H - boxH) / 2 + 4, right = x + boxW, bottom = y + boxH;
  var midX = x + boxW / 2, midY = y + boxH / 2;
  var pd = 'M ' + x.toFixed(1) + ',' + y.toFixed(1) + ' L ' + right.toFixed(1) + ',' + y.toFixed(1) + ' L ' + right.toFixed(1) + ',' + bottom.toFixed(1) + ' L ' + x.toFixed(1) + ',' + bottom.toFixed(1) + ' Z';
  var marker = Math.min(28, Math.max(14, Math.min(boxW, boxH) * 0.28));
  var markerX = right - marker, markerY = y + marker;
  var markerPath = 'M ' + markerX.toFixed(1) + ',' + y.toFixed(1) + ' L ' + markerX.toFixed(1) + ',' + markerY.toFixed(1) + ' L ' + right.toFixed(1) + ',' + markerY.toFixed(1);
  var s = '<path d="' + pd + '" fill="none" stroke="#1a2332" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';
  s += '<path d="' + pd + '" fill="none" stroke="#3a5070" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  s += '<path data-stirrup-marker="overlap" d="' + markerPath + '" fill="none" stroke="#1a2332" stroke-width="4" stroke-linecap="square" stroke-linejoin="miter"/>';
  s += '<path d="' + markerPath + '" fill="none" stroke="#3a5070" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"/>';
  [
    { x: midX, y: y - 11, value: parts.top },
    { x: right + 20, y: midY, value: parts.right },
    { x: midX, y: bottom + 13, value: parts.bottom },
    { x: x - 20, y: midY, value: parts.left }
  ].forEach(function(label) {
    s += '<rect x="' + (label.x - 18).toFixed(1) + '" y="' + (label.y - 7).toFixed(1) + '" width="36" height="14" rx="3" fill="white" fill-opacity="0.94"/>';
    s += '<text x="' + label.x.toFixed(1) + '" y="' + label.y.toFixed(1) + '" text-anchor="middle" dominant-baseline="middle" font-size="8" font-family="Heebo,Arial" font-weight="800" fill="#1a2332">' + label.value + '</text>';
  });
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
  var workerUrl = '/worker-visual.html?card=' + encodeURIComponent(barData);
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

  var printRef = SHORT_REF || CUSTOMER || ORDER_NUM;
  var printLengthCm = Math.round((Number(item.total_length_mm || 0)) / 10);
  var h = '<div class="prod-card">';
  h += '<div class="pc-print-face">';
  h += '<div class="pc-print-main">';
  h += '<div class="pc-print-head"><b>ITEM '+item.id+badge+'</b><b>Ø '+item.diameter+'</b></div>';
  h += '<div class="pc-print-ref">'+printRef+'</div>';
  h += '<div class="pc-print-shape">'+buildShapeSVG(segs)+'</div>';
  h += '<div class="pc-print-bottom"><span>L = '+printLengthCm+' cm</span><span>PCS '+subQty+'</span><span>'+wProp+' kg</span></div>';
  h += '</div>';
  h += '<div class="pc-print-qr-panel"><div class="pc-print-qr-code" data-worker-card-url="'+workerUrl+'"></div><div class="pc-print-status">SCAN STATUS</div></div>';
  h += '</div>';
  h += '<div class="pc-head">';
  h += '<div><div class="pc-title">'+badge+title+'</div><div class="pc-date">'+PRINT_DATE+'</div></div>';
  h += '<div class="pc-top-barcode"><div class="bc-font-top">'+barData+'</div><div class="bc-label">'+barData+'</div></div>';
  h += '</div>';
  h += '<div class="pc-order-row">';
  h += '<div class="pc-order-label">הזמנה מס:</div>';
  h += '<div class="pc-order-barcode"><div class="bc-font-mid">'+ORDER_NUM+'</div><div class="bc-ord-text">'+ORDER_NUM+'</div></div>';
  h += '<div class="pc-pallet">משטח: <b>'+item.pallet_num+'</b></div>';
  h += '</div>';
  h += '<div class="pc-scan-row"><div class="pc-scan-qr" data-worker-card-url="'+workerUrl+'"></div><div><div class="pc-scan-label">סריקה לעדכון עבודה</div><div class="pc-scan-text">'+barData+'</div></div></div>';
  h += '<div class="pc-wq-row">';
  h += '<div class="pc-wq-cell"><span class="wq-lbl">ק"ג:</span> <span class="wq-val">'+wProp+'</span></div>';
  h += '<div class="pc-wq-sep"></div>';
  h += '<div class="pc-wq-cell"><span class="wq-lbl">כמות:</span> <span class="wq-val">'+subQty+'</span> יח</div>';
  h += '<div class="pc-wq-sep"></div>';
  h += '<div class="pc-wq-cell"><span class="wq-lbl">לקוח:</span> <span class="wq-cust">'+CUSTOMER+'</span></div>';
  h += '</div>';
  var savedWeight = cardWeightFor(item, totalCards, cardIdx);
  var savedActual = savedWeight ? Number(savedWeight.actual_weight_kg || 0) : 0;
  var savedDeviation = savedWeight ? savedWeight.weight_deviation_pct : null;
  h += '<div class="pc-weight-entry">';
  h += '<div><label>משקל רצוי לכרטיסייה</label><div class="pc-weight-chip">'+wProp+' ק"ג</div></div>';
  h += '<div><label>משקל מצוי</label><input id="card-weight-'+uid+'" type="number" min="0" step="0.01" value="'+(savedActual || '')+'" placeholder="ק״ג"></div>';
  h += '<div><label>סטייה</label><div id="card-weight-dev-'+uid+'" class="pc-weight-chip'+deviationClass(savedDeviation)+'">'+fmtPct(savedDeviation)+'</div></div>';
  h += '<button onclick="saveCardWeight('+item.id+','+(cardIdx+1)+','+totalCards+','+subQty+',&quot;'+uid+'&quot;,event)">שמור משקל</button>';
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

// ── Generate & render all cards ───────────────────────────────────
function generateCards() {
  var grid = document.getElementById('cardsGrid');
  grid.innerHTML = '';
  var plan = cardPlan();
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

async function saveCardWeight(itemId, cardIndex, cardTotal, cardQty, uid, event) {
  if (event) event.stopPropagation();
  var input = document.getElementById('card-weight-' + uid);
  var value = Number(input && input.value);
  if (!Number.isFinite(value) || value < 0) { alert('משקל לא תקין'); return; }
  var res = await fetch('/api/orders/' + ORDER_ID + '/production-card-weight', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId, card_index: cardIndex, card_total: cardTotal, card_qty: cardQty, actual_weight_kg: value })
  });
  var body = await res.json().catch(function(){ return {}; });
  if (!res.ok) { alert(body.error || 'שמירת משקל נכשלה'); return; }
  var item = allItems.find(function(row){ return Number(row.id) === Number(itemId); });
  if (item) {
    item.actual_weight_kg = Number(body.item_actual_weight_kg || 0);
    item.card_weights = (item.card_weights || []).filter(function(row){ return !(Number(row.card_total) !== Number(cardTotal) || (Number(row.card_total) === Number(cardTotal) && Number(row.card_index) === Number(cardIndex))); });
    item.card_weights.push({ card_index: cardIndex, card_total: cardTotal, card_qty: cardQty, target_weight_kg: Number(body.card_target_weight_kg || 0), actual_weight_kg: value, weight_deviation_pct: body.card_deviation_pct });
  }
  var dev = document.getElementById('card-weight-dev-' + uid);
  if (dev) { dev.textContent = fmtPct(body.card_deviation_pct); dev.className = 'pc-weight-chip' + deviationClass(body.card_deviation_pct); }
}

function renderWorkerCardQrCodes() {
  var nodes = document.querySelectorAll('[data-worker-card-url]');
  nodes.forEach(function(node) {
    var target = new URL(node.getAttribute('data-worker-card-url'), window.location.origin).href;
    node.innerHTML = '';
    if (window.QRCode && window.QRCode.toCanvas) {
      var canvas = document.createElement('canvas');
      node.appendChild(canvas);
      var size = node.classList.contains('pc-print-qr-code') ? 96 : 42;
      window.QRCode.toCanvas(canvas, target, { width: size, margin: 0 }, function(){});
    } else {
      node.textContent = 'QR';
      node.title = target;
    }
  });
}

function printCards() {
  if (PREVIEW_ONLY) { alert('הכרטיסיות בתצוגה בלבד. יש לאשר/לתכנן את ההזמנה לפני הדפסה.'); return; }
  generateCards();
  renderWorkerCardQrCodes();
  setTimeout(function(){ window.print(); }, 120);
}

// Init: render fixed production cards and QR codes.
(function() {
  generateCards();
  renderWorkerCardQrCodes();
})();
</script>
</body>
</html>`;
}

module.exports = {
  renderPrintCardsPage,
};


