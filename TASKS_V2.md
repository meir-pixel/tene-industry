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

## 🎯 Sprint 0 — חלוקת משימות אפיון

מטרה: לסיים אפיון מודולרי לפני כתיבת קוד V2. כל משימה כאן היא אפיון בלבד: README/manifest/API/events/screens. לא בונים קוד עד שהאפיון מאושר.

| סדר | משימה | בעלים מומלץ | למה |
|---|---|---|---|
| 1 | `V2-006` Steel/Rebar Industry | gpt | הליבה המקצועית: צורות, חישוקים, ספירלות, משקל ותצוגה ויזואלית. כל ההזמנות נשענות על זה. |
| 2 | `V2-008` Intake/OCR | gpt | חייב להישען על חוקי הצורות; כולל השוואה מול מקור, תיקון צורה ואימון OCR. |
| 3 | `V2-007` Orders | gpt | מרכז התהליך העסקי: לקוח, פריטים, סטטוסים, אישור, מעבר לייצור. |
| 4 | `V2-011` Production Cards | gpt | נגזר מהזמנות ומתעשיית ברזל; כולל כרטיסיות, ברקוד, תחנת עובד, משקל רצוי/מצוי. |
| 5 | `V2-005` Customers | claude/either | עצמאי יחסית: לקוח, אנשי קשר, כתובות, תנאי תשלום, מחירון לקוח. |
| 6 | `V2-009` Pricing | claude/either | עצמאי יחסית אבל חייב להחזיק מחיר קנייה, מכירה, מחיר לקוח ו־snapshot להזמנה. |
| 7 | `V2-002` Auth / Users / Permissions | claude/either | תשתית ליבה; ניתן לאפיין במקביל כי אינו תלוי בצורות. |
| 8 | `V2-004` Licensing Gate | claude/either | רישוי ומכירת מודולים; תלוי ב־module registry אך אפשר לאפיין חוזה במקביל. |
| 9 | `V2-003` Module Registry + Manifest | gpt | מחבר את כל המודולים לטעינה, ownership, consumes/produces ומפת מודולים. |
| 10 | `V2-010` Integration Gate | gpt | שער כניסה לכל עבודה חיצונית; שומר שאין שוב שני עותקים וטלאים. |

### כללי עבודה לספרינט האפיון

- אין קוד. רק אפיון, manifests, API contracts, אירועים, מסכים ותלויות.
- כל מודול חייב לציין: input, output, logic, DB ownership, API, events, screens, permissions, risks.
- מודול שמייצר מסך חייב לכלול mockup plan ותצוגה לפני קוד.
- אם Claude עובד במקביל — הוא לוקח רק משימות שסומנו `claude/either` ולא נוגע במשימות `gpt` בלי תיאום.
- אם יש סתירה בין מסמך חיצוני למסמך V2 — מסמך V2 מנצח, והסתירה נרשמת ב־blocker.

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

- status: approval
- owner: codex-admin-system-licensing
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

- status: done
- owner: codex-admin-system-licensing
- module: licensing
- priority: high
- scope:
  - core/licensing
  - core/module-gates
  - test/core-module-gates.test.js
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
- owner: claude/either
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


### V2-005A — Customer Portal Price List Visibility And Print Template

- status: done
- owner: codex-customer-portal
- module: customers/portal
- priority: high
- latest_change:
  - replaced the customer portal login crane icon with the Tene logo so the entry screen matches customer-facing branding.
- scope:
  - `TASKS_V2.md`
  - `db/coreSchema.js`
  - `db/startup.js`
  - `routes/customers.js`
  - `routes/portal.js`
  - `services/portalAccess.js`
  - `public/customers.html`
  - `public/customer.html`
- input:
  - customer profile
  - customer tax id / company id
  - portal price list visibility: none / general / customer
  - active general or customer price book
  - reference PDF: customer printable price list layout
- output:
  - customer card controls whether the portal shows no price list, a general price list, or the customer price list.
  - customer-facing portal never exposes internal price book names, tiers, labels, or management source fields.
  - printable customer price list uses customer fields dynamically: name, tax id, address, phone, email, price date, rows, VAT note, signature area.
- logic:
  - order quote calculation remains separate from price-list visibility.
  - customers with no visible price list can still receive order quotes according to their pricing rules.
  - a customer configured for a visible general price list sees a printable public document, not the internal price book name.
  - a customer configured for a visible customer price list sees the same public document format with customer-specific rows.
- definition_of_done:
  - admin customer detail includes tax id and price-list visibility.
  - portal `/api/c/price-list` returns hidden state unless visibility allows a printable document.
  - portal price list print view matches the uploaded reference structure closely enough for operational use.
  - frontend and backend syntax checks pass.

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

