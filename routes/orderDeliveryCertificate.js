const router = require('express').Router();
const { isTechnicalRecognitionNote } = require('../services/intakeWorkflow');
const productionCards = require('../services/productionCards');
const { itemShapeMetrics } = require('../services/shapeSnapshot');

const REVIEW_NOTE_LABEL = '\u05d3\u05d5\u05e8\u05e9 \u05d0\u05d9\u05de\u05d5\u05ea \u05de\u05d5\u05dc \u05de\u05e7\u05d5\u05e8 \u05d4\u05e7\u05dc\u05d9\u05d8\u05d4';

function required(name, value) {
  if (!value) throw new Error(`routes/orderDeliveryCertificate missing dependency: ${name}`);
  return value;
}

function printableItemNote(note) {
  if (!note) return '';
  return isTechnicalRecognitionNote(note) ? REVIEW_NOTE_LABEL : note;
}


function isSixOrTwelveMeterStraight(lengthMm) {
  const mm = Number(lengthMm || 0);
  return Math.abs(mm - 6000) <= 5 || Math.abs(mm - 12000) <= 5;
}

function deliveryItemMetrics(item, industry = null) {
  const metrics = itemShapeMetrics(item || {});
  const totalLengthMm = metrics.totalLengthMm || Number(item && item.total_length_mm) || 0;
  const snapshotWeight = metrics.totalWeightKg || 0;
  if (snapshotWeight > 0) return { totalLengthMm, totalWeightKg: snapshotWeight };

  const legacyWeight = Number(item && item.total_weight) || 0;
  if (legacyWeight > 0) return { totalLengthMm, totalWeightKg: legacyWeight };

  const kgm = industry && typeof industry.kgPerMeter === 'function'
    ? industry.kgPerMeter(Math.round(Number(item && item.diameter) || 0))
    : 0;
  const quantity = Number(item && item.quantity) || 1;
  const calculatedWeight = kgm && totalLengthMm
    ? Math.round((totalLengthMm / 1000) * kgm * quantity * 10) / 10
    : 0;
  return { totalLengthMm, totalWeightKg: calculatedWeight };
}

function deliverySectionKey(item, segs) {
  const text = [item.shape_name, item.shape_id, item.struct_element, item.note]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const diameter = Number(item.diameter || 0);
  if (/mesh|wire|רשת/.test(text)) return 'mesh';
  if (/cage|pile|כלוב|כלונס/.test(text)) return 'cage';
  if (/חישוק|hoop/.test(text)) return 'hoops';
  if (/כסא|כסאות|chair/.test(text)) return 'chairs';
  if (/ציפור|ציפורים|אוזן|אזני|הרמה|קרום|קרומים|bird|lifting|insert/.test(text)) return 'lifting';
  if (/spiral|ring|coil|ספיר|טבעת|סליל|לולאה/.test(text)) return diameter <= 12 ? 'spiral_upto_12' : 'spiral_14_plus';
  const angles = Array.isArray(segs) ? segs.map(seg => Number(seg.angle_deg)).filter(Number.isFinite) : [];
  const bent = Array.isArray(segs) && segs.length > 1 && angles.some(angle => Math.abs(angle) > 0.001 && angle < 175);
  if (bent) return 'bent_rebar';
  return isSixOrTwelveMeterStraight(deliveryItemMetrics(item).totalLengthMm || item.total_length_mm) ? 'straight_stock' : 'straight_cut';
}

