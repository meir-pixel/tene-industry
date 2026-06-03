const axios = require('axios');
const router = require('express').Router();

const {
  MATERIAL_TYPES,
  bendingShapeColumns,
  normalizeBendingShapeInput,
  normalizeReceiptReviewItem,
  parseReceiptReviewPayload,
} = require('../services/inventory');

function required(name, value) {
  if (!value) throw new Error(`routes/inventory missing dependency: ${name}`);
  return value;
}

module.exports = function createInventoryRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const analyzeBendingShapeAuthorization = required('analyzeBendingShapeAuthorization', deps.analyzeBendingShapeAuthorization);
  const imageAnalysisLimiter = required('imageAnalysisLimiter', deps.imageAnalysisLimiter);
  const upload = required('upload', deps.upload);
  const getSetting = required('getSetting', deps.getSetting);
  const getOpenAiApiKey = required('getOpenAiApiKey', deps.getOpenAiApiKey);
  const getIntakeTrainingGuidance = required('getIntakeTrainingGuidance', deps.getIntakeTrainingGuidance);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);
  const auditLog = required('auditLog', deps.auditLog);
  const listPage = required('listPage', deps.listPage);

  router.post('/inventory/analyze-bending-shape', analyzeBendingShapeAuthorization, imageAnalysisLimiter, upload.single('image'), async (req, res) => {
    if (getSetting('INTAKE_AI_ENABLED') !== 'true') return res.status(501).json({ error: 'Document recognition is disabled', feature: 'intake-ai' });
    const openaiKey = getOpenAiApiKey();
    if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
    if (!req.file) return res.status(400).json({ error: 'Image or PDF is required' });
    const mime = req.file.mimetype || 'image/jpeg';
    if (mime !== 'application/pdf' && !mime.startsWith('image/')) {
      return res.status(400).json({ error: 'Only images and PDFs are supported' });
    }
    const fileData = req.file.buffer.toString('base64');
    const attachment = mime === 'application/pdf'
      ? { type: 'input_file', filename: req.file.originalname || 'bending-shape.pdf', file_data: `data:application/pdf;base64,${fileData}` }
      : { type: 'input_image', image_url: `data:${mime};base64,${fileData}`, detail: 'high' };
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        shape_name: { type: 'string' },
        diameter: { type: ['number', 'null'] },
        material_grade: { type: ['string', 'null'] },
        confidence: { type: 'number' },
        segments: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              length_mm: { type: 'number' },
              angle_deg: { type: 'number' },
            },
            required: ['length_mm', 'angle_deg'],
          },
        },
        total_length_mm: { type: 'number' },
        notes: { type: ['string', 'null'] },
      },
      required: ['shape_name', 'diameter', 'material_grade', 'confidence', 'segments', 'total_length_mm', 'notes'],
    };
    const trainingGuidance = getIntakeTrainingGuidance(12, ['bending_shape', 'bar_schedule', 'general']);
    const prompt = `Analyze this rebar bending shape image.
Return only one bending shape. Read visible dimensions and bend angles.
${trainingGuidance}
length_mm must be millimeters. If dimensions are written in centimeters, convert to millimeters.
Trace the bar continuously from one physical end to the other. Use one segment per visible side.
angle_deg is the interior bend angle after that segment: 180 for straight continuation, 90 for square bends, 135 for diagonal bends.
If the drawing is uncertain, keep the conservative simple shape and explain uncertainty in notes.
Do not invent unreadable numbers.`;
    try {
      const response = await axios.post('https://api.openai.com/v1/responses', {
        model: getSetting('OPENAI_MODEL') || 'gpt-5.4-mini',
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, attachment] }],
        text: { format: { type: 'json_schema', name: 'ironbend_bending_shape', strict: true, schema } },
      }, {
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      });
      const text = (response.data?.output || [])
        .flatMap(entry => entry.content || [])
        .find(entry => entry.type === 'output_text')?.text;
      const parsed = JSON.parse(text || '{}');
      const segments = normalizeBendingShapeInput({ bending_shape_segments: parsed.segments || [] }).segments;
      if (!segments.length) return res.status(422).json({ error: 'No bending shape was recognized' });
      res.json({
        success: true,
        shape_name: String(parsed.shape_name || 'כיפוף מזוהה').trim(),
        diameter: parsed.diameter == null ? null : Number(parsed.diameter),
        material_grade: parsed.material_grade || null,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        segments,
        total_length_mm: segments.reduce((sum, segment) => sum + segment.length_mm, 0),
        notes: parsed.notes || null,
      });
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message;
      res.status(500).json({ error: `Bending shape recognition failed: ${message}` });
    }
  });

  router.get('/suppliers', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare('SELECT * FROM suppliers WHERE active=1 ORDER BY name').all());
  });

  router.post('/suppliers', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const { name, phone, contact, email, address, payment_terms, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'שם ספק חובה' });
    const r = db.prepare('INSERT INTO suppliers (name,phone,contact,email,address,payment_terms,notes) VALUES (?,?,?,?,?,?,?)')
      .run(name, phone || null, contact || null, email || null, address || null, payment_terms || null, notes || null);
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/suppliers/:id', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    db.prepare('UPDATE suppliers SET name=COALESCE(?,name),phone=COALESCE(?,phone),contact=COALESCE(?,contact),email=COALESCE(?,email),address=COALESCE(?,address),payment_terms=COALESCE(?,payment_terms),notes=COALESCE(?,notes),active=COALESCE(?,active) WHERE id=?')
      .run(f.name || null, f.phone || null, f.contact || null, f.email || null, f.address || null, f.payment_terms || null, f.notes || null, f.active ?? null, req.params.id);
    res.json({ success: true });
  });

  router.get('/inventory', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const { diameter, supplier_id } = req.query;
    const page = listPage(req.query, { limit: 200, max: 1000 });
    let sql = 'SELECT r.*,s.name as supplier_name,ROUND(r.weight_received-r.weight_used-r.weight_scrapped,2) as weight_available FROM raw_material r LEFT JOIN suppliers s ON r.supplier_id=s.id WHERE r.active=1';
    const params = [];
    if (diameter) { sql += ' AND r.diameter=?'; params.push(diameter); }
    if (supplier_id) { sql += ' AND r.supplier_id=?'; params.push(supplier_id); }
    sql += ' ORDER BY r.received_date DESC, r.id DESC LIMIT ? OFFSET ?';
    params.push(page.limit, page.offset);
    res.json(db.prepare(sql).all(...params));
  });

  router.get('/inventory/summary', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare('SELECT diameter,SUM(weight_received) as total_received,SUM(weight_used) as total_used,SUM(weight_scrapped) as total_scrapped,ROUND(SUM(weight_received-weight_used-weight_scrapped),2) as available,COUNT(*) as batches FROM raw_material WHERE active=1 GROUP BY diameter ORDER BY diameter').all());
  });

  router.get('/inventory/receipt-reviews', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const status = req.query.status || 'pending_review';
    const rows = db.prepare(`
      SELECT rr.*, s.name AS supplier_master_name
      FROM inventory_receipt_reviews rr
      LEFT JOIN suppliers s ON s.id=rr.supplier_id
      WHERE rr.status=?
      ORDER BY rr.created_at DESC, rr.id DESC
      LIMIT 100
    `).all(status);
    res.json(rows);
  });

  // ── סריקת תווית → הוספה מהירה למלאי ─────────────────────────
  // מסלול מהיר: צלם תווית → AI ממלא → עובד מאשר → raw_material
  // AI קרא מה שהצליח — אם לא קרא שדה, מחזיר null (לא שגיאה)
  router.post('/inventory/scan-label', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), imageAnalysisLimiter, upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'נדרשת תמונה' });
    if (getSetting('INTAKE_AI_ENABLED') !== 'true') {
      // AI מושבת — מחזיר טופס ריק לעובד למלא ידנית
      return res.json({ success: true, aiUsed: false, data: { diameter: null, lot_number: null, weight_kg: null, grade: 'B500B', material_type: 'coil', certificate_num: null, notes: null } });
    }
    const openaiKey = getOpenAiApiKey();
    if (!openaiKey) {
      return res.json({ success: true, aiUsed: false, data: { diameter: null, lot_number: null, weight_kg: null, grade: 'B500B', material_type: 'coil', certificate_num: null, notes: null } });
    }

    const mime     = req.file.mimetype || 'image/jpeg';
    const fileData = req.file.buffer.toString('base64');
    const schema   = {
      type: 'object',
      additionalProperties: false,
      properties: {
        diameter:        { type: ['number',  'null'] },
        lot_number:      { type: ['string',  'null'] },
        weight_kg:       { type: ['number',  'null'] },
        grade:           { type: ['string',  'null'] },
        material_type:   { type: ['string',  'null'] },
        certificate_num: { type: ['string',  'null'] },
        supplier_name:   { type: ['string',  'null'] },
        notes:           { type: ['string',  'null'] },
        confidence:      { type: ['number',  'null'] },
      },
      required: ['diameter', 'lot_number', 'weight_kg', 'grade', 'material_type', 'certificate_num', 'supplier_name', 'notes', 'confidence'],
    };

    const prompt = `You are reading a steel bar or coil label in a factory warehouse.
Extract ONLY what is clearly visible. Return null for any field you cannot read confidently.

Fields to extract:
- diameter: bar diameter in mm (integer: 6,8,10,12,14,16,20,25,32 etc.)
- lot_number: lot or heat number (text on label, often "LOT", "חום", "לוט", or a code)
- weight_kg: net weight in kg (number only, ignore "ק\"ג" or "KG" suffix)
- grade: steel grade (B500B, B500C, or similar — default B500B if not visible)
- material_type: "coil" for coils/ملف, "straight" for straight bars/ישר
- certificate_num: material certificate number if visible
- supplier_name: supplier name if visible on label
- notes: any other relevant text (heat treatment, standard, etc.)
- confidence: 0.0–1.0 overall confidence in the reading

IMPORTANT:
- If weight is not on the label, return null for weight_kg (do not guess)
- Diameter is critical — if unclear, return null
- lot_number is critical — if unclear, return null
Return JSON matching the schema only.`;

    try {
      const response = await axios.post('https://api.openai.com/v1/responses', {
        model: getSetting('OPENAI_MODEL') || 'gpt-4o-mini',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: `data:${mime};base64,${fileData}`, detail: 'high' },
          ],
        }],
        text: { format: { type: 'json_schema', name: 'label_scan', strict: true, schema } },
      }, {
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      const text   = (response.data?.output || []).flatMap(e => e.content || []).find(e => e.type === 'output_text')?.text;
      const parsed = JSON.parse(text || '{}');

      // נסה לזהות ספק לפי שם
      let supplierId = null;
      if (parsed.supplier_name) {
        const s = db.prepare('SELECT id FROM suppliers WHERE name LIKE ? LIMIT 1').get(`%${parsed.supplier_name}%`);
        if (s) supplierId = s.id;
      }

      res.json({
        success:    true,
        aiUsed:     true,
        confidence: parsed.confidence ?? null,
        data: {
          diameter:        parsed.diameter        ?? null,
          lot_number:      parsed.lot_number      ?? null,
          weight_kg:       parsed.weight_kg       ?? null,
          grade:           parsed.grade           || 'B500B',
          material_type:   parsed.material_type   || 'coil',
          certificate_num: parsed.certificate_num ?? null,
          supplier_name:   parsed.supplier_name   ?? null,
          supplier_id:     supplierId,
          notes:           parsed.notes           ?? null,
        },
      });
    } catch (err) {
      // AI נכשל — מחזיר טופס ריק, לא שגיאה
      console.warn('[scan-label] AI failed:', err.message);
      res.json({
        success: true,
        aiUsed:  false,
        aiError: err.message,
        data: { diameter: null, lot_number: null, weight_kg: null, grade: 'B500B', material_type: 'coil', certificate_num: null, supplier_name: null, supplier_id: null, notes: null },
      });
    }
  });

  router.post('/inventory/receipt-reviews/analyze', analyzeBendingShapeAuthorization, imageAnalysisLimiter, upload.single('image'), async (req, res) => {
    if (getSetting('INTAKE_AI_ENABLED') !== 'true') return res.status(501).json({ error: 'Document recognition is disabled', feature: 'intake-ai' });
    const openaiKey = getOpenAiApiKey();
    if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
    if (!req.file) return res.status(400).json({ error: 'Supplier delivery note image or PDF is required' });
    const mime = req.file.mimetype || 'image/jpeg';
    if (mime !== 'application/pdf' && !mime.startsWith('image/')) {
      return res.status(400).json({ error: 'Only images and PDFs are supported' });
    }
    const fileData = req.file.buffer.toString('base64');
    const dataUrl = `data:${mime};base64,${fileData}`;
    const attachment = mime === 'application/pdf'
      ? { type: 'input_file', filename: req.file.originalname || 'supplier-delivery-note.pdf', file_data: dataUrl }
      : { type: 'input_image', image_url: dataUrl, detail: 'high' };
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        supplier_name: { type: ['string', 'null'] },
        delivery_note_num: { type: ['string', 'null'] },
        received_date: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              material_type: { type: 'string' },
              diameter: { type: ['number', 'null'] },
              lot_number: { type: ['string', 'null'] },
              certificate_num: { type: ['string', 'null'] },
              grade: { type: ['string', 'null'] },
              weight_kg: { type: ['number', 'null'] },
              purchase_price: { type: ['number', 'null'] },
              warehouse_loc: { type: ['string', 'null'] },
              shape_name: { type: ['string', 'null'] },
              segments: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    length_mm: { type: 'number' },
                    angle_deg: { type: 'number' },
                  },
                  required: ['length_mm', 'angle_deg'],
                },
              },
              confidence: { type: ['number', 'null'] },
              notes: { type: ['string', 'null'] },
            },
            required: ['material_type', 'diameter', 'lot_number', 'certificate_num', 'grade', 'weight_kg', 'purchase_price', 'warehouse_loc', 'shape_name', 'segments', 'confidence', 'notes'],
          },
        },
      },
      required: ['supplier_name', 'delivery_note_num', 'received_date', 'notes', 'items'],
    };
    const trainingGuidance = getIntakeTrainingGuidance(12, ['supplier_delivery_note', 'bar_schedule', 'bending_shape', 'general']);
    const prompt = `Read this supplier delivery note / raw material receipt document.
Return the material received, but do not invent unreadable values.
${trainingGuidance}
The document may be a photo, PDF, supplier delivery note, lab certificate, or handwritten receipt.
Extract supplier_name, delivery_note_num, received_date as YYYY-MM-DD when visible, and every material row.
For each row return material_type: coil, straight, or bent.
For raw rebar stock, diameter is millimeters and weight_kg is kilograms.
Use lot_number for heat number / melt number / batch number when visible.
Use certificate_num for lab certificate or material certificate number when visible.
If a row is a bent shape, include shape_name and continuous bending segments in millimeters.
Put uncertainty in notes. The manager will compare this parsed data against the original image before approval.`;
    try {
      const response = await axios.post('https://api.openai.com/v1/responses', {
        model: getSetting('OPENAI_MODEL') || 'gpt-5.4-mini',
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, attachment] }],
        text: { format: { type: 'json_schema', name: 'ironbend_supplier_receipt', strict: true, schema } },
      }, {
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      });
      const text = (response.data?.output || [])
        .flatMap(entry => entry.content || [])
        .find(entry => entry.type === 'output_text')?.text;
      const parsed = parseReceiptReviewPayload(JSON.parse(text || '{}'));
      const supplier = parsed.supplier_name
        ? db.prepare('SELECT id FROM suppliers WHERE name LIKE ? AND active=1 ORDER BY id LIMIT 1').get(`%${parsed.supplier_name}%`)
        : null;
      parsed.items = parsed.items.map(item => ({
        ...item,
        supplier_id: supplier?.id || null,
        received_date: item.received_date || parsed.received_date || new Date().toISOString().slice(0, 10),
        lot_number: item.lot_number || parsed.delivery_note_num || null,
      }));
      const row = db.prepare(`
        INSERT INTO inventory_receipt_reviews
          (original_filename,original_mime,original_data_url,supplier_id,supplier_name,delivery_note_num,parsed_data,status)
        VALUES (?,?,?,?,?,?,?,'pending_review')
      `).run(req.file.originalname || null, mime, dataUrl, supplier?.id || null, parsed.supplier_name, parsed.delivery_note_num, JSON.stringify(parsed));
      wsBroadcast('inventory_receipt_review_created', { id: row.lastInsertRowid, supplier_name: parsed.supplier_name, item_count: parsed.items.length });
      res.json({ success: true, id: row.lastInsertRowid, parsed });
    } catch (err) {
      console.error('[Inventory Receipt OCR]', err.response?.data || err.message);
      res.status(502).json({ error: 'Supplier delivery note recognition failed', detail: err.response?.data?.error?.message || err.message });
    }
  });

  router.post('/inventory/receipt-reviews/:id/approve', requireAnyRole(['manager', 'admin']), (req, res) => {
    const review = db.prepare('SELECT * FROM inventory_receipt_reviews WHERE id=?').get(req.params.id);
    if (!review) return res.status(404).json({ error: 'not found' });
    if (review.status !== 'pending_review') return res.status(409).json({ error: 'review is not pending', status: review.status });
    const parsed = parseReceiptReviewPayload(JSON.parse(review.parsed_data || '{}'));
    const ids = [];
    const insert = db.prepare(`
      INSERT INTO raw_material
        (material_type,diameter,supplier_id,lot_number,certificate_num,grade,received_date,weight_received,purchase_price,warehouse_loc,bending_shape_name,bending_shape_segments,bending_shape_source,bending_shape_confidence,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const tx = db.transaction(() => {
      for (const rawItem of parsed.items) {
        const item = normalizeReceiptReviewItem({ ...rawItem, supplier_id: rawItem.supplier_id || review.supplier_id });
        if (!item.diameter || !item.weight_received) throw new Error('diameter and weight are required for every approved receipt row');
        if (item.material_type === 'bent' && (!item.bending_shape_name || !item.bending_shape_segments)) {
          throw new Error('bending shape is required for bent material receipt rows');
        }
        const result = insert.run(item.material_type, item.diameter, item.supplier_id, item.lot_number, item.certificate_num, item.grade,
          item.received_date || parsed.received_date || new Date().toISOString().slice(0, 10), item.weight_received, item.purchase_price,
          item.warehouse_loc, item.bending_shape_name, item.bending_shape_segments, item.bending_shape_source, item.bending_shape_confidence,
          item.notes || parsed.notes || null);
        ids.push(result.lastInsertRowid);
      }
      db.prepare(`
        UPDATE inventory_receipt_reviews
        SET status='approved', raw_material_ids=?, reviewed_by=?, review_notes=?, reviewed_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(JSON.stringify(ids), req.auth?.sub || null, req.body?.notes || null, review.id);
    });
    try {
      tx();
      auditLog('inventory_receipt_review', review.id, review.delivery_note_num, 'approve', 'status', 'pending_review', 'approved', req.body?.notes || null, req.auth?.sub || null, req.auth?.display_name || null);
      wsBroadcast('inventory_receipt_review_approved', { id: review.id, raw_material_ids: ids });
      res.json({ success: true, raw_material_ids: ids });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/inventory/receipt-reviews/:id/reject', requireAnyRole(['manager', 'admin']), (req, res) => {
    const review = db.prepare('SELECT * FROM inventory_receipt_reviews WHERE id=?').get(req.params.id);
    if (!review) return res.status(404).json({ error: 'not found' });
    db.prepare(`
      UPDATE inventory_receipt_reviews
      SET status='rejected', reviewed_by=?, review_notes=?, reviewed_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(req.auth?.sub || null, req.body?.notes || null, req.params.id);
    auditLog('inventory_receipt_review', review.id, review.delivery_note_num, 'reject', 'status', review.status, 'rejected', req.body?.notes || null, req.auth?.sub || null, req.auth?.display_name || null);
    wsBroadcast('inventory_receipt_review_rejected', { id: review.id });
    res.json({ success: true });
  });

  router.post('/inventory', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    if (!f.diameter || !f.weight_received) return res.status(400).json({ error: 'קוטר ומשקל חובה' });
    const materialType = MATERIAL_TYPES.has(f.material_type) ? f.material_type : 'coil';
    const shape = bendingShapeColumns(f);
    if (materialType === 'bent' && (!shape.name || !shape.segments)) {
      return res.status(400).json({ error: 'צורת כיפוף חובה עבור חומר מסוג כיפוף' });
    }
    const r = db.prepare('INSERT INTO raw_material (material_type,diameter,supplier_id,lot_number,certificate_num,grade,received_date,weight_received,purchase_price,warehouse_loc,bending_shape_name,bending_shape_segments,bending_shape_source,bending_shape_confidence,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(materialType, f.diameter, f.supplier_id || null, f.lot_number || null, f.certificate_num || null, f.grade || 'B500B', f.received_date || new Date().toISOString().split('T')[0], f.weight_received, f.purchase_price || 0, f.warehouse_loc || null, shape.name, shape.segments, shape.source, shape.confidence, f.notes || null);
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/inventory/:id', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    const materialType = f.material_type && MATERIAL_TYPES.has(f.material_type) ? f.material_type : null;
    const shape = bendingShapeColumns(f);
    if (materialType === 'bent' && (!shape.name || !shape.segments)) {
      return res.status(400).json({ error: 'צורת כיפוף חובה עבור חומר מסוג כיפוף' });
    }
    db.prepare(`UPDATE raw_material SET
      material_type=COALESCE(?,material_type),
      diameter=COALESCE(?,diameter),
      supplier_id=COALESCE(?,supplier_id),
      lot_number=COALESCE(?,lot_number),
      certificate_num=COALESCE(?,certificate_num),
      grade=COALESCE(?,grade),
      received_date=COALESCE(?,received_date),
      weight_received=COALESCE(?,weight_received),
      weight_used=COALESCE(?,weight_used),
      weight_scrapped=COALESCE(?,weight_scrapped),
      purchase_price=COALESCE(?,purchase_price),
      warehouse_loc=COALESCE(?,warehouse_loc),
      bending_shape_name=?,
      bending_shape_segments=?,
      bending_shape_source=?,
      bending_shape_confidence=?,
      notes=COALESCE(?,notes),
      active=COALESCE(?,active)
      WHERE id=?`)
      .run(materialType, f.diameter ?? null, f.supplier_id || null, f.lot_number || null, f.certificate_num || null, f.grade || null, f.received_date || null, f.weight_received ?? null, f.weight_used ?? null, f.weight_scrapped ?? null, f.purchase_price ?? null, f.warehouse_loc || null, shape.name, shape.segments, shape.source, shape.confidence, f.notes || null, f.active ?? null, req.params.id);
    res.json({ success: true });
  });

  router.get('/steel-prices', requireAnyRole(['office', 'sales', 'finance', 'manager', 'admin']), (req, res) => {
    const { diameter } = req.query;
    const q = `SELECT sph.*, s.name as supplier_name FROM steel_price_history sph
             LEFT JOIN suppliers s ON sph.supplier_id=s.id`;
    if (diameter) {
      res.json(db.prepare(q + ' WHERE sph.diameter=? ORDER BY sph.effective_date DESC LIMIT 50').all(diameter));
    } else {
      res.json(db.prepare(`SELECT sph.*, s.name as supplier_name
        FROM steel_price_history sph LEFT JOIN suppliers s ON sph.supplier_id=s.id
        WHERE sph.id IN (
          SELECT MAX(id) FROM steel_price_history GROUP BY diameter
        ) ORDER BY sph.diameter`).all());
    }
  });

  router.post('/steel-prices', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
    const { diameter, price_per_ton, supplier_id, effective_date, notes, created_by } = req.body;
    const r = db.prepare('INSERT INTO steel_price_history (diameter,price_per_ton,supplier_id,effective_date,notes,created_by) VALUES (?,?,?,?,?,?)')
      .run(diameter, price_per_ton, supplier_id || null, effective_date || new Date().toISOString().slice(0, 10), notes || null, created_by || null);
    res.json({ id: r.lastInsertRowid });
  });

  router.get('/inventory/forecast', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const consumption = db.prepare(`
      SELECT i.diameter,
             COALESCE(SUM(i.total_weight),0) / 30 as avg_daily_kg
      FROM items i
      JOIN pallets p ON i.pallet_id=p.id
      JOIN orders o ON p.order_id=o.id
      WHERE DATE(o.created_at) >= DATE('now','-30 days')
      AND i.status='הושלם'
      GROUP BY i.diameter
    `).all();

    const stock = db.prepare(`
      SELECT diameter,
             COALESCE(SUM(weight_received-weight_used-weight_scrapped),0) as on_hand_kg
      FROM raw_material WHERE active=1
      GROUP BY diameter
    `).all();

    const stockMap = {};
    for (const s of stock) stockMap[s.diameter] = s.on_hand_kg;

    const forecast = consumption.map(row => {
      const on_hand = stockMap[row.diameter] || 0;
      const days_left = row.avg_daily_kg > 0 ? Math.floor(on_hand / row.avg_daily_kg) : 999;
      return {
        diameter: row.diameter,
        on_hand_kg: Math.round(on_hand),
        avg_daily_kg: Math.round(row.avg_daily_kg),
        days_left,
        alert: days_left <= 3 ? 'critical' : days_left <= 7 ? 'warning' : 'ok',
      };
    });

    for (const [diam, kg] of Object.entries(stockMap)) {
      if (!forecast.find(f => f.diameter == diam)) {
        forecast.push({ diameter: Number(diam), on_hand_kg: Math.round(kg), avg_daily_kg: 0, days_left: 999, alert: 'ok' });
      }
    }
    forecast.sort((a, b) => a.days_left - b.days_left);
    res.json(forecast);
  });

  router.get('/purchase-orders', requireAnyRole(['warehouse', 'office', 'finance', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare(`
      SELECT po.*, s.name as supplier_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      ORDER BY po.created_at DESC
    `).all());
  });

  router.post('/purchase-orders', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const seq = db.prepare('SELECT COUNT(*)+1 as n FROM purchase_orders').get().n;
    const num = 'PO-' + new Date().getFullYear() + '-' + String(seq).padStart(4, '0');
    const { supplier_id, diameter, material_type, quantity_ton, price_per_ton, expected_date, notes, created_by, status } = req.body;
    const total = (quantity_ton || 0) * (price_per_ton || 0);
    const r = db.prepare(`
      INSERT INTO purchase_orders
        (po_num,supplier_id,diameter,material_type,quantity_ton,price_per_ton,total_amount,expected_date,status,notes,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(num, supplier_id || null, diameter || null, material_type || 'coil',
      quantity_ton || 0, price_per_ton || 0, total,
      expected_date || '', status || 'pending', notes || '', created_by || '');
    res.json({ id: r.lastInsertRowid, po_num: num });
  });

  router.patch('/purchase-orders/:id', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    db.prepare(`
      UPDATE purchase_orders
      SET status      = COALESCE(?, status),
          approved_by = COALESCE(?, approved_by)
      WHERE id = ?
    `).run(f.status || null, f.approved_by || null, req.params.id);
    res.json({ ok: true });
  });

  router.patch('/purchase-orders/:id/receive', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const { heat_number, certificate_num, received_weight, notes } = req.body;
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(req.params.id);
    if (!po) return res.status(404).json({ error: 'not found' });
    const actualWeight = received_weight || (po.quantity_ton * 1000);
    db.prepare(`
      UPDATE purchase_orders
      SET status='הגיע', heat_number=?, certificate_num=?, received_weight=?, received_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(heat_number || '', certificate_num || '', actualWeight, req.params.id);
    if (po.supplier_id && po.diameter) {
      db.prepare(`
        INSERT INTO raw_material
          (material_type,diameter,supplier_id,lot_number,certificate_num,received_date,weight_received,purchase_price,notes)
        VALUES (?,?,?,?,?,date('now'),?,?,?)
      `).run(po.material_type || 'coil', po.diameter, po.supplier_id,
        heat_number || '', certificate_num || '',
        actualWeight, po.price_per_ton || 0, notes || '');
    }
    res.json({ ok: true });
  });

  return router;
};
