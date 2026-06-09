# אפיון: הרשאות מבוססות-מודול + מסך ניהול הרשאות

> סטטוס: אפיון מאושר, **טרם בוצע**.
> בעלות: שכבה רגישת-אבטחה הנוגעת ל-`permissions.js` ול-nav. תיאום עם GPT לפני ביצוע ב-`server.js`.
> תאריך: 2026-06-09

---

## מטרה

לאפשר לבעל המערכת להחליט **ממסך** מה כל תפקיד רואה/קורא/עורך — בלי לגעת בקוד.
ההחלטה "מה ייצור רואה מול מה משרד רואה" היום קבועה בקוד; אחרי השלב היא נתונה לשליטה.

**עיקרון-על:** ההרשאה היא חלק מהמודול. אין טבלת הרשאות מרכזית שצריך לתחזק ידנית.
מסך הניהול הוא **מראה** שמרכיבה את עצמה מהמודולים הפעילים.

---

## העקרונות (מאושרים)

1. **ההרשאה מוצהרת במודול עצמו** (ב-`manifest`). מקור האמת = המודול.
2. **מסך "ניהול מערכת" = תצוגה** שמרכיבה את עצמה מאיחוד המודולים הפעילים אצל הלקוח. מודול חדש מופיע לבד.
3. **מי שאין לו הרשאה — המסך לא קיים לו בשום צורה:** לא ב-nav, לא בחיפוש, ונחסם גם בכניסה ישירה לכתובת.
4. **רמות גישה:** `hidden` / `read` / `edit` לכל תפקיד × מסך.
5. **ברירת מחדל למודול חדש:** סגור לכולם חוץ מאדמין (`default: 'hidden'`, `admin: 'edit'`).
6. **קיר ביטחון בקוד נשאר.** ה-override ממסך יכול רק **להגביל**, לעולם לא להעלות הרשאה מעבר למה שה-`requireAnyRole`/`requireRole` בקוד מתיר. כך מיסקונפיגורציה לא חושפת מידע.

---

## שכבה 1 — קיר ביטחון (קוד, ללא שינוי)

`requireAnyRole(['finance','manager','admin'])` ו-`requireRole('manager')` הקיימים ב-routes נשארים כפי שהם.
זו רשת הביטחון לכתיבה/מידע רגיש. השכבה הקונפיגורבילית לא מחליפה אותה — היא יושבת מעליה ורק מצמצמת.

---

## שכבה 2 — הצהרת מודול (חדש)

מרחיבים את ה-`manifest` הקיים של כל route module (כבר קיים `consumes/produces`).

```js
module.exports.manifest = {
  id: 'finance',
  label: 'פיננסים',

  // מסכים שהמודול חושף (מחליף את ה-mapping שהיום ב-nav.js)
  screens: [
    { id: 'finance', path: '/finance.html', label: 'פיננסים', icon: '💰', group: 'ניהול' }
  ],

  // הרשאת ברירת מחדל שהמודול מגדיר לעצמו
  access: {
    default: 'hidden',                 // כל תפקיד שלא צוין → hidden
    roles: {
      admin:   'edit',
      manager: 'edit',
      finance: 'edit',
      office:  'read'
    }
  },

  consumes: [...],  // קיים
  produces: [...]   // קיים
};
```

- `access.roles` מגדיר את ברירת המחדל **ההגיונית** של המודול.
- מודול חדש שנכתב לפי כלל ברירת-המחדל הבטוחה: `default: 'hidden'`, `roles: { admin: 'edit' }` בלבד.

---

## מקור האמת המורכב (effective access)

הגישה בפועל לכל (תפקיד, מסך) מחושבת לפי סדר עדיפות:

```
effective(role, screen) =
   override של הלקוח (אם קיים ב-settings)
   else access.roles[role] מה-manifest
   else access.default
```

**override** = מה שהמנהל שינה ידנית במסך. נשמר ב-settings (Control Room), לא בקוד.

מפתח ההגדרה המוצע: `ROLE_SCREEN_ACCESS` (group 9 — מערכת), `value_type='string'`, מכיל JSON:
```json
{ "finance": { "office": "hidden" }, "warehouse": { "production": "read" } }
```
רק חריגות מברירת המחדל נשמרות — JSON רזה.

---

## שירות חדש: `services/accessControl.js`

```js
function createAccessControl({ moduleLoader, settingsService, catalog }) {
  // מאחד את ה-manifests של המודולים הפעילים → רשימת screens
  function listScreens() { ... }              // לכל המסכים הפעילים
  function effective(role, screenId) { ... }  // hidden|read|edit לפי סדר העדיפות למעלה
  function screensForRole(role) { ... }        // המסכים שאינם hidden עבור התפקיד
  function canRead(role, screenId)  { return effective(role, screenId) !== 'hidden'; }
  function canEdit(role, screenId)  { return effective(role, screenId) === 'edit'; }
  return { listScreens, effective, screensForRole, canRead, canEdit };
}
```

