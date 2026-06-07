# אפיון: שני סוגי מחירון (מחירון שלי / מחירון הלקוח)

> בעלות: `services/pricer.js`, `services/pricing-importer.js` (חדש), `customers`. תאם עם הצוות שעובד על pricer/finance.
> סטטוס: אפיון, ממתין לביצוע.

## ההבחנה
| סוג | מי קובע | מתי |
|-----|---------|-----|
| **המחירון שלי** | אתה (Tene) | ברירת מחדל — רוב הלקוחות |
| **מחירון הלקוח** | הלקוח | לקוח גדול: "זה המחירון שלי, תתיישר" |

לקוח אחד קונה לפי המחירון שלך. אחר כופה את שלו ואתה מסכים. צריך לתמוך בשניהם.

---

## שינוי מודל נתונים

### customers — שדה חדש
```sql
ALTER TABLE customers ADD COLUMN pricing_source TEXT DEFAULT 'vendor';
-- 'vendor'   = המחירון שלי (price_list)
-- 'customer' = מחירון הלקוח (טבלה ייעודית)
```
(קיים כבר `price_tier` ו-`discount_pct` — נשארים, רלוונטיים ל-vendor.)

### טבלה חדשה — מחירון פר-לקוח
```sql
CREATE TABLE customer_price_list (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL,
  dimension    TEXT,        -- קוטר / סוג פריט (גמיש לתעשיות)
  price        REAL,        -- ₪ ליחידה
  unit         TEXT DEFAULT 'kg',
  source       TEXT,        -- 'image' | 'file' | 'manual'
  imported_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
```

---

## pricer — שינוי נקודתי
`services/pricer.js` כבר מרכז תמחור. מוסיפים החלטה אחת בראש:

```javascript
function getPricePerKg(diameter, customer) {
  if (customer?.pricing_source === 'customer') {
    const row = db.prepare('SELECT price FROM customer_price_list WHERE customer_id=? AND dimension=?')
      .get(customer.id, String(diameter));
    if (row) return row.price;          // מחירון הלקוח גובר
    // אם חסר במחירון הלקוח → נפילה למחירון שלי (עם התראה)
  }
  return vendorPrice(diameter, customer); // הלוגיקה הקיימת
}
```

**עיקרון:** מחירון הלקוח גובר רק כשהוגדר `pricing_source='customer'`. אחרת — המחירון שלי כרגיל. שום שינוי ללקוחות קיימים.

---

## קליטת מחירון לקוח — כל הדרכים

`services/pricing-importer.js` (חדש) — מתרגם כל פורמט לטבלה הפנימית:

| מקור | איך | טכנולוגיה |
|------|-----|-----------|
| **תמונה** | צילום מחירון → OCR | OpenAI Vision (קיים ב-intake) |
| **קובץ** | Excel / CSV | פרסר טבלה |
| **ידני** | הקלדה בכרטיס הלקוח | טופס |
| **בעל פה** | הקלדה ידנית (כמו ידני) | טופס |

```
מחירון מהלקוח (תמונה/קובץ/הקלדה)
        ↓ services/pricing-importer.js
שורות מנורמלות: { dimension, price, unit }
        ↓
תצוגה מקדימה לאישור (כמו ב-OCR הזמנות)
        ↓
שמירה ב-customer_price_list
```

---

## UI (כרטיס לקוח)
- בורר: **"מקור מחיר"** → המחירון שלי / מחירון הלקוח
- אם "מחירון הלקוח": כפתורים — העלה תמונה / העלה קובץ / הזן ידני
- תצוגת המחירון הנוכחי של הלקוח + מתי יובא

---

## ⚠️ ניתוב OCR — קריטי, אסור לפספס
**ה-AI לא מנתב לבד.** אותו OCR מקבל תמונה שיכולה להיות הזמנה / מחירון / תעודת ספק.
אם ה-AI ינחש לא נכון — מחירון ייכנס כהזמנה. אסון.

**הכלל:** המשתמש בוחר **סוג מסמך מראש**, ולכל סוג **prompt נפרד**:
```
מסך קליטה:  [📋 הזמנה]  [💰 מחירון]  [🚚 תעודת ספק]
                 ↓ בחר "מחירון"
        AI עם prompt של מחירון בלבד → תצוגה מקדימה → אישור
```
- ה-AI **קורא** מה שאמרו לו, לא **מנתב**. הניתוב = החלטת אדם, קליק אחד.
- כל סוג מסמך = endpoint + prompt משלו (כמו ש-`/analyze-image` להזמנות ו-`/inventory/scan-label` לתוויות כבר נפרדים).
- אסור prompt אחד גנרי לכל הסוגים — המבנים שונים לגמרי.

## עקרונות
1. **ברירת מחדל = vendor** — לקוחות קיימים לא מושפעים.
2. **pricer = מקור אמת אחד** — כל ההחלטה במקום אחד, לא מפוזר.
3. **תצוגה מקדימה לפני שמירה** — OCR/קובץ אף פעם לא נשמר ישר, תמיד עובר אישור.
4. **נפילה בטוחה** — חסר פריט במחירון הלקוח → המחירון שלי + התראה, לא 0.

## Definition of Done
- [ ] `pricing_source` ב-customers
- [ ] טבלת `customer_price_list`
- [ ] `services/pricing-importer.js` (תמונה/קובץ/ידני)
- [ ] `pricer` בוחר מקור לפי הלקוח
- [ ] UI בכרטיס לקוח + תצוגה מקדימה
- [ ] נפילה למחירון vendor כשחסר
