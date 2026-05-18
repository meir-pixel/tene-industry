// ── REBAR WEIGHT TABLE (kg/m) ──────────────────────────────────────
const REBAR_WEIGHTS = {
  6: 0.222, 8: 0.395, 10: 0.617, 12: 0.888, 14: 1.21,
  16: 1.58,  18: 2.00, 20: 2.47,  22: 2.98,  25: 3.85,
  28: 4.83,  32: 6.31, 36: 7.99,  40: 9.86
};

// ── SHAPE PRESETS ──────────────────────────────────────────────────
// sides: lengths in mm (defaults), angles: bend angles in degrees between sides
const SHAPE_PRESETS = [
  { id: 's1',  name: 'ישר',           bends: 0, sides: [1000],                         angles: [],                    emoji: '➖' },
  { id: 's2',  name: 'L – זווית',     bends: 1, sides: [500, 200],                     angles: [90],                  emoji: '⌐' },
  { id: 's3',  name: 'U – אנקר',      bends: 2, sides: [300, 600, 300],                angles: [90, 90],              emoji: '∪' },
  { id: 's4',  name: 'Z – הזזה',      bends: 2, sides: [300, 400, 300],                angles: [135, 135],            emoji: 'Z' },
  { id: 's5',  name: 'S – כפול',      bends: 3, sides: [200, 300, 300, 200],           angles: [135, 135, 135],       emoji: 'S' },
  { id: 's6',  name: 'אוברל – קרס',  bends: 3, sides: [200, 400, 400, 200],           angles: [90, 180, 90],         emoji: '⎡' },
  { id: 's7',  name: 'אסדה פתוחה',   bends: 3, sides: [200, 500, 500, 200],           angles: [90, 90, 90],          emoji: '⬓' },
  { id: 's8',  name: 'מלבן – אצבה',  bends: 4, sides: [400, 200, 400, 200],           angles: [90, 90, 90, 90],      emoji: '□' },
  { id: 's9',  name: 'ריבוע – אצבה', bends: 4, sides: [300, 300, 300, 300],           angles: [90, 90, 90, 90],      emoji: '◻' },
  { id: 's10', name: 'חמישה כיפופים', bends: 5, sides: [150, 200, 400, 200, 400, 150], angles: [90, 90, 90, 90, 90], emoji: '⌂' },
  { id: 's11', name: 'ששה כיפופים',  bends: 6, sides: [150, 150, 400, 150, 400, 150, 150], angles: [90,90,90,90,90,90], emoji: '⬡' },
  { id: 's12', name: 'מותאם אישית',  bends: 0, sides: [500],                          angles: [],                    emoji: '✏️', custom: true },
];

// ── GEOMETRY ──────────────────────────────────────────────────────
function calcShapePoints(sides, angles) {
  const pts = [[0, 0]];
  let dir = 0; // degrees, 0=right, 90=down (screen coords)
  for (let i = 0; i < sides.length; i++) {
    const rad = dir * Math.PI / 180;
    const [px, py] = pts[pts.length - 1];
    pts.push([px + sides[i] * Math.cos(rad), py + sides[i] * Math.sin(rad)]);
    if (i < angles.length) {
      dir -= (180 - angles[i]); // left-turn convention (standard for rebar)
    }
  }
  return pts;
}

function shapeSVGPath(sides, angles, w, h, padding = 14) {
  if (!sides || sides.length === 0) return { path: '', pts: [] };
  const pts = calcShapePoints(sides, angles);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
  const scale = Math.min((w - padding*2) / rangeX, (h - padding*2) / rangeY);
  const offX = padding + ((w - padding*2) - rangeX * scale) / 2;
  const offY = padding + ((h - padding*2) - rangeY * scale) / 2;
  const mapped = pts.map(([x, y]) => [
    offX + (x - minX) * scale,
    offY + (y - minY) * scale,
  ]);
  const path = 'M ' + mapped.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L ');
  return { path, pts: mapped };
}

