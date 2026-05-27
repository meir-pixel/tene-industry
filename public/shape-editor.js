// ── REBAR WEIGHT TABLE (kg/m) ──────────────────────────────────────
const REBAR_WEIGHTS = {
  6: 0.222, 8: 0.395, 10: 0.617, 12: 0.888, 14: 1.21,
  16: 1.58,  18: 2.00, 20: 2.47,  22: 2.98,  25: 3.85,
  28: 4.83,  32: 6.31, 36: 7.99,  40: 9.86
};

// ── SEGMENT COLOR PALETTE ─────────────────────────────────────────
const SEG_COLORS = [
  '#e07b39', // כתום  – צלע א
  '#3a7bd5', // כחול  – צלע ב
  '#22a85a', // ירוק  – צלע ג
  '#c94f7c', // ורוד  – צלע ד
  '#9b59b6', // סגול  – צלע ה
  '#0ea5a0', // ציאן  – צלע ו
  '#e74c3c', // אדום  – צלע ז
  '#d4ac0d', // זהב   – צלע ח
];

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
  { id: 's13', name: 'W – ארבעה כיפופים', bends: 4, sides: [200, 300, 300, 300, 200], angles: [135, 90, 90, 135], emoji: 'W' },
  { id: 's14', name: 'C – חמש צלעות',    bends: 4, sides: [300, 200, 400, 200, 300], angles: [90, 90, 90, 90],   emoji: 'C' },
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

