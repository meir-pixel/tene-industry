// ── REBAR WEIGHTS ─────────────────────────────────────────────────
function sharedKgPerMeter(diameter) {
  if (window.IronBendRebar?.kgPerMeter) return window.IronBendRebar.kgPerMeter(diameter);
  const d = Number(diameter);
  return Number.isFinite(d) && d > 0 ? d * d * 0.00617 : 0;
}

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
  { id: 's1',  name: 'מוט ישר',           family: 'bars', category: 'פיגורה', icon: 'straight', bends: 0, sides: [1000],                         angles: [],                    emoji: '➖' },
  { id: 's2',  name: 'צורה 2',     family: 'bars', category: 'פיגורה', icon: 'l', bends: 1, sides: [500, 200],                     angles: [90],                  emoji: '⌐' },
  { id: 's3',  name: 'צורה 3',      family: 'bars', category: 'פיגורה', icon: 'u', bends: 2, sides: [300, 600, 300],                angles: [90, 90],              emoji: '∪' },
  { id: 's4',  name: 'צורה 4',      family: 'bars', category: 'פיגורה', icon: 'z', bends: 2, sides: [300, 400, 300],                angles: [135, 135],            emoji: 'Z' },
  { id: 's5',  name: 'צורה 5',      family: 'bars', category: 'פיגורה', icon: 's', bends: 3, sides: [200, 300, 300, 200],           angles: [135, 135, 135],       emoji: 'S' },
  { id: 's6',  name: 'צורה 6',  family: 'bars', category: 'קלמרה', icon: 'hook', bends: 3, sides: [200, 400, 400, 200],           angles: [90, 180, 90],         emoji: '⌡' },
  { id: 's7',  name: 'צורה 7',   family: 'bars', category: 'ציפורים', icon: 'open-u', bends: 3, sides: [200, 500, 500, 200],           angles: [90, 90, 90],          emoji: '┓' },
  { id: 's8',  name: 'צורה 8',  family: 'bars', category: 'חישוק', icon: 'stirrup', bends: 4, sides: [400, 200, 400, 200],           angles: [90, 90, 90, 90],      emoji: '▢' },
  { id: 's9',  name: 'צורה 9', family: 'bars', category: 'חישוק', icon: 'stirrup-square', bends: 4, sides: [300, 300, 300, 300],           angles: [90, 90, 90, 90],      emoji: '▣' },
  { id: 's10', name: 'צורה 10', family: 'bars', category: 'משקפיים', icon: 'multi', bends: 5, sides: [150, 200, 400, 200, 400, 150], angles: [90, 90, 90, 90, 90], emoji: '⌂' },
  { id: 's11', name: 'צורה 11',  family: 'bars', category: 'משקפיים', icon: 'polygon', bends: 6, sides: [150, 150, 400, 150, 400, 150, 150], angles: [90,90,90,90,90,90], emoji: '⬡' },
  { id: 's13', name: 'צורה 12', family: 'bars', category: 'פיגורה', icon: 'w', bends: 4, sides: [200, 300, 300, 300, 200], angles: [135, 90, 90, 135], emoji: 'W' },
  { id: 's14', name: 'צורה 13',    family: 'bars', category: 'פיגורה', icon: 'c', bends: 4, sides: [300, 200, 400, 200, 300], angles: [90, 90, 90, 90],   emoji: 'C' },
  { id: 'mesh1', name: 'רשת', family: 'mesh', icon: 'mesh', bends: 0, sides: [600, 250], angles: [], emoji: '#', specialty: 'mesh' },
  { id: 'pile1', name: 'כלונס', family: 'piles', icon: 'pile', bends: 0, sides: [1620], angles: [], emoji: '◎', specialty: 'pile' },
  { id: 's12', name: 'צורה מותאמת',  family: 'bars', icon: 'custom', bends: 0, sides: [500],                          angles: [],                    emoji: '✏️', custom: true },
];

const SHAPE_FAMILIES = [
  { id: 'bars', label: 'מוטות' },
  { id: 'mesh', label: 'רשת' },
  { id: 'piles', label: 'כלונסאות' },
];

const SHAPE_CATEGORY_FILTERS = ['הכל', 'חישוק', 'פיגורה', 'ספירלים', 'ציפורים', 'משקפיים', 'קלמרה'];
const SHAPE_SIDE_FILTERS = ['הכל', 1, 2, 3, 4, 5, 6, 7, 8];

function shapePresetIconSVG(kind) {
  const stroke = 'stroke="currentColor" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"';
  const thin = 'stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".92"';
  const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="4.2" fill="currentColor"/>`;
  const icons = {
    straight: `<path ${stroke} d="M18 50 H82"/>`,
    l: `<path ${stroke} d="M30 20 V68 H76"/>`,
    u: `<path ${stroke} d="M24 20 V72 H76 V20"/>`,
    z: `<path ${stroke} d="M22 24 H74 L28 72 H78"/>`,
    s: `<path ${stroke} d="M74 22 H34 C18 22 18 45 35 45 H65 C82 45 82 72 62 72 H24"/>`,
    hook: `<path ${stroke} d="M22 20 V70 H68 C82 70 82 48 68 48"/>`,
    'open-u': `<path ${stroke} d="M24 22 V72 H78 V44"/>`,
    stirrup: `<rect x="22" y="18" width="56" height="58" rx="3" ${stroke}/><path ${thin} d="M61 34 H78 V51"/>`,
    'stirrup-square': `<rect x="24" y="24" width="52" height="52" rx="3" ${stroke}/><path ${thin} d="M58 38 H76 V55"/>`,
    multi: `<path ${stroke} d="M17 66 H35 V35 H56 V66 H80"/>`,
    polygon: `<path ${stroke} d="M50 16 L78 32 V66 L50 82 L22 66 V32 Z"/>`,
    w: `<path ${stroke} d="M16 25 L31 74 L50 38 L69 74 L84 25"/>`,
    c: `<path ${stroke} d="M77 24 H31 V74 H77"/>`,
    mesh: `<path ${thin} d="M20 24 H82 M20 40 H82 M20 56 H82 M20 72 H82 M28 16 V80 M44 16 V80 M60 16 V80 M76 16 V80"/>`,
    pile: `<circle cx="50" cy="50" r="30" ${thin}/><circle cx="50" cy="50" r="21" ${thin} opacity=".45"/>${dot(50, 20)}${dot(71, 29)}${dot(80, 50)}${dot(71, 71)}${dot(50, 80)}${dot(29, 71)}${dot(20, 50)}${dot(29, 29)}`,
    custom: `<path ${stroke} d="M24 70 L34 50 L62 22 L78 38 L50 66 Z"/><path ${thin} d="M58 26 L74 42"/>`,
  };
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${icons[kind] || icons.straight}</svg>`;
}

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