function buildDeliveryWorkSummary(allItems, parseSegs, calcItemWeight) {
  const labels = {
    steel: 'ברזל',
    cutting: 'חיתוך',
    bending: 'כיפוף',
    straight_stock: 'ברזל ישר 6/12 מטר',
    mesh: 'רשתות',
    cage: 'כלונסאות / כלובים',
    hoops: 'חישוקים',
    chairs: 'כסאות',
    lifting: 'ציפורים / אזני הרמה / קרומים',
    spiral_upto_12: 'עיבוד ספירלות טבעות עד קוטר 12 כולל',
    spiral_14_plus: 'עיבוד ספירלות מקוטר 14 ומעלה',
  };
  const basis = { steel:'kg', cutting:'kg', bending:'kg', straight_stock:'kg', mesh:'kg', cage:'kg', hoops:'unit', chairs:'unit', lifting:'unit', spiral_upto_12:'kg', spiral_14_plus:'kg' };
  const rows = new Map();
  const add = (key, item, weight) => {
    const row = rows.get(key) || { key, label: labels[key], basis: basis[key], weight: 0, units: 0, items: 0 };
    row.weight += Number(weight || 0);
    row.units += Number(item.quantity || 0);
    row.items += 1;
    rows.set(key, row);
  };
  allItems.forEach(item => {
    const segs = parseSegs(item.segments);
    const weight = calcItemWeight(item);
    const key = deliverySectionKey(item, segs);
    if (key === 'bent_rebar') { add('steel', item, weight); add('cutting', item, weight); add('bending', item, weight); return; }
    if (key === 'straight_cut') { add('steel', item, weight); add('cutting', item, weight); return; }
    if (key === 'straight_stock') { add('straight_stock', item, weight); return; }
    add(key, item, weight);
  });
  return Array.from(rows.values()).filter(row => row.weight > 0 || row.units > 0);
}

module.exports = function createOrderDeliveryCertificateRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const industry = required('industry', deps.industry);

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

  const parseSegs = raw => { try { return JSON.parse(raw) || []; } catch { return []; } };
  const isBent = item => deliverySectionKey(item, parseSegs(item.segments)) === 'bent_rebar';

  const calcItemWeight = it => Math.round((deliveryItemMetrics(it, industry).totalWeightKg || 0) * 10) / 10;

  const workSummary = buildDeliveryWorkSummary(allItems, parseSegs, calcItemWeight);
  const wTotal = allItems.reduce((sum, item) => sum + calcItemWeight(item), 0);
  // 3% weight-gap addition — same factor as orders.billing_weight (routes/orders.js).
  // Optional: ?waste3=0 renders the certificate without the addition rows.
  const includeWaste = String(req.query.waste3 || '1') !== '0';
  const wWaste = wTotal * 0.03;
  const wBilling = wTotal * 1.03;
  const fmt1 = v => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  const fmt2 = v => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const fmtTon = v => (Number(v || 0) / 1000).toFixed(2);

  // Position range label
  const bentCount = allItems.filter(isBent).length;
  const posLabel = allItems.length > 0
    ? 'תעודת משלוח לפי פריטים שסופקו וסיכום סעיפי עבודה'
    : 'תעודת משלוח';

  const workSummaryRowsHtml = workSummary.map(row => {
    const value = row.basis === 'unit'
      ? fmt1(row.units) + ' &#1497;&#1495;&#1523;'
      : fmt1(row.weight) + ' &#1511;&#1524;&#1490; (' + fmtTon(row.weight) + ' &#1496;&#1493;&#1503;)';
    return '<div class="sum-row"><span class="sum-lbl">' + row.label + ':</span><span class="sum-val">' + value + '</span></div>';
  }).join('');

  const summaryTotalsHtml = includeWaste ? `
      <div class="sum-row">
        <span class="sum-lbl">סה"כ משקל תיאורטי:</span>
        <span class="sum-val">${fmt2(wTotal)} ק"ג</span>
      </div>
      <div class="sum-row" style="color:#c0392b;">
        <span class="sum-lbl" style="color:#c0392b;">תוספת 3% פערי משקלים:</span>
        <span class="sum-val" style="color:#c0392b;font-weight:900;">${fmt2(wWaste)} ק"ג</span>
      </div>
      <div class="sum-row sum-total">
        <span class="sum-lbl"><b>סה"כ משקל לחיוב:</b></span>
        <span class="sum-val"><b>${fmt2(wBilling)} ק"ג</b></span>
      </div>` : `
      <div class="sum-row sum-total">
        <span class="sum-lbl"><b>סה"כ משקל:</b></span>
        <span class="sum-val"><b>${fmt2(wTotal)} ק"ג</b></span>
      </div>`;

  const tfootTotalsHtml = includeWaste ? `
      <tr>
        <td colspan="5" style="text-align:right;background:#eef3f8;color:#1a2332;">סה"כ משקל תיאורטי:</td>
        <td class="total-val" style="background:#eef3f8;color:#1a2332;">${fmt2(wTotal)}</td>
        <td style="background:#eef3f8;"></td>
        <td style="background:#eef3f8;color:#1a2332;">סה"כ כללי קומפלט · ${allItems.length} פריטים</td>
      </tr>
      <tr>
        <td colspan="5" style="text-align:right;background:#fff;color:#c0392b;">תוספת 3% פערי משקלים:</td>
        <td class="total-val" style="background:#fff;color:#c0392b;">${fmt2(wWaste)}</td>
        <td style="background:#fff;"></td>
        <td style="background:#fff;"></td>
      </tr>
      <tr>
        <td colspan="5" style="text-align:right;">סה"כ משקל לחיוב:</td>
        <td class="total-val">${fmt2(wBilling)}</td>
        <td></td>
        <td></td>
      </tr>` : `
      <tr>
        <td colspan="5" style="text-align:right;">סה"כ משקל</td>
        <td class="total-val">${fmt2(wTotal)}</td>
        <td></td>
        <td>סה"כ כללי קומפלט · ${allItems.length} פריטים</td>
      </tr>`;

  // Build table rows
  let rows = '';
  allItems.forEach((item, idx) => {
    const segs   = parseSegs(item.segments);
    const itemMetrics = deliveryItemMetrics(item, industry);
    const bent   = isBent(item);
    const posNum = idx + 1;
    const diam   = item.diameter || '–';
    const type   = bent ? 'מכופף' : (isSixOrTwelveMeterStraight(itemMetrics.totalLengthMm) ? 'ברזל ישר 6/12' : 'ישר חתוך');
    const lenCm  = itemMetrics.totalLengthMm ? Math.round(itemMetrics.totalLengthMm / 10) : '–';
    const qty    = item.quantity || 1;
    const wt     = fmt1(calcItemWeight(item));
    const notes  = [item.struct_element, item.struct_floor, item.sheet_num, printableItemNote(item.note)].filter(Boolean).join(' · ') || '–';

    const shapeSvg = productionCards.itemShapeSvg(item);

    rows += `
      <tr>
        <td class="c">${posNum}</td>
        <td class="c"><b>Ø${diam}</b></td>
        <td class="c">${type}</td>
        <td class="c">${lenCm}</td>
        <td class="c">${qty}</td>
        <td class="c"><b>${wt}</b></td>
        <td class="shape-cell">
          <div class="delivery-shape">${shapeSvg}</div>
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
.summary-box{background:#f7fafc;border:2px solid #1a2332;border-radius:4px;
  padding:12px 16px;margin-bottom:16px;display:inline-block;float:left;min-width:92mm;box-shadow:0 1px 0 rgba(26,35,50,.12);}
.summary-title{font-size:12px;font-weight:900;color:#1a2332;margin-bottom:9px;text-align:center;border-bottom:2px solid #1a2332;padding-bottom:5px;}
.sum-row{display:flex;justify-content:space-between;gap:24px;font-size:12px;margin-bottom:5px;}
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
.shape-cell{text-align:center;padding:3px 5px;width:38mm;}
.delivery-shape{width:36mm;height:23mm;margin:0 auto;display:flex;align-items:center;justify-content:center;overflow:hidden;}
.delivery-shape svg{width:100%!important;height:100%!important;max-height:none!important;display:block;}
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
  <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#1a2332;cursor:pointer;">
    <input type="checkbox" ${includeWaste ? 'checked' : ''} onchange="const u=new URL(location.href);u.searchParams.set('waste3',this.checked?'1':'0');location.href=u.href;">
    תוספת 3% פערי משקלים
  </label>
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
    <div class="summary-box" data-summary-contract="steel-cutting-bending">
      <div class="summary-title">&#1505;&#1497;&#1499;&#1493;&#1501; &#1505;&#1506;&#1497;&#1508;&#1497; &#1506;&#1489;&#1493;&#1491;&#1492; &#1500;&#1502;&#1513;&#1500;&#1493;&#1495;</div>
      ${workSummaryRowsHtml}
${summaryTotalsHtml}
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
    <tfoot>${tfootTotalsHtml}
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

  return router;
};

module.exports.manifest = {
  screens: [],
  access: { default: 'hidden', roles: { admin: 'edit' } },
  "id": "order-delivery-certificate",
  "label": "Order Delivery Certificate",
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
