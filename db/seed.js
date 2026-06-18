'use strict';

function seedCoreData(db) {
  // ── SEED DOWNTIME REASONS ─────────────────────────────────────────
  db.exec(`
    INSERT OR IGNORE INTO downtime_reasons (code, label, color) VALUES
      ('SETUP',      'החלפת הגדרה / סט-אפ',  '#f39c12'),
      ('BREAKDOWN',  'תקלה מכונה',            '#e74c3c'),
      ('MATERIAL',   'המתנה לחומר גלם',       '#e67e22'),
      ('QUALITY',    'בדיקת איכות',           '#9b59b6'),
      ('BREAK',      'הפסקת עובד',            '#3498db'),
      ('OTHER',      'אחר',                   '#95a5a6');
  `);


  // ── SEED COMPANIES ────────────────────────────────────────────────
  db.exec(`
    INSERT OR IGNORE INTO companies (id, name, short_name, ownership_pct, erp_type, color) VALUES
      (1, 'IronBend כיפוף ברזל', 'IronBend', 100, 'priority', '#e07b39'),
      (2, 'הרי מדבר תשתיות ופיתוח', 'הרי מדבר', 50, 'maven', '#3498db');
  `);

  // ── SEED MACHINES (A/B/C/D) ───────────────────────────────────────
  db.exec(`
    INSERT OR IGNORE INTO machines (id, name, label, slave_id, min_diameter, max_diameter, port) VALUES
      (1, 'מכונה A – XINJE', 'A', 1,  8, 12, 'COM3'),
      (2, 'מכונה B – XINJE', 'B', 2, 14, 20, 'COM4'),
      (3, 'מכונה C – MEP',   'C', 3,  8, 20, 'COM5'),
      (4, 'מכונה D – עתידי', 'D', 4, 20, 40, 'COM6');
  `);
  // Update labels on existing rows
  db.exec(`
    UPDATE machines SET label='A', slave_id=1, min_diameter=8,  max_diameter=12 WHERE id=1 AND label IS NULL;
    UPDATE machines SET label='B', slave_id=2, min_diameter=14, max_diameter=20 WHERE id=2 AND label IS NULL;
  `);

  // ── SEED SHAPES ──────────────────────────────────────────────────
  const shapeCount = db.prepare('SELECT COUNT(*) as c FROM shapes').get().c;
  if (shapeCount === 0) {
    const insertShape = db.prepare(`INSERT OR IGNORE INTO shapes (id, name, bends, sides_default, angles_default, emoji, description) VALUES (?,?,?,?,?,?,?)`);
    const shapes = [
      ['s1',  'ישר',           0, '[1000]',                         '[]',                     '➖', 'ברזל ישר ללא כיפופים'],
      ['s2',  'L – זווית',     1, '[500,200]',                      '[90]',                   '⌐',  'כיפוף L בקצה'],
      ['s3',  'U – אנקר',      2, '[300,600,300]',                  '[90,90]',                '∪',  'צורת U – עוגן סרגל'],
      ['s4',  'Z – הזזה',      2, '[300,400,300]',                  '[135,135]',              'Z',  'כיפוף Z'],
      ['s5',  'S – כפול',      3, '[200,300,300,200]',              '[135,135,135]',          'S',  'כיפוף S כפול'],
      ['s6',  'אוברל – קרס',   3, '[200,400,400,200]',              '[90,180,90]',            '⎡',  'אוברל עם קרסים'],
      ['s7',  'אסדה פתוחה',    3, '[200,500,500,200]',              '[90,90,90]',             '⬓',  'צורת C פתוחה'],
      ['s8',  'מלבן – אצבה',   4, '[400,200,400,200]',              '[90,90,90,90]',          '□',  'כוש מלבני (Stirrup)'],
      ['s9',  'ריבוע – אצבה',  4, '[300,300,300,300]',              '[90,90,90,90]',          '◻',  'כוש מרובע (Stirrup)'],
      ['s10', 'חמישה כיפופים', 5, '[150,200,400,200,400,150]',      '[90,90,90,90,90]',       '⌂',  'צורה מורכבת 5 כיפופים'],
      ['s11', 'ששה כיפופים',   6, '[150,150,400,150,400,150,150]', '[90,90,90,90,90,90]',    '⬡',  'צורה מורכבת 6 כיפופים'],
      ['s12', 'מותאם אישית',   0, '[500]',                          '[]',                     '✏️', 'צורה מותאמת אישית'],
    ];
    for (const s of shapes) insertShape.run(...s);
    console.log('[DB] Shapes seeded');
  }

  // ── SEED WORKERS ──────────────────────────────────────────────────
  const workerCount = db.prepare('SELECT COUNT(*) as c FROM workers').get().c;
  if (workerCount === 0) {
    db.exec(`INSERT INTO workers (name, role, language) VALUES ('מנהל','מנהל','he'),('עובד 1','ייצור','he'),('עובד 2','ייצור','th')`);
  }

}

module.exports = {
  seedCoreData,
};
