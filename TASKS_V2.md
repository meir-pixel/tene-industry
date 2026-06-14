# TASKS_V2 — IronBend V2

לוח המשימות המרכזי לבנייה מחדש. אין לעבוד ממשימות בצ'אט בלבד.

## סטטוסים

- `todo` — מוכן לבחירה.
- `in_progress` — תפוס על ידי סוכן.
- `approval` — מחכה להכרעת מאיר.
- `blocked` — חסום מסיבה כתובה.
- `done` — הושלם.

## כללי תפיסה

1. סוכן בוחר משימה אחת בלבד.
2. לפני עבודה הוא משנה ל־`in_progress`.
3. אם יש התנגשות scope עם משימה אחרת — לא לוקחים.
4. commit רק עם נתיבים מפורשים.
5. לא נוגעים בקבצים מחוץ ל־scope.

---

## 🟠 בתכנון / לאישור מאיר

### V2-000 — החלטת Repo ומסלול בנייה

- status: approval
- owner: meir
- module: project-management
- scope:
  - repo strategy
- question: האם V2 נבנה בריפו חדש `ironbend-v2` או בתוך הריפו הקיים בתיקייה נפרדת?
- recommendation: ריפו חדש או תיקיית `v2/` נקייה, בלי תלות בקוד הישן.
- definition_of_done:
  - הוחלט איפה V2 חי.
  - הוגדר מה אסור לייבא מהישן.

---

## ✅ מוכן לעבודה

### V2-001 — V2 Core Skeleton

- status: todo
- owner: gpt
- module: core
- priority: critical
- scope:
  - `v2/` או ריפו חדש לאחר החלטת V2-000
- input:
  - `docs/PROJECT_TRUTH_HE.md`
- output:
  - שלד פרויקט נקי
  - תיקיות core/modules/industries/apps/shared/tests
  - test runner בסיסי
  - health endpoint
- logic:
  - אין לוגיקה עסקית.
  - רק תשתית טעינה ובדיקת חיים.
- definition_of_done:
  - הפרויקט עולה מקומית.
  - יש בדיקת health ירוקה.
  - אין תלות בקוד הישן.

### V2-002 — Auth / Users / Permissions Contract

- status: todo
- owner: either
- module: core-auth
- priority: critical
- scope:
  - core/auth
  - core/permissions
  - modules/admin-users
- input:
  - משתמשים, roles, login credentials
- output:
  - JWT stable auth
  - permissions service
  - user management API
- logic:
  - role לא מגיע מ־header מזויף.
  - JWT secret חובה בייצור.
  - WebSocket auth מתוכנן מהיום הראשון.
- definition_of_done:
  - login/logout/refresh מוגדרים.
  - requireRole/requireAnyRole מוגדרים.
  - בדיקות auth קיימות.

### V2-003 — Module Registry + Manifest Contract

- status: todo
- owner: gpt
- module: core-modules
- priority: critical
- scope:
  - core/module-registry
  - shared/module-contract
- input:
  - module.manifest.js מכל מודול
- output:
  - registry של מודולים
  - consumes/produces map
  - validation למודול
- logic:
  - מודול בלי manifest לא נטען.
  - manifest הוא מקור אמת ל־ownership.
- definition_of_done:
  - מודול דמה נטען.
  - מודול בלי manifest נכשל בבדיקה.
  - map בסיסי מוצג/נוצר.

### V2-004 — Licensing Gate

- status: todo
- owner: either
- module: licensing
- priority: high
- scope:
  - core/licensing
  - core/module-gates
- input:
  - license entitlements
  - module registry
- output:
  - requireModule(moduleId)
  - enabled/disabled modules
- logic:
  - Gate לפני routes.
  - Free/dev mode פתוח.
  - Production customer מקבל רק מה שרכש.
- definition_of_done:
  - מודול כבוי חסום.
  - מודול ליבה לא ננעל בטעות.

### V2-005 — Customers Module Specification

- status: todo
- owner: gpt
- module: customers
- priority: high
- scope:
  - modules/customers/README_HE.md
  - modules/customers/module.manifest.js
- input:
  - לקוח, אנשי קשר, כתובות, תנאי תשלום, מחירון לקוח
- output:
  - customer profile contract
  - customer API contract
  - customer screen contract
- logic:
  - לקוח הוא entity עצמאי, לא שדה בתוך הזמנה.
- definition_of_done:
  - אפיון מלא לפני קוד.
  - owner/input/output/db/api/events/screens מוגדרים.

### V2-006 — Steel/Rebar Industry Specification

