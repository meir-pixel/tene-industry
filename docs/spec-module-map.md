# אפיון: מרכז בקרה — מפת מודולים חיה (Self-Declaring)

> בעלות: route modules (manifest), `realtime/ws.js`/`server.js` (ניטור), מסך admin חדש. תחום GPT — אפיון בלבד.
> סטטוס: אפיון מוכן, ממתין לביצוע.

## הרעיון (של מאיר)
כל מודול **מצהיר בעצמו** ממי הוא לוקח ולמי הוא נותן. מרכז הבקרה אוסף את כל ההצהרות ומצייר אוטומטית מפת מודולים — כל צומת עם שם, כמות כניסות/יציאות, וסטטוס חי.

**למה self-declaration ולא קובץ מרכזי:** ההצהרה יושבת בתוך המודול → לא יכולה לסטות מהמציאות. מודול חדש מצהיר → מופיע במפה לבד. מודול בלי הצהרה → בדיקה נכשלת.

---

## 1. הצהרת מודול (manifest)
כל `routes/<x>.js` מוסיף ייצוא `manifest` ליד ה-factory:

```javascript
module.exports = createOrdersRouter;
module.exports.manifest = {
  id:   'orders',
  name: 'הזמנות',
  consumes: [                       // ממי לוקח
    { event: 'new_order' },         // אירוע מ-intake/portal
    { table: 'customers', mode: 'read' },
  ],
  produces: [                       // למי נותן
    { event: 'order_status' },
    { event: 'order_complete' },
    { table: 'orders', mode: 'write' },
  ],
};
```

מבנה edge: `{ event: '<name>' }` או `{ table: '<name>', mode: 'read'|'write' }`.

---

## 2. ניטור חי (instrumentation)
מכיוון שכל האירועים עוברים דרך `wsBroadcast` — נקודה אחת:

```javascript
// בתוך wsBroadcast(type, data)
eventStats[type] = { lastSeen: Date.now(), count: (eventStats[type]?.count||0)+1 };
```

נשמר ב-memory + מתמיד מדי פעם ל-settings (כדי לשרוד restart).

---

## 3. בניית הגרף (מרכז הבקרה)
endpoint `GET /api/system/module-map`:
```javascript
// 1. אסוף manifests מכל route modules
// 2. בנה צמתים (מודולים) וקשתות (edges) מ-consumes/produces
// 3. הצלב עם eventStats: לכל edge של event — מתי נראה לאחרונה
// 4. החזר: { nodes:[{id,name,inCount,outCount}], edges:[{from,to,via,name,lastSeen,status}] }
```

**סטטוס edge:**
| צבע | משמעות |
|-----|--------|
| 🟢 ירוק | האירוע נראה לאחרונה (פעיל) |
| ⚪ אפור | מוצהר, עדיין לא נראה (חדש/לא פעיל) |
| 🔴 אדום | מוצהר וקריטי, אבל לא נראה זמן רב (תקוע!) |

---

## 4. מסך — מפת מודולים (admin)
- צמתים = מודולים, עם **שם + כמות כניסות/יציאות**
- חיצים = זרימות, צבועים לפי סטטוס
- לחיצה על מודול → פירוט: מה הוא מקבל, ממי, ומתי לאחרונה
- מבט-על: "3 זרימות אדומות" בראש המסך

```
  intake ──new_order──► orders ──order_complete──► production
   🟢 2 דק'              🟢 5 דק'                   🔴 3 ימים ⚠️

  orders ──new_invoice──► finance
   ⚪ עוד לא נראה
```

---

## 5. בדיקת governance — שלא ייפול
`test/module-map.test.js`:
- כל `routes/<x>.js` (פרט לליבה) חייב לייצא `manifest` עם id/consumes/produces.
- כל `event` ב-`produces` של מודול חייב להופיע כ-`wsBroadcast('<event>'` באותו קובץ (הצהרה תואמת קוד).
- אזהרה אם event מוצהר ב-consumes של מישהו אבל אף אחד לא מצהיר עליו ב-produces (יתום).

---

## גרסה קלה קודם (מומלץ)
80% מהערך בזול:
1. ניטור `wsBroadcast` (last-seen + count) — שינוי קטן בנקודה אחת
2. מסך טבלה פשוט: אירוע / נראה לאחרונה / ספירה
3. manifests + הגרף הויזואלי — שלב שני

---

## עקרונות
1. **Self-declaring** — האמת בתוך המודול, לא בקובץ צד.
2. **שתי שכבות** — מה שמוצהר (manifest) מול מה שקרה (live). ההצלבה = הערך.
3. **נקודה אחת לניטור** — `wsBroadcast`, לא פיזור.
4. **בדיקה אוכפת** — מודול בלי manifest / event לא-תואם = נכשל.

## Definition of Done
**קל:**
- [ ] ניטור ב-wsBroadcast (lastSeen+count)
- [ ] `GET /api/system/events` — טבלת אירועים + סטטוס
**מלא:**
- [ ] `manifest` בכל route module
- [ ] `GET /api/system/module-map` בונה גרף
- [ ] מסך מפת מודולים ויזואלי
- [ ] `test/module-map.test.js`