// ── 3D ISOMETRIC SVG ──────────────────────────────────────────────
// Projects a flat 2D rebar shape into an isometric 3D view.
// The rebar lies in the XY plane; we view from above-right at 30°.
function shape3DSVG(sides, angles, w, h, diameterMm = 12) {
  if (!sides || sides.length === 0) return '<text x="50%" y="50%" text-anchor="middle" fill="#7a93ab" font-size="12">אין צורה</text>';

  const pts2d = calcShapePoints(sides, angles);

  // Isometric projection: (x,y) → screen
  const ISO_X = 0.866; // cos(30°)
  const ISO_Y = 0.5;   // sin(30°)
  const project = ([x, y]) => [
    (x - y) * ISO_X,
    (x + y) * ISO_Y
  ];

  const iso = pts2d.map(project);
  const sxs = iso.map(p => p[0]), sys = iso.map(p => p[1]);
  const minSX = Math.min(...sxs), maxSX = Math.max(...sxs);
  const minSY = Math.min(...sys), maxSY = Math.max(...sys);
  const pad = 24;
  const scaleX = (w - pad*2) / (maxSX - minSX || 1);
  const scaleY = (h - pad*2) / (maxSY - minSY || 1);
  const sc = Math.min(scaleX, scaleY);
  const ox = pad + ((w - pad*2) - (maxSX - minSX) * sc) / 2;
  const oy = pad + ((h - pad*2) - (maxSY - minSY) * sc) / 2;

  const mapped = iso.map(([sx, sy]) => [
    ox + (sx - minSX) * sc,
    oy + (sy - minSY) * sc,
  ]);

  const pathD = 'M ' + mapped.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ');

  // Bar thickness proportional to diameter (min 4px, max 14px)
  const barW = Math.max(4, Math.min(14, diameterMm * sc * 0.001 + 5));

  // Shadow (offset copy)
  const shadowD = 'M ' + mapped.map(([x,y]) => `${(x+3).toFixed(1)},${(y+3).toFixed(1)}`).join(' L ');

  // Dots at bend points
  const bendDots = mapped.slice(1, -1).map(([x,y]) =>
    `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(barW/2+1).toFixed(1)}" fill="#c9621a"/>`
  ).join('');

  return `
    <defs>
      <linearGradient id="rebarGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#e07b39"/>
        <stop offset="100%" stop-color="#8b4513"/>
      </linearGradient>
    </defs>
    <!-- shadow -->
    <path d="${shadowD}" stroke="rgba(0,0,0,0.25)" stroke-width="${barW}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <!-- bar body -->
    <path d="${pathD}" stroke="url(#rebarGrad)" stroke-width="${barW}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <!-- highlight -->
    <path d="${pathD}" stroke="rgba(255,255,255,0.35)" stroke-width="${(barW*0.3).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke-dasharray="none"/>
    <!-- bend markers -->
    ${bendDots}
    <!-- start/end dots -->
    <circle cx="${mapped[0][0].toFixed(1)}" cy="${mapped[0][1].toFixed(1)}" r="${(barW/2).toFixed(1)}" fill="#1a7a42"/>
    <circle cx="${mapped[mapped.length-1][0].toFixed(1)}" cy="${mapped[mapped.length-1][1].toFixed(1)}" r="${(barW/2).toFixed(1)}" fill="#1560a8"/>
  `;
}

// ── WEIGHT ────────────────────────────────────────────────────────
function calcItemWeight(diameter, sides, qty) {
  const d = Number(diameter);
  const kgPerM = REBAR_WEIGHTS[d] ?? (d * d * 0.00617);
  const totalMm = (sides || []).reduce((s, l) => s + Number(l || 0), 0);
  return (totalMm / 1000) * kgPerM * (qty || 1);
}

function weightPerMeter(diameter) {
  const d = Number(diameter);
  return REBAR_WEIGHTS[d] ?? (d * d * 0.00617);
}

// ── SHAPE EDITOR CLASS ────────────────────────────────────────────
class ShapeEditorModal {
  constructor(onSelect) {
    this.onSelect = onSelect;
    this.current  = null; // { sides, angles, presetId }
    this._build();
  }