- status: in_progress
- owner: codex-intake-ocr
- module: intake-ocr
- priority: critical
- latest_change:
  - aligned order OCR comparison with production-card table format: element name, customer shape description, editable shape drawing, row-level review save.
  - added module-origin OCR context for pricing imports: uploads from pricing/price_list stay in Pricing and use `/api/pricing/price-books/analyze-upload`, not order intake.
- scope:
  - modules/intake/README_HE.md
  - modules/intake/module.manifest.js
  - docs/event-registry.md
  - routes/intake.js
  - routes/catalog.js
  - public/intake.html
  - public/pricing.html
  - test/client-auth-contract.test.js
- input:
  - PDF, image, WhatsApp, email, manual, CSV
  - requested_by_module / requested_use_case / target_module from modules that request OCR
- output:
  - source document, OCR draft, corrections, approval
  - order OCR rows with `item_number`, `element_name`, `shape_description`, geometry, quantities, lengths, calculated weight, and row review status
  - price_list_import draft to Pricing when requested by pricing / price_list context
- logic:
  - OCR יוצר טיוטה בלבד.
  - OCR context from the calling module is a strong routing hint; `pricing / price_list` requests must not become order intake.
  - אישור מול מקור ויזואלי.
  - תיקון צורה פותח shape editor.
  - comparison rows follow the production-card/table format and can be marked reviewed one row at a time.
- definition_of_done:
  - compare flow מוגדר.
  - training flow מוגדר.
  - approval path מוגדר.
  - איפיון מסך קליטת מסמכים והשוואת OCR הועבר ל-modules/intake/README_HE.md.
  - ממתין לאישור מאיר לפני קוד.

### V2-009 — Finance/Pricing Domain Split

- status: done
- owner: codex-finance-pricing
- module: finance-pricing
- priority: high
- scope:
  - `TASKS_V2.md`
  - future: `modules/pricing/README_HE.md`
  - future: `modules/pricing/module.manifest.js`
  - future: `modules/costing/README_HE.md`
  - future: `modules/costing/module.manifest.js`
  - future: `modules/invoicing/README_HE.md`
  - future: `modules/invoicing/module.manifest.js`
  - future: `modules/credit/README_HE.md`
  - future: `modules/credit/module.manifest.js`
  - future: `modules/payment-terms/README_HE.md`
  - future: `modules/payment-terms/module.manifest.js`
  - future: `modules/payments/README_HE.md`
  - future: `modules/payments/module.manifest.js`
- input:
  - `docs/spec-dual-pricing.md`
  - `docs/modules/finance.md`
  - purchase price, sales price, customer price, quote date
  - invoices, credit exposure, payment terms, guarantees, clearing provider
- output:
  - פירוק תחום Finance/Pricing למודולים עצמאיים.
  - גבולות ownership ברורים לכל מקור מחיר/עלות/חיוב/אשראי/סליקה.
  - משימות אפיון נפרדות לפני כתיבת קוד.
- logic:
  - Pricing עונה: כמה הלקוח צריך לשלם.
  - Costing עונה: כמה זה עולה לנו.
  - Invoicing עונה: מה חויב רשמית.
  - Credit עונה: האם מותר להמשיך לעבוד מול הלקוח.
  - Payment Terms / Guarantees עונה: אילו תנאים חייבים להתקיים לפני עבודה/אשראי.
  - Payments עונה: איך תשלום בפועל נסלק/מתועד מול ספק חיצוני.
  - אסור לערבב מחיר קנייה עם מחיר מכירה.
  - אסור לחשב רווחיות ממחיר מכירה במקום מעלות.
  - כל מודול יקבל README/manifest/API/events/screens/permissions/risks משלו לפני קוד.
- definition_of_done:
  - V2-009A עד V2-009F קיימות כמשימות אפיון נפרדות.
  - ברור איזה מודול owns כל טבלה/אירוע/API.
  - אין תלות בקוד V1 או ב-`server.js`.
  - אין עבודה מחוץ ל-Finance/Pricing.

### V2-009A — Pricing Module Specification

- status: todo
- owner: codex-finance-pricing
- module: pricing
- priority: high
- scope:
  - future: `modules/pricing/README_HE.md`
  - future: `modules/pricing/module.manifest.js`
- input:
  - sales price
  - customer price
  - customer pricing source
  - discount
  - quote date
- output:
  - quote price
  - pricing snapshot for order
  - price source label
- logic:
  - מחירון כללי ומחירון לקוח הם שני מקורות מחיר בלבד להצעה.
  - לקוח עם מחירון אישי לא נופל אוטומטית למחירון כללי.
  - `discount_pct` חל רק אחרי בחירת מקור מחיר.
  - snapshot מחיר נשמר בהזמנה ואינו משתנה בדיעבד.
  - Pricing לא מחזיק מחיר קנייה ולא מחשב עלות.