// ── TRUE 3D GEOMETRY (azimuth + elevation per segment) ────────────
// azAngles[i]: rotation in XY plane from +X axis (degrees, 0=right, 90=forward)
// elAngles[i]: tilt from XY plane toward +Z (degrees, 0=flat, 90=straight up)
// azAngles[i] = RELATIVE turn in XY plane from previous segment direction (degrees)
//   0 = continue straight ahead   90 = turn left 90°   -90 = turn right 90°
// elAngles[i] = absolute tilt from XY plane (degrees)
function calcShapePoints3D(sides, azAngles, elAngles) {
  const pts = [[0, 0, 0]];
  let cumAz = 0; // accumulated azimuth direction (degrees)
  for (let i = 0; i < sides.length; i++) {
    cumAz += (azAngles && azAngles[i] != null) ? azAngles[i] : 0;
    const az    = cumAz * Math.PI / 180;
    const elDeg = (elAngles && elAngles[i] != null) ? elAngles[i] : 0;
    const el    = elDeg * Math.PI / 180;
    const [px, py, pz] = pts[pts.length - 1];
    const cosEl = Math.cos(el);
    pts.push([
      px + sides[i] * cosEl * Math.cos(az),
      py + sides[i] * cosEl * Math.sin(az),
      pz + sides[i] * Math.sin(el),
    ]);
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

// ── OVERLAP OFFSET ────────────────────────────────────────────────
// Returns array of depth-offsets (signed px) for each segment.
// Overlapping parallel segments get ±gap — rendered with a DIAGONAL
// "depth" shift so they appear stacked like real bundled rebar,
// not just shifted sideways (which looks unnatural).
function computeSegOffsets(pts2d, barW) {
  const n = pts2d.length - 1;
  if (n <= 0) return [];
  const segs = pts2d.slice(0, -1).map(([x1,y1], i) => {
    const [x2,y2] = pts2d[i+1];
    const dx=x2-x1, dy=y2-y1, len=Math.sqrt(dx*dx+dy*dy)||1;
    let angle = Math.atan2(dy,dx)*180/Math.PI; if (angle<0) angle+=180;
    return { x1,y1,x2,y2, cx:(x1+x2)/2, cy:(y1+y2)/2,
             ux:dx/len, uy:dy/len, nx:-dy/len, ny:dx/len, angle, len };
  });
  const offsets = new Array(n).fill(0);
  const gap = barW * 1.6;
  for (let i=0; i<n; i++) {
    for (let j=i+1; j<n; j++) {
      const si=segs[i], sj=segs[j];
      const da = Math.abs(si.angle - sj.angle);
      if (da>20 && da<160) continue;
      const dcx=sj.cx-si.cx, dcy=sj.cy-si.cy;
      const perp = Math.abs(dcx*si.nx + dcy*si.ny);
      if (perp > gap*1.5) continue;
      const along = Math.abs(dcx*si.ux + dcy*si.uy);
      if (along > (si.len+sj.len)*0.6) continue;
      if (offsets[i]===0 && offsets[j]===0) { offsets[i]=-gap; offsets[j]=+gap; }
      else if (offsets[i]===0) offsets[i] = offsets[j]>0 ? -gap : +gap;
      else if (offsets[j]===0) offsets[j] = offsets[i]>0 ? -gap : +gap;
    }
  }
  return offsets;
}

// Diagonal "depth" direction for overlapping segments.
// Upper-right = "closer to viewer" in isometric convention.
// Both axes equal → clean 45° diagonal that reads as depth, not sideways shift.
const OVLP_DX =  0.707;   // screen-X component of depth vector
const OVLP_DY = -0.707;   // screen-Y component (negative = upward in screen)

// ── 3D ISOMETRIC SVG ──────────────────────────────────────────────
// Projects a flat 2D rebar shape into an isometric 3D view.
// The rebar lies in the XY plane; we view from above-right at 30°.
// ── 3D ISOMETRIC RENDER WITH XYZ AXES ────────────────────────────
// opts.showAxes   – show X/Y/Z axis indicator (default true when w>=120)
// opts.showDims   – show segment length labels
// opts.showBends  – show bend angle labels
// opts.dark       – use dark background palette (default true inside editor)
function shape3DSVG(sides, angles, w, h, diameterMm = 12, opts = {}) {
  if (!sides || sides.length === 0)
    return '<text x="50%" y="50%" text-anchor="middle" fill="#7a93ab" font-size="12">אין צורה</text>';

  const showAxes = opts.showAxes !== false && w >= 100;
  const showDims = opts.showDims !== false && w >= 160;
  const dark     = opts.dark !== false;
  const labelClr = dark ? '#e8edf3' : '#1a2533';
  const mutedClr = dark ? '#7a93ab' : '#526070';

  // ── Orbit-camera projection ───────────────────────────────────
  // theta: azimuth (rotation around world-Z), phi: elevation (tilt from horizontal)
  // Default theta=45°, phi=45° → matches the classic isometric look.
  const theta = opts.camTheta ?? Math.PI / 4;
  const phi   = opts.camPhi   ?? Math.PI / 4;
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const cosP = Math.cos(phi),   sinP = Math.sin(phi);

  // Build 3D point array (z=0 for flat 2D shapes)
  let pts3d;
  if (opts.azAngles) {
    pts3d = calcShapePoints3D(sides, opts.azAngles, opts.elAngles || []);
  } else {
    pts3d = calcShapePoints(sides, angles).map(([x, y]) => [x, y, 0]);
  }

  // Project: rotate around Z by theta, then tilt by phi
  // sx = x·cosθ − y·sinθ
  // sy = −(z·cosφ − (x·sinθ + y·cosθ)·sinφ)   (screen-Y is down, world-Z is up)
  const iso = pts3d.map(([x, y, z]) => {
    const x1 = x * cosT - y * sinT;
    const y1 = x * sinT + y * cosT;
    return [x1, -(z * cosP - y1 * sinP)];
  });
  const sxs = iso.map(p => p[0]), sys = iso.map(p => p[1]);
  const minSX = Math.min(...sxs), maxSX = Math.max(...sxs);
  const minSY = Math.min(...sys), maxSY = Math.max(...sys);

  // Reserve room for axes legend (bottom-left) and labels
  const axPad = showAxes ? 38 : 0;
  const pad   = 22 + (showDims ? 32 : 0);
  const avW   = w - pad * 2 - axPad;
  const avH   = h - pad * 2;
  const sc    = Math.min(avW / (maxSX - minSX || 1), avH / (maxSY - minSY || 1));
  const ox    = pad + axPad + ((avW) - (maxSX - minSX) * sc) / 2;
  const oy    = pad + ((avH) - (maxSY - minSY) * sc) / 2;

  const barW    = Math.max(4, Math.min(diameterMm > 0 ? diameterMm * 0.55 : 8, 16));
  const activeSeg = opts.activeSeg ?? -1;
  const BAR_COLOR = dark ? '#b8cfe0' : '#3d5e78';

  // ── Z-LIFT for overlapping parallel segments ─────────────────────
  // 1. Detect overlaps using the flat projected points.
  // 2. If overlaps exist, add a small virtual Z-elevation to each 3D point,
  //    then re-project — shape shows stacked bars connected at bends,
  //    exactly like real bundled rebar viewed isometrically.
  const flatMapped = iso.map(([sx, sy]) => [
    ox + (sx - minSX) * sc,
    oy + (sy - minSY) * sc,
  ]);
  const offsets3d  = computeSegOffsets(flatMapped, barW);
  const hasOverlap = offsets3d.some(o => o !== 0);

  let mapped;
  if (hasOverlap) {
    // Screen-space diagonal offset — keeps the shape flat, avoids Z-lift distortion.
    // Z-lift causes connecting segments to become 3D-diagonal after projection, which
    // makes 90° bends look skewed. Instead we shift each screen-point by a weighted
    // average of its adjacent segment offsets along the isometric depth direction.
    const n = pts3d.length - 1;
    mapped = flatMapped.map((pt, i) => {
      let sum = 0, cnt = 0;
      if (i > 0 && offsets3d[i - 1] !== 0) { sum += offsets3d[i - 1]; cnt++; }
      if (i < n && offsets3d[i]     !== 0) { sum += offsets3d[i];     cnt++; }
      if (cnt === 0) return pt;
      const off = sum / cnt; // ±barW*1.6 px — already scaled
      return [pt[0] + OVLP_DX * off, pt[1] + OVLP_DY * off];
    });
  } else {
    mapped = flatMapped;
  }

  // ── Bar rendering: single connected polyline ─────────────────────
  let shadowsHtml, segsHtml, activeGlowHtml;
  {
    const pts3  = mapped.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const pts3s = mapped.map(([x,y]) =>
      `${(x+barW*0.35).toFixed(1)},${(y+barW*0.35).toFixed(1)}`).join(' ');
    shadowsHtml = `<polyline points="${pts3s}" stroke="rgba(0,0,0,0.18)"
      stroke-width="${(barW*1.4).toFixed(1)}" stroke-linejoin="round" stroke-linecap="round" fill="none"/>`;
    segsHtml  = `<polyline points="${pts3}" stroke="${BAR_COLOR}"
      stroke-width="${barW}" stroke-linejoin="round" stroke-linecap="round" fill="none"/>`;
    segsHtml += `<polyline points="${pts3}" stroke="rgba(255,255,255,0.38)"
      stroke-width="${(barW*0.28).toFixed(1)}" stroke-linejoin="round" stroke-linecap="round" fill="none"/>`;
    if (activeSeg >= 0 && activeSeg < mapped.length - 1) {
      const [ax1,ay1] = mapped[activeSeg], [ax2,ay2] = mapped[activeSeg+1];
      const ad = `M ${ax1.toFixed(1)},${ay1.toFixed(1)} L ${ax2.toFixed(1)},${ay2.toFixed(1)}`;
      activeGlowHtml = `<path d="${ad}" stroke="rgba(41,121,255,0.22)"
        stroke-width="${(barW*4.5).toFixed(1)}" stroke-linecap="round" fill="none"/>`;
      segsHtml += `<path d="${ad}" stroke="#2979ff" stroke-width="${barW}" stroke-linecap="round" fill="none"/>`;
      segsHtml += `<path d="${ad}" stroke="rgba(255,255,255,0.55)"
        stroke-width="${(barW*0.28).toFixed(1)}" stroke-linecap="round" fill="none"/>`;
    } else { activeGlowHtml = ''; }
  }

  // ── Bend angle labels ─────────────────────────────────────────
  let bendLabels = '';
  if (showDims) {
    for (let i = 1; i < mapped.length - 1; i++) {
      const [bx, by] = mapped[i];
      const angle = angles[i - 1];
      if (angle !== undefined && angle !== 180) {
        bendLabels += `
          <circle cx="${bx.toFixed(1)}" cy="${(by - barW/2 - 16).toFixed(1)}" r="11"
            fill="rgba(201,98,26,0.9)" stroke="rgba(255,255,255,0.2)" stroke-width="1" data-ang-click="${i-1}" style="cursor:pointer"/>
          <text x="${bx.toFixed(1)}" y="${(by - barW/2 - 11.5).toFixed(1)}" text-anchor="middle" font-size="9"
            font-family="Heebo,Arial" font-weight="700" fill="white"
            data-ang-click="${i-1}" style="cursor:pointer">${angle}°</text>`;
      }
    }
  }

  // ── Segment length labels ─────────────────────────────────────
  let dimLabels = '';
  if (showDims) {
    for (let i = 0; i < mapped.length - 1; i++) {
      const [x1, y1] = mapped[i], [x2, y2] = mapped[i + 1];
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len * 22, ny = dx / len * 22;
      const letter = String.fromCharCode(0x05D0 + i); // א ב ג...
      const isActSeg = i === activeSeg;
      const badgeCol = isActSeg ? '#2979ff' : '#526070';
      // Letter badge (circle with Hebrew letter, colored per segment)
      dimLabels += `
        <circle cx="${(mx + nx).toFixed(1)}" cy="${(my + ny - 12).toFixed(1)}" r="10"
          fill="${badgeCol}" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" data-seg-click="${i}" style="cursor:pointer"/>
        <text x="${(mx + nx).toFixed(1)}" y="${(my + ny - 7.5).toFixed(1)}" text-anchor="middle"
          font-size="11" font-family="Heebo,Arial" font-weight="900" fill="white"
          data-seg-click="${i}" style="cursor:pointer">${letter}</text>
        <rect x="${(mx + nx - 16).toFixed(1)}" y="${(my + ny + 1).toFixed(1)}" width="32" height="13"
          rx="3" fill="${dark ? 'rgba(26,38,55,0.88)' : 'rgba(255,255,255,0.92)'}" stroke="${badgeCol}" stroke-width="1" data-seg-click="${i}" style="cursor:pointer"/>
        <text x="${(mx + nx).toFixed(1)}" y="${(my + ny + 11).toFixed(1)}" text-anchor="middle"
          font-size="9" font-family="Heebo,Arial" font-weight="700" fill="${labelClr}"
          data-seg-click="${i}" style="cursor:pointer">${sides[i]}</text>`;
    }
  }

  // ── XYZ Axis indicator (bottom-right corner) ──────────────────
  let axisHTML = '';
  if (showAxes) {
    const ax = w - 44, ay = h - 14;
    const axLen = 22;
    // Project world X/Y/Z axes through the current camera
    const xEnd = [ax + axLen * cosT,              ay + axLen * sinT * sinP];
    const yEnd = [ax - axLen * sinT,              ay + axLen * cosT * sinP];
    const zEnd = [ax,                             ay - axLen * cosP];

    axisHTML = `
      <!-- XYZ Axes -->
      <line x1="${ax}" y1="${ay}" x2="${xEnd[0].toFixed(1)}" y2="${xEnd[1].toFixed(1)}"
        stroke="#e05050" stroke-width="2" stroke-linecap="round"/>
      <text x="${(xEnd[0]+4).toFixed(1)}" y="${(xEnd[1]+4).toFixed(1)}"
        font-size="9" font-family="Heebo,Arial" font-weight="800" fill="#e05050">X</text>
      <line x1="${ax}" y1="${ay}" x2="${yEnd[0].toFixed(1)}" y2="${yEnd[1].toFixed(1)}"
        stroke="#22b844" stroke-width="2" stroke-linecap="round"/>
      <text x="${(yEnd[0]-12).toFixed(1)}" y="${(yEnd[1]+4).toFixed(1)}"
        font-size="9" font-family="Heebo,Arial" font-weight="800" fill="#22b844">Y</text>
      <line x1="${ax}" y1="${ay}" x2="${zEnd[0].toFixed(1)}" y2="${zEnd[1].toFixed(1)}"
        stroke="#3a7bd5" stroke-width="2" stroke-linecap="round"/>
      <text x="${(zEnd[0]+3).toFixed(1)}" y="${(zEnd[1]-4).toFixed(1)}"
        font-size="9" font-family="Heebo,Arial" font-weight="800" fill="#3a7bd5">Z</text>
      <circle cx="${ax}" cy="${ay}" r="3" fill="${mutedClr}"/>`;
  }

  const dragHint = opts.camTheta != null
    ? `<text x="${(w/2).toFixed(0)}" y="${h - 4}" text-anchor="middle"
        font-size="9" font-family="Heebo,Arial" fill="rgba(255,255,255,0.22)">גרור לסובב 🖱</text>`
    : '';

  // Joints: only needed in overlap case (polyline already looks continuous otherwise)
  const jointsHtml = hasOverlap ? mapped.slice(1, -1).map(([x, y], idx) => {
    const isAct = idx === activeSeg || (idx + 1) === activeSeg;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(barW/2).toFixed(1)}"
      fill="${isAct ? '#2979ff' : BAR_COLOR}"/>`;
  }).join('') : '';

  return `
    <!-- ground shadows per segment -->
    ${shadowsHtml}
    <!-- active segment glow -->
    ${activeGlowHtml}
    <!-- segments with per-segment color -->
    ${segsHtml}
    <!-- bend joints -->
    ${jointsHtml}
    <!-- start dot -->
    <circle cx="${mapped[0][0].toFixed(1)}" cy="${mapped[0][1].toFixed(1)}"
      r="${(barW/2).toFixed(1)}" fill="#1a7a42" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"/>
    <!-- end dot -->
    <circle cx="${mapped[mapped.length-1][0].toFixed(1)}" cy="${mapped[mapped.length-1][1].toFixed(1)}"
      r="${(barW/2).toFixed(1)}" fill="#1560a8" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"/>
    ${dimLabels}
    ${bendLabels}
    ${axisHTML}
    ${dragHint}
  `;
}

// ── SAVED SHAPES (localStorage) ──────────────────────────────────
const SAVED_SHAPES_KEY = 'ironbend_saved_shapes';

function loadSavedShapes() {
  try { return JSON.parse(localStorage.getItem(SAVED_SHAPES_KEY) || '[]'); }
  catch { return []; }
}
function persistSavedShape(shapeData, name) {
  const shapes = loadSavedShapes();
  const id = 'u' + Date.now();
  shapes.push({
    id, name: (name || 'צורה מותאמת').trim(),
    sides:    [...shapeData.sides],
    angles:   [...shapeData.angles],
    azAngles: shapeData.azAngles ? [...shapeData.azAngles] : null,
    elAngles: shapeData.elAngles ? [...shapeData.elAngles] : null,
    bends:    shapeData.angles.length,
    savedAt:  Date.now(),
  });
  localStorage.setItem(SAVED_SHAPES_KEY, JSON.stringify(shapes));
  return id;
}
function deleteSavedShape(id) {
  const shapes = loadSavedShapes().filter(s => s.id !== id);
  localStorage.setItem(SAVED_SHAPES_KEY, JSON.stringify(shapes));
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
    this.onSelect   = onSelect;
    this.current    = null;
    this._camTheta  = Math.PI / 4; // camera azimuth  (default 45°, matches isometric)
    this._camPhi    = Math.PI / 4; // camera elevation (default 45°, matches isometric)
    this._activeSeg = null;        // index of highlighted segment (null = none)
    this._build();
  }

  _build() {
    if (document.getElementById('seOverlay')) {
      this._el = document.getElementById('seOverlay');
      return;
    }
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
  background:#ffffff;border:1px solid #d0d8e4;border-radius:16px;
  width:min(1280px,96vw);max-height:95vh;overflow:hidden;
  display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.25);
  transform:translateY(16px);transition:transform 0.2s;
}
#seOverlay.show #seModal{transform:translateY(0);}
#seModal .se-head{
  padding:16px 20px;border-bottom:1px solid #d8e2ec;
  display:flex;align-items:center;justify-content:space-between;flex-shrink:0;
  background:#1a2332;
}
#seModal .se-head h2{font-size:15px;font-weight:800;color:#e8edf3;}
#seModal .se-close{width:36px;height:36px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);
  border-radius:8px;color:#e8edf3;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;}
/* ── Count picker buttons ── */
.se-count-btn{padding:16px 20px;border-radius:14px;border:2px solid #dde4ed;
  background:#fff;cursor:pointer;font-family:'Heebo',sans-serif;text-align:center;
  min-width:110px;transition:all 0.15s;display:flex;flex-direction:column;align-items:center;gap:4px;}
.se-count-btn:hover{border-color:#e07b39;background:rgba(224,123,57,0.05);
  transform:translateY(-2px);box-shadow:0 4px 16px rgba(224,123,57,0.2);}
.se-count-btn .cnt-num{font-size:28px;font-weight:900;color:#1a2332;}
.se-count-btn .cnt-lbl{font-size:11px;color:#7a93ab;}
.se-row-active td{background:rgba(41,121,255,0.07)!important;border-bottom:1px solid rgba(41,121,255,0.2)!important;}
.se-row-active td:first-child{border-right:3px solid #2979ff!important;}
.se-row-active .se-seg-label{background:#2979ff!important;}
/* ── Page 1: shape selection ── */
#sePageSelect{background:#f4f6f9;}
#seModal .se-preset-btn{
  padding:12px 8px 10px;border-radius:12px;border:1.5px solid #dde4ed;
  background:#ffffff;color:#526070;cursor:pointer;
  font-family:'Heebo',sans-serif;font-size:12px;font-weight:600;
  text-align:center;transition:all 0.15s;display:flex;flex-direction:column;
  align-items:center;gap:4px;min-height:100px;
  -webkit-tap-highlight-color:transparent;
}
#seModal .se-preset-btn:hover{border-color:#aab8c8;color:#1a2332;background:#edf1f7;transform:translateY(-1px);box-shadow:0 3px 10px rgba(0,0,0,0.08);}
#seModal .se-preset-btn.active{background:rgba(224,123,57,0.08);border-color:#e07b39;color:#e07b39;box-shadow:0 0 0 3px rgba(224,123,57,0.15);}
#seModal .se-preset-btn svg path{transition:stroke 0.15s;}
#seModal .se-preset-btn.active svg [stroke*="rebarGrad"]{stroke:#e07b39!important;}
/* ── Page 2: edit layout ── */
#sePageEdit{flex:1;display:flex;overflow:hidden;min-height:0;}
.se-preview-panel{flex:1;display:flex;flex-direction:column;padding:14px 16px;gap:10px;background:#fff;overflow:hidden;}
.se-data-panel{width:420px;flex-shrink:0;border-right:1px solid #e2e8ef;display:flex;flex-direction:column;overflow:hidden;background:#fff;}
.se-data-panel-head{padding:12px 14px 8px;border-bottom:1px solid #e2e8ef;font-size:11px;font-weight:700;color:#7a93ab;text-transform:uppercase;letter-spacing:0.5px;background:#f9fafb;}
/* Stats bar (horizontal) */
.se-stats-bar{display:flex;gap:8px;flex-shrink:0;}
#seModal .se-stat{flex:1;background:#f4f6f9;border:1px solid #e2e8ef;border-radius:8px;padding:10px 12px;}
#seModal .se-stat-label{font-size:9px;font-weight:700;color:#7a93ab;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;}
#seModal .se-stat-value{font-size:20px;font-weight:900;color:#e07b39;}
#seModal .se-stat-unit{font-size:11px;color:#7a93ab;font-weight:400;}
/* Back button */
.se-back-btn{padding:5px 12px;border-radius:7px;border:1px solid rgba(255,255,255,0.2);
  background:rgba(255,255,255,0.08);color:#c8d4e0;cursor:pointer;
  font-family:'Heebo',sans-serif;font-size:13px;font-weight:600;
  transition:all .15s;white-space:nowrap;}
.se-back-btn:hover{background:rgba(255,255,255,0.15);color:#fff;}
/* SVG */
#seModal .se-svg-wrap{
  background:#f7f9fc;border:1px solid #e2e8ef;
  border-radius:12px;flex:1;display:flex;align-items:center;justify-content:center;
  min-height:200px;user-select:none;
}
#seModal .se-svg-wrap.grab-mode{cursor:grab;}
#seModal .se-svg-wrap.grab-mode:active{cursor:grabbing;}
#se3DOrbitCtrl{
  display:flex;align-items:center;justify-content:center;gap:6px;padding:4px 0;
}
#se3DOrbitCtrl .se-rot-btn{
  width:32px;height:32px;border-radius:8px;border:1px solid #d0d8e4;
  background:#f0f4f8;color:#1a2332;cursor:pointer;font-size:15px;
  display:flex;align-items:center;justify-content:center;
  transition:background 0.12s, border-color 0.12s;
  font-family:Heebo,Arial,sans-serif;
}
#se3DOrbitCtrl .se-rot-btn:hover{background:rgba(224,123,57,0.12);border-color:#e07b39;color:#e07b39;}
#se3DOrbitCtrl .se-rot-btn:active{background:rgba(224,123,57,0.25);}
#se3DOrbitCtrl .se-rot-label{font-size:9px;color:#7a93ab;font-family:Heebo,Arial;}
#seModal .se-svg-wrap svg{width:100%;height:320px;}
#seModal .se-info-col{width:200px;flex-shrink:0;display:flex;flex-direction:column;gap:10px;}
#seModal .se-stat{background:#f4f6f9;border:1px solid #e2e8ef;border-radius:8px;padding:12px 14px;}
#seModal .se-stat-label{font-size:10px;font-weight:700;color:#7a93ab;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;}
#seModal .se-stat-value{font-size:22px;font-weight:900;color:#e07b39;}
#seModal .se-stat-unit{font-size:12px;color:#7a93ab;font-weight:400;}
#seModal .se-table-wrap{flex:1;overflow-y:auto;}
#seModal .se-table{width:100%;border-collapse:collapse;}
#seModal .se-table th{
  text-align:right;font-size:10px;font-weight:700;color:#7a93ab;text-transform:uppercase;
  letter-spacing:0.5px;padding:8px 10px;border-bottom:1px solid #e2e8ef;
  background:#f4f6f9;position:sticky;top:0;
}
#seModal .se-table td{padding:7px 8px;border-bottom:1px solid #f0f3f7;color:#1a2332;}
#seModal .se-table tr:last-child td{border-bottom:none;}
#seModal .se-table tr:hover td{background:#fafbfd;}
#seModal .se-input{
  width:100%;padding:7px 10px;background:#ffffff;
  border:1.5px solid #d8e2ec;border-radius:7px;
  color:#1a2332;font-family:'Heebo',sans-serif;font-size:14px;direction:rtl;
  min-height:38px;
}
#seModal .se-input:focus{outline:none;border-color:#e07b39;background:#fffaf6;}
#seModal .se-angle-btns{display:flex;gap:4px;flex-wrap:wrap;}
#seModal .se-angle-btn{
  padding:4px 10px;border-radius:6px;border:1px solid #d8e2ec;
  background:#f4f6f9;color:#526070;cursor:pointer;
  font-family:'Heebo',sans-serif;font-size:11px;font-weight:700;
  transition:all 0.15s;-webkit-tap-highlight-color:transparent;
}
#seModal .se-angle-btn:hover{border-color:#e07b39;color:#e07b39;background:#fff6f0;}
#seModal .se-angle-btn.active{background:rgba(224,123,57,0.12);border-color:#e07b39;color:#e07b39;}
#seModal .se-seg-label{
  display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;border-radius:50%;background:#1a2332;
  color:#ffffff;font-size:11px;font-weight:700;flex-shrink:0;
}
#seModal .se-bend-row{background:#fffaf6;}
#seModal .se-table th span{font-size:9px;opacity:0.7;}
#seModal .se-add-row{
  display:flex;gap:8px;padding:10px 0 4px;
}
#seModal .se-add-btn{
  padding:7px 14px;border-radius:7px;border:1.5px dashed #c8d4e0;
  background:transparent;color:#7a93ab;cursor:pointer;font-family:'Heebo',sans-serif;
  font-size:12px;font-weight:600;transition:all 0.15s;
}
#seModal .se-add-btn:hover{border-color:#e07b39;color:#e07b39;}
#seModal .se-del-btn{
  width:28px;height:28px;border-radius:6px;border:1px solid transparent;
  background:transparent;color:#b0bece;cursor:pointer;font-size:14px;
  display:flex;align-items:center;justify-content:center;transition:all 0.15s;
}
#seModal .se-del-btn:hover{background:rgba(231,76,60,0.1);border-color:#e74c3c;color:#e74c3c;}
#seModal .se-foot{
  padding:12px 16px;border-top:1px solid #e2e8ef;
  display:flex;justify-content:flex-end;gap:10px;flex-shrink:0;background:#f9fafb;
}
#seModal .se-cancel-btn{
  padding:10px 20px;border-radius:8px;border:1px solid #d8e2ec;
  background:#ffffff;color:#526070;cursor:pointer;
  font-family:'Heebo',sans-serif;font-size:14px;font-weight:700;
}
#seModal .se-cancel-btn:hover{border-color:#b0bece;background:#f4f6f9;}
#seModal .se-save-shape-btn{
  padding:10px 18px;border-radius:8px;border:1.5px solid #3a7bd5;
  background:rgba(58,123,213,0.07);color:#3a7bd5;cursor:pointer;
  font-family:'Heebo',sans-serif;font-size:14px;font-weight:700;
  transition:all 0.15s;
}
#seModal .se-save-shape-btn:hover{background:rgba(58,123,213,0.14);border-color:#2c62b8;}
.se-saved-section-title{padding:10px 16px 6px;font-size:11px;font-weight:700;color:#3a7bd5;
  text-transform:uppercase;letter-spacing:0.5px;display:flex;align-items:center;gap:6px;}
.se-del-saved-btn{position:absolute;top:4px;left:4px;width:20px;height:20px;
  border-radius:50%;border:none;background:rgba(231,76,60,0.12);color:#e74c3c;
  cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;
  padding:0;line-height:1;opacity:0;transition:opacity 0.15s;}
.se-preset-btn:hover .se-del-saved-btn{opacity:1;}
#seModal .se-ok-btn{
  padding:10px 28px;border-radius:8px;border:none;
  background:linear-gradient(135deg,#e07b39,#f0954d);color:white;cursor:pointer;
  font-family:'Heebo',sans-serif;font-size:14px;font-weight:800;
  box-shadow:0 4px 16px rgba(224,123,57,0.3);
}
#seModal .se-ok-btn:hover{transform:translateY(-1px);}
@media(max-width:640px){
  #seModal .se-body{flex-direction:column;}
  #seModal .se-presets{width:100%;flex-direction:row;overflow-x:auto;overflow-y:hidden;border-left:none;border-bottom:1px solid #e2e8ef;padding:8px;flex-wrap:nowrap;max-height:60px;}
  #seModal .se-preset-btn{flex-shrink:0;white-space:nowrap;}
  #seModal .se-preview-row{flex-direction:column;}
  #seModal .se-info-col{width:100%;flex-direction:row;}
}
</style>
<div id="seModal">
  <!-- ── Header ── -->
  <div class="se-head">
    <div style="display:flex;align-items:center;gap:10px;">
      <button class="se-back-btn" id="seBackBtn" style="display:none;">‹ שנה צורה</button>
      <h2 id="seHeadTitle">בחר צורת כיפוף</h2>
    </div>
    <button class="se-close" id="seClose">✕</button>
  </div>

  <!-- PAGE 0: Segment count picker -->
  <div id="sePageCount" style="flex:1;overflow-y:auto;background:#f4f6f9;display:flex;align-items:center;justify-content:center;">
    <div style="text-align:center;padding:40px 20px;">
      <div style="font-size:20px;font-weight:900;color:#1a2332;margin-bottom:8px;">כמה צלעות יש לצורה?</div>
      <div style="font-size:13px;color:#7a93ab;margin-bottom:36px;">בחר ויוצגו כל הצורות המתאימות</div>
      <div id="seCountBtns" style="display:flex;flex-wrap:wrap;justify-content:center;gap:14px;max-width:700px;"></div>
    </div>
  </div>

  <!-- ── PAGE 1: Shape selection ── -->
  <div id="sePageSelect" style="display:none;flex:1;overflow-y:auto;background:#f4f6f9;">
    <div id="seSavedSection"></div>
    <div style="padding:10px 16px 6px;font-size:11px;font-weight:700;color:#7a93ab;text-transform:uppercase;letter-spacing:0.5px;" id="sePresetsTitle">פרסטים מובנים</div>
    <div id="sePresets" style="padding:0 16px 16px;display:grid;grid-template-columns:repeat(5,1fr);gap:10px;"></div>
  </div>

  <!-- ── PAGE 2: Dimension editing (hidden initially) ── -->
  <div id="sePageEdit" style="display:none;">
    <!-- Left: preview -->
    <div class="se-preview-panel">
      <!-- View toggle -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div class="se-stats-bar" id="seStatsBar">
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
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <button id="seView2D" onclick="seSetView('2d')" style="padding:5px 14px;border-radius:6px;border:1.5px solid #d8e2ec;background:#f4f6f9;color:#526070;font-family:'Heebo',sans-serif;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s">📐 2D</button>
          <button id="seView3D" onclick="seSetView('3d')" style="padding:5px 14px;border-radius:6px;border:1.5px solid #e07b39;background:rgba(224,123,57,0.1);color:#e07b39;font-family:'Heebo',sans-serif;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s">🧊 3D XYZ</button>
          <button id="seResetCam" onclick="if(window._seEditor){window._seEditor._camTheta=Math.PI/4;window._seEditor._camPhi=Math.PI/4;window._seEditor._updatePreview();}"
            style="padding:5px 9px;border-radius:6px;border:1.5px solid #d8e2ec;background:#f4f6f9;color:#7a93ab;cursor:pointer;font-size:13px;transition:all .15s" title="איפוס זווית">⟳</button>
        </div>
      </div>
      <!-- SVG preview -->
      <div class="se-svg-wrap" id="seSvgWrap">
        <svg id="seShapeSvg" viewBox="0 0 300 290" preserveAspectRatio="xMidYMid meet"></svg>
      </div>
      <!-- Orbit controls – compact single row -->
      <div id="se3DOrbitCtrl" style="flex-shrink:0;display:flex;align-items:center;gap:3px;
        padding:4px 6px;background:#f0f4f8;border-radius:8px;border:1px solid #e2e8ef;">
        <span style="font-size:10px;color:#7a93ab;font-weight:700;margin-left:2px;">סיבוב:</span>
        <button class="se-rot-btn" title="שמאלה" style="width:26px;height:26px;font-size:12px;"
          onclick="if(window._seEditor){window._seEditor._camTheta-=Math.PI/8;window._seEditor._updatePreview();}">◁</button>
        <button class="se-rot-btn" title="למעלה" style="width:26px;height:26px;font-size:12px;"
          onclick="if(window._seEditor){window._seEditor._camPhi=Math.min(Math.PI/2-0.05,window._seEditor._camPhi+Math.PI/8);window._seEditor._updatePreview();}">△</button>
        <button class="se-rot-btn" title="איפוס" style="width:26px;height:26px;font-size:12px;"
          onclick="if(window._seEditor){window._seEditor._camTheta=Math.PI/4;window._seEditor._camPhi=Math.PI/4;window._seEditor._updatePreview();}">⊙</button>
        <button class="se-rot-btn" title="למטה" style="width:26px;height:26px;font-size:12px;"
          onclick="if(window._seEditor){window._seEditor._camPhi=Math.max(-Math.PI/2+0.05,window._seEditor._camPhi-Math.PI/8);window._seEditor._updatePreview();}">▽</button>
        <button class="se-rot-btn" title="ימינה" style="width:26px;height:26px;font-size:12px;"
          onclick="if(window._seEditor){window._seEditor._camTheta+=Math.PI/8;window._seEditor._updatePreview();}">▷</button>
        <div style="width:1px;height:20px;background:#d0d8e4;margin:0 3px;"></div>
        <span style="font-size:10px;color:#7a93ab;font-weight:700;">זום:</span>
        <button class="se-rot-btn" title="הקטן" style="width:26px;height:26px;font-size:15px;font-weight:700;"
          onclick="if(window._seEditor)window._seEditor._setZoom(-0.15)">−</button>
        <span id="seZoomVal" style="font-size:10px;color:#7a93ab;min-width:32px;text-align:center;font-weight:700;">100%</span>
        <button class="se-rot-btn" title="הגדל" style="width:26px;height:26px;font-size:15px;font-weight:700;"
          onclick="if(window._seEditor)window._seEditor._setZoom(+0.15)">+</button>
        <button class="se-rot-btn" title="איפוס זום" style="width:26px;height:26px;font-size:10px;"
          onclick="if(window._seEditor)window._seEditor._setZoom(0,true)">1:1</button>
      </div>
    </div>
    <!-- Right: dimension table -->
    <div class="se-data-panel">
      <div class="se-data-panel-head">מידות צלעות וזוויות</div>
      <div class="se-table-wrap">
        <table class="se-table">
          <thead id="seTableHead">
            <tr>
              <th style="width:32px">#</th>
              <th>אורך (מ"מ)</th>
              <th>זווית כיפוף</th>
              <th style="width:32px"></th>
            </tr>
          </thead>
          <tbody id="seTableBody"></tbody>
        </table>
        <div class="se-add-row" style="padding:10px 14px 6px;">
          <button class="se-add-btn" id="seAddSide">➕ הוסף צלע</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Footer (only visible on page 2) ── -->
  <div class="se-foot" id="seFoot" style="display:none;">
    <!-- Normal footer -->
    <div id="seFootNormal" style="display:flex;width:100%;justify-content:flex-end;gap:10px;align-items:center;">
      <button class="se-cancel-btn" id="seCancel">ביטול</button>
      <button class="se-save-shape-btn" id="seSaveShapeBtn">💾 שמור צורה</button>
      <button class="se-ok-btn" id="seOk">אשר צורה ←</button>
    </div>
    <!-- Save bar (hidden by default) -->
    <div id="seFootSave" style="display:none;width:100%;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:13px;font-weight:700;color:#1a2332;font-family:Heebo,sans-serif;white-space:nowrap;">💾 שם הצורה:</span>
      <input id="seSaveNameInput" class="se-input" style="flex:1;min-width:180px;max-width:300px;"
        placeholder="לדוגמה: U-אנקר מיוחד 600מ&quot;מ"
        onkeydown="if(event.key==='Enter')window._seEditor._doSave();if(event.key==='Escape')window._seEditor._hideSaveBar();">
      <button class="se-ok-btn" onclick="window._seEditor._doSave()" style="padding:8px 22px;">שמור ✓</button>
      <button class="se-cancel-btn" onclick="window._seEditor._hideSaveBar()">ביטול</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(overlay);
    this._el = overlay;
    this._bindEvents();
  }

  _bindEvents() {
    document.getElementById('seClose').onclick         = () => this.close();
    document.getElementById('seCancel').onclick        = () => this.close();
    document.getElementById('seOk').onclick            = () => this._confirm();
    document.getElementById('seAddSide').onclick       = () => this._addSide();
    document.getElementById('seSaveShapeBtn').onclick  = () => this._showSaveBar();
    document.getElementById('seBackBtn').onclick = () => {
      if (document.getElementById('sePageEdit').style.display !== 'none') {
        this._goToSelect();
      } else {
        this._goToCount();
      }
    };
    this._el.addEventListener('click', e => { if (e.target === this._el) this.close(); });
    this._bindDragRotation();
    this._bindWheelZoom();
  }

  _goToCount() {
    document.getElementById('sePageCount').style.display  = '';
    document.getElementById('sePageSelect').style.display = 'none';
    document.getElementById('sePageEdit').style.display   = 'none';
    document.getElementById('seFoot').style.display       = 'none';
    document.getElementById('seBackBtn').style.display    = 'none';
    document.getElementById('seHeadTitle').textContent    = 'בחר צורת כיפוף';
    this._renderCountPicker();
  }

  _renderCountPicker() {
    const counts = {};
    SHAPE_PRESETS.forEach(s => {
      const n = s.sides.length;
      counts[n] = (counts[n] || 0) + 1;
    });
    const cont = document.getElementById('seCountBtns');
    cont.innerHTML = Object.entries(counts)
      .sort(([a],[b]) => Number(a)-Number(b))
      .map(([n, total]) => {
        const ex = SHAPE_PRESETS.find(s => s.sides.length == n);
        const svgStr = ex ? shape3DSVG(ex.sides, ex.angles||[], 80, 54, 8, {showAxes:false,showDims:false,dark:false}) : '';
        return '<button class="se-count-btn" data-count="'+n+'">'
          + '<svg viewBox="0 0 80 54" width="80" height="54" style="display:block;margin:0 auto">'+svgStr+'</svg>'
          + '<div class="cnt-num">'+n+'</div>'
          + '<div class="cnt-lbl">צלעות</div>'
          + '</button>';
      }).join('');
    cont.querySelectorAll('.se-count-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._selectedCount = parseInt(btn.dataset.count);
        this._goToSelect();
      });
    });
  }

  _bindWheelZoom() {
    const wrap = document.getElementById('seSvgWrap');
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._setZoom(e.deltaY < 0 ? 0.1 : -0.1);
    }, { passive: false });
  }

  _setZoom(delta, reset = false) {
    this._zoom = reset ? 1 : Math.min(4, Math.max(0.3, (this._zoom || 1) + delta));
    const svg = document.getElementById('seShapeSvg');
    if (svg) {
      svg.style.transform = `scale(${this._zoom})`;
      svg.style.transformOrigin = 'center center';
    }
    const lbl = document.getElementById('seZoomVal');
    if (lbl) lbl.textContent = Math.round(this._zoom * 100) + '%';
  }

  _goToSelect() {
    document.getElementById('sePageCount').style.display  = 'none';
    document.getElementById('sePageSelect').style.display = 'flex';
    document.getElementById('sePageSelect').style.flexDirection = 'column';
    document.getElementById('sePageEdit').style.display   = 'none';
    document.getElementById('seFoot').style.display       = 'none';
    document.getElementById('seBackBtn').style.display    = '';
    document.getElementById('seHeadTitle').textContent    = (this._selectedCount || '') + ' צלעות – בחר צורה';
    this._renderSavedShapes(this._selectedCount);
    this._renderPresets(this._selectedCount);
  }

  _goToEdit() {
    this._activeSeg = null; // clear selection when entering edit page
    document.getElementById('sePageSelect').style.display = 'none';
    document.getElementById('sePageEdit').style.display   = '';
    document.getElementById('seFoot').style.display       = '';
    document.getElementById('seBackBtn').style.display    = '';
    const name = this.current?.presetName || 'עריכת צורה';
    document.getElementById('seHeadTitle').textContent    = name;
    this._renderTable();
    this._updatePreview();
  }

  _bindDragRotation() {
    const wrap = document.getElementById('seSvgWrap');
    let drag = null; // { startX, startY, startTheta, startPhi }

    const getXY = e => e.touches
      ? [e.touches[0].clientX, e.touches[0].clientY]
      : [e.clientX, e.clientY];

    const startDrag = e => {
      if (window._seViewMode === '2d') return;
      e.preventDefault();
      const [cx, cy] = getXY(e);
      drag = { startX: cx, startY: cy, theta: this._camTheta, phi: this._camPhi };
    };

    const moveDrag = e => {
      if (!drag) return;
      // Cancel if mouse button no longer held (released outside window)
      if (!e.touches && e.buttons !== undefined && e.buttons === 0) { drag = null; return; }
      // Cancel if view was switched to 2D while dragging
      if (window._seViewMode === '2d') { drag = null; return; }
      if (e.cancelable) e.preventDefault();
      const [cx, cy] = getXY(e);
      const W = wrap.offsetWidth  || 300;
      const H = wrap.offsetHeight || 180;
      // one full width drag = 360° horizontal; one full height drag = 180° vertical
      this._camTheta = drag.theta + (cx - drag.startX) / W * Math.PI * 2;
      this._camPhi   = Math.max(-Math.PI / 2 + 0.05,
                       Math.min( Math.PI / 2 - 0.05,
                         drag.phi - (cy - drag.startY) / H * Math.PI));
      this._updatePreview();
    };

    const endDrag = () => { drag = null; };

    // Expose so seSetView can cancel active drag when switching modes
    window._seResetDrag = endDrag;

    wrap.addEventListener('mousedown',  startDrag);
    wrap.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('mousemove',  moveDrag);
    document.addEventListener('touchmove',  moveDrag, { passive: false });
    document.addEventListener('mouseup',    endDrag);
    document.addEventListener('touchend',   endDrag);
    // Also cancel if focus leaves the window (alt-tab, etc.)
    window.addEventListener('blur', endDrag);
  }

  _renderPresets(countFilter) {
    const shapes = countFilter
      ? SHAPE_PRESETS.filter(s => s.sides.length === countFilter)
      : SHAPE_PRESETS;
    const cont = document.getElementById('sePresets');
    cont.innerHTML = shapes.map(s => {
      const svgContent = s.sides && s.sides.length > 0
        ? shape3DSVG(s.sides, s.angles || [], 100, 68, 12, { showAxes: false, showDims: false, dark: false })
        : '<text x="50" y="38" text-anchor="middle" fill="#7a93ab" font-size="14">'+s.emoji+'</text>';
      return '<button class="se-preset-btn" data-id="'+s.id+'" title="'+s.name+'">'
        + '<svg viewBox="0 0 100 68" width="100" height="68" style="display:block;margin:0 auto 6px;flex-shrink:0">'+svgContent+'</svg>'
        + '<span style="font-size:12px;font-weight:700;line-height:1.3;word-break:break-word;color:inherit">'+s.name+'</span>'
        + '</button>';
    }).join('');
    cont.querySelectorAll('.se-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = SHAPE_PRESETS.find(s => s.id === btn.dataset.id);
        if (preset) this._loadPreset(preset);
      });
    });
  }

  _renderSavedShapes(countFilter) {
    const saved  = loadSavedShapes();
    const cont   = document.getElementById('seSavedSection');
    if (!cont) return;
    const list   = countFilter ? saved.filter(s => s.sides.length === countFilter) : saved;
    if (list.length === 0) { cont.innerHTML = ''; return; }

    const cardsHtml = list.map(s => {
      const svgStr = shape3DSVG(s.sides, s.angles || [], 100, 68, 12, { showAxes: false, showDims: false, dark: false });
      return `<button class="se-preset-btn" data-saved-id="${s.id}" title="${s.name}" style="position:relative;">
        <svg viewBox="0 0 100 68" width="100" height="68" style="display:block;margin:0 auto 6px;flex-shrink:0">${svgStr}</svg>
        <span style="font-size:12px;font-weight:700;line-height:1.3;word-break:break-word;color:inherit">${s.name}</span>
        <button class="se-del-saved-btn" data-del-id="${s.id}" title="מחק צורה">✕</button>
      </button>`;
    }).join('');

    cont.innerHTML = `
      <div style="padding:10px 16px 4px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #dde4ed;">
        <span style="font-size:11px;font-weight:800;color:#3a7bd5;text-transform:uppercase;letter-spacing:0.5px;">⭐ צורות שמורות שלי</span>
        <span style="font-size:10px;color:#aab8c8;margin-right:auto;">${list.length} צורות</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:10px 16px 14px;">${cardsHtml}</div>
      <div style="height:1px;background:#dde4ed;margin:0 16px 8px;"></div>`;

    cont.querySelectorAll('[data-saved-id]').forEach(btn => {
      btn.addEventListener('click', e => {
        if (e.target.closest('.se-del-saved-btn')) return;
        const shape = loadSavedShapes().find(s => s.id === btn.dataset.savedId);
        if (shape) this._loadSavedShape(shape);
      });
    });
    cont.querySelectorAll('.se-del-saved-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm('למחוק את הצורה הזו?')) return;
        deleteSavedShape(btn.dataset.delId);
        this._renderSavedShapes(countFilter);
      });
    });
  }

  _loadSavedShape(saved) {
    const n = saved.sides.length;
    this.current = {
      presetId:    saved.id,
      presetName:  saved.name,
      presetEmoji: '⭐',
      sides:       [...saved.sides],
      angles:      [...saved.angles],
      azAngles:    saved.azAngles ? [...saved.azAngles] : Array(n).fill(0),
      elAngles:    saved.elAngles ? [...saved.elAngles] : Array(n).fill(0),
    };
    this._goToEdit();
  }

  _showSaveBar() {
    document.getElementById('seFootNormal').style.display = 'none';
    const bar = document.getElementById('seFootSave');
    bar.style.display = 'flex';
    const inp = document.getElementById('seSaveNameInput');
    if (inp) { inp.value = this.current?.presetName || ''; setTimeout(() => { inp.focus(); inp.select(); }, 60); }
  }

  _hideSaveBar() {
    document.getElementById('seFootSave').style.display   = 'none';
    document.getElementById('seFootNormal').style.display = 'flex';
  }

  _doSave() {
    if (!this.current) return;
    const inp  = document.getElementById('seSaveNameInput');
    const name = (inp?.value || '').trim() || this.current.presetName || 'צורה מותאמת';
    persistSavedShape(this.current, name);
    this._hideSaveBar();
    this._showToast('✅ "' + name + '" נשמרה בהצלחה');
  }

  _showToast(msg) {
    let t = document.getElementById('seToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'seToast';
      t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);'
        + 'background:#1a2332;color:#fff;padding:11px 22px;border-radius:10px;'
        + 'font-family:Heebo,sans-serif;font-size:14px;font-weight:700;z-index:600;'
        + 'opacity:0;transition:opacity 0.25s;pointer-events:none;white-space:nowrap;'
        + 'box-shadow:0 4px 20px rgba(0,0,0,0.35);';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2800);
  }

  _loadPreset(preset) {
    const n = preset.sides.length;
    this.current = {
      presetId:    preset.id,
      presetName:  preset.name,
      presetEmoji: preset.emoji,
      sides:       [...preset.sides],
      angles:      [...preset.angles],
      azAngles:    [0, ...preset.angles.map(a => -(180 - (a ?? 180)))].slice(0, n),
      elAngles:    Array(n).fill(0),
    };
    // pad azAngles if needed
    while (this.current.azAngles.length < n) this.current.azAngles.push(0);
    document.querySelectorAll('.se-preset-btn').forEach(b => b.classList.toggle('active', b.dataset.id === preset.id));
    this._goToEdit();
  }

  _renderTable() {
    if (!this.current) return;
    const { sides, angles, azAngles, elAngles } = this.current;
    const is3D = window._seViewMode !== '2d';

    // ── Update column headers ──────────────────────────────────
    const thead = document.getElementById('seTableHead');
    if (thead) {
      if (is3D) {
        thead.innerHTML = `<tr>
          <th style="width:28px">#</th>
          <th style="min-width:90px">אורך (מ"מ)</th>
          <th>פנייה (°) <span style="font-weight:400;color:#526070">ביחס לצלע הקודמת</span></th>
          <th>הטיית Z (°) <span style="font-weight:400;color:#526070">זווית אנכית</span></th>
          <th style="width:28px"></th>
        </tr>`;
      } else {
        thead.innerHTML = `<tr>
          <th style="width:32px">#</th>
          <th>אורך צלע (מ"מ)</th>
          <th>זווית כיפוף</th>
          <th style="width:32px"></th>
        </tr>`;
      }
    }

    // ── Build rows ─────────────────────────────────────────────
    let html = '';
    for (let i = 0; i < sides.length; i++) {
      if (is3D) {
        const az = azAngles?.[i] ?? 0;
        const el = elAngles?.[i] ?? 0;
        html += `
          <tr>
            <td><span class="se-seg-label">${i + 1}</span></td>
            <td><input class="se-input" type="number" min="1" max="20000" value="${sides[i]}"
              data-side="${i}" oninput="window._seEditor._setSide(${i}, this.value)"></td>
            <td>
              ${i === 0
                ? `<span style="font-size:11px;color:#aab8c8;padding:0 4px;">—</span>`
                : `<input class="se-input" type="number" min="-360" max="360" value="${az}" style="width:68px"
                    data-az="${i}" oninput="window._seEditor._setAzAngle(${i}, this.value)">`}
            </td>
            <td>
              <input class="se-input" type="number" min="-90" max="90" value="${el}" style="width:68px"
                data-el="${i}" oninput="window._seEditor._setElAngle(${i}, this.value)">
            </td>
            <td>${sides.length > 1 ? `<button class="se-del-btn" onclick="window._seEditor._deleteSide(${i})">✕</button>` : ''}</td>
          </tr>`;
      } else {
        // ── 2D mode (classic) ──────────────────────────────────
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
    // ── Sync to azAngles (so 3D view stays consistent) ─────────────────
    // azAngles[i+1] = -(180 - angles[i])
    if (this.current.azAngles && i + 1 < this.current.azAngles.length) {
      this.current.azAngles[i + 1] = -(180 - a);
    }
    // update active btn
    const row = document.querySelector(`[data-angle="${i}"]`)?.closest('tr');
    row?.querySelectorAll('.se-angle-btn').forEach(b => b.classList.toggle('active', Number(b.textContent) === a));
    this._updatePreview();
  }

  _setAzAngle(i, val) {
    if (!this.current) return;
    if (i === 0) return; // first segment has no turn — always 0
    const az = Math.min(360, Math.max(-360, Math.round(Number(val) || 0)));
    if (!this.current.azAngles) this.current.azAngles = Array(this.current.sides.length).fill(0);
    this.current.azAngles[i] = az;
    // ── Sync back to 2D angles (machine data) ──────────────────────────
    // Inverse of: azAngles[i] = -(180 - angles[i-1])
    //             angles[i-1] = 180 + azAngles[i]
    // Clamp to valid 2D range [1, 179]; angles outside this range mean
    // a purely-3D direction change with no classic 2D equivalent.
    const ang2d = 180 + az;
    if (i - 1 >= 0 && i - 1 < this.current.angles.length) {
      if (ang2d >= 1 && ang2d <= 179) {
        this.current.angles[i - 1] = ang2d;
      }
      // If outside range (e.g. "שמאל" +90 → ang2d=270), keep existing 2D angle
      // but flag the shape as 3D so the machine operator knows to check.
    }
    // sync input field
    const inp = document.querySelector(`[data-az="${i}"]`);
    if (inp) inp.value = az;
    // update quick-select buttons (match by value)
    document.querySelectorAll(`[data-az-btn^="${i}_"]`).forEach(b => {
      const bVal = Number(b.dataset.azBtn.split('_')[1]);
      b.classList.toggle('active', bVal === az);
    });
    this._updatePreview();
  }

  // Convert flat 2D bend angles → azAngles for 3D renderer.
  // In 2D: dir -= (180 - angles[i]) at each bend.
  // In 3D cumAz: azAngles[segment] = direction change ADDED before drawing that segment.
  // Result: azAngles[0]=0, azAngles[i] = -(180 - angles[i-1])  for i≥1
  _init3DAnglesFrom2D() {
    const { sides, angles } = this.current;
    const n = sides.length;
    const az = [0];
    for (let i = 0; i < angles.length && az.length < n; i++) {
      az.push(-(180 - (angles[i] ?? 180)));
    }
    while (az.length < n) az.push(0);
    this.current.azAngles = az;
    if (!this.current.elAngles) this.current.elAngles = Array(n).fill(0);
    this._renderTable(); // refresh angle buttons to show new azAngles
  }

  _setElAngle(i, val) {
    if (!this.current) return;
    const el = Math.min(90, Math.max(-90, Math.round(Number(val) || 0)));
    if (!this.current.elAngles) this.current.elAngles = Array(this.current.sides.length).fill(0);

    // First time setting any Z tilt: auto-initialize azAngles from 2D bend angles
    // so the shape doesn't collapse into a straight line.
    if (el !== 0 && this.current.azAngles?.every(a => a === 0) && this.current.angles?.length > 0) {
      this._init3DAnglesFrom2D();
    }

    this.current.elAngles[i] = el;
    const inp = document.querySelector(`[data-el="${i}"]`);
    if (inp) inp.value = el;
    document.querySelectorAll(`[data-el-btn^="${i}_"]`).forEach(b => {
      const bVal = Number(b.dataset.elBtn.split('_')[1]);
      b.classList.toggle('active', bVal === el);
    });
    this._updatePreview();
  }

  _addSide() {
    if (!this.current) return;
    this.current.sides.push(300);
    if (this.current.sides.length > 1) this.current.angles.push(90);
    // 3D arrays — new segment starts going straight (azAngle=0 = continue forward)
    const n = this.current.sides.length - 1;
    if (!this.current.azAngles) this.current.azAngles = Array(n).fill(0);
    if (!this.current.elAngles) this.current.elAngles = Array(n).fill(0);
    this.current.azAngles.push(0);  // straight ahead relative to previous
    this.current.elAngles.push(0);
    this._renderTable();
    this._updatePreview();
  }

  _deleteSide(i) {
    if (!this.current || this.current.sides.length <= 1) return;
    this.current.sides.splice(i, 1);
    if (i < this.current.angles.length) this.current.angles.splice(i, 1);
    else if (this.current.angles.length > 0) this.current.angles.pop();
    // keep 3D arrays in sync
    if (this.current.azAngles) this.current.azAngles.splice(i, 1);
    if (this.current.elAngles) this.current.elAngles.splice(i, 1);
    this._renderTable();
    this._updatePreview();
  }

  _bindSvgClicks(svg) {
    svg.querySelectorAll('[data-seg-click]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this._focusRow(parseInt(el.dataset.segClick), false);
      });
    });
    svg.querySelectorAll('[data-ang-click]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this._focusRow(parseInt(el.dataset.angClick), true);
      });
    });
  }

  _focusRow(i, focusAngle) {
    // Highlight segment in SVG
    this._activeSeg = i;
    this._updatePreview();

    const allRows = [...document.querySelectorAll('#seTableBody tr')];
    allRows.forEach(r => r.classList.remove('se-row-active'));
    const is3D = window._seViewMode !== '2d';
    let row;
    if (is3D) {
      row = allRows[i];
    } else {
      const segRows = allRows.filter(r => !r.classList.contains('se-bend-row'));
      row = segRows[i];
    }
    if (row) {
      row.classList.add('se-row-active');
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const sel = focusAngle ? '[data-angle],[data-az]' : '[data-side]';
      const inp = row.querySelector(sel);
      if (inp) { setTimeout(() => { inp.focus(); inp.select(); }, 50); }
    }
  }

  _updatePreview() {
    if (!this.current) return;
    const { sides, angles } = this.current;
    const svg = document.getElementById('seShapeSvg');
    const is3D = window._seViewMode !== '2d';

    if (is3D) {
      const diam = this._diameter || 12;
      const { azAngles, elAngles } = this.current;
      const has3D = (azAngles && azAngles.some(a => a !== 0)) ||
                    (elAngles && elAngles.some(a => a !== 0));

      // If elAngles are set but azAngles are still all-zero, derive azAngles from 2D angles
      // so the shape keeps its correct XY geometry when Z-tilt is added.
      let effectiveAzAngles = azAngles;
      if (has3D && (!azAngles || azAngles.every(a => a === 0)) && angles.length > 0) {
        effectiveAzAngles = [0, ...angles.map(a => -(180 - a))];
        while (effectiveAzAngles.length < sides.length) effectiveAzAngles.push(0);
      }

      svg.innerHTML = shape3DSVG(sides, angles, 300, 260, diam, {
        showAxes: true, showDims: true, dark: false,
        camTheta:  this._camTheta,
        camPhi:    this._camPhi,
        azAngles:  has3D ? (effectiveAzAngles || Array(sides.length).fill(0)) : null,
        elAngles:  has3D ? (elAngles || []) : [],
        activeSeg: this._activeSeg ?? -1,
      });
      this._bindSvgClicks(svg);
    } else {
      svg.innerHTML = '';
      const { path, pts } = shapeSVGPath(sides, angles, 300, 260, 38);
      const _activeSeg2d = this._activeSeg ?? -1;
      const BAR_PX = Math.max(4, Math.min((this._diameter||12)*0.55, 14));
      const SEG_GRAY = '#3d5e78'; // dark steel-blue — visible on the light editor background

      // Detect overlapping segments in 2D — same logic as 3D view for consistency.
      const offsets2d = computeSegOffsets(pts, BAR_PX);
      const hasOvlp2d = offsets2d.some(o => o !== 0);

      // Compute per-vertex screen offset (weighted average of adjacent segment offsets)
      const ptOff2d = pts.map((_, i) => {
        let sum = 0, cnt = 0;
        if (i > 0 && offsets2d[i - 1] !== 0) { sum += offsets2d[i - 1]; cnt++; }
        if (i < offsets2d.length && offsets2d[i] !== 0) { sum += offsets2d[i]; cnt++; }
        if (cnt === 0) return [0, 0];
        const off = sum / cnt;
        return [OVLP_DX * off, OVLP_DY * off];
      });

      // Build offset segments (used for body rendering, labels & arrows)
      const segs = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1,y1] = pts[i], [x2,y2] = pts[i+1];
        const dx = x2-x1, dy = y2-y1, len = Math.sqrt(dx*dx+dy*dy)||1;
        const nx = -dy/len, ny = dx/len;
        const [ox1,oy1] = ptOff2d[i];
        const [ox2,oy2] = ptOff2d[i + 1];
        segs.push({
          x1: x1 + ox1, y1: y1 + oy1,
          x2: x2 + ox2, y2: y2 + oy2,
          nx, ny
        });
      }

      // Arrow marker helper
      const arrowHead = (x1,y1,x2,y2,color,size=7) => {
        const dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy)||1;
        const ux=dx/len,uy=dy/len,px=-uy,py=ux;
        const tip=[x2,y2];
        const b1=[x2-ux*size+px*size*0.45, y2-uy*size+py*size*0.45];
        const b2=[x2-ux*size-px*size*0.45, y2-uy*size-py*size*0.45];
        return `<polygon points="${tip[0].toFixed(1)},${tip[1].toFixed(1)} ${b1[0].toFixed(1)},${b1[1].toFixed(1)} ${b2[0].toFixed(1)},${b2[1].toFixed(1)}" fill="${color}" opacity="0.85"/>`;
      };

      let html = '';

      // ── Bar body — always drawn from segs (which incorporate any overlap offset) ──
      {
        // Build connected polyline from offset vertices
        const ptStr2 = [
          `${segs[0].x1.toFixed(1)},${segs[0].y1.toFixed(1)}`,
          ...segs.map(s => `${s.x2.toFixed(1)},${s.y2.toFixed(1)}`)
        ].join(' ');
        html += `<polyline points="${ptStr2}" stroke="${SEG_GRAY}" stroke-width="4"
          stroke-linejoin="round" stroke-linecap="round" fill="none"/>`;
        // Active segment overlay
        if (_activeSeg2d >= 0 && _activeSeg2d < segs.length) {
          const s = segs[_activeSeg2d];
          html += `<path d="M ${s.x1.toFixed(1)},${s.y1.toFixed(1)} L ${s.x2.toFixed(1)},${s.y2.toFixed(1)}"
            stroke="rgba(41,121,255,0.18)" stroke-width="16" fill="none" stroke-linecap="round"/>`;
          html += `<path d="M ${s.x1.toFixed(1)},${s.y1.toFixed(1)} L ${s.x2.toFixed(1)},${s.y2.toFixed(1)}"
            stroke="#2979ff" stroke-width="4" fill="none" stroke-linecap="round"
            data-seg-click="${_activeSeg2d}" style="cursor:pointer"/>`;
        }
      }

      // Start dot
      if (segs.length > 0)
        html += `<circle cx="${segs[0].x1.toFixed(1)}" cy="${segs[0].y1.toFixed(1)}" r="4"
          fill="#526070" stroke="white" stroke-width="1.5"/>`;

      // Invisible wide click areas (one per segment, sits over the polyline)
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        html += `<path d="M ${s.x1.toFixed(1)},${s.y1.toFixed(1)} L ${s.x2.toFixed(1)},${s.y2.toFixed(1)}"
          stroke="transparent" stroke-width="14" fill="none"
          data-seg-click="${i}" style="cursor:pointer"/>`;
      }

      // Labels — letter badge + dimension
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const isAct = i === _activeSeg2d;
        const col = isAct ? '#2979ff' : '#526070';
        const mx=(s.x1+s.x2)/2, my=(s.y1+s.y2)/2;
        const lx=mx+s.nx*24, ly=my+s.ny*24;
        const letter = String.fromCharCode(0x05D0 + i);
        html += `<circle cx="${lx.toFixed(1)}" cy="${(ly-12).toFixed(1)}" r="11"
            fill="${col}" stroke="white" stroke-width="1.5" data-seg-click="${i}" style="cursor:pointer"/>
          <text x="${lx.toFixed(1)}" y="${(ly-7.5).toFixed(1)}" text-anchor="middle" font-size="11"
            font-family="Heebo,Arial" font-weight="900" fill="white" data-seg-click="${i}" style="cursor:pointer">${letter}</text>
          <rect x="${(lx-17).toFixed(1)}" y="${(ly+1).toFixed(1)}" width="34" height="13" rx="3"
            fill="rgba(26,35,50,0.85)" stroke="${col}" stroke-width="1" data-seg-click="${i}" style="cursor:pointer"/>
          <text x="${lx.toFixed(1)}" y="${(ly+11).toFixed(1)}" text-anchor="middle" font-size="9"
            font-family="Heebo,Arial" font-weight="700" fill="#e8edf3" data-seg-click="${i}" style="cursor:pointer">${sides[i]}</text>`;
      }

      // Angle dots at bends — use segs endpoints so dots align with the offset polyline
      if (segs.length > 1) {
        for (let i = 0; i < segs.length - 1; i++) {
          // The bend between seg[i] and seg[i+1] is at segs[i].x2/y2
          const bx = segs[i].x2, by = segs[i].y2;
          if (angles[i] !== undefined && angles[i] !== 180) {
            html += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="12"
                fill="rgba(201,98,26,0.90)" stroke="white" stroke-width="1.5"
                data-ang-click="${i}" style="cursor:pointer"/>
              <text x="${bx.toFixed(1)}" y="${(by+4.5).toFixed(1)}" text-anchor="middle" font-size="9"
                font-family="Heebo,Arial" font-weight="700" fill="white"
                data-ang-click="${i}" style="cursor:pointer">${angles[i]}°</text>`;
          }
        }
      }

      svg.innerHTML = html;
      this._bindSvgClicks(svg);
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
    // Sync orbit controls and cursor to current view mode on open
    const orbitCtrl = document.getElementById('se3DOrbitCtrl');
    const svgWrap   = document.getElementById('seSvgWrap');
    const is3D = window._seViewMode !== '2d';
    if (orbitCtrl) orbitCtrl.style.display = is3D ? 'flex' : 'none';
    if (svgWrap)   svgWrap.classList.toggle('grab-mode', is3D);
    if (existingData?.sides?.length) {
      const n = existingData.sides.length;
      // Derive azAngles from 2D bend angles when not saved with the shape.
      // Formula: azAngles[i] = -(180 - angles[i-1])  (same as _init3DAnglesFrom2D)
      // This ensures the 3D table shows the correct turn for each segment,
      // matching the actual bend angles that go to the machine.
      let initAz;
      if (existingData.azAngles?.length === n) {
        initAz = [...existingData.azAngles];
      } else {
        initAz = [0, ...(existingData.angles || []).map(a => -(180 - (a ?? 180)))];
        while (initAz.length < n) initAz.push(0);
        initAz = initAz.slice(0, n);
      }
      this.current = {
        ...existingData,
        azAngles: initAz,
        elAngles: existingData.elAngles?.length === n
          ? [...existingData.elAngles]
          : Array(n).fill(0),
      };
      document.querySelectorAll('.se-preset-btn').forEach(b => b.classList.toggle('active', b.dataset.id === existingData.presetId));
      this._goToEdit();
    } else {
      // No existing shape — start from count picker
      this._goToCount();
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
  // Cancel any active drag when switching modes
  if (window._seResetDrag) window._seResetDrag();
  const btn2d = document.getElementById('seView2D');
  const btn3d = document.getElementById('seView3D');
  if (btn2d && btn3d) {
    const base  = 'padding:5px 14px;border-radius:6px;font-family:Heebo,sans-serif;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s;';
    const active = base + 'border:1.5px solid #e07b39;background:rgba(224,123,57,0.1);color:#e07b39;box-shadow:0 0 0 2px rgba(224,123,57,0.2);';
    const idle   = base + 'border:1.5px solid #d8e2ec;background:#f4f6f9;color:#526070;box-shadow:none;';
    btn2d.style.cssText = (mode === '2d' ? active : idle);
    btn3d.style.cssText = (mode === '3d' ? active : idle);
    btn2d.textContent = '📐 2D';
    btn3d.textContent = '🧊 3D XYZ';
  }
  // Show/hide orbit controls and grab cursor based on mode
  const orbitCtrl = document.getElementById('se3DOrbitCtrl');
  const svgWrap   = document.getElementById('seSvgWrap');
  if (orbitCtrl) orbitCtrl.style.display = (mode === '3d') ? 'flex' : 'none';
  if (svgWrap)   svgWrap.classList.toggle('grab-mode', mode === '3d');

  if (window._seEditor) {
    window._seEditor._renderTable();
    window._seEditor._updatePreview();
  }
};
