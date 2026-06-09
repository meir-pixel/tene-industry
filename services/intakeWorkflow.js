function importCell(row, aliases) {
  const normalized = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [String(key).trim().toLowerCase().replace(/[\s_-]+/g, ''), value])
  );
  for (const alias of aliases) {
    const value = normalized[String(alias).toLowerCase().replace(/[\s_-]+/g, '')];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function parseDelimitedRows(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const delimiter = text.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  const records = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      cell = '';
      if (row.some(value => String(value).trim())) records.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some(value => String(value).trim())) records.push(row);
  if (!records.length) throw Object.assign(new Error('CSV file is empty'), { statusCode: 400 });
  const headers = records.shift().map(header => String(header).trim());
  return records.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function buildOrderImportPreview(buffer, { orderExists = () => false } = {}) {
  const rows = parseDelimitedRows(buffer);
  const groups = new Map();
  const errors = [];

  rows.forEach((row, index) => {
    const sourceOrderNum = String(importCell(row, ['order_num', 'ordernum', 'order', 'מספרהזמנה', 'הזמנה']) || '').trim();
    const customerName = String(importCell(row, ['customer_name', 'customer', 'client', 'לקוח', 'שםלקוח']) || '').trim();
    const customerPhone = String(importCell(row, ['customer_phone', 'phone', 'טלפון', 'טלפוןלקוח']) || '').trim();
    const deliveryDate = String(importCell(row, ['delivery_date', 'deliverydate', 'אספקה', 'תאריךאספקה']) || '').trim();
    const deliveryAddress = String(importCell(row, ['delivery_address', 'address', 'כתובת', 'כתובתאספקה']) || '').trim();
    const diameter = Number(importCell(row, ['diameter', 'dia', 'קוטר']));
    const length = Number(importCell(row, ['length', 'length_mm', 'אורך', 'אורךממ']));
    const qty = Number(importCell(row, ['qty', 'quantity', 'כמות']));
    const shape = String(importCell(row, ['shape', 'shape_name', 'צורה']) || 'straight').trim();
    const notes = String(importCell(row, ['notes', 'note', 'הערות']) || '').trim();
    const rowErrors = [];
    if (!customerName) rowErrors.push('customer is required');
    if (!(diameter > 0)) rowErrors.push('diameter is required');
    if (!(length > 0)) rowErrors.push('length is required');
    if (!(qty > 0)) rowErrors.push('quantity is required');
    if (rowErrors.length) {
      errors.push({ row: index + 2, errors: rowErrors });
      return;
    }
    const groupKey = sourceOrderNum || `${customerName}|${deliveryDate}|${deliveryAddress}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        sourceOrderNum,
        duplicate: Boolean(sourceOrderNum && orderExists(sourceOrderNum)),
        payload: {
          customer: { name: customerName, phone: customerPhone, address: deliveryAddress },
          order: { orderNum: sourceOrderNum || undefined, channel: 'spreadsheet', deliveryDate, deliveryAddress, priority: 'regular' },
          pallets: [{ maxWeight: 9999, items: [] }],
        },
      });
    }
    groups.get(groupKey).payload.pallets[0].items.push({
      diameter,
      length,
      sides: [length],
      qty,
      shapeId: shape,
      shapeName: shape,
      note: notes,
    });
  });

  return { orders: [...groups.values()], errors, rowCount: rows.length };
}

function parseManualIntakeText({ text, source, parseWhatsAppMessage, parseOCRText }) {
  if (!text) throw Object.assign(new Error('text required'), { statusCode: 400 });
  const parsed = source === 'whatsapp'
    ? parseWhatsAppMessage(text)
    : parseOCRText(text);
  parsed.source = source || 'manual';
  return parsed;
}

function extractFirstEmailFromText(value) {
  const match = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : '';
}

function cleanRecognizedCustomerName(value) {
  const name = String(value || '').trim();
  if (!name) return '';
  if (extractFirstEmailFromText(name)) return '';
  if (extractFirstPhoneFromText(name)) return '';
  if (/^https?:\/\//i.test(name)) return '';
  return name;
}

function isTechnicalRecognitionNote(value) {
  const note = String(value || '').trim();
  if (!note) return false;
  if (note.length > 220) return true;
  return /cover page|row\s+\d+|interpreted|sketch|review required|reported total|segment sum|length surplus|unclear|uncertain|conservatively|tassa|pdf/i.test(note);
}

function operationalOrderNote(value) {
  const note = String(value || '').trim();
  return isTechnicalRecognitionNote(note) ? '' : note;
}

function normalizeIntakePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '').replace(/^972/, '0');
}

function extractFirstPhoneFromText(value) {
  const match = String(value || '').match(/(?:\+?972|0)[\d\s().-]{7,14}/);
  return match ? normalizeIntakePhone(match[0]) : '';
}

function resolveIntakeCustomer(parsed = {}, rawContent = '', lookups = {}) {
  const name = cleanRecognizedCustomerName(parsed.customer_name || parsed.customerName || parsed.name || '');
  const phone = normalizeIntakePhone(parsed.customer_phone || parsed.customerPhone || parsed.phone || extractFirstPhoneFromText(rawContent));
  const email = String(parsed.customer_email || parsed.customerEmail || extractFirstEmailFromText(rawContent) || '').trim().toLowerCase();
  const priorityId = String(parsed.priority_id || parsed.priorityId || parsed.customer_id || parsed.customerId || '').trim();
  const candidates = [];
  const pushCandidate = (row, matchType, confidence) => {
    if (!row || candidates.some(candidate => candidate.id === row.id)) return;
    candidates.push({
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      priority_id: row.priority_id,
      match_type: matchType,
      confidence,
    });
  };

  if (phone) pushCandidate(lookups.byPhone?.(phone), 'phone', 0.98);
  if (email) pushCandidate(lookups.byEmail?.(email), 'email', 0.96);
  if (priorityId) pushCandidate(lookups.byPriorityId?.(priorityId), 'priority_id', 0.92);
  if (name) pushCandidate(lookups.byName?.(name), 'name', 0.82);

  const best = candidates[0] || null;
  return {
    input: { name, phone, email, priority_id: priorityId },
    customer: best,
    candidates,
    needs_customer_review: !best || best.confidence < 0.9,
  };
}

function normalizeIntakeItem(item = {}) {
  const sourceSides = Array.isArray(item.sides) ? item.sides : [];
  const sides = sourceSides.map(Number).filter(length => Number.isFinite(length) && length > 0);
  const fallbackLength = Number(item.length ?? item.total_length_mm ?? 0);
  if (!sides.length && fallbackLength > 0) sides.push(fallbackLength);
  const length = sides.reduce((sum, side) => sum + side, 0);
  const sourceAngles = Array.isArray(item.angles) ? item.angles : [];
  const angles = sourceAngles.length
    ? sourceAngles.map(Number)
    : Array(Math.max(0, sides.length - 1)).fill(90);
  const qty = Number(item.qty ?? item.quantity ?? 1);
  return {
    diameter: Number(item.diameter),
    length,
    sides,
    angles,
    qty,
    shapeId: item.shapeId || item.shape || (sides.length === 3 ? 's3' : 's1'),
    shapeName: item.shapeName || item.shape || (sides.length === 3 ? 'U - anchor' : 'straight'),
    note: item.notes || item.note || '',
  };
}

function distributeSurplusToEndSegments(sourceSegments, reportedLengthMm) {
  const segments = (sourceSegments || []).map(segment => ({
    ...segment,
    length_mm: Number(segment.length_mm || 0),
  }));
  const reportedLength = Number(reportedLengthMm || 0);
  const segmentSum = segments.reduce((sum, segment) => sum + segment.length_mm, 0);
  const surplus = reportedLength - segmentSum;

  if (!reportedLength || !segments.length || surplus <= 0.001) {
    return {
      segments,
      adjusted: false,
      surplus: 0,
      perEnd: 0,
      totalLength: segmentSum,
      segmentSum,
    };
  }

  const perEnd = surplus / 2;
  const lastIndex = segments.length - 1;
  segments[0].length_mm = Number((segments[0].length_mm + perEnd).toFixed(3));
  if (lastIndex > 0) {
    segments[lastIndex].length_mm = Number((segments[lastIndex].length_mm + perEnd).toFixed(3));
  } else {
    segments[0].length_mm = Number((segments[0].length_mm + perEnd).toFixed(3));
  }

  return {
    segments,
    adjusted: true,
    surplus: Number(surplus.toFixed(3)),
    perEnd: Number(perEnd.toFixed(3)),
    totalLength: reportedLength,
    segmentSum,
  };
}

function buildIntakeOrderPayload(parsed = {}, {
  source = 'intake',
  customerOverride = null,
  rawContent = '',
  findCustomerById = () => null,
  resolveCustomer = () => null,
  calcWeightPerUnit = () => 0,
} = {}) {
  const items = (parsed.items || []).map(normalizeIntakeItem);
  const overrideCustomer = customerOverride?.id ? findCustomerById(customerOverride.id) : null;
  const match = customerOverride?.id ? null : resolveCustomer(parsed, rawContent);
  const selectedCustomer = overrideCustomer || customerOverride || match;
  return {
    customer: {
      id: selectedCustomer?.id || null,
      name: customerOverride?.name || selectedCustomer?.name || cleanRecognizedCustomerName(parsed.customer_name || parsed.customerName) || 'Unidentified customer',
      phone: customerOverride?.phone || selectedCustomer?.phone || parsed.customer_phone || parsed.customerPhone || '',
      email: customerOverride?.email || selectedCustomer?.email || parsed.customer_email || parsed.customerEmail || extractFirstEmailFromText(rawContent),
      address: parsed.delivery_address || parsed.deliveryAddress || '',
    },
    order: {
      channel: source,
      deliveryDate: parsed.delivery_date || parsed.deliveryDate || null,
      deliveryAddress: parsed.delivery_address || parsed.deliveryAddress || '',
      priority: parsed.priority || 'regular',
      generalNotes: operationalOrderNote(parsed.notes),
      totalWeight: items.reduce((sum, item) => sum + calcWeightPerUnit(item.diameter, item.length) * item.qty, 0),
    },
    pallets: [{ maxWeight: 9999, items }],
  };
}

module.exports = {
  buildIntakeOrderPayload,
  buildOrderImportPreview,
  cleanRecognizedCustomerName,
  distributeSurplusToEndSegments,
  extractFirstEmailFromText,
  extractFirstPhoneFromText,
  importCell,
  isTechnicalRecognitionNote,
  normalizeIntakePhone,
  normalizeIntakeItem,
  operationalOrderNote,
  parseDelimitedRows,
  parseManualIntakeText,
  resolveIntakeCustomer,
};
