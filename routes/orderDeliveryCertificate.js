const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/orderDeliveryCertificate missing dependency: ${name}`);
  return value;
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

  // Classify each item: מכופף or ישר
  const parseSegs = raw => { try { return JSON.parse(raw) || []; } catch { return []; } };
  const isBent = item => {
    const segs = parseSegs(item.segments);
    const angles = segs.map(s => s.angle_deg).filter(a => a !== undefined);
    return angles.some(a => a < 175);
  };

  const calcItemWeight = it => {
    if (it.total_weight && it.total_weight > 0) return it.total_weight;
    const kgm = industry.kgPerMeter(Math.round(it.diameter));
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

  return router;
};

module.exports.manifest = {
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