- status: todo
- owner: gpt
- module: industry-steel-rebar
- priority: critical
- scope:
  - industries/steel-rebar/README_HE.md
  - industries/steel-rebar/module.manifest.js
- input:
  - קוטר, צורה, צלעות, זוויות, ספירלה, כמות
- output:
  - shape contract
  - weight contract
  - visual SVG contract
- logic:
  - ישר בלי זוויות.
  - מקופף עם צלעות וזוויות.
  - ספירלה עם קוטר ברזל, קוטר ספירלה, מספר כריכות.
  - חישוק עם סימון פנימי קבוע.
- definition_of_done:
  - כל סוג צורה מוגדר.
  - אין ambiguity בין ספירלה/חישוק/מקופף.

### V2-007 — Orders Module Specification

- status: todo
- owner: gpt
- module: orders
- priority: critical
- scope:
  - modules/orders/README_HE.md
  - modules/orders/module.manifest.js
- input:
  - customer, order items, pricing snapshot, intake approval
- output:
  - order, order_items, status events, production request
- logic:
  - עריכה עורכת הזמנה קיימת.
  - שינוי כרטיסיות אחרי ייצור מחייב מסלול הדפסה מחדש.
- definition_of_done:
  - lifecycle מוגדר.
  - status transitions מוגדרים.
  - API/screen/db/events מוגדרים.

### V2-008 — Intake/OCR Module Specification

- status: todo
- owner: gpt
- module: intake-ocr
- priority: critical
- scope:
  - modules/intake/README_HE.md
  - modules/intake/module.manifest.js
- input:
  - PDF, image, WhatsApp, email, manual, CSV
- output:
  - source document, OCR draft, corrections, approval
- logic:
  - OCR יוצר טיוטה בלבד.
  - אישור מול מקור ויזואלי.
  - תיקון צורה פותח shape editor.
- definition_of_done:
  - compare flow מוגדר.
  - training flow מוגדר.
  - approval path מוגדר.

### V2-009 — Pricing Module Specification

- status: todo
- owner: either
- module: pricing
- priority: high
- scope:
  - modules/pricing/README_HE.md
  - modules/pricing/module.manifest.js
- input:
  - purchase price, sales price, customer price, date
- output:
  - quote, cost basis, snapshot
- logic:
  - מחיר לקוח גובר על מחיר מכירה.
  - מחיר קנייה משמש עלות.
  - snapshot נשמר בהזמנה.
- definition_of_done:
  - שלושת סוגי המחירון מופרדים.
  - API חישוב מחיר מוגדר.


### V2-010 — Integration Gate + Licensing Source of Truth

- status: todo
- owner: gpt
- module: project-management/licensing
- priority: critical
- scope:
  - `docs/V2_INTEGRATION_PROTOCOL_HE.md`
  - `START_HERE_V2.md`
  - `TASKS_V2.md`
  - future: `core/licensing`
  - future: `core/module-registry`
- input:
  - עבודה שנעשתה אצל Claude/GPT מחוץ לריפו
  - קטלוג מודולים קיים
  - שרת רישיונות קיים
  - החלטות מאיר לגבי מכירת מודולים
- output:
  - שער קליטה אחד לכל עבודה חיצונית
  - חוזה רישוי V2 נקי
  - הפרדה בין מודולי מוצר למודולי תעשייה
  - כלל: מה שלא נכנס דרך TASKS_V2 לא נכנס לפרויקט
- logic:
  - לא מעתיקים קוד צדדי כטלאי.
  - כל עבודה חיצונית מקבלת כרטיס, scope, owner ו־Definition of Done.
  - רישוי מחובר ל־module registry, לא מפוזר במסכים/routes.
  - Free/dev mode פתוח; production נאכף לפי entitlements.
- definition_of_done:
  - פרוטוקול הקליטה מתועד.
  - START_HERE_V2 מפנה לפרוטוקול.
  - כל משימת רישוי עתידית חייבת לעבור דרך core/licensing + module registry.

---

## ⛔ אסור כרגע

- לא לתקן עוד מסכים במערכת הישנה בלי החלטה מפורשת.
- לא להוסיף משימות V2 לתוך `TASKS.md` הישן.
- לא לערבב קוד V2 עם server.js הישן.
- לא להעתיק DB schema ישן בלי אפיון ownership.

---

## ✅ הושלם

### V2-DOC-001 — מסמך אמת V2

- status: done
- owner: gpt
- artifact:
  - `docs/PROJECT_TRUTH_HE.md`
  - Google Docs: IronBend V2 - מסמך אמת מודולרי
