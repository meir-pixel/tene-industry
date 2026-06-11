const router = require('express').Router();

function required(name, value) {
  if (value === undefined || value === null) throw new Error(`routes/bvbs missing dependency: ${name}`);
  return value;
}

module.exports = function createBvbsRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const upload = required('upload', deps.upload);
  const industry = required('industry', deps.industry);
  const generateOrderNum = required('generateOrderNum', deps.generateOrderNum);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);

  function parseBVBSLine(line) {
    line = line.trim();
    if (!line.startsWith('@3') && !line.startsWith('@')) return null;
    const item = {};
    // Split on ^ delimiter
    const parts = line.split('^');
    for (const part of parts) {
      if (!part || part === '!' || part.startsWith('@')) continue;
      const m = part.match(/^([a-zA-Z]+)(.+)$/);
      if (!m) {
        // geometry block [A 500 B 1800 ...]
        const geoM = part.match(/\[([^\]]+)\]/);
        if (geoM) {
          const legs = [];
          const tokens = geoM[1].trim().split(/\s+/);
          for (let i = 0; i < tokens.length - 1; i += 2) {
            const label = tokens[i];
            const len = parseFloat(tokens[i + 1]);
            if (!isNaN(len)) legs.push({ label, length: len });
          }
          item.legs = legs;
          item.sides = legs.map(l => l.length);
        }
        continue;
      }
      const [, key, val] = m;
      switch (key.toLowerCase()) {
        case 'd':  item.diameter    = parseFloat(val); break;
        case 'l':  item.total_length= parseFloat(val); break;
        case 'n':  item.mark        = val; break;
        case 'p':  item.quantity    = parseInt(val, 10) || 1; break;
        case 'a':  item.shape_code  = val; break;
        case 'r':  item.grade_code  = val; item.grade = val === '1' ? 'B500B' : val === '2' ? 'B500C' : 'B500B'; break;
        case 'w':  {
          if (!item.angles) item.angles = [];
          item.angles.push(parseFloat(val));
          break;
        }
      }
    }
    if (!item.diameter || !item.quantity) return null;
    item.weight_per_unit = industry.weightPerUnit({
      diameter: item.diameter,
      total_length_mm: item.total_length || 0,
    });
    item.total_weight = item.weight_per_unit * item.quantity;
    return item;
  }

  function parseBVBS(content) {
    const lines = content.split(/\r?\n/);
    const items = [];
    let header = {};
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith('@1') || t.startsWith('@2')) {
        // Header record — extract project/order info
        const parts = t.split('^');
        for (const p of parts) {
          const m = p.match(/^([A-Za-z]+)(.+)$/);
          if (!m) continue;
          if (m[1].toLowerCase() === 'bs') header.project = m[2];
          if (m[1].toLowerCase() === 'kd') header.customer = m[2];
          if (m[1].toLowerCase() === 'da') header.date = m[2];
        }
        continue;
      }
      const item = parseBVBSLine(t);
      if (item) items.push(item);
    }
    return { header, items, total_weight: items.reduce((s, i) => s + i.total_weight, 0) };
  }

  router.post('/bvbs/parse', requireAnyRole(['office', 'manager', 'admin']), upload.single('file'), (req, res) => {
    try {
      const content = req.file
        ? req.file.buffer.toString('utf-8')
        : (req.body.content || '');
      if (!content.trim()) return res.status(400).json({ error: 'Empty BVBS content' });
      const result = parseBVBS(content);
      if (!result.items.length) return res.status(422).json({ error: 'לא נמצאו פריטים בקובץ BVBS', raw_lines: content.split('\n').slice(0,5) });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/bvbs/create-order', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const { bvbs_result, customer_id, delivery_date, priority } = req.body;
    if (!bvbs_result?.items?.length) return res.status(400).json({ error: 'No items' });
    const orderNum = generateOrderNum();
    const totalWeight = bvbs_result.total_weight || 0;
    const orderId = db.prepare(`INSERT INTO orders (order_num,customer_id,channel,delivery_date,priority,status,total_weight,general_notes)
      VALUES (?,?,?,?,?,?,?,?)`).run(orderNum, customer_id || null, 'BVBS',
      delivery_date || null, priority || 'רגיל', 'ממתינה לאישור',
      totalWeight, `יובא מקובץ BVBS${bvbs_result.header?.project ? ' – פרויקט: ' + bvbs_result.header.project : ''}`
    ).lastInsertRowid;

    // Create one pallet
    const palletId = db.prepare('INSERT INTO pallets (order_id,pallet_num,total_weight) VALUES (?,1,?)')
      .run(orderId, totalWeight).lastInsertRowid;

    // Insert items
    const insertItem = db.prepare(`INSERT INTO items (pallet_id,shape_id,diameter,total_length_mm,quantity,weight_per_unit,total_weight,note,status)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const item of bvbs_result.items) {
      const shapeId = item.shape_code ? 's12' : 's1'; // default to custom or straight
      insertItem.run(palletId, shapeId, item.diameter, item.total_length || 0, item.quantity,
        item.weight_per_unit || 0, item.total_weight || 0, `מסימן ${item.mark || ''} | ${item.grade || 'B500B'}`, 'ממתין');
    }

    wsBroadcast('new_order', { orderId, orderNum });
    res.json({ ok: true, order_id: orderId, order_num: orderNum, items_created: bvbs_result.items.length });
  });

  return router;
};

module.exports.manifest = {
  screens: [],
  access: { default: 'hidden', roles: { admin: 'edit' } },
  id: 'bvbs',
  label: 'ייבוא BVBS',
  consumes: [{ external: 'bvbs-file' }],
  produces: [{ event: 'new_order' }],
};