- definition_of_done:
  - README/manifest/API/events/screens/permissions/risks מוגדרים.
  - מוגדר API חישוב מחיר להצעה.
  - מוגדר snapshot מחיר להזמנה.
  - מוגדר status `price_list_requires_update`.

### V2-009A-UI — Pricing Manager Runtime Screen

- status: done
- owner: codex-finance-pricing
- module: pricing
- priority: high
- latest_change:
  - prepared the main IronBend Render blueprint for cloud access to pricing: persistent `/data` disk, `/data/ironbend.db`, `/data/backups`, license server URL, and external `BASE_URL`.
  - added pricing OCR import flow: PDF/image recognition creates an editable draft before assigning it to a general or customer price book.
- scope:
  - `docs/mockups/pricing-manager.html`
  - `public/pricing.html`
  - `public/nav.js`
  - `public/finance.html`
  - `public/index.html`
  - `routes/catalog.js`
  - `routes/portal.js`
  - `services/pricer.js`
  - `db/coreSchema.js`
  - `db/financeSchema.js`
  - `db/seed.js`
  - `test/pricer.test.js`
  - `test/app-smoke.test.js`
  - `test/client-auth-contract.test.js`
  - `test/module-governance.test.js`
  - `test/security-routes.test.js`
- input:
  - `docs/spec-dual-pricing.md`
  - sample PDF price list from customer/vendor
- output:
  - מוקאפ HTML עצמאי למסך ניהול מחירונים.
  - מסך מערכת אמיתי לניהול מחירונים, מק״טים ושורות מחיר.
  - API לשמירת מחירונים ושורות מחיר הניתנות לעריכה/הוספה.
  - הסרת מחירון הקוטר הישן (`price_list`) מהמסך, ה-API, ה-schema וה-seed.
  - חלון יבוא מחירון מ-PDF/Excel/CSV.
  - חלון עריכת שורת מחירון עם מק״ט, קטגוריה, יחידה, מחיר, מטבע, חריגה ותוקף.
- logic:
  - המוקאפ אושר כהכוונת UI ומוטמע במסך מערכת.
  - מחירונים חדשים נשמרים כטיוטה עד הפעלה ידנית.
  - מחירון כללי ומחירון לקוח מוצגים ומנוהלים כהפרדה ברורה.
  - תנאי תשלום אינם שדה במחירון; הם שייכים למודול Payment Terms / Customers.
  - תאריך מחירון אינו מוזן ידנית; כל שינוי מעדכן `updated_at` ומוצג כ"עודכן".
  - כל שורת מחירון חייבת להיות ניתנת לעריכה/הוספה.
  - מחירון מיובא נשמר כטיוטה עד השוואה ואישור.
- definition_of_done:
  - ניתן ליצור מחירון חדש מתוך התוכנה.
  - ניתן להוסיף, לערוך ולמחוק שורות מק״ט.
  - אין במסך המחירון תנאי תשלום או תאריך תוקף ידני.
  - בדיקות הרשאות ו-governance מכסות את API המחירונים.

### V2-009B — Costing Module Specification

- status: todo
- owner: codex-finance-pricing
- module: costing
- priority: high
- scope:
  - future: `modules/costing/README_HE.md`
  - future: `modules/costing/module.manifest.js`
- input:
  - purchase price
  - steel price history
  - order item weight
  - labor cost rules
  - overhead cost rules
- output:
  - cost basis
  - material cost
  - labor cost
  - overhead cost
  - margin input for Finance reports
- logic:
  - מחיר קנייה מגיע ממקור עלות בלבד, לא ממחיר מכירה.
  - אם חסר מחיר קנייה, מחזירים `cost_basis_missing`.
  - Costing לא יוצר הצעת מחיר ללקוח ולא מציג מחיר בפורטל.
  - Cost snapshot ננעל לפי אירוע הזמנה מוגדר.
- definition_of_done:
  - README/manifest/API/events/screens/permissions/risks מוגדרים.
  - מקור האמת למחיר קנייה מוגדר.
  - מוגדר API חישוב עלות.
  - מוגדר מתי cost snapshot נוצר וננעל.

### V2-009C — Invoicing Module Specification

- status: todo
- owner: codex-finance-pricing
- module: invoicing
- priority: high
- scope:
  - future: `modules/invoicing/README_HE.md`
  - future: `modules/invoicing/module.manifest.js`
- input:
  - approved order
  - pricing snapshot
  - customer billing details
  - payment status
- output:
  - invoice
  - invoice items
  - payment mark
  - cancellation/credit-note contract if approved
- logic:
  - חשבונית נוצרת ממקור עסקי מאושר, לא מטיוטת מחיר.
  - סכום חשבונית נשען על snapshot, לא על מחירון חי.
  - ביטול/זיכוי הוא מסלול מפורש, לא מחיקה שקטה.
  - Invoicing לא מנהל מסגרת אשראי ולא מחשב עלות.