const COUNT_PICKER_NAMES = {
  1: 'קו ישר',
  2: 'צורת L',
  3: 'צורת ח',
  4: 'ריבוע / מלבן',
  5: 'מחומש',
  6: 'משושה',
  7: 'שבע צלעות',
  8: 'שמונה צלעות'
};

function countPickerShapeSVG(count) {
  const n = Number(count);
  const style = 'fill:none;stroke:#0c567a;stroke-width:9;stroke-linecap:round;stroke-linejoin:round';
  const guide = 'fill:none;stroke:#d9e5ee;stroke-width:2;stroke-dasharray:4 5';
  const dot = p => `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="#22a85a"/>`;
  const path = pts => `<path d="${pts.map((p,i)=>(i?'L':'M')+p[0]+' '+p[1]).join(' ')}" style="${style}"/>` + pts.map(dot).join('');

  if (n === 1) return `<svg viewBox="0 0 112 80" aria-label="קו ישר">${path([[22,40],[90,40]])}</svg>`;
  if (n === 2) return `<svg viewBox="0 0 112 80" aria-label="צורת L">${path([[26,22],[26,58],[84,58]])}</svg>`;
  if (n === 3) return `<svg viewBox="0 0 112 80" aria-label="צורת ח">${path([[24,18],[24,58],[88,58],[88,18]])}</svg>`;
  if (n === 4) return `<svg viewBox="0 0 112 80" aria-label="ריבוע"><rect x="27" y="16" width="58" height="48" rx="3" style="${style}"/><rect x="27" y="16" width="58" height="48" rx="3" style="${guide}"/></svg>`;

  const sides = Math.max(5, n);
  const r = sides <= 6 ? 27 : 29;
  const cx = 56, cy = 40;
  const pts = Array.from({ length:sides }, (_, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / sides;
    return [Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))];
  });
  return `<svg viewBox="0 0 112 80" aria-label="${COUNT_PICKER_NAMES[n] || `${n} צלעות`}">${path([...pts, pts[0]])}</svg>`;
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
  const showBends = opts.showBends !== false && w >= 180;
  const compactLabels = opts.compactLabels !== false;
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
  const axPad = showAxes ? 28 : 0;
  const pad   = compactLabels ? 28 : 22 + (showDims ? 32 : 0);
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
  if (showBends) {
    for (let i = 1; i < mapped.length - 1; i++) {
      const [bx, by] = mapped[i];
      const angle = angles[i - 1];
      if (angle !== undefined && angle !== 180) {
        bendLabels += `
          <g opacity="0.92">
          <rect x="${(bx - 16).toFixed(1)}" y="${(by - barW/2 - 24).toFixed(1)}" width="32" height="20" rx="6"
            fill="#ffffff" stroke="#d47a35" stroke-width="1.2" data-ang-click="${i-1}" style="cursor:pointer"/>
          <text x="${bx.toFixed(1)}" y="${(by - barW/2 - 10).toFixed(1)}" text-anchor="middle" font-size="10"
            font-family="Heebo,Arial" font-weight="800" fill="#c9621a"
            data-ang-click="${i-1}" style="cursor:pointer">${angle}°</text>`;
          bendLabels += `</g>`;
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
      const nx = -dy / len * (compactLabels ? 15 : 22), ny = dx / len * (compactLabels ? 15 : 22);
      const letter = String.fromCharCode(0x05D0 + i); // א ב ג...
      const isActSeg = i === activeSeg;
      const badgeCol = isActSeg ? '#2979ff' : '#526070';
      const labelW = Math.max(34, Math.min(54, String(sides[i]).length * 8 + 14));
      dimLabels += `
        <g data-seg-click="${i}" style="cursor:pointer">
          <rect x="${(mx + nx - labelW / 2).toFixed(1)}" y="${(my + ny - 10).toFixed(1)}" width="${labelW}" height="22"
            rx="6" fill="${dark ? 'rgba(26,38,55,0.9)' : 'rgba(255,255,255,0.96)'}" stroke="${badgeCol}" stroke-width="${isActSeg ? 1.8 : 1}"/>
          <text x="${(mx + nx).toFixed(1)}" y="${(my + ny + 5).toFixed(1)}" text-anchor="middle"
            font-size="10" font-family="Heebo,Arial" font-weight="800" fill="${labelClr}">${sides[i]}</text>
          ${compactLabels ? '' : `<circle cx="${(mx + nx + labelW / 2 - 4).toFixed(1)}" cy="${(my + ny - 10).toFixed(1)}" r="8" fill="${badgeCol}"/>
          <text x="${(mx + nx + labelW / 2 - 4).toFixed(1)}" y="${(my + ny - 6.5).toFixed(1)}" text-anchor="middle"
            font-size="8" font-family="Heebo,Arial" font-weight="900" fill="white">${letter}</text>`}
        </g>`;
    }
  }

  // ── XYZ Axis indicator (bottom-right corner) ──────────────────
  let axisHTML = '';
  if (showAxes) {
    const ax = w - 34, ay = h - 18;
    const axLen = 18;
    // Project world X/Y/Z axes through the current camera
    const xEnd = [ax + axLen * cosT,              ay + axLen * sinT * sinP];
    const yEnd = [ax - axLen * sinT,              ay + axLen * cosT * sinP];
    const zEnd = [ax,                             ay - axLen * cosP];

    axisHTML = `
      <!-- XYZ Axes -->
      <line x1="${ax}" y1="${ay}" x2="${xEnd[0].toFixed(1)}" y2="${xEnd[1].toFixed(1)}"
        stroke="#e05050" stroke-width="2" stroke-linecap="round"/>
      <text x="${(xEnd[0]+4).toFixed(1)}" y="${(xEnd[1]+4).toFixed(1)}"
        font-size="8" font-family="Heebo,Arial" font-weight="800" fill="#e05050">X</text>
      <line x1="${ax}" y1="${ay}" x2="${yEnd[0].toFixed(1)}" y2="${yEnd[1].toFixed(1)}"
        stroke="#22b844" stroke-width="2" stroke-linecap="round"/>
      <text x="${(yEnd[0]-12).toFixed(1)}" y="${(yEnd[1]+4).toFixed(1)}"
        font-size="8" font-family="Heebo,Arial" font-weight="800" fill="#22b844">Y</text>
      <line x1="${ax}" y1="${ay}" x2="${zEnd[0].toFixed(1)}" y2="${zEnd[1].toFixed(1)}"
        stroke="#3a7bd5" stroke-width="2" stroke-linecap="round"/>
      <text x="${(zEnd[0]+3).toFixed(1)}" y="${(zEnd[1]-4).toFixed(1)}"
        font-size="8" font-family="Heebo,Arial" font-weight="800" fill="#3a7bd5">Z</text>
      <circle cx="${ax}" cy="${ay}" r="3" fill="${mutedClr}"/>`;
  }

  const dragHint = opts.dragHint === true && opts.camTheta != null
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
    is3d:     shapeData.is3d ? 1 : 0,
    azAngles: shapeData.is3d && shapeData.azAngles ? [...shapeData.azAngles] : null,
    elAngles: shapeData.is3d && shapeData.elAngles ? [...shapeData.elAngles] : null,
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
  const kgPerM = sharedKgPerMeter(diameter);
  const totalMm = (sides || []).reduce((s, l) => s + Number(l || 0), 0);
  return (totalMm / 1000) * kgPerM * (qty || 1);
}