  _build() {
    if (document.getElementById('seOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'seOverlay';
    overlay.innerHTML = `
<style>
#seOverlay {
  position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:500;
  display:flex;align-items:center;justify-content:center;
  opacity:0;pointer-events:none;transition:opacity 0.2s;backdrop-filter:blur(4px);
}
#seOverlay.show{opacity:1;pointer-events:all;}
#seModal{
  background:#1a2637;border:1px solid rgba(255,255,255,0.08);border-radius:16px;
  width:860px;max-width:98vw;max-height:92vh;overflow:hidden;
  display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.6);
  transform:translateY(16px);transition:transform 0.2s;
}
#seOverlay.show #seModal{transform:translateY(0);}
#seModal .se-head{
  padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.07);
  display:flex;align-items:center;justify-content:space-between;flex-shrink:0;
}
#seModal .se-head h2{font-size:15px;font-weight:800;color:#e8edf3;}
#seModal .se-close{width:36px;height:36px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);
  border-radius:8px;color:#e8edf3;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;}
#seModal .se-body{display:flex;flex:1;overflow:hidden;min-height:0;}
#seModal .se-presets{
  width:200px;flex-shrink:0;border-left:1px solid rgba(255,255,255,0.07);
  overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:4px;
}
#seModal .se-preset-btn{
  padding:9px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.07);
  background:rgba(255,255,255,0.03);color:#7a93ab;cursor:pointer;
  font-family:'Heebo',sans-serif;font-size:13px;font-weight:600;
  text-align:right;transition:all 0.15s;display:flex;align-items:center;gap:8px;
  -webkit-tap-highlight-color:transparent;
}
#seModal .se-preset-btn:hover{border-color:rgba(255,255,255,0.15);color:#e8edf3;}
#seModal .se-preset-btn.active{background:rgba(224,123,57,0.15);border-color:#e07b39;color:#e07b39;}
#seModal .se-preset-btn .se-emoji{font-size:16px;flex-shrink:0;}
#seModal .se-main{flex:1;display:flex;flex-direction:column;overflow:hidden;padding:16px;gap:14px;}
#seModal .se-preview-row{display:flex;gap:14px;flex-shrink:0;}
#seModal .se-svg-wrap{
  background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
  border-radius:12px;flex:1;display:flex;align-items:center;justify-content:center;
  min-height:180px;
}
#seModal .se-svg-wrap svg{width:100%;height:180px;}
#seModal .se-info-col{width:160px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;}
#seModal .se-stat{background:rgba(255,255,255,0.04);border-radius:8px;padding:10px 12px;}
#seModal .se-stat-label{font-size:10px;font-weight:700;color:#7a93ab;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;}
#seModal .se-stat-value{font-size:18px;font-weight:900;color:#e07b39;}
#seModal .se-stat-unit{font-size:11px;color:#7a93ab;font-weight:400;}
#seModal .se-table-wrap{flex:1;overflow-y:auto;}
#seModal .se-table{width:100%;border-collapse:collapse;}
#seModal .se-table th{
  text-align:right;font-size:10px;font-weight:700;color:#7a93ab;text-transform:uppercase;
  letter-spacing:0.5px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.07);
  background:rgba(255,255,255,0.02);
}
#seModal .se-table td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.04);}
#seModal .se-table tr:last-child td{border-bottom:none;}
#seModal .se-input{
  width:100%;padding:7px 10px;background:rgba(255,255,255,0.05);
  border:1px solid rgba(255,255,255,0.08);border-radius:7px;
  color:#e8edf3;font-family:'Heebo',sans-serif;font-size:13px;direction:rtl;
  min-height:38px;
}
#seModal .se-input:focus{outline:none;border-color:#e07b39;background:rgba(224,123,57,0.08);}
#seModal .se-angle-btns{display:flex;gap:4px;flex-wrap:wrap;}
#seModal .se-angle-btn{
  padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);
  background:rgba(255,255,255,0.04);color:#7a93ab;cursor:pointer;
  font-family:'Heebo',sans-serif;font-size:11px;font-weight:700;
  transition:all 0.15s;-webkit-tap-highlight-color:transparent;
}
#seModal .se-angle-btn:hover{border-color:#e07b39;color:#e07b39;}
#seModal .se-angle-btn.active{background:rgba(224,123,57,0.15);border-color:#e07b39;color:#e07b39;}
#seModal .se-seg-label{
  display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;border-radius:50%;background:#2e4a6e;
  color:#e8edf3;font-size:11px;font-weight:700;flex-shrink:0;
}
#seModal .se-bend-row{background:rgba(224,123,57,0.04);}
#seModal .se-add-row{
  display:flex;gap:8px;padding:10px 0 4px;
}
#seModal .se-add-btn{
  padding:7px 14px;border-radius:7px;border:1px dashed rgba(255,255,255,0.15);
  background:transparent;color:#7a93ab;cursor:pointer;font-family:'Heebo',sans-serif;
  font-size:12px;font-weight:600;transition:all 0.15s;
}
#seModal .se-add-btn:hover{border-color:#e07b39;color:#e07b39;}
#seModal .se-del-btn{
  width:28px;height:28px;border-radius:6px;border:1px solid transparent;
  background:transparent;color:#7a93ab;cursor:pointer;font-size:14px;
  display:flex;align-items:center;justify-content:center;transition:all 0.15s;
}
#seModal .se-del-btn:hover{background:rgba(231,76,60,0.15);border-color:#e74c3c;color:#e74c3c;}
#seModal .se-foot{
  padding:12px 16px;border-top:1px solid rgba(255,255,255,0.07);
  display:flex;justify-content:flex-end;gap:10px;flex-shrink:0;
}
#seModal .se-cancel-btn{
  padding:10px 20px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);
  background:rgba(255,255,255,0.04);color:#7a93ab;cursor:pointer;
  font-family:'Heebo',sans-serif;font-size:14px;font-weight:700;
}
#seModal .se-ok-btn{
  padding:10px 28px;border-radius:8px;border:none;
  background:linear-gradient(135deg,#e07b39,#f0954d);color:white;cursor:pointer;
  font-family:'Heebo',sans-serif;font-size:14px;font-weight:800;
  box-shadow:0 4px 16px rgba(224,123,57,0.3);
}
#seModal .se-ok-btn:hover{transform:translateY(-1px);}
@media(max-width:640px){
  #seModal .se-body{flex-direction:column;}
  #seModal .se-presets{width:100%;flex-direction:row;overflow-x:auto;overflow-y:hidden;border-left:none;border-bottom:1px solid rgba(255,255,255,0.07);padding:8px;flex-wrap:nowrap;max-height:60px;}
  #seModal .se-preset-btn{flex-shrink:0;white-space:nowrap;}
  #seModal .se-preview-row{flex-direction:column;}
  #seModal .se-info-col{width:100%;flex-direction:row;}
}
</style>
<div id="seModal">
  <div class="se-head">
    <h2>עורך צורת כיפוף</h2>
    <button class="se-close" id="seClose">✕</button>
  </div>
  <div class="se-body">
    <div class="se-presets" id="sePresets"></div>
    <div class="se-main">
      <div class="se-preview-row">
        <div style="display:flex;flex-direction:column;flex:1;gap:8px">
          <div style="display:flex;gap:6px;justify-content:flex-end">
            <button id="seView2D" onclick="seSetView('2d')" style="padding:4px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#e8edf3;font-family:'Heebo',sans-serif;font-size:12px;font-weight:700;cursor:pointer">2D</button>
            <button id="seView3D" onclick="seSetView('3d')" style="padding:4px 12px;border-radius:6px;border:1px solid #e07b39;background:rgba(224,123,57,0.15);color:#e07b39;font-family:'Heebo',sans-serif;font-size:12px;font-weight:700;cursor:pointer">3D</button>
          </div>
          <div class="se-svg-wrap" id="seSvgWrap">
            <svg id="seShapeSvg" viewBox="0 0 300 180" preserveAspectRatio="xMidYMid meet">
              <path id="seShapePath" stroke="#e07b39" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
        <div class="se-info-col">
          <div class="se-stat">
            <div class="se-stat-label">פרימטר כולל</div>
            <div class="se-stat-value" id="sePerimeter">0</div>
            <div class="se-stat-unit">מ"מ</div>
          </div>
          <div class="se-stat">
            <div class="se-stat-label">אורך בר</div>
            <div class="se-stat-value" id="seBarLength">0.00</div>
            <div class="se-stat-unit">מטר</div>
          </div>
          <div class="se-stat">
            <div class="se-stat-label">כיפופים</div>
            <div class="se-stat-value" id="seBends">0</div>
          </div>
        </div>
      </div>
      <div class="se-table-wrap">
        <table class="se-table">
          <thead>
            <tr>
              <th style="width:32px">#</th>
              <th>אורך צלע (מ"מ)</th>
              <th>זווית כיפוף</th>
              <th style="width:32px"></th>
            </tr>
          </thead>
          <tbody id="seTableBody"></tbody>
        </table>
        <div class="se-add-row">
          <button class="se-add-btn" id="seAddSide">➕ הוסף צלע</button>
        </div>
      </div>
    </div>
  </div>
  <div class="se-foot">
    <button class="se-cancel-btn" id="seCancel">ביטול</button>
    <button class="se-ok-btn" id="seOk">אשר צורה ←</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    this._el = overlay;
    this._bindEvents();
    this._renderPresets();
  }

  _bindEvents() {
    document.getElementById('seClose').onclick  = () => this.close();
    document.getElementById('seCancel').onclick = () => this.close();
    document.getElementById('seOk').onclick     = () => this._confirm();
    document.getElementById('seAddSide').onclick = () => this._addSide();
    this._el.addEventListener('click', e => { if (e.target === this._el) this.close(); });
  }

  _renderPresets() {
    document.getElementById('sePresets').innerHTML = SHAPE_PRESETS.map(s => `
      <button class="se-preset-btn" data-id="${s.id}">
        <span class="se-emoji">${s.emoji}</span>
        <span>${s.name}</span>
      </button>`).join('');
    document.getElementById('sePresets').querySelectorAll('.se-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = SHAPE_PRESETS.find(s => s.id === btn.dataset.id);
        if (preset) this._loadPreset(preset);
      });
    });
  }

  _loadPreset(preset) {
    this.current = {
      presetId: preset.id,
      presetName: preset.name,
      presetEmoji: preset.emoji,
      sides: [...preset.sides],
      angles: [...preset.angles],
    };
    document.querySelectorAll('.se-preset-btn').forEach(b => b.classList.toggle('active', b.dataset.id === preset.id));
    this._renderTable();
    this._updatePreview();
  }

  _renderTable() {
    if (!this.current) return;
    const { sides, angles } = this.current;
    let html = '';
    for (let i = 0; i < sides.length; i++) {
      html += `
        <tr>
          <td><span class="se-seg-label">${i + 1}</span></td>
          <td><input class="se-input" type="number" min="1" max="20000" value="${sides[i]}"
            data-side="${i}" oninput="window._seEditor._setSide(${i}, this.value)"></td>
          <td>${i < angles.length ? `
            <div style="display:flex;align-items:center;gap:6px">
              <input class="se-input" type="number" min="1" max="179" value="${angles[i]}" style="width:70px"
                data-angle="${i}" oninput="window._seEditor._setAngle(${i}, this.value)">
              <div class="se-angle-btns">
                ${[45,90,135].map(a => `<button class="se-angle-btn ${angles[i]==a?'active':''}"
                  onclick="window._seEditor._setAngle(${i},${a});this.closest('tr').querySelector('[data-angle]').value=${a}">${a}°</button>`).join('')}
              </div>
            </div>` : '<span style="color:var(--text-dim,#7a93ab);font-size:12px">—</span>'}</td>
          <td>${sides.length > 1 ? `<button class="se-del-btn" onclick="window._seEditor._deleteSide(${i})">✕</button>` : ''}</td>
        </tr>`;
      if (i < angles.length) {
        html += `<tr class="se-bend-row">
          <td colspan="4" style="padding:2px 10px;font-size:11px;color:#7a93ab">
            ↳ כיפוף ${i + 1}: ${angles[i]}°
          </td>
        </tr>`;
      }
    }
    document.getElementById('seTableBody').innerHTML = html;
  }

  _setSide(i, val) {
    if (!this.current) return;
    this.current.sides[i] = Math.max(1, Number(val) || 1);
    this._updatePreview();
  }

  _setAngle(i, val) {
    if (!this.current) return;
    const a = Math.min(179, Math.max(1, Number(val) || 90));
    this.current.angles[i] = a;
    // update active btn
    const row = document.querySelector(`[data-angle="${i}"]`)?.closest('tr');
    row?.querySelectorAll('.se-angle-btn').forEach(b => b.classList.toggle('active', Number(b.textContent) === a));
    this._updatePreview();
  }

  _addSide() {
    if (!this.current) return;
    this.current.sides.push(300);
    if (this.current.sides.length > 1) this.current.angles.push(90);
    this._renderTable();
    this._updatePreview();
  }

  _deleteSide(i) {
    if (!this.current || this.current.sides.length <= 1) return;
    this.current.sides.splice(i, 1);
    if (i < this.current.angles.length) this.current.angles.splice(i, 1);
    else if (this.current.angles.length > 0) this.current.angles.pop();
    this._renderTable();
    this._updatePreview();
  }

  _updatePreview() {
    if (!this.current) return;
    const { sides, angles } = this.current;
    const svg = document.getElementById('seShapeSvg');
    const is3D = window._seViewMode !== '2d';

    if (is3D) {
      const diam = this._diameter || 12;
      svg.innerHTML = shape3DSVG(sides, angles, 300, 180, diam);
    } else {
      svg.innerHTML = '<path id="seShapePath" stroke="#e07b39" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
      const { path } = shapeSVGPath(sides, angles, 300, 180, 16);
      document.getElementById('seShapePath').setAttribute('d', path);
    }

    const perimeter = sides.reduce((s, l) => s + Number(l), 0);
    document.getElementById('sePerimeter').textContent  = perimeter.toLocaleString('he-IL');
    document.getElementById('seBarLength').textContent  = (perimeter / 1000).toFixed(2);
    document.getElementById('seBends').textContent      = angles.length;
  }

  _confirm() {
    if (!this.current || !this.onSelect) return;
    this.onSelect({ ...this.current });
    this.close();
  }

  open(existingData) {
    window._seEditor = this;
    if (existingData?.sides?.length) {
      this.current = { ...existingData };
      const preset = SHAPE_PRESETS.find(s => s.id === existingData.presetId);
      document.querySelectorAll('.se-preset-btn').forEach(b => b.classList.toggle('active', b.dataset.id === existingData.presetId));
      this._renderTable();
      this._updatePreview();
    } else {
      this._loadPreset(SHAPE_PRESETS[0]);
    }
    this._el.classList.add('show');
  }

  close() {
    this._el.classList.remove('show');
  }
}

// ── VIEW MODE TOGGLE (global, called from onclick) ────────────────
window._seViewMode = '3d'; // default to 3D
window.seSetView = function(mode) {
  window._seViewMode = mode;
  const btn2d = document.getElementById('seView2D');
  const btn3d = document.getElementById('seView3D');
  if (btn2d && btn3d) {
    const activeStyle = 'border:1px solid #e07b39;background:rgba(224,123,57,0.15);color:#e07b39';
    const idleStyle   = 'border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#e8edf3';
    btn2d.style.cssText = (mode === '2d' ? activeStyle : idleStyle) + ';padding:4px 12px;border-radius:6px;font-family:Heebo,sans-serif;font-size:12px;font-weight:700;cursor:pointer';
    btn3d.style.cssText = (mode === '3d' ? activeStyle : idleStyle) + ';padding:4px 12px;border-radius:6px;font-family:Heebo,sans-serif;font-size:12px;font-weight:700;cursor:pointer';
  }
  if (window._seEditor) window._seEditor._updatePreview();
};
