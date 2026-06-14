# מודול: production-cards — כרטיסיות ייצור

## מה הוא עושה

מודול כרטיסיות ייצור מנהל את המעבר מהזמנה מאושרת לעבודה בפועל במפעל: יצירת כרטיסיות מאסטר ופריט, הדפסה, סריקת ברקוד, תחנת עובד, עדכון ביצוע, שקילה והשוואת משקל רצוי מול משקל מצוי.

המודול אינו יוצר הזמנות ואינו משנה מחירים. הוא מקבל הזמנה מאושרת ממודול `orders`, הופך אותה לכרטיסיות עבודה, ומחזיר סטטוס ייצור.

---

## גבולות אחריות

| תחום | אחריות |
|---|---|
| שייך למודול | כרטיסיות ייצור, ברקודים, הדפסה, תחנת עובד, סטטוס כרטיסייה, משקל רצוי/מצוי |
| לא שייך למודול | יצירת הזמנה, OCR של הזמנה מקורית, לקוחות, מחירון, חשבוניות, מלאי חומר גלם |
| מקבל מ | `orders`, `industry-steel-rebar`, `auth/users` |
| שולח אל | `orders`, `production`, `reports`, `alerts` |

---

## קלט

| מקור | מה מתקבל | הערות |
|---|---|---|
| מודול הזמנות | הזמנה מאושרת + פריטי הזמנה | רק אחרי status שמותר להעביר לייצור |
| מודול תעשיית ברזל | צורת פריט, צלעות, קוטר, אורך פריסה, משקל רצוי | אין חישוב צורה בתוך production-cards |
| עובד בתחנה | סריקת ברקוד / צילום כרטיסייה | צילום כרטיסייה הוא לזיהוי כרטיס, לא OCR הזמנה |
| משקל | משקל מצוי | משמש להתרעת חריגה מול משקל רצוי |
| מנהל | פיצול כרטיסיות / הדפסה מחדש | במיוחד אם הזמנה כבר בייצור |

---

## פלט

| יעד | מה יוצא | אירוע |
|---|---|---|
| עובד | כרטיסייה ברורה לעבודה | הצגת צורה, מידות, כמות, משקל רצוי |
| הזמנות | סטטוס פריט/הזמנה | `production.card.completed` |
| התראות | חריגת משקל / עיכוב | `production.card.weightDeviation` |
| דוחות | יומן עבודה וזמני ביצוע | persisted events / work log |
| הדפסה | PDF כרטיסיות | מאסטר + כרטיסייה לכל פריט/חלוקה |

---

## תהליכי עבודה

### 1. יצירת כרטיסיות מהזמנה מאושרת

```mermaid
flowchart RTL
  A[orders: הזמנה מאושרת] --> B[production-cards: יצירת מאסטר]
  B --> C[יצירת כרטיסייה לכל פריט]
  C --> D[שיוך ברקוד יחיד]
  D --> E[PDF להדפסה]
  D --> F[זמין לתחנת עובד]
```

חוקים:

- כל כרטיסייה מקבלת מזהה יציב, למשל `HZ-2026-001-000001`.
- כרטיסיית מאסטר מציגה את כל פריטי ההזמנה.
- כרטיסיית פריט מציגה רק את מה שהעובד צריך לבצע.
- אם משנים חלוקת כרטיסיות אחרי שההזמנה נכנסה לייצור — נדרש מסלול הדפסה מחדש ותיעוד שינוי.

### 2. תחנת עובד

```mermaid
flowchart RTL
  A[סריקת ברקוד] --> B[טעינת כרטיסייה]
  B --> C[הצגת צורה ומידות]
  C --> D[התחל עבודה]
  D --> E[סיום / כמות שבוצעה]
  E --> F[שקילה]
  F --> G{חריגה מהטווח?}
  G -->|כן| H[התראת בדיקה]
  G -->|לא| I[כרטיסייה הושלמה]
```

חוקים:

- עובד לא אמור לקרוא מלל ארוך. המסך מציג צורה ויזואלית, מידות, כמות, משקל רצוי וכפתורי פעולה.
- משקל רצוי מחושב לפני העבודה.
- משקל מצוי מוזן/נקלט בסוף.
- חריגה מהאחוז המותר לא חוסמת אוטומטית, אלא דורשת אישור/בדיקה לפי הרשאה.

### 3. זיהוי צילום כרטיסייה

צילום כרטיסייה משמש לזיהוי מספר כרטיסייה או פריט כאשר אין סריקת ברקוד.

```mermaid
flowchart RTL
  A[צילום כרטיסייה] --> B[Vision Provider]
  B --> C[זיהוי orderRef/cardRef]
  C --> D[טעינת כרטיסייה מהמערכת]
  D --> E[אישור עובד]
```

חוקים:

- לא מתחייבים לספק AI מסוים במסמך האפיון.
- הזיהוי מחזיר טיוטת זיהוי בלבד.
- אם confidence נמוך — העובד בוחר כרטיסייה ידנית.

---

## מסכים

| מסך | משתמשים | מטרה |
|---|---|---|
| תחנת עובד | worker, production, kiosk | סריקה, התחלה, סיום, שקילה, הערה |
| ניהול כרטיסיות | manager, office, production | צפייה בהזמנה, סטטוס כרטיסיות, הדפסה מחדש |
| תצוגת הדפסה | office, manager | PDF מאסטר + כרטיסיות פריטים |
| ניטור ייצור | manager, production | התקדמות, עיכובים, חריגות משקל |

כל מסך חייב לקבל mockup ויזואלי לפני הטמעה.

---

## API Contract ראשוני

| Method | Path | תפקיד | פעולה |
|---|---|---|---|
| GET | `/api/production-cards/orders` | production/manager | רשימת הזמנות עם סטטוס כרטיסיות |
| GET | `/api/production-cards/orders/:orderId` | production/manager | כרטיסיות להזמנה |
| GET | `/api/production-cards/:cardId` | production/kiosk | פרטי כרטיסייה |
| POST | `/api/production-cards/:cardId/start` | production/kiosk | התחלת עבודה |
| POST | `/api/production-cards/:cardId/complete` | production/kiosk | סיום עבודה + כמות |
| POST | `/api/production-cards/:cardId/weight` | production/kiosk | הזנת משקל מצוי |
| POST | `/api/production-cards/recognize` | production/kiosk | זיהוי כרטיסייה מצילום |
| POST | `/api/production-cards/orders/:orderId/reprint` | manager | הדפסה מחדש |

כל endpoint כתיבה חייב auth, validation, audit event, ובמידת הצורך realtime event.

---

## נתונים בבעלות המודול

ה־schema הסופי ייקבע בזמן בניית המודול, אבל אלה הישויות שבבעלותו:

| ישות | תוכן |
|---|---|
| `production_card` | כרטיסייה יחידה, מזהה, הזמנה, פריט, סטטוס, כמות, משקל רצוי |
| `production_card_work_log` | התחלה, עצירה, סיום, עובד, זמן, כמות, הערה |
| `production_card_weight_check` | משקל רצוי, משקל מצוי, אחוז חריגה, מי אישר |
| `production_card_print_job` | מתי הודפס, מי הדפיס, האם זו הדפסה מחדש |

אסור לשכפל כאן נתוני לקוח/מחיר/צורה כ־source of truth. מותר לשמור snapshot לצורך היסטוריה והדפסה.

---

## אירועים

| אירוע | מתי נשלח | צרכנים |
|---|---|---|
| `production.card.created` | נוצרה כרטיסייה מהזמנה | production, reports |
| `production.card.started` | עובד התחיל לבצע כרטיסייה | production, orders |
| `production.card.completed` | כרטיסייה הושלמה | orders, reports |
| `production.card.reprinted` | הודפסה מחדש כרטיסייה/מאסטר | orders, audit |
| `production.card.weightCaptured` | נקלט משקל מצוי | reports, quality |
| `production.card.weightDeviation` | חריגה מטווח משקל | alerts, quality, manager |

---

## Manifest מוצע

```js
module.exports.manifest = {
  id: 'production-cards',
  label: 'כרטיסיות ייצור',
  type: 'product-module',
  owns: {
    entities: ['production_card', 'production_card_work_log', 'production_card_weight_check'],
    routes: ['/api/production-cards'],
    screens: ['production-cards', 'production-station']
  },
  consumes: [
    { module: 'orders', event: 'order.approved' },
    { module: 'industry-steel-rebar', entity: 'shapeSnapshot' }
  ],
  produces: [
    { event: 'production.card.created' },
    { event: 'production.card.started' },
    { event: 'production.card.completed' },
    { event: 'production.card.weightDeviation' }
  ]
};
```

---

## סיכונים פתוחים

- צריך להכריע אחוז חריגת משקל מותר לפי קוטר/צורה/לקוח.
- צריך להכריע האם worker station עובד גם offline.
- צריך להכריע פורמט ברקוד סופי: SYNTA בלבד או גם QR פנימי.
- צריך לקשור פיצול כרטיסיות למסלול הדפסה מחדש בהזמנה.
- צריך mockup לפני קוד לכל מסך.

---

## Definition of Done

- דרכון המודול מאושר.
- manifest מוגדר.
- API contract מוגדר.
- אירועים רשומים ב־`docs/event-registry.md`.
- מסכי worker/manager קיבלו mockup ויזואלי ואישור.
- בדיקות מודול ממוקדות קיימות.
- אין תלות בקוד legacy של `server.js`.
