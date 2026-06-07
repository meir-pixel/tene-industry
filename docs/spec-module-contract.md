# אפיון: חוזה מודול תעשייה + Module Loader (שלב 2)

> סטטוס: שלב 2a בוצע. Backend בלבד; `public/index.html` לא שונה.

## מטרה
לנתק את ה-routes מהצימוד לפלדה. אחרי השלב — החלפת תעשייה = שינוי ערך אחד ב-settings, לא שכתוב קוד.

## פיצול לשני שלבים
- **2a (עכשיו, בטוח):** חוזה + Loader. `server.js` מושך את פונקציות הפלדה דרך ה-Loader. ה-routes לא משתנים. הטסטים נשארים ירוקים.
- **2b (בוצע חלקית):** routes מרכזיים משתמשים עכשיו ב-`industry.weightPerUnit`; ניתוק מלא של שמות דומיין ספציפיים ימשיך בהמשך.

---

## קובץ חדש: `services/moduleLoader.js`

```javascript
'use strict';

/**
 * services/moduleLoader.js — בוחר וטוען את מודול התעשייה הפעיל.
 * המודול נקבע ב-settings: ACTIVE_INDUSTRY_MODULE (ברירת מחדל steel-rebar).
 */

function required(name, value) {
  if (!value) throw new Error(`services/moduleLoader missing dependency: ${name}`);
  return value;
}

const AVAILABLE = {
  'steel-rebar': () => require('../modules/steel-rebar'),
  // בעתיד: 'wood': () => require('../modules/wood'),
};

function createModuleLoader(settingsService) {
  required('settingsService', settingsService);

  function active() {
    const id = settingsService.get('ACTIVE_INDUSTRY_MODULE', 'steel-rebar');
    const factory = AVAILABLE[id];
    if (!factory) {
      throw new Error(`Unknown industry module: ${id}. Available: ${Object.keys(AVAILABLE).join(', ')}`);
    }
    const mod = factory();
    ['id', 'name', 'kgPerMeter', 'assignResource', 'normalizeSegments', 'normalizeShapeName']
      .forEach(k => { if (mod[k] === undefined) throw new Error(`Industry module "${id}" missing contract member: ${k}`); });
    return mod;
  }

  return { active, listAvailable: () => Object.keys(AVAILABLE) };
}

module.exports = { createModuleLoader };
```

---

## עריכה: `modules/steel-rebar/index.js` (תוספת בלבד — לא לשבור קיים)

שמור את כל הייצוא הקיים, הוסף מעליו את שדות החוזה והכינויים הגנריים:

```javascript
module.exports = {
  // ── קיים (לא לגעת) ──
  MODULE_ID: 'steel-rebar',
  MODULE_NAME: 'ברזל כפוף',
  rebarKgPerMeter, REBAR_WEIGHTS, REBAR_KG_PER_M, VALID_DIAMETERS,
  autoAssignMachine, normalizeFactorySegments, normalizeFactoryShapeName,
  parseBVBS, parseBVBSLine,

  // ── חוזה מודול אחיד (חדש) ──
  id:   'steel-rebar',
  name: 'ברזל כפוף',

  kgPerMeter:         rebarKgPerMeter,
  assignResource:     autoAssignMachine,
  normalizeSegments:  normalizeFactorySegments,
  normalizeShapeName: normalizeFactoryShapeName,
  parseBatchFile:     parseBVBS,

  weightPerUnit(item) {
    const len = Number(item.total_length_mm) || 0;
    return (len / 1000) * rebarKgPerMeter(item.diameter);
  },

  priceDimension: 'diameter',

  itemFields: [
    { key: 'diameter', label: 'קוטר', type: 'number', unit: 'mm', required: true },
    { key: 'segments', label: 'צלעות', type: 'segments' },
  ],

  labels: { item: 'מוט', dimension: 'קוטר', resource: 'מכונה', batchFile: 'קובץ BVBS' },
};
```

---

## עריכה: `services/settings.js`

הוסף ל-seed של ה-definitions (קבוצה 9 — מערכת):

```javascript
['ACTIVE_INDUSTRY_MODULE', 9, 'מודול תעשייה פעיל', 'איזה מודול תעשייה המערכת מריצה', 'string', 'steel-rebar', null, null, null, 1, 'read', 0],
```

`vendor_only=1`, `customer_permission='read'` — הלקוח רואה, רק Tene Industry מחליף.

---

## עריכה: `server.js`

**1. require (ליד שאר ה-services):**
```javascript
const { createModuleLoader } = require('./services/moduleLoader');
```

**2. אחרי יצירת `settingsService`:**
```javascript
const moduleLoader = createModuleLoader(settingsService);
const industry     = moduleLoader.active();
```

**3. החלף את ה-destructure (כיום שורות ~53–64):**
```javascript
// universal — נשאר מ-constants
const { MACHINE_STATES, STATE_TRANSITIONS } = constants;
// industry-specific — מהמודול הפעיל דרך ה-Loader
const {
  rebarKgPerMeter, REBAR_WEIGHTS,
  autoAssignMachine, normalizeFactorySegments, normalizeFactoryShapeName,
} = industry;
// shared
const { createOrderFactory } = ordersService;
```

**סדר חשוב:** `settingsService` ו-`industry` חייבים להיווצר לפני ה-destructure. אם צריך — להזיז את ה-destructure למטה, אחרי יצירת ה-DB/settings. כל ה-mounts נשארים זהים.

---

## עדכון `test/module-governance.test.js`

```javascript
test('industry module is resolved through the loader, not hardcoded', () => {
  const server = read('server.js');
  const loader = read('services/moduleLoader.js');
  assert.match(server, /createModuleLoader/);
  assert.match(server, /moduleLoader\.active\(\)/);
  assert.match(server, /=\s*industry;/);
  assert.match(loader, /ACTIVE_INDUSTRY_MODULE/);
  const steel = read('modules/steel-rebar/index.js');
  assert.match(steel, /kgPerMeter:/);
  assert.match(steel, /assignResource:/);
  assert.match(steel, /weightPerUnit/);
});
```

---

## Definition of Done
- [ ] `services/moduleLoader.js` קיים עם `required()` guard
- [ ] `modules/steel-rebar/index.js` מממש את החוזה (תוספת בלבד)
- [ ] `ACTIVE_INDUSTRY_MODULE` ב-settings
- [ ] `server.js` מושך industry מה-Loader
- [ ] governance test חדש עובר
- [ ] `npm test` ירוק (139+)
- [ ] לא נגעו ב-`public/index.html`

---

## מה זה נותן
נקודת האינטגרציה היחידה לתעשייה היא ה-Loader. כש-`modules/wood/index.js` ייכתב עם אותו חוזה — מוסיפים שורה ל-`AVAILABLE`, משנים `ACTIVE_INDUSTRY_MODULE`, והמערכת רצה כנגרייה.

## שלב 2b (בוצע חלקית)
Routes מרכזיים (`orders`, `portal`, `finance`, `bvbs`, `productionCards`) מקבלים עכשיו `industry` וקוראים לחוזה הפעיל לחישובי משקל/שיוך. נשאר להמשיך בהמשך לניתוק מלא של שמות דומיין ספציפיים במסכים ובדוחות.
