const router = require('express').Router();
const axios = require('axios');
const { normalizeSpiralParams, spiralCutLengthMm } = require('../modules/steel-rebar/shapes');

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
  const intakeWorkflow = required('intakeWorkflow', deps.intakeWorkflow);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);
  const cleanRecognizedCustomerName = intakeWorkflow.cleanRecognizedCustomerName || (value => String(value || '').trim());

  function shouldSaveToIntake(req) {
    return req.query.save_to_intake === 'true'
      || req.body?.save_to_intake === 'true'
      || req.body?.save_to_intake === true;
  }

  function requestedOcrDocumentType(req) {
    const raw = String(
      req.body?.target_module
      || req.body?.requested_by_module
      || req.body?.requestedByModule
      || req.body?.requested_use_case
      || req.body?.requestedUseCase
      || req.query.target_module
      || req.query.requested_by_module
      || req.query.requestedByModule
      || req.query.requested_use_case
      || req.query.requestedUseCase
      || req.body?.ocr_target
      || req.query.ocr_target
      || req.body?.document_type_hint
      || req.body?.document_type
      || req.query.document_type_hint
      || req.query.document_type
      || 'order'
    ).trim().toLowerCase();
    if (['order', 'customer_order', 'bar_schedule', 'rebar_order'].includes(raw)) return 'order';
    if (['supplier_delivery', 'delivery_note', 'supplier_receipt', 'inventory_receipt'].includes(raw)) return 'supplier_delivery';
    if (['price_list', 'pricing', 'steel_price_list'].includes(raw)) return 'price_list';
    return 'order';
  }

  function saveAnalysisToIntake(req, payload) {
    const originalMime = req.file.mimetype || 'application/octet-stream';
    const originalDataUrl = `data:${originalMime};base64,${req.file.buffer.toString('base64')}`;
    const rawContent = [
      req.file.originalname ? `file: ${req.file.originalname}` : '',
      payload.document_type ? `document_type: ${payload.document_type}` : '',
      payload.supplier_order_num ? `supplier_order_num: ${payload.supplier_order_num}` : '',
      payload.customer_name ? `customer_name: ${payload.customer_name}` : '',
      payload.customer_phone ? `customer_phone: ${payload.customer_phone}` : '',
      payload.delivery_date ? `delivery_date: ${payload.delivery_date}` : '',
      payload.notes ? `notes: ${payload.notes}` : '',
      `items: ${(payload.items || []).length}`,
    ].filter(Boolean).join('\n').slice(0, 2000);

    const log = db.prepare(`
      INSERT INTO intake_log
        (source,raw_content,parsed_data,original_filename,original_mime,original_data_url,status)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      'ocr',
      rawContent,
      JSON.stringify(payload),
      req.file.originalname || 'ocr-upload',
      originalMime,
      originalDataUrl,
      'pending_review'
    );
    const intakeId = log.lastInsertRowid;
    wsBroadcast('new_intake', { source: 'ocr', intakeId, parsed: payload });
    return intakeId;
  }

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
    const documentIntent = requestedOcrDocumentType(req);
    if (documentIntent !== 'order') {
      const target = documentIntent === 'supplier_delivery'
        ? {
            module: 'inventory',
            endpoint: null,
            screen: '/inventory.html#receipts',
            use_case: 'supplier_delivery_intake',
          }
        : {
            module: 'pricing',
            endpoint: '/api/pricing/price-books/analyze-upload',
            screen: '/pricing.html',
            use_case: 'price_list_import',
          };
      return res.status(422).json({
        code: 'wrong_document_route',
        document_type_hint: documentIntent,
        target,
        error: documentIntent === 'supplier_delivery'
          ? 'תעודת ספק / קבלת חומר נקלטת דרך מודול מלאי, לא דרך הזמנה חדשה.'
          : 'מחירון ברזל נקלט דרך מודול מחירונים, לא דרך הזמנה חדשה.',
      });
    }
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
              spiral_diameter_mm: { type: ['number', 'null'] },
              spiral_turns: { type: ['number', 'null'] },
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
            required: ['diameter', 'shape_name', 'quantity', 'spiral_diameter_mm', 'spiral_turns', 'segments', 'total_length_cm', 'material_grade', 'note'],
          },
        },
      },
      required: ['document_type', 'supplier_order_num', 'customer_name', 'customer_phone', 'delivery_date', 'delivery_address', 'notes', 'items'],
    };
    const trainingGuidance = getIntakeTrainingGuidance();
    const prompt = `The operator selected document type: CUSTOMER ORDER / BAR SCHEDULE.
  This route must parse only customer orders, handwritten rebar lists, factory cards, or bending schedules.
  Do not classify the document yourself as supplier delivery, inventory receipt, or price list. If the selected route is wrong, return no items and explain in notes.
  Read this photographed or PDF steel production order carefully.
  Return every printed or handwritten table row as a separate item.
  ${trainingGuidance}
  If it is a TASSA / טסה supplier order used as a customer order source:
  - Page 1 is usually a cover page. Extract the supplier order number from "הזמנה לספק מס'", the requested delivery date from "מועד אספקה", customer/contact name from "לכבוד" or the handwritten body, and phone from the handwritten body if present.
  - Later pages are "רשימת ברזל לכיפוף" / bending schedules. Extract each numbered table row as a separate item.
  - Do not treat the cover-page free text or phone line as a steel item.
  - Use the quantity from the "כמות" / units column only. Do not confuse weight/משקל, page totals, row numbers, or drawing labels with quantity.
  - Use the bar diameter from the diameter column or Ø mark. Use the row sketch dimensions for segments.
  - If the table gives a straight bar row, use the printed row length as one 180-degree segment.
  For document_type return a short label such as "tassa_pdf", "handwritten_cards", "bar_schedule", or "unknown".
  For supplier_order_num, customer_name, customer_phone, delivery_date, delivery_address, and notes return null when not visible. delivery_date must be YYYY-MM-DD when visible.
  For generic "רשימת ברזל" / bar schedule documents, header email addresses and phone numbers are supplier/contact details, not customer names. Never put an email address, URL, or phone number in customer_name. If the customer name is not clearly visible, return null.
  Extract every numbered table row that contains any visible steel data. Do not summarize rows as blank unless the row number area and all steel columns are clearly empty. If a row is hard to read, still return a reviewed item with the visible values and explain uncertainty in note.
  For a visible table row, quantity belongs to the "כמות" column, diameter belongs to the "קוטר" column, and length/shape dimensions belong to "אורך" / "תיאור צורה". Do not use header phone/email digits as steel item values.
  For handwritten factory cards, visible dimensions are centimeters. Return every visible side in length_cm exactly as written. Return the row's total cut length in total_length_cm exactly as written. Do not convert centimeters to millimeters yourself.
  Never invent an unreadable value. Put every uncertainty, missing dimension, or interpretation issue in note.
  Supported bar diameters are 6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, and 40 mm. If a diameter is unclear, state that in note instead of guessing an unsupported value.
  Read every digit after the diameter symbol. A leading 1 is often handwritten very close to the Ø mark: do not read Ø16 as Ø6 just because the 1 touches or overlaps the symbol. Inspect consecutive rows carefully when the same diameter repeats.
  Trace every shape continuously from one physical end of the bar to the other. Do not group equal dimensions just because they look similar or are written close together.
  For an open U-shaped bar with two equal parallel legs and one base, return [leg,base,leg]. Example: two 80 cm legs and a 60 cm base become [80,60,80], not [80,80,60].
  If a row gives a total cut length that is longer than the visible side dimensions, the hidden excess belongs to the two physical end legs of the bar. Add half of the excess to the first segment and half to the last segment instead of only writing a review note.
  For a fully closed rectangular stirrup with the small 90-degree overlap mark, never return an open hooked bar. Include the full outer rectangle and the two overlap tails as segments, with one tail at each end of the continuous trace.
  Closed stirrup segment order must follow the physical bending path: [tail,height,width,height,width,tail]. Do not swap width and height.
  When the row gives a total cut length and a rectangular stirrup sketch with outer width W and height H, calculate remaining tail length as (total - 2*W - 2*H) / 2. Return six segments: [tail,H,W,H,W,tail].
  Example: total 215 cm with a 60 by 40 cm closed stirrup becomes [7.5,40,60,40,60,7.5] cm. Total 205 cm with a 60 by 35 cm closed stirrup becomes [7.5,35,60,35,60,7.5] cm.
  Name this shape "closed stirrup 90-degree overlap". If the sketch does not clearly show a closed rectangle and the small corner overlap, keep the conservative open shape and add a review note.
  For a spiral / coil / ring / salil / spiral:
  - Return shape_name exactly as "spiral".
  - diameter is the bar diameter.
  - spiral_diameter_mm is the visible spiral/ring diameter in millimeters.
  - spiral_turns is the number of wraps/turns.
  - segments must be [] because a spiral is not a side/angle shape.
  - total_length_cm should be the calculated cut length in centimeters when possible: pi * spiral_diameter_mm * spiral_turns / 10.
  - Put uncertainty in note, but do not encode spiral parameters only in note.
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
        const spiral = normalizeSpiralParams(item);
        if (spiral.isSpiral) {
          const reportedLength = (Number(item.total_length_cm) || 0) * 10;
          const computedLength = reportedLength || spiralCutLengthMm(spiral.spiralDiameterMm, spiral.turns);
          const notes = [];
          if (item.note) notes.push(item.note);
          if (!reportedLength) {
            notes.push(`Spiral length calculated from diameter ${spiral.spiralDiameterMm} mm and ${spiral.turns} turns.`);
          }
          return {
            ...item,
            shape_name: 'spiral',
            segments: [],
            spiral_diameter_mm: spiral.spiralDiameterMm,
            spiral_turns: spiral.turns,
            total_length_mm: computedLength,
            note: notes.join(' '),
          };
        }
        const normalizedSegments = normalizeFactorySegments(item.shape_name, (item.segments || []).map(segment => ({
          length_mm: (Number(segment.length_cm) || 0) * 10,
          angle_deg: Number(segment.angle_deg) || 0,
        })));
        const reportedLength = (Number(item.total_length_cm) || 0) * 10;
        const lengthAdjustment = intakeWorkflow.distributeSurplusToEndSegments(normalizedSegments, reportedLength);
        const segments = lengthAdjustment.segments;
        const computedLength = lengthAdjustment.totalLength;
        const notes = [];
        if (item.note) notes.push(item.note);
        if (lengthAdjustment.adjusted) {
          notes.push(`Length surplus ${lengthAdjustment.surplus} mm was assigned to the two end legs (${lengthAdjustment.perEnd} mm per end).`);
        } else if (reportedLength && Math.abs(reportedLength - computedLength) > 0.001) {
          notes.push(`Review required: reported total ${reportedLength} mm is shorter than segment sum ${computedLength} mm.`);
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
      const payload = {
        success: true,
        document_type: parsedDocument.document_type || null,
        supplier_order_num: parsedDocument.supplier_order_num || null,
        customer_name: cleanRecognizedCustomerName(parsedDocument.customer_name) || null,
        customer_phone: parsedDocument.customer_phone || null,
        delivery_date: parsedDocument.delivery_date || null,
        delivery_address: parsedDocument.delivery_address || null,
        notes: parsedDocument.notes || null,
        items,
      };
      if (shouldSaveToIntake(req)) {
        payload.intakeId = saveAnalysisToIntake(req, payload);
      }
      res.json(payload);
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

  return router;
};

module.exports.manifest = {
  id: 'intake-ocr',
  label: 'קליטת הזמנות',
  screens: [
    { id: 'intake', path: '/intake.html', label: 'קליטת הזמנות', icon: '📬', group: 'ראשי' },
  ],
  access: {
    default: 'hidden',
    roles: { admin: 'edit', manager: 'edit', office: 'edit' },
  },
  consumes: [{ table: 'intake_training' }],
  produces: [],
};