- `required()` guard על כל dependency.
- אין DB חדש; משתמש ב-`settingsService` הקיים.

---

## API חדש (route module: `routes/access.js`)

| Method | Route | Guard | תיאור |
|--------|-------|-------|-------|
| GET  | `/api/access/me`        | מחובר | המסכים+רמות של התפקיד שלי (ל-nav וחסימת דף) |
| GET  | `/api/access/matrix`    | admin | מטריצת תפקידים×מסכים מלאה (למסך הניהול) |
| PUT  | `/api/access/matrix`    | admin | שמירת override (תפקיד, מסך, רמה) |

- `GET /api/access/me` מחזיר רק את **שלי** — הצד-לקוח לא צריך לדעת מה תפקידים אחרים רואים.
- שמירה ב-`PUT` עוברת ולידציה: ערך ∈ {hidden,read,edit}; לא ניתן לתת `edit` למסך שהקוד חוסם לתפקיד (קיר ביטחון) — מסומן disabled במסך.

---

## Frontend

### nav.js
- היום: LINKS מסונן לפי מודול מורשה בלבד.
- שינוי: בטעינה קורא `GET /api/access/me`; מציג רק מסכים שרמתם ≠ `hidden`. מסך `hidden` **לא נוצר ב-DOM** ולא נכנס לאינדקס החיפוש.

### חסימת כניסה ישירה (page guard)
- snippet משותף (למשל `public/access-guard.js`) שכל דף מוגן טוען בראשו:
  - קורא `GET /api/access/me`; אם המסך הנוכחי `hidden` → redirect ל-`/dashboard.html` (כאילו לא קיים).
  - אם `read` → מסמן `document.body.dataset.access='read'`; CSS מסתיר אלמנטים עם `[data-requires-edit]` (כפתורי צור/שמור/מחק).

### מסך הניהול (`admin.html` → טאב "הרשאות")
- רשת: שורות = תפקידים, עמודות = מסכים (מקובצים לפי group/מודול), כל תא dropdown `hidden/read/edit`.
- תא שהקוד חוסם לתפקיד = disabled עם tooltip "חסום בקוד (קיר ביטחון)".
- כפתור שמירה → `PUT /api/access/matrix`.

---

## אבטחה — נקודות חובה

- ה-override **לא יכול להעלות** מעבר לקיר הביטחון בקוד. אכיפה גם בשרת (ולידציה ב-PUT) וגם בתצוגה (disabled).
- הסתרה בצד-לקוח אינה אבטחה — היא UX. האבטחה האמיתית נשארת ב-`requireAnyRole` בכל endpoint.
- `GET /api/access/me` חושף רק את התפקיד של המבקש, לא את המטריצה המלאה.
- מודול שאינו ברישיון הלקוח כלל — לא מופיע ב-`listScreens` ולכן לא ב-nav, לא בחיפוש, ולא במטריצה.

---

## Definition of Done

- [ ] `manifest.screens` + `manifest.access` נוספו למודולים הקיימים (תוספת בלבד).
- [ ] `services/accessControl.js` קיים עם `required()` guard ובדיקות יחידה ל-`effective()`.
- [ ] `routes/access.js` עם 3 ה-endpoints + הרשאות.
- [ ] `nav.js` מסנן לפי `/api/access/me`; מסך hidden לא נוצר ב-DOM/חיפוש.
- [ ] `access-guard.js` חוסם כניסה ישירה ומחיל read-only.
- [ ] טאב "הרשאות" ב-`admin.html` עם רשת ושמירה.
- [ ] בדיקה: override לא יכול לעקוף קיר ביטחון (שרת + UI).
- [ ] ברירת מחדל למודול חדש = hidden לכולם חוץ מאדמין (נבדק).
- [ ] `npm test` ירוק; אם נוסף route — עודכן `test/module-governance.test.js`.

---

## מה זה נותן

הרשאות הופכות לתכונה של המודול, לא לתחזוקה מרכזית.
מוסיפים מודול → ההרשאות שלו מופיעות לבד במסך הניהול, סגורות כברירת מחדל.
בעל המערכת מחליט ממסך מה כל תפקיד רואה/קורא/עורך, מעל קיר ביטחון שאי-אפשר לעקוף.
מתחבר ישירות ל-`spec-module-map.md` (מודול מצהיר על עצמו).
