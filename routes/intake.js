const router = require('express').Router();
const axios = require('axios');

function required(name, value) {
  if (value === undefined || value === null) throw new Error(`routes/intake missing dependency: ${name}`);
  return value;
}

module.exports = function createIntakeRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const analyzeImageAuthorization = required('analyzeImageAuthorization', deps.analyzeImageAuthorization);
  const imageAnalysisLimiter = required('imageAnalysisLimiter', deps.imageAnalysisLimiter);
  const upload = required('upload', deps.upload);
  const getSetting = required('getSetting', deps.getSetting);
  const getOpenAiApiKey = required('getOpenAiApiKey', deps.getOpenAiApiKey);
  const getIntakeTrainingGuidance = required('getIntakeTrainingGuidance', deps.getIntakeTrainingGuidance);
  const normalizeFactorySegments = required('normalizeFactorySegments', deps.normalizeFactorySegments);
  const normalizeFactoryShapeName = required('normalizeFactoryShapeName', deps.normalizeFactoryShapeName);
  const INTAKE_AI_ENABLED = required('INTAKE_AI_ENABLED', deps.INTAKE_AI_ENABLED);
  const intake = required('intake', deps.intake);
  const webhookLimiter = required('webhookLimiter', deps.webhookLimiter);
  const verifyWhatsAppSignature = required('verifyWhatsAppSignature', deps.verifyWhatsAppSignature);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);
  const enrichIntakeRow = required('enrichIntakeRow', deps.enrichIntakeRow);
  const createOrderFromPayload = required('createOrderFromPayload', deps.createOrderFromPayload);
  const intakeToOrderPayload = required('intakeToOrderPayload', deps.intakeToOrderPayload);
  const intakeWorkflow = required('intakeWorkflow', deps.intakeWorkflow);

  router.post('/analyze-image', analyzeImageAuthorization, imageAnalysisLimiter, upload.single('image'), async (req, res) => {
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
      ? { type: 'input_file', filename: req.file.originalname || 'order.pdf', file_data: `data:application/pdf;base64,${fileData}` }
      : { type: 'input_image', image_url: `data:${mime};base64,${fileData}`, detail: 'high' };
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        document_type: { type: ['string', 'null'] },
        supplier_order_num: { type: ['string', 'null'] },
        customer_name: { type: ['string', 'null'] },
        customer_phone: { type: ['string', 'null'] },
        delivery_date: { type: ['string', 'null'] },
        delivery_address: { type: ['string', 'null'] },
        notes: { type: ['string', 'null'] },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              diameter: { type: 'number' },
              shape_name: { type: 'string' },
              quantity: { type: 'integer' },
              segments: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    length_cm: { type: 'number' },
                    angle_deg: { type: 'number' },
                  },
                  required: ['length_cm', 'angle_deg'],
                },
              },
              total_length_cm: { type: 'number' },
              material_grade: { type: 'string' },
              note: { type: 'string' },
            },
            required: ['diameter', 'shape_name', 'quantity', 'segments', 'total_length_cm', 'material_grade', 'note'],
          },
        },
      },
      required: ['document_type', 'supplier_order_num', 'customer_name', 'customer_phone', 'delivery_date', 'delivery_address', 'notes', 'items'],
    };
    const trainingGuidance = getIntakeTrainingGuidance();
    const prompt = `Read this photographed or PDF steel production order carefully.
  Return every printed or handwritten table row as a separate item.
  ${trainingGuidance}
  First identify the document format. If it is a TASSA / טסה supplier order:
  - Page 1 is usually a cover page. Extract the supplier order number from "הזמנה לספק מס'", the requested delivery date from "מועד אספקה", customer/contact name from "לכבוד" or the handwritten body, and phone from the handwritten body if present.
  - Later pages are "רשימת ברזל לכיפוף" / bending schedules. Extract each numbered table row as a separate item.
  - Do not treat the cover-page free text or phone line as a steel item.
  - Use the quantity from the "כמות" / units column only. Do not confuse weight/משקל, page totals, row numbers, or drawing labels with quantity.
  - Use the bar diameter from the diameter column or Ø mark. Use the row sketch dimensions for segments.
  - If the table gives a straight bar row, use the printed row length as one 180-degree segment.
  For document_type return a short label such as "tassa_pdf", "handwritten_cards", "bar_schedule", or "unknown".
  For supplier_order_num, customer_name, customer_phone, delivery_date, delivery_address, and notes return null when not visible. delivery_date must be YYYY-MM-DD when visible.
  For handwritten factory cards, visible dimensions are centimeters. Return every visible side in length_cm exactly as written. Return the row's total cut length in total_length_cm exactly as written. Do not convert centimeters to millimeters yourself.
  Never invent an unreadable value. Put every uncertainty, missing dimension, or interpretation issue in note.
  Supported bar diameters are 6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, and 40 mm. If a diameter is unclear, state that in note instead of guessing an unsupported value.
  Read every digit after the diameter symbol. A leading 1 is often handwritten very close to the Ø mark: do not read Ø16 as Ø6 just because the 1 touches or overlaps the symbol. Inspect consecutive rows carefully when the same diameter repeats.
  Trace every shape continuously from one physical end of the bar to the other. Do not group equal dimensions just because they look similar or are written close together.
  For an open U-shaped bar with two equal parallel legs and one base, return [leg,base,leg]. Example: two 80 cm legs and a 60 cm base become [80,60,80], not [80,80,60].
  For a fully closed rectangular stirrup with the small 90-degree overlap mark, never return an open hooked bar. Include the full outer rectangle and the two overlap tails as segments, with one tail at each end of the continuous trace.
  When the row gives a total cut length and a rectangular stirrup sketch with outer width W and height H, calculate remaining tail length as (total - 2*W - 2*H) / 2. Return six segments: [tail,W,H,W,H,tail].
  Example: total 215 cm with a 60 by 40 cm closed stirrup becomes [7.5,60,40,60,40,7.5] cm. Total 205 cm with a 60 by 35 cm closed stirrup becomes [7.5,60,35,60,35,7.5] cm.
  Name this shape "closed stirrup 90-degree overlap". If the sketch does not clearly show a closed rectangle and the small corner overlap, keep the conservative open shape and add a review note.
  For a spiral, name it "ספירלה" and include visible ring diameter and turns in note.
  Use one segment per visible side. angle_deg is the interior angle after that segment: 180 for straight, 90 for a square bend.
  Return JSON that matches the requested schema only.`;
    try {
      const response = await require('axios').post('https://api.openai.com/v1/responses', {
        model: getSetting('OPENAI_MODEL') || 'gpt-5.4-mini',
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, attachment] }],
        text: { format: { type: 'json_schema', name: 'ironbend_order', strict: true, schema } },
      }, {
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      });
      const text = (response.data?.output || [])
        .flatMap(entry => entry.content || [])
        .find(entry => entry.type === 'output_text')?.text;
      const parsedDocument = JSON.parse(text || '{}');
      const items = (parsedDocument.items || []).map(item => {
        const segments = normalizeFactorySegments(item.shape_name, (item.segments || []).map(segment => ({
          length_mm: (Number(segment.length_cm) || 0) * 10,
          angle_deg: Number(segment.angle_deg) || 0,
        })));
        const computedLength = segments.reduce((sum, segment) => sum + segment.length_mm, 0);
        const reportedLength = (Number(item.total_length_cm) || 0) * 10;
        const notes = [];
        if (item.note) notes.push(item.note);
        if (reportedLength && reportedLength !== computedLength) {
          notes.push(`Review required: reported total ${reportedLength} mm differs from segment sum ${computedLength} mm. Segment sum is shown.`);
        }
        if (segments.length === 1 && segments[0].length_mm > 0 && segments[0].length_mm < 1000) {
          notes.push('Review required: extracted straight-bar length is shorter than 1000 mm; verify cm-to-mm conversion.');
        }
        if (![6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40].includes(Number(item.diameter))) {
          notes.push(`Review required: diameter ${item.diameter} mm is not supported; verify the handwritten value.`);
        }
        if (Number(item.diameter) === 6) {
          notes.push('Review required: handwritten Ø6 can overlap visually with Ø16; verify the full diameter before approval.');
        }
        return {
          ...item,
          shape_name: normalizeFactoryShapeName(item.shape_name, segments),
          segments,
          total_length_mm: computedLength,
          note: notes.join(' '),
        };
      });
      if (!items.length) return res.status(422).json({ error: 'No steel rows were recognized' });
      res.json({
        success: true,
        document_type: parsedDocument.document_type || null,
        supplier_order_num: parsedDocument.supplier_order_num || null,
        customer_name: parsedDocument.customer_name || null,
        customer_phone: parsedDocument.customer_phone || null,
        delivery_date: parsedDocument.delivery_date || null,
        delivery_address: parsedDocument.delivery_address || null,
        notes: parsedDocument.notes || null,
        items,
      });
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message;
      res.status(500).json({ error: `Document recognition failed: ${message}` });
    }
  });

  router.post('/intake/image', requireAnyRole(['office', 'manager', 'admin']), upload.single('image'), async (req, res) => {
    if (!INTAKE_AI_ENABLED) return res.status(501).json({ error: 'OCR לא זמין בשלב זה', feature: 'intake-ai' });
    if (!req.file) return res.status(400).json({ error: 'לא צורפה תמונה' });
    try {
      const ocrResult = await intake.runOCR(req.file.buffer, { apiKey: getSetting('GOOGLE_VISION_API_KEY') });
      const parsed    = intake.parseOCRText(ocrResult.fullText);
      const originalMime = req.file.mimetype || 'image/jpeg';
      const originalDataUrl = `data:${originalMime};base64,${req.file.buffer.toString('base64')}`;
      const log = db.prepare(`
        INSERT INTO intake_log
          (source,raw_content,parsed_data,original_filename,original_mime,original_data_url,status)
        VALUES (?,?,?,?,?,?,?)
      `).run(
        'ocr',
        ocrResult.fullText.slice(0, 2000),
        JSON.stringify(parsed),
        req.file.originalname || 'intake-upload',
        originalMime,
        originalDataUrl,
        'pending_review'
      );
      res.json({ success: true, intakeId: log.lastInsertRowid, parsed, fullText: ocrResult.fullText });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/intake/whatsapp', webhookLimiter, (req, res) => {
    // Meta webhook verification
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  router.post('/intake/whatsapp', webhookLimiter, verifyWhatsAppSignature, async (req, res) => {
    res.sendStatus(200); // acknowledge immediately (Meta requires fast response)
    try {
      const body = req.body;
      const entry = body.entry?.[0]?.changes?.[0]?.value;
      if (!entry?.messages) return;

      for (const msg of entry.messages) {
        const fromPhone = msg.from;
        let parsed = null;

        if (msg.type === 'text') {
          parsed = intake.parseWhatsAppMessage(msg.text.body);
          parsed.source = 'whatsapp';
          parsed.customerPhone = fromPhone;
        } else if (msg.type === 'image' || msg.type === 'document') {
          // Image/PDF - would need to download via WhatsApp API then OCR
          // Mark for manual review
          db.prepare('INSERT INTO intake_log (source,raw_content,status) VALUES (?,?,?)')
            .run('whatsapp_media', `media:${msg.type} from:${fromPhone}`, 'pending_review');
          await intake.sendWhatsApp(fromPhone, 'קיבלנו את התמונה, ניצור קשר בהקדם!');
          continue;
        }

        if (parsed) {
          db.prepare('INSERT INTO intake_log (source,raw_content,parsed_data,status) VALUES (?,?,?,?)')
            .run('whatsapp', msg.text?.body || '', JSON.stringify(parsed), 'pending_review');
          wsBroadcast('new_intake', { source: 'whatsapp', phone: fromPhone, parsed });
        }
      }
    } catch (err) {
      console.error('[WhatsApp webhook]', err.message);
    }
  });

  router.post('/intake/email/poll', requireAnyRole(['office', 'manager', 'admin']), async (req, res) => {
    if (!INTAKE_AI_ENABLED) return res.status(501).json({ error: 'Email intake לא זמין בשלב זה', feature: 'intake-ai' });
    try {
      const results = await intake.pollEmail(db);
      res.json({ success: true, count: results.length, results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/intake/log', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const status = req.query.status; // optional filter: pending_review / approved / rejected
    const sql = status
      ? 'SELECT * FROM intake_log WHERE status=? ORDER BY created_at DESC LIMIT 100'
      : 'SELECT * FROM intake_log ORDER BY created_at DESC LIMIT 100';
    res.json(db.prepare(sql).all(...(status ? [status] : [])).map(enrichIntakeRow));
  });

  router.post('/intake/:id/approve', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const row = db.prepare('SELECT * FROM intake_log WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Intake row not found' });
    if (row.order_id) {
      const order = db.prepare('SELECT order_num FROM orders WHERE id=?').get(row.order_id);
      if (row.status !== 'approved') {
        db.prepare('UPDATE intake_log SET status=? WHERE id=?').run('approved', row.id);
      }
      return res.json({ success: true, orderId: row.order_id, orderNum: order?.order_num, alreadyApproved: true });
    }
    try {
      const parsed = JSON.parse(row.parsed_data || '{}');
      const body = req.body || {};
      const customerOverride = body.customer_id ? {
        id: Number(body.customer_id),
        name: body.customer_name || null,
        phone: body.customer_phone || null,
        email: body.customer_email || null,
      } : null;
      const approve = db.transaction(() => {
        const result = createOrderFromPayload(intakeToOrderPayload(parsed, row.source || 'intake', customerOverride, row.raw_content || ''));
        db.prepare('UPDATE intake_log SET status=?,order_id=? WHERE id=?').run('approved', result.orderId, row.id);
        return result;
      });
      const result = approve();
      wsBroadcast('new_order', { orderNum: result.orderNum, orderId: result.orderId });
      res.json(result);
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
  });

  router.post('/intake/:id/reject', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const r = db.prepare('UPDATE intake_log SET status=? WHERE id=?').run('rejected', req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ success: true });
  });

  router.post('/intake/parse-text', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const { text, source } = req.body;
    try {
      const parsed = intakeWorkflow.parseManualIntakeText({
        text,
        source,
        parseWhatsAppMessage: intake.parseWhatsAppMessage,
        parseOCRText: intake.parseOCRText,
      });
      const result = db.prepare('INSERT INTO intake_log (source,raw_content,parsed_data,status) VALUES (?,?,?,?)')
        .run(source || 'manual', text.slice(0, 2000), JSON.stringify(parsed), 'pending_review');
      res.json({ success: true, id: result.lastInsertRowid, parsed, item_count: (parsed.items || []).length });
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  });

  return router;
};
