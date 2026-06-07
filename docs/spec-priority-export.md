# אפיון: ייצוא ל-Priority (ולדוחות חיצוניים)

> בעלות: `routes/reports.js` + service חדש. תאם עם הצוות שעובד על reports/exports.
> סטטוס: אפיון, ממתין לביצוע.

## הבעיה
המערכת שומרת נתונים **תפעוליים** (צורות כיפוף, צלעות, זוויות, מכונה). Priority — ומערכות הנהלת חשבונות בכלל — רוצים שורה **מסחרית מסוכמת**:

```
תאור מוצר            | כמות  | יח' | מחיר ליחידה | סה"כ
ברזל קטרים 8-25 רתיך | 0.982 | טון | 2,670 ₪     | 2,621.94 ₪
חיתוך למידות          | 0.982 | טון | 70 ₪        | 68.74 ₪
בגין כיפוף            | 0.982 | טון | 170 ₪       | 166.94 ₪
```

Priority **לא מעניין** אותו איך הברזל מכופף — רק: **סוג פריט + משקל + מחיר**.

## העיקרון
שכבת **תרגום** (mapper) שלוקחת הזמנה פנימית → מפיקה שורות מסחריות. לא משנה שום נתון פנימי, רק "מתרגם החוצה".

```
הזמנה פנימית (פריטים + צורות + משקלים)
        ↓  services/priorityMapper.js
שורות מסחריות מסוכמות (סוג פריט, משקל, מחיר)
        ↓
ייצוא: JSON ל-Priority API  /  CSV  /  PDF חשבונית
```

---

## services/priorityMapper.js — חדש

```javascript
function buildPriorityDocument(order, items, { pricer }) {
  // קבץ פריטים לפי "סוג מסחרי" (לא לפי צורה!)
  // סוג מסחרי = טווח קוטר + סוג עיבוד (רתיך/חלק)
  // מחזיר שורות: { description, quantityTon, unit:'טון', pricePerTon, total }
  return {
    docNumber: order.order_num,
    customer:  order.customer_name,
    date:      order.created_at,
    lines: [
      { description: 'ברזל קטרים 8-25 רתיך', quantityTon, unit:'טון', pricePerTon, total },
      { description: 'חיתוך למידות',          quantityTon, unit:'טון', pricePerTon, total },
      { description: 'בגין כיפוף',            quantityTon, unit:'טון', pricePerTon, total },
    ],
    subtotal, discountPct, vatPct: 18, vat, grandTotal,
  };
}
```

**מיפוי סוג מסחרי** — טבלת הגדרה (לא קוד קשיח):
| טווח קוטר | תיאור מסחרי |
|-----------|-------------|
| 8–25 | ברזל קטרים 8-25 רתיך |
| 28–40 | ברזל קטרים 28-40 |
| תוספות | חיתוך למידות, בגין כיפוף |

---

## נקודות ייצוא
| יעד | פורמט | endpoint |
|-----|-------|----------|
| Priority ERP | JSON (API שלהם) | `POST /api/priority/sync/:orderId` (קיים, מושבת) |
| הנהלת חשבונות כללית | CSV | `GET /api/export/invoice/:orderId.csv` |
| חשבונית ללקוח | PDF | `GET /api/export/invoice/:orderId.pdf` |

---

## עקרונות
1. **לא לשנות נתונים פנימיים** — רק לתרגם החוצה.
2. **מיפוי כהגדרה** — טווחי קוטר → תיאור מסחרי בטבלה הניתנת לעריכה, לא בקוד.
3. **מחיר מ-pricer** — לא לחשב מחיר כאן, לקרוא ל-`services/pricer.js` (מקור אמת אחד).
4. **מע"מ 18% configurable** — מ-settings (`VAT_PCT`), לא קבוע.

## Definition of Done
- [ ] `services/priorityMapper.js` — תרגום הזמנה → מסמך מסחרי
- [ ] טבלת מיפוי טווח קוטר → תיאור מסחרי (ניתנת לעריכה)
- [ ] ייצוא CSV
- [ ] חיבור ל-`/api/priority/sync` הקיים
- [ ] `VAT_PCT` ב-settings
