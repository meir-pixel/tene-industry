'use strict';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(value, currency) {
  const amount = Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount} ${escapeHtml(currency || 'ILS')}`;
}

function number(value, digits = 3) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
}

function renderQuotationPrintPage({ quotation, revision }) {
  const isDraft = Boolean(quotation && revision && revision.status === 'draft');
  const isIssued = Boolean(quotation && revision && revision.status === 'issued' && revision.issued_payload_hash);
  if (!isDraft && !isIssued) {
    const error = new Error('issued_quotation_revision_required');
    error.code = 'issued_quotation_revision_required';
    error.statusCode = 409;
    throw error;
  }
  const customer = revision.customer_snapshot || {};
  const projectSite = revision.project_site_snapshot || {};
  const documentStatus = isDraft ? 'טיוטה — לא נשלח ללקוח' : 'הצעת מחיר';
  const documentIdentity = isDraft ? 'טיוטה' : quotation.quotation_num;
  const rows = revision.lines.map(line => `
    <tr>
      <td>${number(line.sequence, 0)}</td>
      <td class="desc">${escapeHtml(line.item_description)}</td>
      <td>${number(line.quantity)} ${escapeHtml(line.unit)}</td>
      <td>${line.total_weight_kg == null ? '—' : `${number(line.total_weight_kg)} kg`}</td>
      <td>${number(line.pricing_quantity)} ${escapeHtml(line.pricing_unit)}</td>
      <td>${money(line.unit_price, revision.currency_code)}</td>
      <td>${number(line.discount_pct)}%</td>
      <td>${money(line.line_grand_total, revision.currency_code)}</td>
    </tr>`).join('');
  const issuedDate = isIssued && revision.issued_at ? new Date(revision.issued_at).toLocaleDateString('he-IL') : null;
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(documentStatus)} / ${revision.revision_number}</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#eef1f5;color:#172033;font-family:Arial,"Heebo",sans-serif}
    .toolbar{max-width:210mm;margin:12px auto;display:flex;gap:10px;align-items:center}.toolbar button{padding:9px 18px;border:0;border-radius:6px;background:#172033;color:#fff;font-weight:700;cursor:pointer}
    .page{width:210mm;min-height:297mm;margin:0 auto 18px;background:#fff;padding:15mm 13mm;box-shadow:0 2px 12px #0002}
    header{display:grid;grid-template-columns:32mm 1fr auto;gap:8mm;align-items:center;border-bottom:3px solid #172033;padding-bottom:8mm}
    header img{width:30mm;max-height:22mm;object-fit:contain}.title h1{margin:0;font-size:25px}.title p{margin:3px 0 0;color:#566174}.number{text-align:left;direction:ltr;font-size:20px;font-weight:900}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:7mm;margin:9mm 0}.box{border:1px solid #cdd4df;border-radius:7px;padding:5mm}.box h2{font-size:12px;margin:0 0 4px;color:#687386}.box p{margin:2px 0;font-size:12px}
    table{width:100%;border-collapse:collapse;font-size:10px}th{background:#172033;color:#fff;padding:7px 5px}td{border:1px solid #d3d9e2;padding:7px 5px;text-align:center}.desc{text-align:right;min-width:44mm}
    .totals{width:75mm;margin:8mm 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #dde2ea}.totals .grand{font-size:16px;font-weight:900;border-top:2px solid #172033;border-bottom:0;margin-top:3px;padding-top:7px}
    .notes{margin-top:8mm;border:1px solid #d3d9e2;border-radius:7px;padding:5mm;min-height:20mm;white-space:pre-wrap;font-size:11px}.proof{direction:ltr;text-align:left;overflow-wrap:anywhere;color:#687386;font:8px monospace;margin-top:9mm}
    footer{margin-top:12mm;padding-top:5mm;border-top:1px solid #172033;display:flex;justify-content:space-between;font-size:9px;color:#687386}
    @media print{body{background:#fff}.toolbar{display:none}.page{margin:0;box-shadow:none;width:auto;min-height:auto}@page{size:A4 portrait;margin:0}}
  </style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">הדפס / שמור PDF</button><span>${escapeHtml(isDraft ? documentStatus : 'הצעת מחיר שהופקה מגרסה בלתי־ניתנת לשינוי')}</span></div>
  <main class="page" data-document-kind="customer-quotation" data-revision-status="${isDraft ? 'draft' : 'issued'}">
    <header>
      <img src="/brand/tene-pdf-logo.jpg" alt="TENE">
      <div class="title"><h1>${escapeHtml(documentStatus)}</h1><p>Customer Quotation</p></div>
      <div class="number">${escapeHtml(documentIdentity)}<br><small>REV ${revision.revision_number}</small></div>
    </header>
    <section class="meta">
      <div class="box"><h2>לקוח / לקוח פוטנציאלי</h2><p><b>${escapeHtml(customer.name || quotation.prospect_display_name || '—')}</b></p><p>${escapeHtml(customer.contact_name || '')} ${escapeHtml(customer.phone || customer.contact_phone || '')}</p><p>${escapeHtml(customer.address || '')}</p></div>
      <div class="box"><h2>פרטי ההצעה</h2>${isIssued ? `<p>הופקה: <b>${escapeHtml(issuedDate)}</b></p>` : `<p><b>${escapeHtml(documentStatus)}</b></p>`}<p>בתוקף עד: <b>${escapeHtml(revision.validity_date || '—')}</b></p><p>פרויקט: <b>${escapeHtml(projectSite.project?.name || '—')}</b></p><p>אתר: <b>${escapeHtml(projectSite.site?.name || '—')}</b></p></div>
    </section>
    <table>
      <thead><tr><th>#</th><th>תיאור</th><th>כמות</th><th>משקל</th><th>כמות לחיוב</th><th>מחיר יחידה</th><th>הנחה</th><th>סה״כ כולל מע״מ</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <section class="totals">
      <div><span>סכום ביניים</span><b>${money(revision.subtotal, revision.currency_code)}</b></div>
      <div><span>הנחות</span><b>${money(revision.discount_total, revision.currency_code)}</b></div>
      <div><span>מע״מ (${number(Number(revision.vat_rate) * 100)}%)</span><b>${money(revision.vat_total, revision.currency_code)}</b></div>
      <div class="grand"><span>סה״כ</span><b>${money(revision.grand_total, revision.currency_code)}</b></div>
    </section>
    <section class="notes"><b>הערות מסחריות</b><br>${escapeHtml(revision.commercial_notes || '—')}</section>
    ${isIssued ? `<div class="proof">Issued payload SHA-256: ${escapeHtml(revision.issued_payload_hash)}</div>` : ''}
    <footer><span>מסמך הצעת מחיר — אינו הזמנה ואינו מסמך ייצור</span><span>${escapeHtml(documentIdentity)} / REV ${revision.revision_number}</span></footer>
  </main>
</body>
</html>`;
}

module.exports = { renderQuotationPrintPage, escapeHtml };