function weightPerMeter(diameter) {
  return sharedKgPerMeter(diameter);
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
  background:#ffffff;border:1px solid #d0d8e4;border-radius:12px;
  width:min(1180px,96vw);max-height:95vh;overflow:hidden;
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
  min-width:142px;transition:all 0.15s;display:flex;flex-direction:column;align-items:center;gap:6px;}
.se-count-btn:hover{border-color:#e07b39;background:rgba(224,123,57,0.05);
  transform:translateY(-2px);box-shadow:0 4px 16px rgba(224,123,57,0.2);}
.se-count-btn .cnt-num{font-size:28px;font-weight:900;color:#1a2332;}
.se-count-btn .cnt-lbl{font-size:11px;color:#7a93ab;}
.se-count-btn .cnt-name{font-size:13px;font-weight:900;color:#1a2332;}
.se-count-btn svg{width:112px;height:80px;display:block;margin:0 auto;}
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
.se-preview-panel{flex:1;display:flex;flex-direction:column;padding:14px 16px;gap:10px;background:#fff;overflow:hidden;min-width:0;}
.se-data-panel{width:360px;flex-shrink:0;border-right:1px solid #e2e8ef;display:flex;flex-direction:column;overflow:hidden;background:#fff;}
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
  background:#f7f9fc;border:1px solid #dbe4ef;
  border-radius:12px;flex:1;display:flex;align-items:center;justify-content:center;
  min-height:420px;user-select:none;overflow:hidden;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.9);
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
#seModal .se-svg-wrap svg{width:100%;height:100%;min-height:520px;max-height:100%;}
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
#seModal .se-table td:nth-child(2) .se-input{max-width:96px;margin-inline-start:auto;}
#seModal .se-table td:nth-child(3) .se-input{max-width:78px;margin-inline-start:auto;}
#seModal .se-input:focus{outline:none;border-color:#e07b39;background:#fffaf6;box-shadow:0 0 0 3px rgba(224,123,57,0.12);}
#seModal .se-direct-edit-note{font-size:11px;font-weight:700;color:#7a93ab;margin-inline-start:12px;}
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
#seModal .se-mode-note{padding:10px 14px;border-bottom:1px solid #e2e8ef;background:#fbfcfe;display:grid;gap:8px;}
#seModal .se-3d-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #d8e2ec;border-radius:8px;padding:9px 10px;background:#fff;}
#seModal .se-3d-toggle strong{font-size:13px;color:#1a2332;}
#seModal .se-3d-toggle small{display:block;font-size:11px;color:#7a93ab;font-weight:500;line-height:1.45;}
#seModal .se-switch{position:relative;width:44px;height:24px;flex-shrink:0;}
#seModal .se-switch input{opacity:0;width:0;height:0;}
#seModal .se-slider{position:absolute;cursor:pointer;inset:0;background:#c8d4e0;border-radius:999px;transition:.15s;}
#seModal .se-slider:before{content:"";position:absolute;width:18px;height:18px;right:3px;top:3px;background:#fff;border-radius:50%;transition:.15s;box-shadow:0 1px 4px rgba(0,0,0,.18);}
#seModal .se-switch input:checked + .se-slider{background:#e07b39;}
#seModal .se-switch input:checked + .se-slider:before{transform:translateX(-20px);}
#seModal .se-3d-help{font-size:11px;color:#7a93ab;line-height:1.55;}
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

/* Easybar-inspired production workspace */
#seOverlay{
  background:rgba(32,33,36,0.62);
  backdrop-filter:none;
  align-items:center;
  justify-content:center;
}
#seOverlay.show #seModal{transform:none;}
#seModal{
  width:100vw;
  height:100vh;
  max-height:100vh;
  border-radius:0;
  border:0;
  background:#d9d9d9;
  box-shadow:none;
  color:#243047;
}
#seModal .se-head{
  min-height:54px;
  padding:10px 20px;
  background:#202633;
  border-bottom:1px solid rgba(255,255,255,0.06);
}
#seModal .se-head h2{font-size:15px;color:#f3f6fa;}
#sePageEdit{
  flex:1;
  display:flex;
  min-height:0;
  background:#d9d9d9;
  direction:ltr;
}
#sePageEdit .se-preview-panel,
#sePageEdit .se-data-panel{direction:rtl;}
#sePageEdit[style*="display:none"]{display:none!important;}
.se-preview-panel{
  flex:1;
  order:1;
  background:#d9d9d9;
  padding:16px 28px 18px;
  gap:10px;
}
.se-data-panel{
  order:2;
  width:332px;
  background:#eef0f3;
  border-right:1px solid #c9cdd4;
  border-left:0;
}
.se-data-panel-head{
  min-height:56px;
  padding:18px 22px 12px;
  background:#eef0f3;
  border-bottom:1px solid #c9cdd4;
  color:#243047;
  font-size:18px;
  font-weight:900;
  text-transform:none;
  letter-spacing:0;
}
#seModal .se-mode-note{
  background:#eef0f3;
  border-bottom:1px solid #c9cdd4;
  padding:14px 18px;
}
#seModal .se-3d-toggle{
  border:0;
  border-radius:0;
  padding:0;
  background:transparent;
}
#seModal .se-3d-toggle strong{font-size:14px;}
#seModal .se-3d-toggle small{color:#667286;}
#seModal .se-switch input:checked + .se-slider{background:#ff4047;}
#seModal .se-table-wrap{
  background:#eef0f3;
  padding:12px 16px 16px;
}
#seModal .se-table{
  border-collapse:separate;
  border-spacing:0 8px;
}
#seModal .se-table th{
  background:transparent;
  border-bottom:0;
  color:#667286;
  font-size:11px;
  position:static;
}
#seModal .se-table td{
  background:#ffffff;
  border-top:1px solid #d8dde5;
  border-bottom:1px solid #d8dde5;
  padding:8px;
}
#seModal .se-table td:first-child{
  border-right:1px solid #d8dde5;
  border-radius:0 8px 8px 0;
}
#seModal .se-table td:last-child{
  border-left:1px solid #d8dde5;
  border-radius:8px 0 0 8px;
}
#seModal .se-table tr:hover td{background:#fbfcfe;}
#seModal .se-seg-label{
  width:34px;
  height:34px;
  background:#2f394b;
  border-radius:50%;
  font-size:13px;
}
.se-row-active td{background:#fff3f3!important;border-color:#ff4047!important;}
.se-row-active td:first-child{border-right:1px solid #ff4047!important;}
.se-row-active .se-seg-label{background:#ff4047!important;}
#seModal .se-add-row{justify-content:center;}
#seModal .se-add-btn{
  width:100%;
  min-height:40px;
  border-radius:8px;
  border:0;
  background:#5b6474;
  color:#fff;
  font-weight:800;
}
#seModal .se-add-btn:hover{background:#2f394b;color:#fff;}
#seModal .se-svg-wrap{
  background:#ffffff;
  border:0;
  border-radius:0;
  min-height:420px;
  box-shadow:none;
}
#seModal .se-svg-wrap svg{
  width:100%;
  height:380px;
  max-height:100%;
}
#seModal .se-stats-bar{
  background:#d9d9d9;
  gap:8px;
}
#seModal .se-stat{
  min-width:110px;
  background:#eef0f3;
  border:1px solid #c9cdd4;
  border-radius:8px;
  padding:8px 12px;
}
#seModal .se-stat-label{
  color:#667286;
  letter-spacing:0;
  text-transform:none;
}
#seModal .se-stat-value{color:#243047;font-size:19px;}
#seModal .se-direct-edit-note{
  color:#667286;
  white-space:nowrap;
}
#seView2D,#seView3D,#seResetCam{
  min-height:34px;
  border-radius:8px;
}
#se3DOrbitCtrl{
  align-self:center;
  background:#eef0f3!important;
  border:1px solid #c9cdd4!important;
  border-radius:10px!important;
  padding:6px 10px!important;
}
#se3DOrbitCtrl .se-rot-btn{
  border-radius:50%!important;
  background:#858d9a!important;
  border:0!important;
  color:#fff!important;
}
#se3DOrbitCtrl .se-rot-btn:hover{background:#2f394b!important;color:#fff!important;}
#seModal .se-foot{
  background:#eef0f3;
  border-top:1px solid #c9cdd4;
}
#seModal .se-ok-btn{
  border-radius:8px;
  background:#ff4047;
  box-shadow:none;
}
#seModal .se-save-shape-btn{
  border-color:#5b6474;
  color:#2f394b;
  background:#fff;
}
#seModal .se-cancel-btn{
  border-color:#c9cdd4;
  color:#2f394b;
}
#sePageSelect{
  background:#d9d9d9!important;
}
#seFamilyTabs{
  display:flex;
  justify-content:flex-end;
  gap:10px;
  padding:16px 24px 10px;
  background:#eef0f3;
  border-bottom:1px solid #d5dae1;
}
#seFamilyTabs .se-family-tab{
  min-width:82px;
  height:30px;
  border:1px solid #b9c3d0;
  border-radius:6px;
  background:#f7f8fa;
  color:#647083;
  font-family:'Heebo',sans-serif;
  font-size:14px;
  font-weight:800;
}
#seFamilyTabs .se-family-tab.active{
  background:#fff;
  color:#172235;
  border-color:#263449;
}
#seCategoryFilters{
  display:flex;
  flex-wrap:wrap;
  justify-content:center;
  gap:10px 12px;
  padding:14px 24px 6px;
  background:#eef0f3;
}
#seCategoryFilters .se-category-filter{
  min-width:78px;
  height:34px;
  border:0;
  border-radius:6px;
  background:#5f6878;
  color:#fff;
  font-family:'Heebo',sans-serif;
  font-size:14px;
  font-weight:900;
}
#seCategoryFilters .se-category-filter.active{background:#ff4047;}
#seCategoryFilters .se-category-filter:disabled{opacity:.45;cursor:default;}
#seSideFilters{
  display:flex;
  flex-wrap:wrap;
  justify-content:center;
  gap:8px;
  padding:4px 24px 12px;
  background:#eef0f3;
  border-bottom:1px solid #d5dae1;
}
#seSideFilters .se-side-filter{
  min-width:42px;
  height:30px;
  border:1px solid #c2cad5;
  border-radius:6px;
  background:#fff;
  color:#5f6878;
  font-family:'Heebo',sans-serif;
  font-size:13px;
  font-weight:900;
}
#seSideFilters .se-side-filter.active{background:#2f394b;color:#fff;border-color:#2f394b;}
#sePresets{
  grid-template-columns:repeat(auto-fill,minmax(64px,1fr))!important;
  justify-items:center;
  gap:16px 14px!important;
}
#seModal .se-preset-btn{
  width:58px;
  height:58px;
  min-height:58px;
  padding:0;
  border:0;
  border-radius:50%;
  background:#858d9a;
  color:#fff;
  display:grid;
  place-items:center;
}
#seModal .se-preset-btn svg{width:38px;height:38px;margin:0!important;display:block;}
#seModal .se-preset-btn:hover{background:#5b6474;color:#fff;transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.14);}
#seModal .se-preset-btn.active{
  background:#2f394b;
  border-color:transparent;
  color:#fff;
  box-shadow:none;
}
#seModal .se-preset-name{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}


