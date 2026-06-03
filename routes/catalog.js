const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/catalog missing dependency: ${name}`);
  return value;
}

module.exports = function createCatalogRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const intake = required('intake', deps.intake);
  const PORT = required('PORT', deps.PORT);

  async function notifyPriceListUpdate(rows) {
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const keyDiams = [8, 10, 12, 14, 16, 20];
    const priceLines = rows
      .filter(r => keyDiams.includes(Number(r.diameter)))
      .map(r => `Diameter ${r.diameter}: list ${r.price_list} NIS/kg | customer ${r.price_cust} NIS/kg`)
      .join('\n');

    const customers = db.prepare(
      `SELECT id, name, phone, portal_token FROM customers WHERE portal_token IS NOT NULL AND phone IS NOT NULL`
    ).all();

    for (const c of customers) {
      const link = `${baseUrl}/customer.html?token=${c.portal_token}`;
      const msg = `IronBend price list updated\n\nHello ${c.name},\nThe price list was updated:\n\n${priceLines}\n\nView prices and order:\n${link}`;
      try { await intake.sendWhatsApp(c.phone, msg); } catch {}
      await new Promise(r => setTimeout(r, 300));
    }
  }

  router.get('/price-list', requireAnyRole(['office', 'sales', 'finance', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare('SELECT * FROM price_list ORDER BY diameter').all());
  });

  router.patch('/price-list', requireAnyRole(['finance', 'manager', 'admin']), async (req, res) => {
    const rows = req.body;
    const upsert = db.prepare('INSERT OR REPLACE INTO price_list (diameter,price_list,price_cust) VALUES (?,?,?)');
    const tx = db.transaction(() => rows.forEach(r => upsert.run(r.diameter, r.price_list, r.price_cust)));
    tx();
    res.json({ success: true });

    notifyPriceListUpdate(rows).catch(e => console.warn('[PriceList notify]', e));
  });

  router.get('/shapes', requireAnyRole(['office', 'sales', 'production', 'manager', 'admin']), (req, res) => {
    const { bends } = req.query;
    let sql = 'SELECT * FROM shapes WHERE active=1';
    const params = [];
    if (bends !== undefined) { sql += ' AND bends=?'; params.push(Number(bends)); }
    sql += ' ORDER BY sort_order, bends, name';
    res.json(db.prepare(sql).all(...params));
  });

  router.post('/shapes', requireAnyRole(['manager', 'admin']), (req, res) => {
    const { id, name, bends, sidesDefault, anglesDefault, emoji, description } = req.body;
    db.prepare(`INSERT OR REPLACE INTO shapes (id,name,bends,sides_default,angles_default,emoji,description) VALUES (?,?,?,?,?,?,?)`)
      .run(id, name, bends || 0, JSON.stringify(sidesDefault || []), JSON.stringify(anglesDefault || []), emoji || '⬡', description || '');
    res.json({ success: true });
  });

  // ── SHAPE SEED (standard Israeli rebar catalog) ──────────────────
  router.post('/shapes/seed', requireAnyRole(['manager', 'admin']), (req, res) => {
    // Standard Israeli rebar shapes (based on IS/BS 8666 catalog)
    // Dimensions in mm, angles in degrees
    const CATALOG = [
      // ── 0 Bends ──────────────────────────────────────────────────
      { id:'s00', name:'ישר',               bends:0, sides:[3000],                          angles:[],                  emoji:'➖', sort:1,  desc:'מוט ישר ללא כיפופים' },
      // ── 1 Bend ───────────────────────────────────────────────────
      { id:'s01', name:'L – זווית 90°',     bends:1, sides:[500,200],                        angles:[90],                emoji:'⌐', sort:2,  desc:'כיפוף L בזווית ישרה' },
      { id:'s02', name:'L – זווית 45°',     bends:1, sides:[500,200],                        angles:[45],                emoji:'⌐', sort:3,  desc:'כיפוף L בזווית 45°' },
      { id:'s03', name:'L – זווית 135°',    bends:1, sides:[500,200],                        angles:[135],               emoji:'⌐', sort:4,  desc:'כיפוף L בזווית 135°' },
      // ── 2 Bends ──────────────────────────────────────────────────
      { id:'s10', name:'U – אנקר 90°',      bends:2, sides:[150,1250,150],                   angles:[90,90],             emoji:'∪', sort:5,  desc:'אנקר U כיפוף 90°' },
      { id:'s11', name:'U – אנקר רחב',      bends:2, sides:[150,6000,150],                   angles:[90,90],             emoji:'∪', sort:6,  desc:'אנקר U רחב' },
      { id:'s12', name:'Z – הזזה',           bends:2, sides:[300,400,300],                    angles:[135,135],           emoji:'Z', sort:7,  desc:'הזזה Z' },
      { id:'s13', name:'S – כפול',           bends:2, sides:[300,400,300],                    angles:[45,45],             emoji:'S', sort:8,  desc:'כיפוף S כפול' },
      { id:'s14', name:'שלב פתוח',           bends:2, sides:[600,200,600],                    angles:[45,135],            emoji:'⊂', sort:9,  desc:'שלב פתוח עם זוויות' },
      // ── 3 Bends ──────────────────────────────────────────────────
      { id:'s20', name:'קרס – אוברל',        bends:3, sides:[200,400,400,200],                angles:[90,180,90],         emoji:'⎡', sort:10, desc:'קרס overlap עם כיפוף 180°' },
      { id:'s21', name:'אסדה פתוחה',         bends:3, sides:[200,500,500,200],                angles:[90,90,90],          emoji:'⬓', sort:11, desc:'אסדה פתוחה 3 כיפופים' },
      { id:'s22', name:'T – רגל',            bends:3, sides:[250,600,250,100],                angles:[90,90,90],          emoji:'⊤', sort:12, desc:'צורת T עם רגל' },
      // ── 4 Bends ──────────────────────────────────────────────────
      { id:'s30', name:'מסגרת מלבנית',       bends:4, sides:[400,200,400,200,100],            angles:[90,90,90,90],       emoji:'▭', sort:13, desc:'אצבה מלבנית – stirrup' },
      { id:'s31', name:'מסגרת ריבועית',      bends:4, sides:[300,300,300,300,100],            angles:[90,90,90,90],       emoji:'□', sort:14, desc:'אצבה ריבועית' },
      { id:'s32', name:'מסגרת גדולה',        bends:4, sides:[600,400,600,400,100],            angles:[90,90,90,90],       emoji:'▬', sort:15, desc:'מסגרת גדולה' },
      { id:'s33', name:'מסגרת עם אלכסון',    bends:4, sides:[300,300,300,300,100],            angles:[45,135,45,135],     emoji:'◇', sort:16, desc:'מסגרת עם כיפופים אלכסוניים' },
      // ── 5 Bends ──────────────────────────────────────────────────
      { id:'s40', name:'חמישה כיפופים',      bends:5, sides:[150,200,400,200,400,150],        angles:[90,90,90,90,90],    emoji:'⌂', sort:17, desc:'מוט עם 5 כיפופים' },
      { id:'s41', name:'W – גלי',            bends:5, sides:[200,300,200,300,200,200],        angles:[45,135,45,135,45],  emoji:'〜', sort:18, desc:'מוט גלי W' },
      // ── 6 Bends ──────────────────────────────────────────────────
      { id:'s50', name:'ששה כיפופים',        bends:6, sides:[150,150,400,150,400,150,150],    angles:[90,90,90,90,90,90], emoji:'⬡', sort:19, desc:'מוט עם 6 כיפופים' },
      { id:'s51', name:'ספירלה מלבנית',      bends:6, sides:[300,200,300,200,300,200,300],    angles:[90,90,90,90,90,90], emoji:'🌀', sort:20, desc:'ספירלה עם 6+ כיפופים' },
      // ── Special ──────────────────────────────────────────────────
      { id:'s60', name:'אנקר U – קצר',       bends:2, sides:[100,800,100],                    angles:[90,90],             emoji:'∪', sort:21, desc:'אנקר U קצר' },
      { id:'s61', name:'אנקר U – ארוך',      bends:2, sides:[200,2000,200],                   angles:[90,90],             emoji:'∪', sort:22, desc:'אנקר U ארוך' },
      { id:'s62', name:'ראש עוגן',           bends:2, sides:[300,1500,300],                    angles:[90,90],             emoji:'⚓', sort:23, desc:'ראש עוגן – U רחב' },
      { id:'s63', name:'U – עם זוויות 45°',  bends:2, sides:[200,800,200],                    angles:[45,45],             emoji:'∪', sort:24, desc:'U כיפוף בזוויות 45°' },
      { id:'s70', name:'מסגרת 6 צלעות',      bends:5, sides:[200,400,200,400,200,400],        angles:[60,120,60,120,60],  emoji:'⬡', sort:25, desc:'מסגרת משושה' },
      { id:'s80', name:'רשת – mesh',          bends:0, sides:[6000],                            angles:[],                  emoji:'⊞', sort:26, desc:'רשת ברזל – mesh' },
      { id:'s90', name:'מותאם אישית',        bends:0, sides:[1000],                            angles:[],                  emoji:'✏️', sort:99, desc:'כיפוף חופשי', custom:true },
    ];

    // Ensure sort_order column exists (add if missing)
    try {
      db.prepare('ALTER TABLE shapes ADD COLUMN sort_order INTEGER DEFAULT 99').run();
    } catch(e) { /* column already exists */ }

    const insert = db.prepare(`INSERT OR REPLACE INTO shapes
      (id,name,bends,sides_default,angles_default,emoji,description,sort_order,active)
      VALUES (?,?,?,?,?,?,?,?,1)`);

    const runAll = db.transaction(() => {
      CATALOG.forEach(s => {
        insert.run(
          s.id, s.name, s.bends,
          JSON.stringify(s.sides),
          JSON.stringify(s.angles),
          s.emoji, s.desc || '', s.sort || 99
        );
      });
    });
    runAll();

    res.json({ success: true, count: CATALOG.length, shapes: CATALOG.map(s => s.id) });
  });

  return router;
};
