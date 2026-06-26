// IronBend temporary UI tuning tool. UI-only, local browser storage only.
(function () {
  if (window.IronBendUiTuner) return;

  const STORE_KEY = 'ironbend.globalUiTuner.v1';
  const SELECTED_CLASS = 'ui-tuner-selected';
  const HOVER_CLASS = 'ui-tuner-hover';
  const DEFAULTS = { font: 100, icon: 100, width: 100, height: 100, gap: 100, radius: 100 };
  const LABELS = {
    title: '\u05d4\u05ea\u05d0\u05de\u05ea \u05ea\u05e6\u05d5\u05d2\u05d4',
    lockTitle: '\u05de\u05e6\u05d1 \u05e2\u05e8\u05d9\u05db\u05d4 \u05d6\u05de\u05e0\u05d9',
    lockText: '\u05db\u05dc\u05d9 \u05dc\u05e4\u05d9\u05ea\u05d5\u05d7 \u05de\u05d4\u05d9\u05e8. \u05e4\u05ea\u05d7 \u05e8\u05e7 \u05db\u05e9\u05e6\u05e8\u05d9\u05da, \u05db\u05d3\u05d9 \u05e9\u05dc\u05d0 \u05d9\u05e2\u05e8\u05db\u05d5 \u05d1\u05d8\u05e2\u05d5\u05ea.',
    unlock: '\u05e4\u05ea\u05d7 \u05de\u05e6\u05d1 \u05e2\u05e8\u05d9\u05db\u05d4 \u05d6\u05de\u05e0\u05d9',
    select: '\u05e1\u05de\u05df \u05d0\u05dc\u05de\u05e0\u05d8\u05d9\u05dd',
    stopSelect: '\u05e2\u05e6\u05d5\u05e8 \u05e1\u05d9\u05de\u05d5\u05df',
    selected: '\u05e0\u05d1\u05d7\u05e8\u05d5',
    clear: '\u05e0\u05e7\u05d4 \u05d1\u05d7\u05d9\u05e8\u05d4',
    reset: '\u05d0\u05d9\u05e4\u05d5\u05e1',
    save: '\u05e9\u05de\u05d5\u05e8',
    close: '\u05e1\u05d2\u05d5\u05e8',
    font: '\u05e4\u05d5\u05e0\u05d8',
    icon: '\u05d0\u05d9\u05d9\u05e7\u05d5\u05df',
    width: '\u05e8\u05d5\u05d7\u05d1',
    height: '\u05d2\u05d5\u05d1\u05d4',
    gap: '\u05e8\u05d9\u05d5\u05d5\u05d7',
    radius: '\u05e2\u05d9\u05d2\u05d5\u05dc',
    hint: '\u05dc\u05d7\u05e5 \u05e2\u05dc \u05db\u05de\u05d4 \u05d0\u05d6\u05d5\u05e8\u05d9\u05dd \u05d1\u05d3\u05e3. \u05d4\u05e9\u05d9\u05e0\u05d5\u05d9 \u05d6\u05de\u05e0\u05d9 \u05d5\u05de\u05e7\u05d5\u05de\u05d9.'
  };

  let root;
  let panel;
  let selectMode = false;
  let unlocked = false;
  let selected = [];
  let values = loadValues();

  function loadValues() {
    try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {}) }; }
    catch (_) { return { ...DEFAULTS }; }
  }

  function saveValues() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(values)); } catch (_) {}
  }

  function isToolElement(el) {
    return !!(el && (el.closest?.('#uiTunerRoot') || el.id === 'uiTunerRoot'));
  }

  function injectStyle() {
    if (document.getElementById('uiTunerStyle')) return;
    const style = document.createElement('style');
    style.id = 'uiTunerStyle';
    style.textContent = `
      #uiTunerRoot{position:fixed;top:64px;left:12px;z-index:390;font-family:Heebo,Arial,sans-serif;direction:rtl;text-align:right;color:#243047;}
      #uiTunerRoot .ut-fab{width:34px;height:34px;border-radius:50%;border:1px solid #c5cbd4;background:#fff;color:#243047;box-shadow:0 8px 22px rgba(15,23,42,.18);display:grid;place-items:center;font-size:17px;font-weight:900;cursor:pointer;line-height:1;}
      #uiTunerRoot .ut-fab.active{border-color:#ff4047;color:#ff4047;box-shadow:0 0 0 3px rgba(255,64,71,.14),0 8px 22px rgba(15,23,42,.18);}
      #uiTunerRoot .ut-panel{position:absolute;top:42px;left:0;width:min(366px,calc(100vw - 24px));background:#fff;border:1px solid #c5cbd4;border-radius:8px;box-shadow:0 18px 50px rgba(15,23,42,.24);padding:12px;display:none;gap:10px;}
      #uiTunerRoot .ut-panel.open{display:grid;}
      #uiTunerRoot .ut-title{font-size:14px;font-weight:900;display:flex;justify-content:space-between;gap:8px;align-items:center;}
      #uiTunerRoot .ut-lock{display:grid;gap:9px;border:1px dashed #c5cbd4;border-radius:8px;background:#f8fafc;padding:10px;}
      #uiTunerRoot .ut-lock strong{font-size:13px}.ut-lock small{font-size:11px;color:#647083;line-height:1.45;}
      #uiTunerRoot .ut-body{display:none;gap:10px;}
      #uiTunerRoot.unlocked .ut-body{display:grid;}#uiTunerRoot.unlocked .ut-lock{display:none;}
      #uiTunerRoot button{font-family:Heebo,Arial,sans-serif;font-weight:900;cursor:pointer;border-radius:7px;border:1px solid #c5cbd4;background:#fff;color:#243047;padding:7px 10px;}
      #uiTunerRoot .primary{background:#243047;color:#fff;border-color:#243047;}#uiTunerRoot .danger{color:#b83227;border-color:#f2c5c0;}
      #uiTunerRoot .ut-actions{display:flex;gap:7px;flex-wrap:wrap;align-items:center;}
      #uiTunerRoot .ut-select.active{background:#ff4047;color:#fff;border-color:#ff4047;}
      #uiTunerRoot .ut-count{font-size:11px;font-weight:900;color:#647083;margin-inline-start:auto;}
      #uiTunerRoot .ut-control{display:grid;grid-template-columns:76px minmax(0,1fr) 42px;align-items:center;gap:8px;font-size:12px;font-weight:900;}
      #uiTunerRoot .ut-control input{width:100%;accent-color:#ff4047;}.ut-value{direction:ltr;text-align:left;color:#647083;font-size:11px;}
      #uiTunerRoot .ut-hint{font-size:11px;line-height:1.45;color:#647083;background:#f8fafc;border:1px solid #eef0f3;border-radius:7px;padding:8px;}
      .ui-tuner-hover{outline:2px dashed #ff9a3d!important;outline-offset:3px!important;}
      .ui-tuner-selected{outline:3px solid #2979ff!important;outline-offset:3px!important;}
      body.ui-tuner-selecting{cursor:crosshair!important;}
      body.ui-tuner-selecting *{cursor:crosshair!important;}
      @media(max-width:760px){#uiTunerRoot{top:62px;left:8px;}#uiTunerRoot .ut-panel{width:calc(100vw - 16px);}}
    `;
    document.head.appendChild(style);
  }

  function build() {
    if (document.getElementById('uiTunerRoot')) return;
    injectStyle();
    root = document.createElement('div');
    root.id = 'uiTunerRoot';
    root.innerHTML = `
      <button class="ut-fab" type="button" title="${LABELS.title}" aria-label="${LABELS.title}">&#9998;</button>
      <div class="ut-panel" role="dialog" aria-label="${LABELS.title}">
        <div class="ut-title"><span>${LABELS.title}</span><span class="ut-count">${LABELS.selected}: <b data-ut-count>0</b></span></div>
        <div class="ut-lock"><strong>${LABELS.lockTitle}</strong><small>${LABELS.lockText}</small><button class="primary" type="button" data-ut-unlock>${LABELS.unlock}</button></div>
        <div class="ut-body">
          <div class="ut-actions"><button class="ut-select" type="button" data-ut-select>${LABELS.select}</button><button type="button" data-ut-clear>${LABELS.clear}</button></div>
          <div class="ut-hint">${LABELS.hint}</div>
          ${control('font', LABELS.font, 80, 140)}
          ${control('icon', LABELS.icon, 70, 160)}
          ${control('width', LABELS.width, 70, 160)}
          ${control('height', LABELS.height, 70, 160)}
          ${control('gap', LABELS.gap, 60, 170)}
          ${control('radius', LABELS.radius, 0, 200)}
          <div class="ut-actions"><button class="danger" type="button" data-ut-reset>${LABELS.reset}</button><button type="button" data-ut-close>${LABELS.close}</button><button class="primary" type="button" data-ut-save>${LABELS.save}</button></div>
        </div>
      </div>`;
    document.body.appendChild(root);
    panel = root.querySelector('.ut-panel');
    bind();
    syncControls();
  }

  function control(key, label, min, max) {
    return `<label class="ut-control"><span>${label}</span><input type="range" min="${min}" max="${max}" value="${values[key]}" data-ut-control="${key}"><span class="ut-value" data-ut-value="${key}">${values[key]}%</span></label>`;
  }

  function bind() {
    root.querySelector('.ut-fab').addEventListener('click', togglePanel);
    root.querySelector('[data-ut-unlock]').addEventListener('click', unlock);
    root.querySelector('[data-ut-select]').addEventListener('click', toggleSelectMode);
    root.querySelector('[data-ut-clear]').addEventListener('click', clearSelection);
    root.querySelector('[data-ut-reset]').addEventListener('click', reset);
    root.querySelector('[data-ut-close]').addEventListener('click', closePanel);
    root.querySelector('[data-ut-save]').addEventListener('click', () => { saveValues(); closePanel(); });
    root.querySelectorAll('[data-ut-control]').forEach(input => {
      input.addEventListener('input', () => {
        if (!unlocked) return;
        values[input.dataset.utControl] = Number(input.value) || 100;
        updateValueLabel(input.dataset.utControl);
        applyToSelection();
      });
    });
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('mouseover', onHover, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') stopSelectMode(); });
  }

  function togglePanel() {
    const open = !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    root.querySelector('.ut-fab').classList.toggle('active', open);
    if (open) { unlocked = false; root.classList.remove('unlocked'); stopSelectMode(); syncControls(); }
  }

  function unlock() { unlocked = true; root.classList.add('unlocked'); syncControls(); }
  function closePanel() { panel.classList.remove('open'); root.querySelector('.ut-fab').classList.remove('active'); unlocked = false; root.classList.remove('unlocked'); stopSelectMode(); }
  function toggleSelectMode() { if (!unlocked) return; selectMode ? stopSelectMode() : startSelectMode(); }
  function startSelectMode() { selectMode = true; document.body.classList.add('ui-tuner-selecting'); root.querySelector('[data-ut-select]').classList.add('active'); root.querySelector('[data-ut-select]').textContent = LABELS.stopSelect; }
  function stopSelectMode() { selectMode = false; document.body.classList.remove('ui-tuner-selecting'); root?.querySelector('[data-ut-select]')?.classList.remove('active'); const btn = root?.querySelector('[data-ut-select]'); if (btn) btn.textContent = LABELS.select; document.querySelectorAll('.' + HOVER_CLASS).forEach(el => el.classList.remove(HOVER_CLASS)); }

  function onDocumentClick(event) {
    if (!selectMode || isToolElement(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    toggleElement(event.target.closest('button,a,input,select,textarea,label,th,td,.card,.panel,.modal,.box,[class]') || event.target);
  }
  function onHover(event) { if (selectMode && !isToolElement(event.target)) event.target.classList.add(HOVER_CLASS); }
  function onOut(event) { if (event.target?.classList) event.target.classList.remove(HOVER_CLASS); }

  function toggleElement(el) {
    if (!el || isToolElement(el) || el === document.body || el === document.documentElement) return;
    if (selected.includes(el)) {
      selected = selected.filter(item => item !== el);
      el.classList.remove(SELECTED_CLASS);
    } else {
      selected.push(el);
      el.classList.add(SELECTED_CLASS);
      applyElement(el);
    }
    updateCount();
  }

  function selectedAlive() { selected = selected.filter(el => document.contains(el)); return selected; }
  function updateCount() { const count = root.querySelector('[data-ut-count]'); if (count) count.textContent = String(selectedAlive().length); }
  function clearSelection() { selected.forEach(el => el.classList.remove(SELECTED_CLASS)); selected = []; updateCount(); }

  function applyToSelection() { selectedAlive().forEach(applyElement); updateCount(); }
  function applyElement(el) {
    el.style.setProperty('--ui-tuner-font', values.font / 100);
    el.style.setProperty('--ui-tuner-icon', values.icon / 100);
    el.style.fontSize = `calc(1em * ${values.font / 100})`;
    if (values.width !== 100) el.style.width = `calc(100% * ${values.width / 100})`;
    if (values.height !== 100) el.style.minHeight = `calc(1em * ${values.height / 100} + 18px)`;
    el.style.gap = `calc(.5rem * ${values.gap / 100})`;
    el.style.borderRadius = `${Math.max(0, values.radius / 100 * 8)}px`;
    el.querySelectorAll('svg,img,.icon,[class*="icon"]').forEach(icon => {
      icon.style.width = `calc(1em * ${values.icon / 100})`;
      icon.style.height = `calc(1em * ${values.icon / 100})`;
    });
  }

  function reset() {
    if (!unlocked) return;
    values = { ...DEFAULTS };
    syncControls();
    selectedAlive().forEach(el => {
      ['fontSize','width','minHeight','gap','borderRadius'].forEach(prop => { el.style[prop] = ''; });
      el.querySelectorAll('svg,img,.icon,[class*="icon"]').forEach(icon => { icon.style.width = ''; icon.style.height = ''; });
    });
    saveValues();
  }

  function syncControls() {
    Object.keys(DEFAULTS).forEach(key => {
      const input = root.querySelector(`[data-ut-control="${key}"]`);
      if (input) input.value = values[key];
      updateValueLabel(key);
    });
    updateCount();
  }
  function updateValueLabel(key) { const el = root.querySelector(`[data-ut-value="${key}"]`); if (el) el.textContent = `${values[key]}%`; }

  window.IronBendUiTuner = { mount: build, close: closePanel, clear: clearSelection };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
