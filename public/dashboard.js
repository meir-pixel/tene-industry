const WS_URL = () => window.IronBendAuth?.webSocketUrl?.('/') || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
const TODAY = new Date().toISOString().slice(0, 10);
let ws, dashData = null, alertsData = [], inventoryForecast = [], productionQueueItems = [], todayDeliveries = [], shiftSummary = null, _wsDelay = 1000;

function applyDataContractBadges() {
  if (window.IronBendDataContracts) window.IronBendDataContracts.applyDataContracts(document);
}

function escHtml(s) {
  return window.IronBendSafe
    ? window.IronBendSafe.escapeHtml(s)
    : String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
function formatKg(value) { return Math.round(Number(value || 0)).toLocaleString('he-IL') + ' ק"ג'; }
function formatTons(value, digits = 1) {
  const tons = Number(value || 0);
  return tons.toLocaleString('he-IL', { maximumFractionDigits: digits, minimumFractionDigits: tons > 0 && tons < 10 ? 1 : 0 });
}
function statusBadgeClass(status) {
  const s = String(status || '');
  if (s.includes('הושלם') || s.includes('סופק')) return 's-done';
  if (s.includes('ייצור')) return 's-prod';
  if (s.includes('אישור') || s.includes('ממתין')) return 's-pend';
  if (s.includes('חסר') || s.includes('בוטל')) return 's-risk';
  return '';
}

function updateTime() {
  const now = new Date();
  const time = now.toLocaleTimeString('he-IL', { hour:'2-digit', minute:'2-digit' });
  const date = now.toLocaleDateString('he-IL', { weekday:'long', day:'numeric', month:'long' });
  const h = now.getHours();
  let shiftLabel = 'משמרת לילה', shiftRange = '22:00-06:00';
  if (h >= 6 && h < 14) { shiftLabel = 'משמרת בוקר'; shiftRange = '06:00-14:00'; }
  if (h >= 14 && h < 22) { shiftLabel = 'משמרת אחה"צ'; shiftRange = '14:00-22:00'; }
  setText('headerClock', time);
  setText('shiftBadge', `${shiftLabel} · ${shiftRange}`);
  setText('dayHeaderText', `${date} · ${time}`);
}

function connectWS() {
  try {
    ws = new WebSocket(WS_URL());
    ws.onopen = () => { _wsDelay = 1000; };
    ws.onerror = () => ws.close();
    ws.onclose = () => { _wsDelay = Math.min(_wsDelay * 2, 30000); setTimeout(connectWS, _wsDelay); };
    ws.onmessage = e => {
      try {
        const { type, data } = JSON.parse(e.data);
        if (type === 'machines_state') renderMachinesCompact(data);
        if (type === 'machine_update') fetchDashboard();
        if (type === 'alert') fetchDashboard();
        if (['new_order','order_status','order_complete'].includes(type)) fetchDashboard();
      } catch {}
    };
  } catch {}
}

async function fetchDashboard() {
  try {
    const [dashboardRes, queueRes, ordersRes, forecastRes, alertsRes, shiftRes] = await Promise.all([
      fetch('/api/dashboard'),
      fetch('/api/production-queue'),
      fetch('/api/orders?date=' + encodeURIComponent(TODAY)),
      fetch('/api/inventory/forecast').catch(() => null),
      fetch('/api/alerts').catch(() => null),
      fetch('/api/kpi/shift-summary').catch(() => null)
    ]);
    dashData = await dashboardRes.json();
    const productionQueue = await queueRes.json().catch(() => ({ items: [] }));
    const ordersToday = await ordersRes.json().catch(() => []);
    productionQueueItems = productionQueue.items || [];
    todayDeliveries = Array.isArray(ordersToday) ? ordersToday : [];
    inventoryForecast = forecastRes && forecastRes.ok ? await forecastRes.json().catch(() => []) : [];
    alertsData = alertsRes && alertsRes.ok ? await alertsRes.json().catch(() => []) : [];
    shiftSummary = shiftRes && shiftRes.ok ? await shiftRes.json().catch(() => null) : null;

    renderKPIs(dashData);
    renderDailyProductionPlan();
    renderActionCenter();
    renderTodayDeliveries();
    renderProdQueue(productionQueue.items || []);
    renderStockShortages();
    renderProductionCardsSummary();
    renderMachinesCompact(dashData.machines || []);
    renderWasteByMachine(dashData.wasteByMachine || []);
    applyDataContractBadges();
  } catch (err) {
    console.warn('dashboard load failed', err);
  }
}

function renderKPIs(d) {
  const producedWeightToday = Number(d.producedWeightToday || 0);
  const producedTonsToday = Number(d.producedTonsToday || (producedWeightToday / 1000) || 0);
  const completedItemsToday = Number(d.itemsDone ?? d.completedToday ?? 0);
  const deliveryWeight = todayDeliveries.reduce((sum, o) => sum + Number(o.total_weight || o.billing_weight || 0), 0);
  const shortageCount = relevantShortages().length;

  document.getElementById('kpiOrdersToday').textContent = todayDeliveries.length || 0;
  document.getElementById('kpiWeightToday').textContent = producedWeightToday.toFixed(0) + ' ק"ג יוצרו';
  document.getElementById('kpiInProd').textContent = d.inProduction ?? 0;
  document.getElementById('kpiItemsProd').textContent = (d.itemsInProduction || 0) + ' פריטים';
  document.getElementById('kpiDone').textContent = completedItemsToday;
  document.getElementById('kpiItemsDone').textContent = completedItemsToday + ' פריטים';
  document.getElementById('kpiUrgent').textContent = d.urgentOpen || 0;
  document.getElementById('kpiWaste').textContent = (d.wasteAvgPct || 0) + '%';
  document.getElementById('kpiPending').textContent = d.pending ?? 0;
  document.getElementById('kpiTonsToday').textContent = formatTons(producedTonsToday) + ' ט';
  document.getElementById('qsWeight').textContent = producedWeightToday.toFixed(0) + ' ק"ג';

  setText('todayDeliveryWeight', deliveryWeight > 0 ? formatKg(deliveryWeight) + ' לצאת' : 'אין צפי משקל');
  setText('stockShortageKpi', shortageCount);
  setText('deliveriesTodayKpi', todayDeliveries.length || 0);
  setText('deliveriesTodaySub', deliveryWeight > 0 ? formatTons(deliveryWeight / 1000) + ' טון' : 'הזמנות');
}

function productionReference() {
  const deliveryWeightKg = todayDeliveries.reduce((sum, o) => sum + Number(o.total_weight || o.billing_weight || 0), 0);
  if (deliveryWeightKg > 0) return { type: 'forecast', label: 'צפי יציאה היום לפי אספקות', kg: deliveryWeightKg };
  return { type: 'none', label: 'יעד יומי לא הוגדר', kg: 0 };
}
function currentShiftBounds() {
  if (!shiftSummary?.shiftType) return null;
  const now = new Date(), start = new Date(now), end = new Date(now);
  if (shiftSummary.shiftType === 'morning') { start.setHours(6,0,0,0); end.setHours(14,0,0,0); }
  else if (shiftSummary.shiftType === 'afternoon') { start.setHours(14,0,0,0); end.setHours(22,0,0,0); }
  else { start.setHours(22,0,0,0); end.setDate(end.getDate() + (now.getHours() >= 22 ? 1 : 0)); end.setHours(6,0,0,0); }
  return { start, end };
}
function calculateProductionPace(actualKg, targetKg) {
  if (!targetKg) return { status: 'muted', badge: 'ללא יעד', text: 'אין יעד/צפי לחישוב קצב' };
  const bounds = currentShiftBounds();
  if (!bounds) return { status: 'muted', badge: 'ללא נתון משמרת', text: 'מוצג אחוז ביצוע בלבד' };
  const now = new Date();
  const elapsed = Math.max(0, Math.min(1, (now - bounds.start) / (bounds.end - bounds.start)));
  const actual = Math.max(0, Math.min(2, actualKg / targetKg));
  if (actual < elapsed - 0.08) return { status: 'behind', badge: 'בפיגור', text: 'נדרש להגביר קצב' };
  if (actual > elapsed + 0.08) return { status: 'ahead', badge: 'מקדים', text: 'הביצוע מקדים את קצב המשמרת' };
  return { status: 'ok', badge: 'בקצב', text: 'הביצוע תואם את קצב המשמרת' };
}
function renderDailyProductionPlan() {
  const actualKg = Number(dashData?.producedWeightToday || 0);
  const ref = productionReference();
  const pct = ref.kg > 0 ? Math.min(160, (actualKg / ref.kg) * 100) : 0;
  const remainingKg = ref.kg > 0 ? Math.max(0, ref.kg - actualKg) : 0;
  const pace = calculateProductionPace(actualKg, ref.kg);
  const plan = document.getElementById('dailyProductionPlan');
  plan.classList.toggle('is-behind', pace.status === 'behind');
  plan.classList.toggle('is-ahead', pace.status === 'ahead');
  setText('productionPlanSubtitle', ref.label);
  setText('productionActualTons', formatTons(actualKg / 1000));
  setText('productionTargetTons', ref.kg > 0 ? formatTons(ref.kg / 1000) : '—');
  setText('productionPercent', ref.kg > 0 ? Math.round(Math.min(100, pct)) + '%' : '—');
  setText('productionRemainingTons', ref.kg > 0 ? 'נותרו ' + formatTons(remainingKg / 1000) + ' טון' : 'לא הוגדר יעד יומי');
  setText('productionPaceText', pace.text);
  document.getElementById('productionProgressFill').style.setProperty('--progress', Math.min(100, pct) + '%');
  const badge = document.getElementById('productionPaceBadge');
  badge.textContent = pace.badge;
  badge.className = 'pace-badge ' + (pace.status === 'behind' ? 'is-behind' : pace.status === 'ahead' ? 'is-ahead' : pace.status === 'ok' ? '' : 'is-muted');
  const overall = document.getElementById('overallStatusBadge');
  overall.textContent = pace.badge;
  overall.className = 'status-pill ' + (pace.status === 'behind' ? 'is-behind' : pace.status === 'ahead' ? 'is-ahead' : pace.status === 'ok' ? 'is-ok' : '');
}

function relevantShortages() {
  const queueDiameters = new Set((productionQueueItems || []).map(item => String(item.diameter || '').trim()).filter(Boolean));
  return (inventoryForecast || [])
    .filter(row => row.alert && row.alert !== 'ok')
    .filter(row => !queueDiameters.size || queueDiameters.has(String(row.diameter || '').trim()))
    .slice(0, 6);
}
function renderActionCenter() {
  const actions = [];
  const pending = Number(dashData?.pending || 0), urgent = Number(dashData?.urgentOpen || 0);
  const todayNotReady = todayDeliveries.filter(o => !String(o.status || '').includes('סופק') && !String(o.status || '').includes('הושלם'));
  const shortages = relevantShortages();
  const notPrinted = productionQueueItems.filter(item => item.status && String(item.status).includes('ממתין')).length;
  const machineProblems = (dashData?.machines || []).filter(m => machineStateClass(m) === 'error');
  if (shortages.length) actions.push({ level:'danger', title:`${shortages.length} קטרים בחוסר מלאי`, sub:shortages.map(s => `Ø${s.diameter}`).join(' · '), href:'/inventory.html' });
  if (todayNotReady.length) actions.push({ level:'warning', title:`${todayNotReady.length} אספקות היום עדיין לא מוכנות`, sub:'בדוק סטטוס ייצור/מחסן לפני יציאה', href:'/orders.html?date=' + encodeURIComponent(TODAY) });
  if (pending) actions.push({ level:'warning', title:`${pending} הזמנות ממתינות לאישור`, sub:'נדרש אישור לפני שחרור לייצור', href:'/orders.html?status=' + encodeURIComponent('ממתינה לאישור') });
  if (urgent) actions.push({ level:'danger', title:`${urgent} הזמנות דחופות פתוחות`, sub:'לתעדף בתור הייצור והאספקה', href:'/orders.html?priority=' + encodeURIComponent('דחוף') });
  if (notPrinted) actions.push({ level:'info', title:`${notPrinted} פריטים ממתינים לשחרור/כרטיסיות`, sub:'פתח כרטיסיות רק לפריטים שדורשים פעולה', href:'/production-queue.html' });
  if (machineProblems.length) actions.push({ level:'danger', title:`${machineProblems.length} מכונות בחריגה`, sub:machineProblems.map(m => m.name).join(' · '), href:'/machine.html' });
  setText('actionCountPill', actions.length);
  const host = document.getElementById('actionCenterList');
  if (!actions.length) { host.innerHTML = '<div class="muted-state">אין כרגע חריגות שמחייבות פעולה.</div>'; return; }
  host.innerHTML = actions.map(action => `<div class="action-item"><span class="action-dot ${action.level === 'danger' ? 'danger' : action.level === 'warning' ? 'warning' : ''}"></span><div class="action-copy"><div class="action-title">${escHtml(action.title)}</div><div class="action-sub">${escHtml(action.sub)}</div></div><a class="action-link" href="${escHtml(action.href)}">פתח</a></div>`).join('');
}
function renderTodayDeliveries() {
  setText('todayDeliveriesCount', todayDeliveries.length);
  const tbody = document.getElementById('todayDeliveriesBody');
  if (!todayDeliveries.length) { tbody.innerHTML = '<tr><td colspan="5" class="muted-state">אין אספקות מתוכננות להיום.</td></tr>'; return; }
  tbody.innerHTML = todayDeliveries.map(o => `<tr onclick="location.href='/orders.html?id=${Number(o.id)}'" style="cursor:pointer"><td><span class="order-num">${escHtml(o.order_num || o.id)}</span></td><td>${escHtml(o.customer_name || '—')}</td><td>${escHtml(o.delivery_address || o.site_name || o.project_name || '—')}</td><td><span class="weight-val">${formatKg(o.total_weight || o.billing_weight || 0)}</span></td><td><span class="status-badge ${statusBadgeClass(o.status)}">${escHtml(o.status || '—')}</span></td></tr>`).join('');
}
function renderProdQueue(items) {
  const queueItems = items || [];
  document.getElementById('prodQueueCount').textContent = queueItems.length;
  const host = document.getElementById('prodQueueBody');
  if (!queueItems.length) { host.innerHTML = '<div class="muted-state">אין פריטים בתור ייצור.</div>'; return; }
  const shortages = relevantShortages();
  host.innerHTML = `<table class="data-table"><thead><tr><th>הזמנה</th><th>לקוח</th><th>משקל</th><th>סטטוס</th></tr></thead><tbody>${queueItems.slice(0, 18).map(item => { const risk = shortages.some(s => String(s.diameter) === String(item.diameter)); return `<tr onclick="location.href='/orders.html?id=${Number(item.order_id)}'" style="cursor:pointer"><td><span class="order-num">${escHtml(item.order_num || '—')}</span></td><td>${escHtml(item.customer_name || '—')} ${item.diameter ? `<span style="color:var(--dim);font-weight:800">Ø${escHtml(item.diameter)}</span>` : ''}</td><td><span class="weight-val">${formatKg(item.weight || 0)}</span></td><td><span class="status-badge ${risk ? 's-risk' : statusBadgeClass(item.status)}">${risk ? 'חסר מלאי' : escHtml(item.status || '—')}</span></td></tr>`; }).join('')}</tbody></table>`;
}
function renderStockShortages() {
  const shortages = relevantShortages();
  const host = document.getElementById('stockShortagesPanel');
  if (!shortages.length) { host.innerHTML = '<div class="muted-state">אין חוסרי מלאי רלוונטיים כרגע.</div>'; return; }
  host.innerHTML = `<div class="compact-list">${shortages.map(row => `<div class="compact-row"><span>Ø${escHtml(row.diameter)} · ${row.alert === 'critical' ? 'חוסר קריטי' : 'אזהרה'}</span><strong>${formatKg(row.on_hand_kg || 0)}</strong></div>`).join('')}</div><a class="action-link" href="/procurement.html" style="margin-top:12px">פתח רכש/מלאי</a>`;
}
function renderProductionCardsSummary() {
  const waiting = productionQueueItems.filter(item => String(item.status || '').includes('ממתין')).length;
  const inProd = productionQueueItems.filter(item => String(item.status || '').includes('ייצור')).length;
  const weight = productionQueueItems.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  document.getElementById('productionCardsSummary').innerHTML = `<div class="compact-list"><div class="compact-row"><span>פריטים בתור</span><strong>${productionQueueItems.length}</strong></div><div class="compact-row"><span>ממתינים</span><strong>${waiting}</strong></div><div class="compact-row"><span>בייצור</span><strong>${inProd}</strong></div><div class="compact-row"><span>משקל בתור</span><strong>${formatKg(weight)}</strong></div></div>${productionQueueItems.length ? '<a class="action-link" href="/production-queue.html" style="margin-top:12px">פתח תור ייצור</a>' : ''}`;
}
function machineStateClass(m) {
  if (m.status === 'בייצור') return 'running';
  if (m.status === 'תקלה' || m.status === 'שגיאת תקשורת' || m.connected === 0) return 'error';
  if (m.connected || m.status === 'פנוי') return 'online';
  return 'idle';
}
function renderMachinesCompact(machines) {
  const host = document.getElementById('machinesCompactStrip');
  if (!machines?.length) { host.innerHTML = '<span class="machine-chip">אין מכונות</span>'; setText('machinesOnlineCount', '0/0'); return; }
  let online = 0;
  host.innerHTML = machines.map(m => { const cls = machineStateClass(m); if (cls !== 'idle' && cls !== 'error') online++; return `<span class="machine-chip ${cls}">${escHtml(m.name || ('מכונה ' + m.id))} · ${escHtml(m.status || 'לא מחובר')}</span>`; }).join('');
  setText('machinesOnlineCount', `${online}/${machines.length}`);
}
function renderWasteByMachine(wasteByMachine) {
  const totalWaste = (wasteByMachine || []).reduce((sum, row) => sum + Number(row.waste || 0), 0);
  const totalQty = (wasteByMachine || []).reduce((sum, row) => sum + Number(row.qty || 0), 0);
  if (totalQty > 0 && !dashData?.wasteAvgPct) setText('kpiWaste', ((totalWaste / totalQty) * 100).toFixed(1) + '%');
}
async function fetchTonsToday() {
  try { const d = await fetch('/api/kpi/tons-today').then(r => r.json()); if (d && Number.isFinite(Number(d.tons))) document.getElementById('kpiTonsToday').textContent = formatTons(d.tons) + ' ט'; } catch {}
}
async function fetchInventoryForecast() {
  try { inventoryForecast = await fetch('/api/inventory/forecast').then(r => r.json()); renderStockShortages(); renderActionCenter(); } catch {}
}
function bootDashboard() {
  updateTime();
  applyDataContractBadges();
  connectWS();
  fetchDashboard();
  setInterval(updateTime, 1000);
  setInterval(fetchDashboard, 15000);
  setInterval(fetchInventoryForecast, 120000);
}
bootDashboard();