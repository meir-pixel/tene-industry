# V2 Integration Protocol — פרוטוקול קליטת עבודה ל־IronBend V2

מסמך זה מגדיר איך כל עבודה שנעשתה בצד — Claude, GPT, מאפיין חיצוני או פיתוח ידני — נכנסת לפרויקט V2 בלי טלאים ובלי סלט.

## כלל יסוד

מה שלא נמצא ב־GitHub, לא קיים מבחינת הפרויקט.

צ'אט, צילום מסך, קובץ מקומי או שינוי אצל סוכן אחר הם חומר גלם בלבד. הם נכנסים ל־V2 רק דרך משימה בלוח `TASKS_V2.md`, עם בעלות, scope, חוזה, בדיקות ו־commit ברור.

## מקורות האמת של V2

| תחום | מקור אמת |
|---|---|
| חזון וגבולות | `docs/PROJECT_TRUTH_HE.md` |
| משימות | `TASKS_V2.md` |
| כניסה לסוכן | `START_HERE_V2.md` |
| פרוטוקול קליטה | `docs/V2_INTEGRATION_PROTOCOL_HE.md` |
| קטלוג מודולים עסקי | V2 module manifests, ובהמשך קטלוג V2 ייעודי |
| רישוי | `core/licensing` + module registry, לא קוד צדדי מפוזר |

## שער כניסה לעבודה חיצונית

כל עבודה של Claude/GPT/מפתח נכנסת רק אם יש לה כרטיס ב־`TASKS_V2.md`.

כרטיס חייב לכלול:

- `status`
- `owner`
- `module`
- `priority`
- `scope`
- `input`
- `output`
- `logic`
- `definition_of_done`
- קבצים שנוגעים בהם
- בדיקות נדרשות

אם אחד מהסעיפים חסר — לא מתחילים קוד.

## איך קולטים עבודה שכבר נעשתה אצל Claude

1. מבקשים ממנו commit/hash או diff ברור.
2. בודקים שהקבצים לא מתנגשים עם משימה `in_progress`.
3. פותחים כרטיס `integration` ב־`TASKS_V2.md`.
4. מסווגים: לקחת, לשכתב, או לדחות.
5. אם לוקחים — מכניסים דרך מודול V2, לא מעתיקים לתוך קוד קיים כטלאי.
6. רק אחרי בדיקה ממוקדת מסמנים done.

## רישוי ומודולים — כלל V2

במערכת החדשה יש שני צירים שונים שאסור לערבב:

| ציר | משמעות | דוגמה |
|---|---|---|
| מודול מוצר | חלק שניתן למכור/לכבות ללקוח | orders, inventory, finance, intake |
| מודול תעשייה | חוקיות מקצועית לפי ענף | steel-rebar, wood, packaging בעתיד |

רישוי שולט במודולי מוצר. מודול תעשייה שולט בחישובים, צורות, משקלים ותצוגות מקצועיות.

## חוזה רישוי נקי

ב־V2 הרישוי חייב לעבוד כך:

```mermaid
flowchart RTL
  A[License Server] --> B[core/licensing]
  B --> C[core/module-registry]
  C --> D{requireModule}
  D -->|enabled| E[Module Routes]
  D -->|disabled| F[403 Module Not Licensed]
  C --> G[Admin Module Status Screen]
```

חוקים:

- `requireModule(moduleId)` יושב לפני routes.
- מצב פיתוח/Free פתוח כברירת מחדל, כדי לא לעצור מפעל.
- לקוח production מקבל רק מודולים שרכש.
- ליבה כמו auth/users/settings לא ננעלת בטעות.
- UI מציג מודולים פעילים/כבויים ומגבלות רישיון.
- max users הוא אזהרה רכה, לא חסימה מיידית באמצע יום עבודה.

## חוזה מודול V2

כל מודול חייב להצהיר על עצמו:

```js
module.exports.manifest = {
  id: 'orders',
  label: 'הזמנות',
  type: 'product-module',
  owns: {
    tables: ['orders', 'order_items'],
    routes: ['/api/orders'],
    screens: ['orders.html']
  },
  consumes: [
    { module: 'customers', entity: 'customer' },
    { module: 'pricing', entity: 'priceSnapshot' }
  ],
  produces: [
    { event: 'order.created' },
    { event: 'order.approved' }
  ]
};
```

מודול בלי manifest לא נטען.

## מה מותר לקחת מהמערכת הישנה

מותר לקחת:

- חוקים עסקיים שהוכחו כנכונים.
- נוסחאות משקל אחרי בדיקה.
- תובנות UX שנלמדו מהשטח.
- רשימת מודולים ותפקידים.
- רעיונות קיימים לרישוי, אם הם עוברים דרך חוזה V2.

אסור לקחת:

- server.js כמבנה.
- UI ישן כבסיס עיצוב.
- routes בלי service/validation/audit/events.
- קוד OCR שמחזיר מלל במקום טיוטה ויזואלית לאישור.
- תיקונים נקודתיים שלא מחוברים למודול.

## Definition of Done לאינטגרציה

עבודה חיצונית נחשבת נקלטה רק אם:

- יש כרטיס ב־`TASKS_V2.md`.
- יש בעלות ברורה.
- יש manifest או עדכון חוזה מודול.
- יש API contract אם נחשף endpoint.
- יש screen contract אם יש מסך.
- יש בדיקה ממוקדת.
- אין קובץ משותף שנערך בלי תיאום.
- יש commit עם נתיבים מפורשים.

## החלטה ניהולית

Codex/GPT מנהל את השער הטכני של V2.
Claude או כל סוכן אחר יכול לבנות חלקים, אבל לא מכניסים אותם לפרויקט בלי הכרטיס והחוזה.
