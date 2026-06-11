const router = require('express').Router();
const printPage = require('../services/productionCardPrintPage');

function required(name, value) {
  if (!value) throw new Error(`routes/productionCards missing dependency: ${name}`);
  return value;
}

module.exports = function createProductionCardsRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const cards = required('productionCards', deps.productionCards);
  const industry = required('industry', deps.industry);
  const tryParseJSON = required('tryParseJSON', deps.tryParseJSON);
  const normalizeFactorySegments = required('normalizeFactorySegments', deps.normalizeFactorySegments);
  const normalizeFactoryShapeName = required('normalizeFactoryShapeName', deps.normalizeFactoryShapeName);

// ── PRINT CARDS ───────────────────────────────────────────────────
router.get('/orders/:id/print-cards', requireAnyRole(['office', 'production', 'manager', 'admin']), (req, res) => {
  const order = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
    FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.id);
  if (!order) return res.status(404).send('הזמנה לא נמצאה');

  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=? ORDER BY pallet_num').all(order.id);
  pallets.forEach(p => {
    p.items = db.prepare('SELECT * FROM items WHERE pallet_id=? ORDER BY id').all(p.id);
    p.items.forEach(item => {
      item._palletNum = p.pallet_num;
      const segments = normalizeFactorySegments(item.shape_name, tryParseJSON(item.segments, []));
      item.shape_name = normalizeFactoryShapeName(item.shape_name, segments);
      item.segments = JSON.stringify(segments);
    });
  });
  order.pallets = pallets;

  const allItems = pallets.flatMap(p => p.items);

  // Format date dd-mm-yyyy
  const today = new Date();
  const fmtDate = d => {
    const dt = d ? new Date(d) : today;
    return `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()}`;
  };
  const printDate = fmtDate(order.created_at);
  const delivDate = order.delivery_date ? fmtDate(order.delivery_date) : '';

  const html = printPage.renderPrintCardsPage({
    order,
    pallets,
    allItems,
    printDate,
    delivDate,
    cards,
    industry,
    tryParseJSON,
  });

  console.log('[print-cards] order', req.params.id, '→', allItems.length, 'items server-rendered');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

  return router;
};

module.exports.manifest = {
  id: 'production-cards',
  label: 'כרטיסי ייצור',
  screens: [
    { id: 'production-cards', path: '/productionCards.html', label: 'כרטיסי ייצור', icon: '🗂️', group: 'ייצור' },
  ],
  access: {
    default: 'hidden',
    roles: { admin: 'edit', manager: 'edit', office: 'read', production: 'read' },
  },
  consumes: [{ table: 'orders' }, { table: 'items' }],
  produces: [],
};
