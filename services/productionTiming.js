'use strict';

// Read-only production timing projection.  The source of truth remains the
// production item timestamps and the canonical shape snapshot stored on each
// item; this service never changes an order, a card, or an item state.

const FACTORY_TIME_ZONE = 'Asia/Jerusalem';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const LUNCH_START_MINUTE = 12 * 60;
const LUNCH_END_MINUTE = 12 * 60 + 45;

function round(value, digits = 3) {
  const numeric = Number(value) || 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value || '').trim();
  if (!raw) return null;
  // SQLite CURRENT_TIMESTAMP is stored as UTC without its trailing Z.
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/i.test(raw)
    ? raw
    : `${raw.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localParts(value, timeZone = FACTORY_TIME_ZONE) {
  const date = asDate(value);
  if (!date) return null;
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
    return result;
  }, {});
  return values;
}

function israelDay(value) {
  const parts = localParts(value);
  if (!parts) return null;
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function validDay(value) {
  if (!ISO_DAY.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function nextDay(day) {
  if (!validDay(day)) throw new Error('invalid production date');
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

function factoryLocalTimeUtc(day, minuteOfDay, timeZone = FACTORY_TIME_ZONE) {
  if (!validDay(day)) throw new Error('invalid production date');
  const [year, month, date] = day.split('-').map(Number);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const wantedUtcLike = Date.UTC(year, month - 1, date, hour, minute, 0);
  let result = wantedUtcLike;
  // Two passes handle the Israeli daylight-saving offset at the target time.
  for (let pass = 0; pass < 2; pass += 1) {
    const local = localParts(new Date(result), timeZone);
    const actualUtcLike = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second || 0);
    result += wantedUtcLike - actualUtcLike;
  }
  return new Date(result);
}

function overlapMinutes(start, end, otherStart, otherEnd) {
  const a = Math.max(start.getTime(), otherStart.getTime());
  const b = Math.min(end.getTime(), otherEnd.getTime());
  return b > a ? (b - a) / 60000 : 0;
}

function daySequence(start, end) {
  const first = israelDay(start);
  const last = israelDay(new Date(Math.max(start.getTime(), end.getTime() - 1)));
  if (!first || !last) return [];
  const days = [];
  let day = first;
  let safety = 0;
  while (day <= last) {
    if (++safety > 370) throw new Error('production timing range too large');
    days.push(day);
    day = nextDay(day);
  }
  return days;
}

function lunchIntervals(start, end) {
  return daySequence(start, end).map(day => ({
    start: factoryLocalTimeUtc(day, LUNCH_START_MINUTE),
    end: factoryLocalTimeUtc(day, LUNCH_END_MINUTE),
    kind: 'lunch',
  }));
}

function intervalIntersection(start, end, otherStart, otherEnd) {
  const a = Math.max(start.getTime(), otherStart.getTime());
  const b = Math.min(end.getTime(), otherEnd.getTime());
  return b > a ? { start: new Date(a), end: new Date(b) } : null;
}

function unionMinutes(intervals = []) {
  const clean = intervals
    .filter(interval => interval?.start instanceof Date && interval?.end instanceof Date && interval.end > interval.start)
    .map(interval => ({ start: interval.start.getTime(), end: interval.end.getTime() }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let total = 0;
  let current = null;
  for (const interval of clean) {
    if (!current || interval.start > current.end) {
      if (current) total += current.end - current.start;
      current = { ...interval };
    } else {
      current.end = Math.max(current.end, interval.end);
    }
  }
  if (current) total += current.end - current.start;
  return total / 60000;
}

function deductIntervals(start, end, stops = []) {
  const lunches = lunchIntervals(start, end)
    .map(interval => intervalIntersection(start, end, interval.start, interval.end))
    .filter(Boolean);
  const overlappingStops = stops
    .map(stop => intervalIntersection(start, end, stop.start, stop.end))
    .filter(Boolean);
  const lunchMinutes = unionMinutes(lunches);
  const allDeductionMinutes = unionMinutes([...lunches, ...overlappingStops]);
  const documentedStopMinutes = Math.max(0, allDeductionMinutes - lunchMinutes);
  return {
    lunchMinutes: round(lunchMinutes, 3),
    documentedStopMinutes: round(documentedStopMinutes, 3),
    deductedMinutes: round(allDeductionMinutes, 3),
  };
}

function parseJson(value, fallback = null) {
  if (value && typeof value === 'object') return value;
  if (!value || typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positive(value, fallback = 0) {
  const numeric = numberOrNull(value);
  return numeric !== null && numeric > 0 ? numeric : fallback;
}

function normaliseSegments(item = {}, snapshot = {}) {
  const fromItem = parseJson(item.segments, []);
  if (Array.isArray(fromItem) && fromItem.length) return fromItem;
  const generic = snapshot.machineOutput?.generic || {};
  const fromSnapshot = generic.segments || snapshot.data?.segments;
  if (Array.isArray(fromSnapshot) && fromSnapshot.length) return fromSnapshot;
  const sides = Array.isArray(snapshot.data?.sides) ? snapshot.data.sides : [];
  const angles = Array.isArray(snapshot.data?.angles) ? snapshot.data.angles : [];
  return sides.map((length, index) => ({
    length_mm: length,
    angle_deg: index < sides.length - 1 ? angles[index] : null,
  }));
}

function shapeProfile(item = {}) {
  const snapshot = parseJson(item.shape_snapshot_json, {}) || {};
  const generic = snapshot.machineOutput?.generic || {};
  const segments = normaliseSegments(item, snapshot).map(segment => ({
    length_mm: round(positive(segment?.length_mm ?? segment?.lengthMm ?? segment?.length), 3),
    angle_deg: numberOrNull(segment?.angle_deg ?? segment?.angleDeg ?? segment?.angle),
  })).filter(segment => segment.length_mm > 0);
  const bends = segments.slice(0, -1).filter(segment => {
    const angle = Number(segment.angle_deg);
    return Number.isFinite(angle) && Math.abs(angle) > 0.001 && Math.abs(Math.abs(angle) - 180) > 0.001;
  });
  const shapeType = String(snapshot.shapeType || generic.shapeType || item.shape_id || item.shape_name || 'unknown');
  const shapeName = String(snapshot.displayName || item.shape_name || shapeType || 'לא ידוע');
  const diameterMm = positive(item.diameter ?? snapshot.data?.diameterMm ?? snapshot.data?.diameter ?? generic.diameterMm ?? generic.diameter);
  const unitCutLengthMm = positive(item.total_length_mm ?? snapshot.calculated?.totalLengthMm ?? generic.totalLengthMm ?? generic.lengthMm);
  const fingerprintSource = {
    shapeType,
    diameterMm: round(diameterMm, 3),
    unitCutLengthMm: round(unitCutLengthMm, 3),
    segments,
    spiralDiameterMm: round(positive(item.spiral_diameter_mm ?? snapshot.data?.spiral?.diameterMm ?? generic.spiralDiameterMm), 3),
    spiralTurns: round(positive(item.spiral_turns ?? snapshot.data?.spiral?.turns ?? generic.spiralTurns), 3),
  };
  return {
    shapeType,
    shapeName,
    diameterMm,
    unitCutLengthMm,
    bendCount: bends.length,
    bendAngles: bends.map(segment => segment.angle_deg),
    segments,
    fingerprint: JSON.stringify(fingerprintSource),
  };
}

function itemProducedQuantity(item = {}) {
  const requested = positive(item.quantity, 1);
  const produced = numberOrNull(item.produced_qty);
  return produced !== null && produced > 0 ? Math.min(produced, requested) : requested;
}

function itemWeightKg(item = {}, producedQty) {
  const actual = numberOrNull(item.actual_weight_kg);
  if (actual !== null && actual >= 0) return { kg: actual, source: 'measured' };
  const total = positive(item.total_weight);
  const requested = positive(item.quantity, 1);
  return { kg: total * (producedQty / requested), source: 'theoretical' };
}

function machineDisplayName(item = {}, machineNames = new Map()) {
  const raw = String(item.machine || '').trim();
  const machineId = numberOrNull(item.machine_id);
  return raw || (machineId && machineNames.get(machineId)) || 'לא שויכה מכונה';
}

function stopIndex(db) {
  const machines = db.prepare('SELECT id,name,label FROM machines').all();
  const names = new Map(machines.map(machine => [Number(machine.id), String(machine.name || machine.label || machine.id)]));
  const byMachineId = new Map();
  const rows = db.prepare(`
    SELECT machine_id,reason_code,started_at,ended_at,duration_min
    FROM machine_stops
    WHERE started_at IS NOT NULL AND ended_at IS NOT NULL
  `).all();
  for (const row of rows) {
    const start = asDate(row.started_at);
    const end = asDate(row.ended_at);
    if (!start || !end || end <= start || !Number.isInteger(Number(row.machine_id))) continue;
    const entry = { start, end, reasonCode: String(row.reason_code || '').toUpperCase() };
    const key = Number(row.machine_id);
    if (!byMachineId.has(key)) byMachineId.set(key, []);
    byMachineId.get(key).push(entry);
  }
  return { machines, names, byMachineId };
}

function resolveMachineId(item, machines) {
  const direct = Number(item.machine_id);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const label = String(item.machine || '').trim();
  const match = machines.find(machine => String(machine.name || '') === label || String(machine.label || '') === label);
  return match ? Number(match.id) : null;
}

function median(values = []) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function reportProductionTiming(db, { fromDate, toDate } = {}) {
  if (!validDay(fromDate) || !validDay(toDate) || fromDate > toDate) throw new Error('invalid production date range');
  const stopData = stopIndex(db);
  const rows = db.prepare(`
    SELECT i.*, COALESCE(i.order_id, p.order_id) AS report_order_id,
           o.order_num AS report_order_num
    FROM items i
    LEFT JOIN pallets p ON p.id=i.pallet_id
    LEFT JOIN orders o ON o.id=COALESCE(i.order_id,p.order_id)
    WHERE i.completed_at IS NOT NULL
    ORDER BY datetime(i.completed_at), i.id
  `).all();

  const items = [];
  for (const item of rows) {
    const completedAt = asDate(item.completed_at);
    if (!completedAt) continue;
    const productionDay = israelDay(completedAt);
    if (!productionDay || productionDay < fromDate || productionDay > toDate) continue;
    const startedAt = asDate(item.started_at);
    const profile = shapeProfile(item);
    const machineId = resolveMachineId(item, stopData.machines);
    const machine = machineDisplayName(item, stopData.names);
    const quantity = itemProducedQuantity(item);
    const weight = itemWeightKg(item, quantity);
    const base = {
      item_id: Number(item.id),
      order_id: Number(item.report_order_id) || null,
      order_num: item.report_order_num || null,
      machine_id: machineId,
      machine,
      production_day: productionDay,
      started_at: startedAt ? startedAt.toISOString() : null,
      completed_at: completedAt.toISOString(),
      quantity,
      weight_kg: round(weight.kg, 3),
      weight_source: weight.source,
      ...profile,
    };
    if (!startedAt) {
      items.push({ ...base, measurement_status: 'missing_start', measurement_reason: 'לא נרשמה התחלת ייצור', gross_minutes: null, net_minutes: null, cut_length_mm: null, meters_per_min: null, kg_per_min: null, bends_per_min: null });
      continue;
    }
    if (completedAt <= startedAt) {
      items.push({ ...base, measurement_status: 'invalid_range', measurement_reason: 'סיום קודם להתחלה', gross_minutes: null, net_minutes: null, cut_length_mm: null, meters_per_min: null, kg_per_min: null, bends_per_min: null });
      continue;
    }
    const stops = machineId ? (stopData.byMachineId.get(machineId) || []) : [];
    const deductions = deductIntervals(startedAt, completedAt, stops);
    const grossMinutes = (completedAt - startedAt) / 60000;
    const netMinutes = Math.max(0, grossMinutes - deductions.deductedMinutes);
    const cutLengthMm = profile.unitCutLengthMm * quantity;
    const bends = profile.bendCount * quantity;
    items.push({
      ...base,
      measurement_status: netMinutes > 0 ? 'measured' : 'zero_net_time',
      measurement_reason: netMinutes > 0 ? null : 'אין זמן ייצור נטו לאחר ניכויים',
      gross_minutes: round(grossMinutes, 3),
      lunch_minutes: deductions.lunchMinutes,
      documented_stop_minutes: deductions.documentedStopMinutes,
      net_minutes: round(netMinutes, 3),
      cut_length_mm: round(cutLengthMm, 3),
      total_bends: bends,
      meters_per_min: netMinutes > 0 ? round(cutLengthMm / 1000 / netMinutes, 4) : null,
      kg_per_min: netMinutes > 0 ? round(weight.kg / netMinutes, 4) : null,
      bends_per_min: netMinutes > 0 && bends > 0 ? round(bends / netMinutes, 4) : null,
    });
  }

  const measured = items.filter(item => item.measurement_status === 'measured');
  const recipes = new Map();
  for (const item of measured) {
    const key = `${item.machine}|${item.fingerprint}`;
    if (!recipes.has(key)) recipes.set(key, []);
    recipes.get(key).push(item);
  }
  for (const list of recipes.values()) {
    const baseline = list.length >= 5 ? median(list.map(item => item.net_minutes / Math.max(1, item.quantity))) : null;
    for (const item of list) {
      const unitMinutes = item.net_minutes / Math.max(1, item.quantity);
      item.recipe_sample_count = list.length;
      item.recipe_median_min_per_unit = baseline === null ? null : round(baseline, 3);
      item.slowdown_pct = baseline && baseline > 0 ? round(((unitMinutes - baseline) / baseline) * 100, 1) : null;
      item.speed_status = item.slowdown_pct === null ? 'insufficient_history'
        : item.slowdown_pct >= 50 ? 'slow'
          : item.slowdown_pct >= 25 ? 'watch'
            : 'normal';
    }
  }

  const transitions = [];
  const byMachine = new Map();
  for (const item of measured) {
    if (!item.machine_id) continue;
    if (!byMachine.has(item.machine_id)) byMachine.set(item.machine_id, []);
    byMachine.get(item.machine_id).push(item);
  }
  for (const [machineId, machineItems] of byMachine.entries()) {
    const ordered = [...machineItems].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || a.item_id - b.item_id);
    const stops = stopData.byMachineId.get(machineId) || [];
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const start = asDate(previous.completed_at);
      const end = asDate(current.started_at);
      if (!start || !end) continue;
      if (end <= start) {
        transitions.push({ machine_id: machineId, machine: current.machine, previous_item_id: previous.item_id, item_id: current.item_id, gap_status: 'overlap', overlap_minutes: round((start - end) / 60000, 3), gross_gap_minutes: 0, lunch_minutes: 0, documented_stop_minutes: 0, coil_load_minutes: 0, transition_minutes: 0 });
        continue;
      }
      const deductions = deductIntervals(start, end, stops);
      const coilIntervals = stops.filter(stop => stop.reasonCode === 'COIL_LOAD')
        .map(stop => intervalIntersection(start, end, stop.start, stop.end)).filter(Boolean);
      const coilMinutes = unionMinutes(coilIntervals);
      const grossGap = (end - start) / 60000;
      transitions.push({
        machine_id: machineId,
        machine: current.machine,
        previous_item_id: previous.item_id,
        previous_order_num: previous.order_num,
        previous_shape_name: previous.shapeName,
        item_id: current.item_id,
        order_num: current.order_num,
        shape_name: current.shapeName,
        gross_gap_minutes: round(grossGap, 3),
        lunch_minutes: deductions.lunchMinutes,
        documented_stop_minutes: deductions.documentedStopMinutes,
        coil_load_minutes: round(coilMinutes, 3),
        transition_minutes: round(Math.max(0, grossGap - deductions.deductedMinutes), 3),
        gap_status: 'measured',
      });
    }
  }

  const machineSummaries = new Map();
  const orderSummaries = new Map();
  for (const item of measured) {
    const key = item.machine;
    const current = machineSummaries.get(key) || {
      machine: key, measured_cards: 0, unmeasured_cards: 0, net_minutes: 0, lunch_minutes: 0,
      documented_stop_minutes: 0, cut_length_mm: 0, weight_kg: 0, measured_weight_kg: 0,
      estimated_weight_kg: 0, total_bends: 0, transition_minutes: 0, coil_load_minutes: 0,
    };
    current.measured_cards += 1;
    current.net_minutes += item.net_minutes;
    current.lunch_minutes += item.lunch_minutes;
    current.documented_stop_minutes += item.documented_stop_minutes;
    current.cut_length_mm += item.cut_length_mm;
    current.weight_kg += item.weight_kg;
    current.total_bends += item.total_bends;
    if (item.weight_source === 'measured') current.measured_weight_kg += item.weight_kg;
    else current.estimated_weight_kg += item.weight_kg;
    machineSummaries.set(key, current);

    const orderKey = item.order_id ? `order:${item.order_id}` : `unlinked:${item.item_id}`;
    const order = orderSummaries.get(orderKey) || {
      order_id: item.order_id,
      order_num: item.order_num || 'ללא הזמנה',
      measured_cards: 0,
      unmeasured_cards: 0,
      net_minutes: 0,
      lunch_minutes: 0,
      documented_stop_minutes: 0,
      cut_length_mm: 0,
      weight_kg: 0,
      profiles: new Set(),
    };
    order.measured_cards += 1;
    order.net_minutes += item.net_minutes;
    order.lunch_minutes += item.lunch_minutes;
    order.documented_stop_minutes += item.documented_stop_minutes;
    order.cut_length_mm += item.cut_length_mm;
    order.weight_kg += item.weight_kg;
    order.profiles.add(`${item.shapeName} · Ø${item.diameterMm} מ״מ`);
    orderSummaries.set(orderKey, order);
  }
  for (const item of items.filter(item => item.measurement_status !== 'measured')) {
    const key = item.machine;
    const current = machineSummaries.get(key) || {
      machine: key, measured_cards: 0, unmeasured_cards: 0, net_minutes: 0, lunch_minutes: 0,
      documented_stop_minutes: 0, cut_length_mm: 0, weight_kg: 0, measured_weight_kg: 0,
      estimated_weight_kg: 0, total_bends: 0, transition_minutes: 0, coil_load_minutes: 0,
    };
    current.unmeasured_cards += 1;
    machineSummaries.set(key, current);

    const orderKey = item.order_id ? `order:${item.order_id}` : `unlinked:${item.item_id}`;
    const order = orderSummaries.get(orderKey) || {
      order_id: item.order_id,
      order_num: item.order_num || 'ללא הזמנה',
      measured_cards: 0,
      unmeasured_cards: 0,
      net_minutes: 0,
      lunch_minutes: 0,
      documented_stop_minutes: 0,
      cut_length_mm: 0,
      weight_kg: 0,
      profiles: new Set(),
    };
    order.unmeasured_cards += 1;
    order.profiles.add(`${item.shapeName} · Ø${item.diameterMm} מ״מ`);
    orderSummaries.set(orderKey, order);
  }
  for (const transition of transitions) {
    if (transition.gap_status !== 'measured') continue;
    const current = machineSummaries.get(transition.machine);
    if (!current) continue;
    current.transition_minutes += transition.transition_minutes;
    current.coil_load_minutes += transition.coil_load_minutes;
  }
  const machines = [...machineSummaries.values()].map(row => ({
    ...row,
    net_minutes: round(row.net_minutes, 3),
    lunch_minutes: round(row.lunch_minutes, 3),
    documented_stop_minutes: round(row.documented_stop_minutes, 3),
    cut_length_mm: round(row.cut_length_mm, 3),
    weight_kg: round(row.weight_kg, 3),
    measured_weight_kg: round(row.measured_weight_kg, 3),
    estimated_weight_kg: round(row.estimated_weight_kg, 3),
    transition_minutes: round(row.transition_minutes, 3),
    coil_load_minutes: round(row.coil_load_minutes, 3),
    meters_per_min: row.net_minutes > 0 ? round(row.cut_length_mm / 1000 / row.net_minutes, 4) : null,
    kg_per_min: row.net_minutes > 0 ? round(row.weight_kg / row.net_minutes, 4) : null,
    bends_per_min: row.net_minutes > 0 && row.total_bends > 0 ? round(row.total_bends / row.net_minutes, 4) : null,
  })).sort((a, b) => b.net_minutes - a.net_minutes || a.machine.localeCompare(b.machine, 'he'));

  const recipeSummaries = [...recipes.values()].map(list => {
    const first = list[0];
    const netMinutes = list.reduce((sum, item) => sum + item.net_minutes, 0);
    const cutLengthMm = list.reduce((sum, item) => sum + item.cut_length_mm, 0);
    const weightKg = list.reduce((sum, item) => sum + item.weight_kg, 0);
    const bends = list.reduce((sum, item) => sum + item.total_bends, 0);
    return {
      machine: first.machine,
      shape_name: first.shapeName,
      shape_type: first.shapeType,
      diameter_mm: first.diameterMm,
      unit_cut_length_mm: first.unitCutLengthMm,
      bend_count: first.bendCount,
      bend_angles: first.bendAngles,
      sample_count: list.length,
      net_minutes: round(netMinutes, 3),
      cut_length_mm: round(cutLengthMm, 3),
      weight_kg: round(weightKg, 3),
      meters_per_min: netMinutes > 0 ? round(cutLengthMm / 1000 / netMinutes, 4) : null,
      kg_per_min: netMinutes > 0 ? round(weightKg / netMinutes, 4) : null,
      bends_per_min: netMinutes > 0 && bends > 0 ? round(bends / netMinutes, 4) : null,
      median_min_per_unit: list.length >= 5 ? round(median(list.map(item => item.net_minutes / Math.max(1, item.quantity)), 3), 3) : null,
    };
  }).sort((a, b) => b.net_minutes - a.net_minutes || a.machine.localeCompare(b.machine, 'he'));

  const orders = [...orderSummaries.values()].map(order => ({
    ...order,
    profiles: [...order.profiles].sort((a, b) => a.localeCompare(b, 'he')),
    net_minutes: round(order.net_minutes, 3),
    lunch_minutes: round(order.lunch_minutes, 3),
    documented_stop_minutes: round(order.documented_stop_minutes, 3),
    cut_length_mm: round(order.cut_length_mm, 3),
    weight_kg: round(order.weight_kg, 3),
    meters_per_min: order.net_minutes > 0 ? round(order.cut_length_mm / 1000 / order.net_minutes, 4) : null,
    kg_per_min: order.net_minutes > 0 ? round(order.weight_kg / order.net_minutes, 4) : null,
  })).sort((a, b) => b.net_minutes - a.net_minutes || String(a.order_num).localeCompare(String(b.order_num), 'he'));

  return {
    period: { from: fromDate, to: toDate, time_zone: FACTORY_TIME_ZONE, lunch: { start: '12:00', end: '12:45' } },
    cards: items.sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)) || b.item_id - a.item_id),
    orders,
    machines,
    recipes: recipeSummaries,
    transitions: transitions.sort((a, b) => b.transition_minutes - a.transition_minutes || b.item_id - a.item_id),
    data_quality: {
      completed_cards: items.length,
      measured_cards: measured.length,
      unmeasured_cards: items.length - measured.length,
      transition_count: transitions.filter(row => row.gap_status === 'measured').length,
      overlap_anomalies: transitions.filter(row => row.gap_status === 'overlap').length,
    },
  };
}

module.exports = {
  FACTORY_TIME_ZONE,
  LUNCH_START_MINUTE,
  LUNCH_END_MINUTE,
  asDate,
  israelDay,
  validDay,
  factoryLocalTimeUtc,
  lunchIntervals,
  unionMinutes,
  deductIntervals,
  shapeProfile,
  reportProductionTiming,
};