/* One-screen shape edit layout: keep a single shape editable without page scroll */
#seModal{overflow:hidden;}
#sePageEdit{
  height:calc(100vh - 118px);
  max-height:calc(100vh - 118px);
  overflow:hidden;
}
#sePageEdit .se-preview-panel,
#sePageEdit .se-data-panel{
  height:100%;
  min-height:0;
}
.se-preview-panel{
  padding:10px 18px 8px;
  gap:8px;
}
#seModal .se-canvas-topbar{
  min-height:44px;
  gap:10px;
}
#seModal .se-svg-wrap{
  flex:1 1 auto;
  min-height:0;
  height:calc(100vh - 246px);
  max-height:calc(100vh - 246px);
}
#seModal .se-svg-wrap svg{
  height:100%;
  min-height:0;
}
.se-data-panel{
  display:flex;
  flex-direction:column;
  min-height:0;
}
.se-data-panel-head{
  min-height:42px;
  padding:12px 18px 8px;
  font-size:16px;
}
#seModal .se-mode-note{
  padding:10px 16px;
  flex-shrink:0;
}
#seModal .se-3d-help{
  font-size:10px;
  line-height:1.35;
}
#seModal .se-table-wrap{
  flex:1 1 auto;
  min-height:0;
  overflow-y:auto;
  padding:8px 14px 10px;
}
#seModal .se-panel-summary{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:8px;
  padding:12px 16px 4px;
  background:#eef0f3;
  border-top:1px solid #d3d8df;
}
#seModal .se-panel-summary-item{
  min-width:0;
  background:#fff;
  border:1px solid #d8dde5;
  border-radius:8px;
  padding:8px 10px;
}
#seModal .se-panel-summary-main{
  grid-column:1 / -1;
  display:flex;
  align-items:center;
  justify-content:space-between;
  border-color:#e07b39;
  box-shadow:0 0 0 2px rgba(224,123,57,.10);
}
#seModal .se-panel-summary-item span{
  display:block;
  color:#667286;
  font-size:10px;
  font-weight:800;
  line-height:1.2;
}
#seModal .se-panel-summary-item strong{
  color:#243047;
  font-size:18px;
  font-weight:900;
  line-height:1.15;
}
#seModal .se-panel-summary-main strong{
  color:#df5000;
}
#seModal .se-panel-summary-item small{
  margin-inline-start:3px;
  color:#667286;
  font-size:10px;
  font-weight:700;
}
#seModal .se-table{border-spacing:0 6px;}
#seModal .se-table td{padding:6px 8px;}
#seModal .se-input{min-height:36px;padding:6px 10px;}
#seModal .se-angle-btn{padding:5px 8px;min-width:54px;}
#seModal .se-add-row{padding:6px 0 0!important;}
#seModal .se-add-btn{min-height:34px;}
#seModal .se-foot{
  min-height:58px;
  height:58px;
  padding:8px 16px;
}
#seModal .se-ok-btn,
#seModal .se-save-shape-btn,
#seModal .se-cancel-btn{
  min-height:40px;
  padding-top:8px;
  padding-bottom:8px;
}
@media(max-height:760px){
  #seModal .se-head{min-height:48px;padding-top:8px;padding-bottom:8px;}
  #sePageEdit{height:calc(100vh - 102px);max-height:calc(100vh - 102px);}
  #seModal .se-svg-wrap{height:calc(100vh - 220px);max-height:calc(100vh - 220px);}
  #seModal .se-stat{padding:6px 10px;}
  #seModal .se-stat-value{font-size:17px;}
  #seModal .se-foot{height:54px;min-height:54px;}
}
@media(max-width:760px){
  #seModal{width:100vw;height:100vh;max-height:100vh;border-radius:0;}
  #sePageEdit{flex-direction:column;}
  .se-preview-panel{order:1;padding:10px;background:#d9d9d9;}
  .se-data-panel{order:2;width:100%;max-height:42vh;border-right:none;border-top:1px solid #c9cdd4;}
  #seModal .se-svg-wrap{min-height:44vh;}
  #seModal .se-direct-edit-note{display:none;}
}
@media(max-width:640px){
  #seModal{width:100vw;max-height:100vh;border-radius:0;}
  #sePageEdit{flex-direction:column;}
  .se-data-panel{width:100%;border-right:none;border-top:1px solid #e2e8ef;max-height:40vh;}
  #seModal .se-svg-wrap{min-height:260px;}
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
      <h2 id="seHeadTitle">בחר צורה</h2>
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
    <div id="seFamilyTabs"></div>
    <div id="seCategoryFilters"></div>
    <div id="seSideFilters"></div>
    <div id="seSavedSection"></div>
    <div style="padding:10px 24px 12px;font-size:15px;font-weight:900;color:#243047;" id="sePresetsTitle">סינון צורות</div>
    <div id="sePresets" style="padding:0 24px 20px;display:grid;grid-template-columns:repeat(5,1fr);gap:10px;"></div>
  </div>

  <!-- ── PAGE 2: Dimension editing (hidden initially) ── -->
  <div id="sePageEdit" style="display:none;">
    <!-- Left: preview -->
    <div class="se-preview-panel">
      <!-- View toggle -->
      <div class="se-canvas-topbar" style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
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
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <span class="se-direct-edit-note">דאבל-קליק על מספר בשרטוט לעריכה</span>
          <button id="seView2D" onclick="seSetView('2d')" style="padding:5px 14px;border-radius:6px;border:1.5px solid #e07b39;background:rgba(224,123,57,0.1);color:#e07b39;font-family:'Heebo',sans-serif;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s">2D</button>
          <button id="seView3D" onclick="seSetView('3d')" style="padding:5px 14px;border-radius:6px;border:1.5px solid #d8e2ec;background:#f4f6f9;color:#526070;font-family:'Heebo',sans-serif;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s">3D</button>
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
        <span style="font-size:10px;color:#7a93ab;font-weight:700;margin-left:2px;">תצוגה:</span>
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
      <div class="se-mode-note">
        <label class="se-3d-toggle">
          <span>
            <strong>מוצר תלת-ממדי אמיתי</strong>
            <small>כבה: 3D הוא רק תצוגה. דלוק: נשמרים נתוני XYZ לפריט.</small>
          </span>
          <span class="se-switch">
            <input type="checkbox" id="seReal3DToggle" onchange="window._seEditor._setReal3D(this.checked)">
            <span class="se-slider"></span>
          </span>
        </label>
        <div class="se-3d-help" id="se3DHelp">תצוגת 3D לא הופכת את המוצר לתלת-ממדי. סמן כאן רק אם הברזל באמת יוצא מהמישור.</div>
      </div>
      <div class="se-panel-summary" aria-live="polite">
        <div class="se-panel-summary-item se-panel-summary-main">
          <span>סה״כ אורך</span>
          <div>
            <strong id="sePanelTotalMm">0</strong>
            <small>מ״מ</small>
          </div>
        </div>
        <div class="se-panel-summary-item">
          <span>אורך בר</span>
          <div>
            <strong id="sePanelTotalM">0.00</strong>
            <small>מטר</small>
          </div>
        </div>
        <div class="se-panel-summary-item">
          <span>כיפופים</span>
          <strong id="sePanelBends">0</strong>
        </div>
      </div>
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
      <button class="se-save-shape-btn" id="seSaveShapeBtn">שמור צורה</button>
      <button class="se-ok-btn" id="seOk">אשר צורה ←</button>
    </div>
    <!-- Save bar (hidden by default) -->
    <div id="seFootSave" style="display:none;width:100%;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:13px;font-weight:700;color:#1a2332;font-family:Heebo,sans-serif;white-space:nowrap;">שם הצורה:</span>
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
    document.getElementById('seHeadTitle').textContent    = 'בחר צורה';
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
        const shapeName = COUNT_PICKER_NAMES[Number(n)] || n + ' צלעות';
        return '<button class="se-count-btn" data-count="'+n+'">'
          + countPickerShapeSVG(n)
          + '<div class="cnt-num">'+n+'</div>'
          + '<div class="cnt-name">'+shapeName+'</div>'
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
    document.getElementById('seHeadTitle').textContent    = this._selectedCount ? (this._selectedCount + ' צלעות – בחר צורה') : 'בחר סוג וצורה';
    if (!this._selectedFamily) this._selectedFamily = 'bars';
    if (!this._selectedCategory) this._selectedCategory = 'הכל';
    if (this._selectedSideCount === undefined) this._selectedSideCount = this._selectedCount || 'הכל';
    this._renderFamilyTabs();
    this._renderCategoryFilters();
    this._renderSideFilters();
    this._renderSavedShapes(this._selectedCount);
    this._renderPresets(this._selectedCount);
  }

  _renderFamilyTabs() {
    const cont = document.getElementById('seFamilyTabs');
    if (!cont) return;
    cont.innerHTML = SHAPE_FAMILIES.map(f => `<button class="se-family-tab ${this._selectedFamily === f.id ? 'active' : ''}" data-family="${f.id}">${f.label}</button>`).join('');
    cont.querySelectorAll('[data-family]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._selectedFamily = btn.dataset.family;
        this._selectedCategory = 'הכל';
        this._selectedSideCount = 'הכל';
        this._renderFamilyTabs();
        this._renderCategoryFilters();
        this._renderSideFilters();
        this._renderSavedShapes(this._selectedCount);
        this._renderPresets(this._selectedCount);
      });
    });
  }

  _renderCategoryFilters() {
    const cont = document.getElementById('seCategoryFilters');
    if (!cont) return;
    const isBars = (this._selectedFamily || 'bars') === 'bars';
    cont.style.display = isBars ? 'flex' : 'none';
    if (!isBars) return;
    cont.innerHTML = SHAPE_CATEGORY_FILTERS.map(label => `<button class="se-category-filter ${this._selectedCategory === label ? 'active' : ''}" data-category="${label}">${label}</button>`).join('');
    cont.querySelectorAll('[data-category]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._selectedCategory = btn.dataset.category;
        this._renderCategoryFilters();
        this._renderPresets(this._selectedCount);
      });
    });
  }

  _renderSideFilters() {
    const cont = document.getElementById('seSideFilters');
    if (!cont) return;
    const isBars = (this._selectedFamily || 'bars') === 'bars';
    cont.style.display = isBars ? 'flex' : 'none';
    if (!isBars) return;
    const selected = this._selectedSideCount === undefined ? 'הכל' : this._selectedSideCount;
    cont.innerHTML = SHAPE_SIDE_FILTERS.map(value => {
      const label = value === 'הכל' ? 'הכל' : `${value}`;
      return `<button class="se-side-filter ${String(selected) === String(value) ? 'active' : ''}" data-side-count="${value}">${label}</button>`;
    }).join('');
    cont.querySelectorAll('[data-side-count]').forEach(btn => {
      btn.addEventListener('click', () => {
        const raw = btn.dataset.sideCount;
        this._selectedSideCount = raw === 'הכל' ? 'הכל' : Number(raw);
        this._renderSideFilters();
        this._renderSavedShapes(this._selectedCount);
        this._renderPresets(this._selectedCount);
      });
    });
  }

  _goToEdit() {
    this._activeSeg = null; // clear selection when entering edit page
    document.getElementById('sePageCount').style.display  = 'none';
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
    let drag = null; // { pointerId, startX, startY, startTheta, startPhi }

    const startDrag = e => {
      if (window._seViewMode === '2d') return;
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      drag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, theta: this._camTheta, phi: this._camPhi };
      wrap.setPointerCapture?.(e.pointerId);
      wrap.classList.add('dragging');
    };

    const moveDrag = e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (e.buttons !== undefined && e.buttons === 0) { endDrag(e); return; }
      if (window._seViewMode === '2d') { endDrag(e); return; }
      if (e.cancelable) e.preventDefault();
      const W = wrap.offsetWidth  || 300;
      const H = wrap.offsetHeight || 180;
      // one full width drag = 360° horizontal; one full height drag = 180° vertical
      this._camTheta = drag.theta + (e.clientX - drag.startX) / W * Math.PI * 2;
      this._camPhi   = Math.max(-Math.PI / 2 + 0.05,
                       Math.min( Math.PI / 2 - 0.05,
                         drag.phi - (e.clientY - drag.startY) / H * Math.PI));
      this._updatePreview();
    };

    const endDrag = e => {
      if (drag && e?.pointerId != null && wrap.hasPointerCapture?.(e.pointerId)) {
        wrap.releasePointerCapture?.(e.pointerId);
      }
      drag = null;
      wrap.classList.remove('dragging');
    };

    // Expose so seSetView can cancel active drag when switching modes
    window._seResetDrag = endDrag;

    wrap.addEventListener('pointerdown', startDrag);
    wrap.addEventListener('pointermove', moveDrag);
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);
    wrap.addEventListener('lostpointercapture', endDrag);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') endDrag(e); });
    window.addEventListener('blur', endDrag);
  }

  _renderPresets(countFilter) {
    const family = this._selectedFamily || 'bars';
    const category = this._selectedCategory || 'הכל';
    const sideCount = this._selectedSideCount === undefined || this._selectedSideCount === 'הכל' ? countFilter : Number(this._selectedSideCount);
    const shapes = SHAPE_PRESETS.filter(s => {
      const sameFamily = (s.family || 'bars') === family;
      const countOk = !sideCount || family !== 'bars' || s.sides.length === sideCount;
      const categoryOk = family !== 'bars' || category === 'הכל' || s.category === category;
      return sameFamily && countOk && categoryOk;
    });
    const cont = document.getElementById('sePresets');
    cont.innerHTML = shapes.map(s => {
      return '<button class="se-preset-btn" data-id="'+s.id+'" title="'+s.name+'" aria-label="'+s.name+'">'
        + shapePresetIconSVG(s.icon || 'straight')
        + '<span class="se-preset-name">'+s.name+'</span>'
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
    const sideCount = this._selectedSideCount === undefined || this._selectedSideCount === 'הכל' ? countFilter : Number(this._selectedSideCount);
    const list   = sideCount ? saved.filter(s => s.sides.length === sideCount) : saved;
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
    const isReal3D = this.current.is3d === 1 || this.current.is3d === true;
    const toggle = document.getElementById('seReal3DToggle');
    if (toggle) toggle.checked = isReal3D;
    const help = document.getElementById('se3DHelp');
    if (help) help.textContent = isReal3D
      ? 'מצב מוצר תלת-ממדי פעיל: ערוך פנייה במרחב והטיית Z לכל צלע.'
      : 'תצוגת 3D לא הופכת את המוצר לתלת-ממדי. סמן כאן רק אם הברזל באמת יוצא מהמישור.';

    // ── Update column headers ──────────────────────────────────
    const thead = document.getElementById('seTableHead');
    if (thead) {
      if (isReal3D) {
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
    // One-row side editor: each side keeps length and bend angle in one readable row.
    let html = '';
    for (let i = 0; i < sides.length; i++) {
      const letter = String.fromCharCode(65 + i);
      if (isReal3D) {
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
        // 2D mode: One-row side editor, aligned with the compact 3D table.
        html += `
          <tr class="se-side-row">
            <td><span class="se-seg-label">${letter}</span></td>
            <td class="se-length-cell"><input class="se-input" type="number" min="1" max="20000" value="${sides[i]}"
              data-side="${i}" oninput="window._seEditor._setSide(${i}, this.value)"></td>
            <td class="se-angle-cell">${i < angles.length
              ? `<input class="se-input" type="number" min="-360" max="360" value="${angles[i]}"
                  data-angle="${i}" oninput="window._seEditor._setAngle(${i}, this.value)">`
              : '<span style="font-size:11px;color:#aab8c8;padding:0 4px;">&mdash;</span>'}</td>
            <td>${sides.length > 1 ? `<button class="se-del-btn" onclick="window._seEditor._deleteSide(${i})">&times;</button>` : ''}</td>
          </tr>`;
      }
    }
    document.getElementById('seTableBody').innerHTML = html;
  }

  _setReal3D(enabled) {
    if (!this.current) return;
    this.current.is3d = enabled ? 1 : 0;
    if (enabled) {
      this._init3DAnglesFrom2D();
      window.seSetView?.('3d');
    } else {
      this.current.azAngles = Array(this.current.sides.length).fill(0);
      this.current.elAngles = Array(this.current.sides.length).fill(0);
      window.seSetView?.('2d');
    }
    this._renderTable();
    this._updatePreview();
  }

  _setSide(i, val) {
    if (!this.current) return;
    this.current.sides[i] = Math.max(1, Number(val) || 1);
    this._updatePreview();
  }

  _setAngle(i, val) {
    if (!this.current) return;
    const a = Math.min(360, Math.max(-360, Number(val) || 90));
    this.current.angles[i] = a;
    // ── Sync to azAngles (so 3D view stays consistent) ─────────────────
    // azAngles[i+1] = -(180 - angles[i])
    if (this.current.azAngles && i + 1 < this.current.azAngles.length) {
      this.current.azAngles[i + 1] = -(180 - a);
    }
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
    // Clamp to valid 2D range [-360, 360]; angles outside this range mean
    // a purely-3D direction change with no classic 2D equivalent.
    const ang2d = 180 + az;
    if (i - 1 >= 0 && i - 1 < this.current.angles.length) {
      if (ang2d >= -360 && ang2d <= 360) {
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
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const i = parseInt(el.dataset.segClick);
        this._editSideFromDrawing(i);
      });
    });
    svg.querySelectorAll('[data-ang-click]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this._focusRow(parseInt(el.dataset.angClick), true);
      });
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const i = parseInt(el.dataset.angClick);
        this._editAngleFromDrawing(i);
      });
    });
  }

  _editSideFromDrawing(i) {
    if (!this.current || !Number.isInteger(i) || i < 0 || i >= this.current.sides.length) return;
    this._focusRow(i, false);
    // דאבל-קליק לעריכת אורך
    // ׳“׳׳‘׳-׳§׳׳™׳§ ׳׳¢׳¨׳™׳›׳× ׳׳•׳¨׳
    const next = prompt('דאבל-קליק לעריכת אורך', this.current.sides[i]);
    if (next == null) return;
    const val = Math.max(1, Math.min(20000, Number(next) || this.current.sides[i]));
    this.current.sides[i] = val;
    const inp = document.querySelector(`[data-side="${i}"]`);
    if (inp) inp.value = val;
    this._renderTable();
    this._updatePreview();
  }

  _editAngleFromDrawing(i) {
    if (!this.current || !Number.isInteger(i) || i < 0 || i >= this.current.angles.length) return;
    this._focusRow(i, true);
    // דאבל-קליק לעריכת זווית
    // ׳“׳׳‘׳-׳§׳׳™׳§ ׳׳¢׳¨׳™׳›׳× ׳–׳•׳•׳™׳×
    const next = prompt('דאבל-קליק לעריכת זווית', this.current.angles[i]);
    if (next == null) return;
    const val = Math.min(360, Math.max(-360, Number(next) || this.current.angles[i]));
    this.current.angles[i] = val;
    if (this.current.azAngles && i + 1 < this.current.azAngles.length) {
      this.current.azAngles[i + 1] = -(180 - val);
    }
    const inp = document.querySelector(`[data-angle="${i}"]`);
    if (inp) inp.value = val;
    this._renderTable();
    this._updatePreview();
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
    const isReal3D = this.current.is3d === 1 || this.current.is3d === true;

    if (is3D) {
      const diam = this._diameter || 12;
      const { azAngles, elAngles } = this.current;
      const has3D = isReal3D && (
        (azAngles && azAngles.some(a => a !== 0)) ||
        (elAngles && elAngles.some(a => a !== 0))
      );

      // Visual-only 3D must render the exact same flat bend geometry as 2D.
      // True 3D may use XYZ turn data only after the user explicitly marks it as real 3D.
      let effectiveAzAngles = azAngles;
      if (has3D && (!azAngles || azAngles.every(a => a === 0)) && angles.length > 0) {
        effectiveAzAngles = [0, ...angles.map(a => -(180 - a))];
        while (effectiveAzAngles.length < sides.length) effectiveAzAngles.push(0);
      }

      svg.innerHTML = shape3DSVG(sides, angles, 300, 260, diam, {
        showAxes: true, showDims: true, showBends: false, compactLabels: true, dark: false,
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

      // Dimension tags: small white windows aligned with each side.
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const isAct = i === _activeSeg2d;
        const stroke = isAct ? '#ff4047' : '#9aa3b2';
        const fill = isAct ? '#fff4f4' : '#ffffff';
        const mx=(s.x1+s.x2)/2, my=(s.y1+s.y2)/2;
        const lx=mx+s.nx*24, ly=my+s.ny*24;
        const rawAngle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180 / Math.PI;
        let labelAngle = rawAngle;
        if (labelAngle > 90) labelAngle -= 180;
        if (labelAngle < -90) labelAngle += 180;
        const value = String(sides[i]);
        const tagW = Math.max(36, Math.min(62, value.length * 9 + 18));
        const letter = String.fromCharCode(65 + i);
        html += `<g transform="translate(${lx.toFixed(1)} ${ly.toFixed(1)}) rotate(${labelAngle.toFixed(1)})"
            data-seg-click="${i}" style="cursor:pointer">
          <text x="0" y="-15" text-anchor="middle" font-size="12"
            font-family="Heebo,Arial" font-weight="700" fill="#111827"
            data-seg-click="${i}">${letter}</text>
          <rect x="${(-tagW/2).toFixed(1)}" y="-9" width="${tagW}" height="18" rx="3"
            fill="${fill}" stroke="${stroke}" stroke-width="1"
            data-seg-click="${i}"/>
          <text x="0" y="5" text-anchor="middle" font-size="13"
            font-family="Heebo,Arial" font-weight="700" fill="#111827"
            data-seg-click="${i}">${value}</text>
        </g>`;
      }

      // Bend marks: right angle gets a clean corner marker without number.
      if (segs.length > 1) {
        for (let i = 0; i < segs.length - 1; i++) {
          const bx = segs[i].x2, by = segs[i].y2;
          const angle = Number(angles[i]);
          if (angles[i] === undefined || angle === 180) continue;
          const s1 = segs[i], s2 = segs[i + 1];
          const len1 = Math.hypot(s1.x2 - s1.x1, s1.y2 - s1.y1) || 1;
          const len2 = Math.hypot(s2.x2 - s2.x1, s2.y2 - s2.y1) || 1;
          const u1x = (s1.x1 - bx) / len1, u1y = (s1.y1 - by) / len1;
          const u2x = (s2.x2 - bx) / len2, u2y = (s2.y2 - by) / len2;
          if (Math.abs(Math.abs(angle) - 90) < 0.001) {
            const m = 8;
            const p1x = bx + u1x * m, p1y = by + u1y * m;
            const p2x = p1x + u2x * m, p2y = p1y + u2y * m;
            const p3x = bx + u2x * m, p3y = by + u2y * m;
            html += `<path d="M ${p1x.toFixed(1)} ${p1y.toFixed(1)} L ${p2x.toFixed(1)} ${p2y.toFixed(1)} L ${p3x.toFixed(1)} ${p3y.toFixed(1)}"
              fill="none" stroke="#c4c8cf" stroke-width="2"
              data-ang-click="${i}" style="cursor:pointer"/>`;
          } else {
            let bxOut = u1x + u2x;
            let byOut = u1y + u2y;
            const bLen = Math.hypot(bxOut, byOut) || 1;
            bxOut /= bLen;
            byOut /= bLen;
            // Keep non-90 angle labels outside the bend so they do not cover the vertex or short side tag.
            const dist = Math.max(34, Math.min(50, Math.min(len1, len2) * 0.42 + 24));
            const tx = bx + bxOut * dist;
            const ty = by + byOut * dist;
            const value = String(angle) + '°';
            const tagW = Math.max(36, Math.min(54, value.length * 8 + 16));
            html += `<g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)})"
                data-ang-click="${i}" style="cursor:pointer">
              <rect x="${(-tagW/2).toFixed(1)}" y="-10" width="${tagW}" height="20" rx="4"
                fill="#ffffff" stroke="#c9621a" stroke-width="1.2"/>
              <text x="0" y="5" text-anchor="middle" font-size="12"
                font-family="Heebo,Arial" font-weight="800" fill="#111827">${value}</text>
            </g>`;
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
    const sePanelTotalMm = document.getElementById('sePanelTotalMm');
    const sePanelTotalM = document.getElementById('sePanelTotalM');
    const sePanelBends = document.getElementById('sePanelBends');
    if (sePanelTotalMm) sePanelTotalMm.textContent = perimeter.toLocaleString('he-IL');
    if (sePanelTotalM) sePanelTotalM.textContent = (perimeter / 1000).toFixed(2);
    if (sePanelBends) sePanelBends.textContent = angles.length;
  }

  _confirm() {
    if (!this.current || !this.onSelect) return;
    const isReal3D = this.current.is3d === 1 || this.current.is3d === true;
    this.onSelect({
      ...this.current,
      is3d: isReal3D ? 1 : 0,
      azAngles: isReal3D ? (this.current.azAngles || []) : null,
      elAngles: isReal3D ? (this.current.elAngles || []) : null,
    });
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
        is3d: existingData.is3d ? 1 : 0,
        azAngles: initAz,
        elAngles: existingData.elAngles?.length === n
          ? [...existingData.elAngles]
          : Array(n).fill(0),
      };
      document.querySelectorAll('.se-preset-btn').forEach(b => b.classList.toggle('active', b.dataset.id === existingData.presetId));
      this._goToEdit();
    } else {
      // No existing shape: start from the family selector so mesh and piles are available immediately.
      this._selectedCount = null;
      this._selectedSideCount = 'הכל';
      this._goToSelect();
    }
    this._el.classList.add('show');
  }

  close() {
    if (window._seResetDrag) window._seResetDrag();
    this._el.classList.remove('show');
  }
}

// ── VIEW MODE TOGGLE (global, called from onclick) ────────────────
window._seViewMode = '2d'; // default to precise 2D editing; 3D is optional review
window.IronBendShapeGeometry = {
  calcShapePoints,
  calcShapePoints3D,
  shapeSVGPath,
  shape3DSVG,
};
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
    btn2d.textContent = '2D';
    btn3d.textContent = '3D';
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
