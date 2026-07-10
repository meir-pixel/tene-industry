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
    return '<div class="order-items-empty"><strong>עדיין אין פריטים בהזמנה</strong><span>התחל מהוספת צורת ברזל.</span></div>';
  }

  function minRenderItemCard(palletId, item, itemIndex = 0) {
    const weight = typeof window.calcItemWeight === 'function' ? window.calcItemWeight(item) : 0;
    const sides = typeof window.itemShapeSides === 'function' ? window.itemShapeSides(item) : [];
    const angles = typeof window.itemShapeAngles === 'function' ? window.itemShapeAngles(item) : [];
    const contract = typeof window.itemShapeContract === 'function' ? window.itemShapeContract(item) : null;
    const isSpiral = (typeof window.isSpiralOrderItem === 'function' && window.isSpiralOrderItem(item)) || contract?.family === 'spirals';
    const diameter = Number(item.diameter || (isSpiral ? 8 : 12));
    const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
    const title = item.shapeName || item.displayName || (isSpiral ? 'ספירלה' : 'מוט ברזל');
    const perimeter = sides.reduce((sum, length) => sum + Number(length || 0), 0);
    const lengthLabel = perimeter > 0 ? perimeter.toLocaleString('he-IL') + ' מ"מ' : 'לחץ לעריכה';
    const preview = typeof window.itemPreviewSvg === 'function' ? window.itemPreviewSvg(item, sides, angles) : '';
    const stock = typeof window.renderStockSelect === 'function' ? window.renderStockSelect(palletId, item) : '';
    const id = String(item.id);
    const duplicate = typeof window.duplicateItem === 'function' ? `<button type="button" class="no-card-action" onclick="duplicateItem(${palletId}, '${escapeHtml(id)}')">שכפל</button>` : '';
    return `<article class="order-item-card no-item-card" id="item-row-${escapeHtml(id)}">
      <button type="button" class="item-shape-preview no-item-preview shape-preview" onclick="openShapeEditor(${palletId}, '${escapeHtml(id)}')" title="ערוך צורה">${preview}</button>
      <div class="item-main no-item-main">
        <div class="item-title-row no-item-title-row"><div><h3 class="no-item-title">${escapeHtml(title)}</h3></div></div>
        <div class="item-metrics no-item-metrics">
          <div class="no-metric"><span>קוטר</span><strong>Ø${diameter}</strong></div>
          <div class="no-metric"><span>אורך</span><strong>${escapeHtml(lengthLabel)}</strong></div>
          <div class="no-metric"><span>כמות</span><strong>${qty}</strong></div>
          <div class="no-metric"><span>משקל</span><strong>${escapeHtml(formatKg(weight))}</strong></div>
        </div>
        <div class="no-item-fields">
          <label class="no-field-mini">כמות<input type="text" inputmode="numeric" pattern="[0-9]*" value="${qty}" class="item-qty" onfocus="this.select()" oninput="this.value=this.value.replace(/[^0-9]/g,'')" onblur="if(!this.value||+this.value<1)this.value=1;updateItem(${palletId},'${escapeHtml(id)}','qty',+this.value)" onkeydown="if(event.key==='Enter'){this.blur();}"></label>
          <label class="no-field-mini">תיאור<input type="text" value="${escapeHtml(item.note || '')}" placeholder="לדוגמה: קומה 2" onchange="updateItem(${palletId},'${escapeHtml(id)}','note',this.value)"></label>
        </div>
        <div class="no-stock-wrap">${stock}</div>
      </div>
      <div class="item-actions no-item-actions"><button type="button" class="no-card-action" onclick="openShapeEditor(${palletId}, '${escapeHtml(id)}')">ערוך</button>${duplicate}<button type="button" class="no-card-action danger" onclick="removeItem(${palletId},'${escapeHtml(id)}')">מחק</button></div>
    </article>`;
  }

  function minRenderPallets() {
    const container = document.getElementById('palletsContainer');
    if (!container) return;
    minEnsureDefaultPallet();
    const rows = minGetAllVisibleOrderItems();
    container.innerHTML = rows.length ? '<div class="order-items-list">' + rows.map(({ palletId, item }, index) => minRenderItemCard(palletId, item, index)).join('') + '</div>' : minRenderEmptyItemsState();
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
      panel.innerHTML = '<section class="inspector-card"><h3>????</h3><p>???? ????? ???? ????? ??????.</p></section>';
    }
  }

  function minRenderPricingSummary() {
    if (typeof window.applyPricingPreviewAccess === 'function') window.applyPricingPreviewAccess();
    const card = document.getElementById('pricingPreviewCard');
    if (!card) return;
    const total = (document.getElementById('summaryPriceTotal')?.textContent || '').trim();
    const perKg = (document.getElementById('summaryPricePerKg')?.textContent || '').trim();
    const useful = minHasItems() && total && total !== '-' && !perKg.includes('???');
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