- definition_of_done:
  - README/manifest/API/events/screens/permissions/risks מוגדרים.
  - lifecycle חשבונית מוגדר.
  - API list/create/pay/cancel מוגדר.
  - אירועי invoice מוגדרים.

### V2-009D — Credit Module Specification

- status: todo
- owner: codex-finance-pricing
- module: credit
- priority: high
- scope:
  - future: `modules/credit/README_HE.md`
  - future: `modules/credit/module.manifest.js`
- input:
  - customer
  - credit limit
  - ledger balance
  - open orders
  - unpaid invoices
- output:
  - credit exposure
  - credit block status
  - credit transaction log
  - order approval gate result
- logic:
  - Credit מחליט האם מותר להמשיך לעבוד מול הלקוח.
  - לא מערבבים בין ledger חשבונאי לבין מסגרת אשראי תפעולית בלי חוזה ברור.
  - חסימת אשראי היא תוצאה מפורשת עם סיבה, לא side effect מוסתר.
  - Credit לא יוצר חשבונית ולא מחשב מחיר.
- definition_of_done:
  - README/manifest/API/events/screens/permissions/risks מוגדרים.
  - מוגדר מודל חשיפה וחסימה.
  - מוגדר API בדיקת אשראי.
  - מוגדרים אירועים לשינוי מסגרת/חסימה.

### V2-009E — Payment Terms And Guarantees Module Specification

- status: todo
- owner: codex-finance-pricing
- module: payment-terms
- priority: high
- scope:
  - future: `modules/payment-terms/README_HE.md`
  - future: `modules/payment-terms/module.manifest.js`
- input:
  - customer
  - payment terms
  - signed guarantee
  - required guarantee amount
  - customer onboarding status
- output:
  - terms contract
  - guarantee status
  - pre-work eligibility
  - required action for customer/admin
- logic:
  - לקוח ללא תנאי תשלום חייב תשלום/אשראי מראש לפי החלטה עסקית.
  - לקוח עם תנאי תשלום חייב ערבות חתומה אם כך הוגדר.
  - תנאי תשלום וערבות הם חוזה לקוח, לא שדה צדדי בהזמנה.
  - המודול לא סולק תשלום בפועל ולא יוצר חשבונית.
- definition_of_done:
  - README/manifest/API/events/screens/permissions/risks מוגדרים.
  - מוגדר חוזה תנאי תשלום.
  - מוגדר חוזה ערבות.
  - מוגדרת בדיקת eligibility להזמנה/עבודה.

### V2-009F — Payments Module Specification

- status: todo
- owner: codex-finance-pricing
- module: payments
- priority: medium
- scope:
  - future: `modules/payments/README_HE.md`
  - future: `modules/payments/module.manifest.js`
- input:
  - invoice
  - payment request
  - clearing provider response
  - receipt/reference number
- output:
  - payment attempt
  - payment status
  - provider reference
  - invoice payment event
- logic:
  - Payments מחבר לספק סליקה חיצוני; לא בונים ספק סליקה פנימי.
  - כל ניסיון תשלום נשמר עם provider/reference/status.
  - הצלחת תשלום מעדכנת Invoicing דרך אירוע/חוזה מוגדר.
  - Payments לא מחליט מחיר, עלות, אשראי או תנאי תשלום.
- definition_of_done:
  - README/manifest/API/events/screens/permissions/risks מוגדרים.
  - מוגדר חוזה provider adapter.
  - מוגדר payment lifecycle.
  - מוגדרת אינטגרציה נקייה מול Invoicing.


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

### V2-011 — Production Cards Module Specification

- status: todo
- owner: gpt
- module: production-cards
- priority: high
- scope:
  - `docs/modules/production-cards.md`
  - future: `modules/production-cards/README_HE.md`
  - future: `modules/production-cards/module.manifest.js`
- input:
  - approved order
  - steel-rebar shape snapshot
  - worker scan/photo
  - target weight and actual weight
- output:
  - production cards
  - print/reprint jobs
  - worker progress
  - weight deviation alerts
- logic:
  - כרטיסיות נוצרות רק מהזמנה מאושרת.
  - עובד רואה צורה, מידות, כמות, משקל רצוי וכפתורי פעולה — לא מלל ארוך.
  - משקל מצוי מושווה למשקל רצוי ומייצר התראת חריגה רכה.
  - צילום כרטיסייה מזהה כרטיס, לא יוצר הזמנה חדשה.
- definition_of_done:
  - manifest מלא.
  - API/screen/db/events מוגדרים.
  - mockup ויזואלי לתחנת עובד וניהול כרטיסיות.
  - אין תלות ב־server.js הישן.

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
