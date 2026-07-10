(function () {
  if (window.NewOrderEditor && window.NewOrderEditor.installed) return;

  const TITLES = { customer: 'לקוח', site: 'אתר', delivery: 'אספקה', source: 'מקור / OCR' };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }
  function formatKg(value) { const n = Number(value || 0); return (Number.isFinite(n) ? n : 0).toLocaleString('he-IL', { maximumFractionDigits: 1 }) + ' ק"ג'; }
  function setTextSafe(id, value) { const el = document.getElementById(id); if (el) el.textContent = value == null ? '' : String(value); }
  function shortDate(value) { const d = new Date(String(value || '') + 'T00:00:00'); return Number.isNaN(d.getTime()) ? String(value || '') : d.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit' }); }
  function normalizePanel(type) { return ['customer','site','delivery','source'].includes(type) ? type : ''; }
  function numeric(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function formatMm(value) { const n = numeric(value, 0); return n > 0 ? n.toLocaleString('he-IL', { maximumFractionDigits: 0 }) + ' \u05de\u0022\u05de' : '-'; }
  function formatMeters(value) { const n = numeric(value, 0); return n > 0 ? (n / 1000).toLocaleString('he-IL', { maximumFractionDigits: 2 }) + ' \u05de\u05f3' : '-'; }
  function jsArg(value) { const n = Number(value); return Number.isFinite(n) && String(value).trim() !== '' ? String(n) : JSON.stringify(String(value)); }

  function setupOrderLinesTable() {
    const container = document.getElementById('palletsContainer');
    if (!container) return;
    container.classList.add('order-lines-body');
    if (container.closest('.order-lines-table')) return;
    const table = document.createElement('div');
    table.className = 'order-lines-table';
    const head = document.createElement('div');
    head.className = 'order-lines-head';
    head.innerHTML = '<span>\u05de\u05e1\u05f3</span><span>\u05d0\u05dc\u05de\u05e0\u05d8</span><span>\u05e6\u05d5\u05e8\u05d4 \u05d5\u05de\u05d9\u05d3\u05d5\u05ea</span><span>\u05e7\u05d5\u05d8\u05e8</span><span>\u05db\u05de\u05d5\u05ea</span><span>\u05d0\u05d5\u05e8\u05da</span><span>\u05e1\u05d4\u05f4\u05db \u05d0\u05d5\u05e8\u05da</span><span>\u05de\u05e9\u05e7\u05dc</span><span></span>';
    container.parentNode.insertBefore(table, container);
    table.append(head, container);
  }
  function setupDom() {
    const main = document.querySelector('body[data-page="new"] .main');
    if (main) main.classList.add('order-min-page');
    document.querySelector('.order-pro-header')?.classList.add('order-min-header');
    document.querySelector('.order-pro-title')?.classList.add('order-min-title');
    document.querySelector('.order-pro-actions')?.classList.add('order-min-actions');
    document.querySelector('.order-pro-kicker')?.remove();
    document.querySelector('.order-more-action')?.remove();
    document.querySelector('.order-pro-context')?.classList.add('order-min-context');
    wireContextChip('noCustomerContextCard', 'customer');
    wireContextChip('noSiteContextCard', 'site');
    wireContextChip('noDeliveryContextCard', 'delivery');
    wireContextChip('noSourceContextCard', 'source');
    document.querySelector('.order-pro-editor')?.classList.add('order-min-editor');
    const items = document.getElementById('items-section');
    if (items) {
      items.classList.add('order-min-items');
      const h = items.querySelector('.items-header h2'); if (h) h.textContent = 'פרטי ההזמנה';
      const p = items.querySelector('.items-header p'); if (p) p.textContent = 'צורות, כמויות ומשקל';
    }
    const importBtn = document.querySelector('.secondary-import-shape');
    if (importBtn) { importBtn.classList.add('secondary-import'); importBtn.onclick = () => minToggleInspectorPanel('source'); }
    const inspector = document.querySelector('.order-pro-inspector');
    if (inspector) {
      inspector.classList.add('order-min-inspector');
      inspector.id = 'orderInspector';
      if (!document.getElementById('inspectorEditHost')) {
        const host = document.createElement('div');
        host.id = 'inspectorEditHost';
        host.className = 'inspector-edit-shell';
        host.hidden = true;
        inspector.prepend(host);
      }
    }
    document.getElementById('orderSetupDrawer')?.classList.add('order-legacy-setup-store');
    document.querySelector('.summary-bar > .submit-btn')?.remove();
    document.querySelector('.no-bottom-actions')?.remove();
  }

  function wireContextChip(id, panel) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.dataset.context = panel;
    btn.onclick = () => minToggleInspectorPanel(panel);
    btn.querySelector('em')?.remove();
  }

  function panelElementFor(type) {
    const panel = normalizePanel(type);
    if (panel === 'customer') return document.getElementById('customer-section');
    if (panel === 'site' || panel === 'delivery') return document.getElementById('delivery-section');
    if (panel === 'source') return document.getElementById('order-import-section-anchor');
    return null;
  }

  function returnSetupPanelsToStore() {
    const store = document.getElementById('orderSetupDrawer');
    document.querySelectorAll('[data-setup-panel]').forEach(panel => {
      panel.hidden = true;
      panel.classList.remove('is-active', 'is-open', 'is-inspector-panel');
      panel.style.setProperty('display', 'none', 'important');
      const details = panel.querySelector('details'); if (details) details.open = false;
      if (store && panel.parentElement !== store) store.appendChild(panel);
    });
  }

  function renderMovedPanel(host, type) {
    const panel = panelElementFor(type);
    if (!panel) return;
    panel.hidden = false;
    panel.classList.add('is-active', 'is-open', 'is-inspector-panel');
    panel.style.setProperty('display', 'block', 'important');
    const details = panel.querySelector('details'); if (details) details.open = true;
    host.appendChild(panel);
  }

  function minRenderCustomerInspector(host) { renderMovedPanel(host, 'customer'); }
  function minRenderDeliveryInspector(host, type = 'delivery') { renderMovedPanel(host, type); }
  function minRenderSourceInspector(host) { renderMovedPanel(host, 'source'); }

  function minRenderDefaultInspector() {
    const host = document.getElementById('inspectorEditHost');
    const summary = document.getElementById('summary-section');
    const inventory = document.getElementById('liveInventoryPanel');
    returnSetupPanelsToStore();
    if (host) { host.hidden = true; host.replaceChildren(); }
    if (summary) summary.style.removeProperty('display');
    if (inventory) inventory.style.removeProperty('display');
    minRenderOrderSummary(); minRenderInventorySummary(); minRenderPricingSummary();
  }

  function minRenderInspector(activePanel = '') {
    const inspector = document.getElementById('orderInspector');
    const host = document.getElementById('inspectorEditHost');
    const panel = normalizePanel(activePanel);
    if (!inspector || !host) return;
    inspector.dataset.activePanel = panel;
    document.querySelectorAll('.context-chip').forEach(btn => btn.classList.toggle('is-active', btn.dataset.context === panel));
    if (!panel) { minRenderDefaultInspector(); return; }
    document.getElementById('summary-section')?.style.setProperty('display', 'none', 'important');
    document.getElementById('liveInventoryPanel')?.style.setProperty('display', 'none', 'important');
    returnSetupPanelsToStore();
    host.hidden = false;
    host.replaceChildren();
    const head = document.createElement('div');
    head.className = 'inspector-head';
    head.innerHTML = '<h2>' + escapeHtml(TITLES[panel] || 'פרטי הזמנה') + '</h2><button type="button" class="inspector-close">סגור</button>';
    head.querySelector('button').addEventListener('click', minCloseInspectorPanel);
    const body = document.createElement('div');
    body.className = 'inspector-body';
    host.append(head, body);
    if (panel === 'customer') minRenderCustomerInspector(body);
    else if (panel === 'source') minRenderSourceInspector(body);
    else minRenderDeliveryInspector(body, panel);
  }

  function minToggleInspectorPanel(type) {
    const inspector = document.getElementById('orderInspector');
    const next = normalizePanel(type);
    minRenderInspector((inspector?.dataset.activePanel || '') === next ? '' : next);
  }
  function minCloseInspectorPanel() { minRenderInspector(''); }

  function minEnsureDefaultPallet() {
    if (!Array.isArray(pallets)) pallets = [];
    if (!pallets.length) pallets.push({ id: Date.now(), maxWeight: 500, items: [] });
    return pallets[0];
  }

  function minAddShapeNow(family = 'bar') {
    const pallet = minEnsureDefaultPallet();
    if (!pallet || typeof window.addItem !== 'function') return;
    window.addItem(pallet.id);
  }

  function minGetAllVisibleOrderItems() {
    return (pallets || []).flatMap(pallet => (pallet.items || []).map(item => ({ palletId: pallet.id, item })));
  }

  function minRenderEmptyItemsState() {
    return '<div class="order-lines-empty">\u05e2\u05d3\u05d9\u05d9\u05df \u05d0\u05d9\u05df \u05e4\u05e8\u05d9\u05d8\u05d9\u05dd \u05d1\u05d4\u05d6\u05de\u05e0\u05d4. \u05dc\u05d7\u05e5 \u05e2\u05dc + \u05d4\u05d5\u05e1\u05e3 \u05e6\u05d5\u05e8\u05d4 \u05db\u05d3\u05d9 \u05dc\u05d4\u05ea\u05d7\u05d9\u05dc.</div>';
  }

  function lineContract(item = {}) { return typeof window.itemShapeContract === 'function' ? window.itemShapeContract(item) : null; }
  function lineData(item = {}) { const contract = lineContract(item); const snapshot = typeof item.shapeSnapshot === 'object' && item.shapeSnapshot ? item.shapeSnapshot : null; return contract?.data || snapshot?.data || snapshot || {}; }
  function lineSides(item = {}) { if (typeof window.itemShapeSides === 'function') return window.itemShapeSides(item); const data = lineData(item); if (Array.isArray(item.shapeSides)) return item.shapeSides.map(Number).filter(v => Number.isFinite(v) && v > 0); if (Array.isArray(data.sides)) return data.sides.map(Number).filter(v => Number.isFinite(v) && v > 0); const length = numeric(item.length || item.totalLengthMm || data.lengthMm || data.totalLengthMm, 0); return length > 0 ? [length] : []; }
  function lineAngles(item = {}) { if (typeof window.itemShapeAngles === 'function') return window.itemShapeAngles(item); const data = lineData(item); return Array.isArray(data.angles) ? data.angles.map(Number).filter(Number.isFinite) : []; }
  function lineQty(item = {}) { return Math.max(1, numeric(item.qty ?? item.quantity ?? lineData(item).quantity, 1)); }
  function lineDiameter(item = {}) { const data = lineData(item); return numeric(item.diameter ?? item.barDiameter ?? data.diameter ?? data.barDiameter ?? 12, 12); }
  function isLineSpiral(item = {}) { const contract = lineContract(item); return item.family === 'spirals' || contract?.family === 'spirals' || (typeof window.isSpiralOrderItem === 'function' && window.isSpiralOrderItem(item)); }
  function getSpiralFields(item = {}) { if (typeof window.spiralFieldsFromShapeData === 'function') return window.spiralFieldsFromShapeData(item); const data = lineData(item); return { spiralDiameterMm: numeric(item.spiral_diameter_mm || item.spiralDiameterMm || data.spiralDiameterMm || data.diameterMm, 0), spiralTurns: numeric(item.spiral_turns || item.spiralTurns || data.spiralTurns || data.turns, 0), spiralHeightMm: numeric(item.spiral_height_mm || item.spiralHeightMm || data.spiralHeightMm || data.heightMm, 0) }; }
  function getLineUnitLengthMm(item = {}) { const data = lineData(item); const calculated = lineContract(item)?.calculated || item.shapeSnapshot?.calculated || {}; if (isLineSpiral(item)) { const spiral = getSpiralFields(item); if (typeof window.spiralLengthMm === 'function' && spiral.spiralDiameterMm > 0 && spiral.spiralTurns > 0) return window.spiralLengthMm(spiral.spiralDiameterMm, spiral.spiralTurns); } const sides = lineSides(item); const sideTotal = sides.reduce((sum, length) => sum + numeric(length, 0), 0); if (sideTotal > 0) return sideTotal; return numeric(item.length ?? item.totalLengthMm ?? data.lengthMm ?? data.totalLengthMm ?? calculated.unitLengthMm ?? calculated.totalLengthMm, 0); }
  function formatLineLength(item = {}) { return formatMm(getLineUnitLengthMm(item)); }
  function formatLineTotalLength(item = {}) { return formatMeters(getLineUnitLengthMm(item) * lineQty(item)); }
  function formatLineWeight(item = {}) { const weight = typeof window.calcItemWeight === 'function' ? window.calcItemWeight(item) : 0; return formatKg(weight); }
  function formatLineShapeDims(item = {}) { const data = lineData(item); if (isLineSpiral(item)) { const spiral = getSpiralFields(item); const parts = []; if (spiral.spiralDiameterMm > 0) parts.push('\u00d8' + spiral.spiralDiameterMm.toLocaleString('he-IL')); if (spiral.spiralHeightMm > 0) parts.push('H=' + spiral.spiralHeightMm.toLocaleString('he-IL')); if (spiral.spiralTurns > 0) parts.push(spiral.spiralTurns.toLocaleString('he-IL') + ' \u05db\u05e8\u05d9\u05db\u05d5\u05ea'); return parts.join(' \u00b7 ') || '\u05e1\u05e4\u05d9\u05e8\u05dc\u05d4'; } const family = lineContract(item)?.family || item.family || ''; const width = numeric(data.widthMm || data.width || item.widthMm || item.width, 0); const height = numeric(data.heightMm || data.height || item.heightMm || item.height, 0); if ((family === 'mesh' || family === 'meshes') && width > 0 && height > 0) return '\u05e8\u05e9\u05ea ' + (width / 1000).toLocaleString('he-IL', { maximumFractionDigits: 2 }) + '\u00d7' + (height / 1000).toLocaleString('he-IL', { maximumFractionDigits: 2 }); const sides = lineSides(item); if (sides.length) { const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''); return sides.slice(0, 4).map((length, index) => labels[index] + '=' + numeric(length, 0).toLocaleString('he-IL', { maximumFractionDigits: 0 })).join(' \u00b7 '); } return '\u05e6\u05d5\u05e8\u05d4'; }
  function renderLineShapeSketch(item = {}) { const sides = lineSides(item); const angles = lineAngles(item); if (typeof window.itemPreviewSvg === 'function') { const svg = window.itemPreviewSvg(item, sides, angles); if (svg) return svg; } const label = sides.length ? 'A=' + numeric(sides[0], 0).toLocaleString('he-IL', { maximumFractionDigits: 0 }) : '\u05e6\u05d5\u05e8\u05d4'; return '<svg viewBox="0 0 112 34" width="112" height="34" aria-hidden="true"><line x1="12" y1="15" x2="100" y2="15" stroke="#35546f" stroke-width="4" stroke-linecap="round"/><text x="56" y="30" text-anchor="middle" font-size="10" fill="#64748b">' + escapeHtml(label) + '</text></svg>'; }
  function lineTitle(item = {}) { if (item.shapeName || item.displayName) return item.shapeName || item.displayName; if (isLineSpiral(item)) return '\u05e1\u05e4\u05d9\u05e8\u05dc\u05d4'; const family = lineContract(item)?.family || item.family || ''; if (family === 'mesh' || family === 'meshes') return '\u05e8\u05e9\u05ea'; return '\u05de\u05d5\u05d8 \u05d9\u05e9\u05e8'; }

  function updateLineQuantity(palletId, itemId, input) {
    if (input && !input.isConnected) return;
    const next = Math.max(1, numeric(input?.value, 1));
    if (input) input.value = String(next);
    const pallet = (window.pallets || []).find((entry) => String(entry.id) === String(palletId));
    const item = (pallet?.items || []).find((entry) => String(entry.id) === String(itemId));
    if (item && numeric(item.qty, 1) === next) return;
    if (typeof window.updateItem === 'function') window.updateItem(palletId, itemId, 'qty', next);
  }

  function renderCompactOrderLine(palletId, item, itemIndex = 0) {
    const id = String(item.id); const palletArg = jsArg(palletId); const itemArg = jsArg(id); const qty = lineQty(item); const diameter = lineDiameter(item); const title = lineTitle(item); const note = String(item.note || '').trim(); const dims = formatLineShapeDims(item); const length = formatLineLength(item); const totalLength = formatLineTotalLength(item); const weight = formatLineWeight(item); const openCall = 'openShapeEditor(' + palletArg + ',' + itemArg + ')'; const updateQtyCall = 'updateLineQuantity(' + palletArg + ',' + itemArg + ',this)';
    return `<article class="order-line-row" id="item-row-${escapeHtml(id)}" data-item-id="${escapeHtml(id)}"><div class="line-index">${itemIndex + 1}</div><button type="button" class="line-name" onclick="${openCall}" title="\u05e4\u05ea\u05d7 \u05e2\u05d5\u05e8\u05da \u05e6\u05d5\u05e8\u05d4"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(note || dims)}</small></button><button type="button" class="line-shape" onclick="${openCall}" title="\u05e4\u05ea\u05d7 \u05e2\u05d5\u05e8\u05da \u05e6\u05d5\u05e8\u05d4"><span class="line-shape-sketch">${renderLineShapeSketch(item)}</span><span class="line-shape-dims">${escapeHtml(dims)}</span></button><div class="line-diameter">\u00d8${escapeHtml(diameter.toLocaleString('he-IL', { maximumFractionDigits: 0 }))}</div><input class="line-qty" type="number" min="1" step="1" value="${escapeHtml(qty)}" inputmode="numeric" aria-label="\u05db\u05de\u05d5\u05ea" onfocus="this.select()" oninput="this.value=this.value.replace(/[^0-9]/g,'')" onchange="${updateQtyCall}" onblur="${updateQtyCall}" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"><div class="line-length desktop-only-cell">${escapeHtml(length)}</div><div class="line-total-length desktop-only-cell">${escapeHtml(totalLength)}</div><div class="line-weight">${escapeHtml(weight)}</div><button type="button" class="line-delete" onclick="removeItem(${palletArg},${itemArg})" title="\u05de\u05d7\u05e7 \u05e4\u05e8\u05d9\u05d8" aria-label="\u05de\u05d7\u05e7 \u05e4\u05e8\u05d9\u05d8">&times;</button><div class="line-mobile-meta"><span>\u00d8${escapeHtml(diameter.toLocaleString('he-IL', { maximumFractionDigits: 0 }))}</span><span>${escapeHtml(length)}</span><span>${escapeHtml(totalLength)}</span><span>${escapeHtml(weight)}</span></div></article>`;
  }

  function minRenderItemCard(palletId, item, itemIndex = 0) { return renderCompactOrderLine(palletId, item, itemIndex); }
  function minRenderPallets() {
    setupOrderLinesTable();
    const container = document.getElementById('palletsContainer');
    if (!container) return;
    minEnsureDefaultPallet();
    const rows = minGetAllVisibleOrderItems();
    container.innerHTML = rows.length ? rows.map(({ palletId, item }, index) => renderCompactOrderLine(palletId, item, index)).join('') : minRenderEmptyItemsState();
    setTextSafe('itemsCountPill', rows.length + ' \u05e4\u05e8\u05d9\u05d8\u05d9\u05dd');
    setTextSafe('noItemsCount', rows.length);
    if (typeof window.updateSummary === 'function') window.updateSummary();
  }
  function minRenderOrderSummary() { if (typeof window.updateSummary === 'function') window.updateSummary(); }
  function minHasItems() {
    return (pallets || []).some(pallet => (pallet.items || []).length > 0);
  }

  function minRenderInventorySummary() {
    if (typeof window.renderLiveInventoryPanel === 'function') window.renderLiveInventoryPanel();
    const stockCard = document.getElementById('stockPreviewCard');
    if (stockCard) stockCard.style.setProperty('display', minHasItems() ? '' : 'none', 'important');
    minPruneZeroInventoryRows();
  }

  function minPruneZeroInventoryRows() {
    const panel = document.getElementById('liveInventoryPanel');
    if (!panel || !minHasItems()) return;
    panel.querySelectorAll('.inventory-compact-row').forEach(row => {
      const text = (row.textContent || '').replace(/\s+/g, ' ');
      const zeroRequired = /\u05e0\u05d3\u05e8\u05e9\s*0(?:[.,]0)?\s*\u05e7/.test(text);
      const zeroShortage = /\u05d7\u05e1\u05e8\s*0(?:[.,]0)?\s*\u05e7/.test(text);
      if (zeroRequired && zeroShortage) row.remove();
    });
    const rows = panel.querySelectorAll('.inventory-compact-row');
    if (!rows.length) {
      panel.innerHTML = '<section class="inspector-card"><h3>\u05de\u05dc\u05d0\u05d9</h3><p>\u05de\u05dc\u05d0\u05d9 \u05d9\u05d9\u05d1\u05d3\u05e7 \u05d0\u05d7\u05e8\u05d9 \u05d4\u05d5\u05e1\u05e4\u05ea \u05e4\u05e8\u05d9\u05d8\u05d9\u05dd.</p></section>';
    }
  }

  function minRenderPricingSummary() {
    if (typeof window.applyPricingPreviewAccess === 'function') window.applyPricingPreviewAccess();
    const card = document.getElementById('pricingPreviewCard');
    if (!card) return;
    const total = (document.getElementById('summaryPriceTotal')?.textContent || '').trim();
    const perKg = (document.getElementById('summaryPricePerKg')?.textContent || '').trim();
    const useful = minHasItems() && total && total !== '-' && !/\?{3,}/.test(perKg);
    card.classList.toggle('is-hidden', !useful);
    if (useful) card.style.removeProperty('display');
    else card.style.setProperty('display', 'none', 'important');
  }

  function selectedSiteLabelSafe() {
    if (typeof window.selectedSiteLabel === 'function') return window.selectedSiteLabel();
    return (document.getElementById('deliverySiteName')?.value || document.getElementById('deliveryAddress')?.value || '').trim();
  }

  function minUpdateContextStrip(totalWeight = 0) {
    const customer = (document.getElementById('customerSearch')?.value || '').trim();
    const site = selectedSiteLabelSafe();
    const address = (document.getElementById('deliveryAddress')?.value || '').trim();
    const date = (document.getElementById('deliveryDate')?.value || '').trim();
    const time = (document.getElementById('deliveryTime')?.value || '').trim();
    const priority = (document.getElementById('orderPriority')?.value || '').trim();
    const channel = (document.getElementById('orderChannel')?.value || '').trim();
    const delivery = [date ? shortDate(date) : '', time, priority].filter(Boolean).join(' · ') || address || 'לא נקבע';
    const count = (pallets || []).reduce((sum, pallet) => sum + ((pallet.items || []).length), 0);
    setTextSafe('noCustomerName', customer || 'לא נבחר');
    setTextSafe('noSiteName', site || 'לא נבחר');
    setTextSafe('noDeliveryAddress', delivery);
    setTextSafe('noOrderSource', channel || 'טלפון');
    setTextSafe('noItemsCount', count);
  }

  function bindEscClose() { document.addEventListener('keydown', event => { if (event.key === 'Escape') minCloseInspectorPanel(); }); }
  function bindOutsideClick() {
    document.addEventListener('click', event => {
      const inspector = document.getElementById('orderInspector');
      if (!inspector?.dataset.activePanel) return;
      if (event.target.closest('#orderInspector') || event.target.closest('.context-chip')) return;
      minCloseInspectorPanel();
    });
  }

  function applyMinimalLayout() {
    const main = document.querySelector('body[data-page="new"] .main.order-min-page');
    if (main) {
      main.style.setProperty('display', window.innerWidth <= 900 ? 'block' : 'grid', 'important');
      main.style.setProperty('direction', 'ltr', 'important');
      main.style.setProperty('overflow-x', 'hidden', 'important');
    }
    document.querySelectorAll('.progress-bar,#orderSetupDrawer,.no-bottom-actions,.order-more-action,.summary-bar>.submit-btn,.no-internal-stat,.add-pallet-btn').forEach(el => el.style.setProperty('display', 'none', 'important'));
  }

  function exposeGlobals() {
    window.updateContextStrip = minUpdateContextStrip;
    window.toggleInspectorPanel = minToggleInspectorPanel;
    window.closeInspectorPanel = minCloseInspectorPanel;
    window.renderInspector = minRenderInspector;
    window.renderCustomerInspector = minRenderCustomerInspector;
    window.renderDeliveryInspector = minRenderDeliveryInspector;
    window.renderSourceInspector = minRenderSourceInspector;
    window.ensureDefaultPallet = minEnsureDefaultPallet;
    window.addShapeNow = minAddShapeNow;
    window.getAllVisibleOrderItems = minGetAllVisibleOrderItems;
    window.renderPallets = minRenderPallets;
    window.renderEmptyItemsState = minRenderEmptyItemsState;
    window.renderCompactOrderLine = renderCompactOrderLine;
    window.formatLineShapeDims = formatLineShapeDims;
    window.formatLineLength = formatLineLength;
    window.formatLineTotalLength = formatLineTotalLength;
    window.formatLineWeight = formatLineWeight;
    window.renderLineShapeSketch = renderLineShapeSketch;
    window.updateLineQuantity = updateLineQuantity;
    window.renderItemCard = minRenderItemCard;
    window.renderDefaultInspector = minRenderDefaultInspector;
    window.renderInventorySummary = minRenderInventorySummary;
    window.renderPricingSummary = minRenderPricingSummary;
    window.renderOrderSummary = minRenderOrderSummary;
  }

  function boot() {
    if (document.body?.getAttribute('data-page') !== 'new') return;
    setupDom(); exposeGlobals(); bindEscClose(); bindOutsideClick(); applyMinimalLayout();
    minUpdateContextStrip(); minRenderDefaultInspector(); minRenderPallets();
    window.NewOrderEditor = { installed: true, applyMinimalLayout, renderInspector: minRenderInspector };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.addEventListener('load', () => { setupDom(); applyMinimalLayout(); minUpdateContextStrip(); minRenderPricingSummary(); minRenderInventorySummary(); });
  window.addEventListener('resize', applyMinimalLayout);
  setTimeout(() => { setupDom(); applyMinimalLayout(); minUpdateContextStrip(); minRenderPricingSummary(); minRenderInventorySummary(); }, 250);
  setTimeout(() => { setupDom(); applyMinimalLayout(); minUpdateContextStrip(); minRenderPricingSummary(); minRenderInventorySummary(); }, 800);
})();

