# מודול: orders — הזמנות

## מה הוא עושה
ניהול מחזור חיי הזמנה מלא — יצירה, עריכה, מעקב סטטוסים, ייבוא קבצים, ושליחת אישורים.

---

## קלט — מה הוא מקבל

| מקור | מה | endpoint |
|------|----|----------|
| לקוח (UI) | הזמנה חדשה | `POST /api/orders` |
| פורטל לקוח | הזמנה מהפורטל | דרך routes/portal.js |
| intake | אישור הזמנה מ-OCR/WA | `POST /api/intake/:id/approve` |
| BVBS | קובץ BVBS → הזמנה | `POST /api/bvbs/create-order` |
| קובץ Excel/CSV | ייבוא מרובה | `POST /api/orders/import` |

---

## פלט — מה הוא נותן

| יעד | מה | דרך |
|-----|----|-----|
| frontend | רשימת הזמנות | `GET /api/orders` |
| frontend | הזמנה בודדת עם פלטים | `GET /api/orders/:id` |
| מודול production | הזמנה אושרה | `wsBroadcast('new_order')` |
| מודול fleet | הזמנה מוכנה למשלוח | `wsBroadcast('order_status')` |
| מודול finance | נתוני עלות | דרך order_costs |

---

## טבלאות שבבעלותו

| טבלה | תוכן |
|------|------|
| `orders` | כותרת הזמנה — לקוח, תאריך, סטטוס, עדיפות |
| `pallets` | פלטים בתוך הזמנה |
| `items` | פריטים (קוטר, צלעות, משקל, מכונה) |

---

## חישובים

### משקל הזמנה
```
weight_per_unit = (total_length_mm / 1000) × rebarKgPerMeter(diameter)
total_weight    = weight_per_unit × quantity
billing_weight  = total_weight × (1 + waste_pct / 100)
```

### waste_pct ברירת מחדל: 3%

---

## מעבר סטטוסים (חוזה)

```
ממתינה לאישור → אושרה – ממתין לייצור
אושרה – ממתין לייצור → בייצור
בייצור → הושלם – ממתין לאיסוף
הושלם – ממתין לאיסוף → בדרך ללקוח
בדרך ללקוח → סופק – אושר
כל סטטוס → בוטל
```

---

## קבצים

| קובץ | תוכן |
|------|------|
| `routes/orders.js` | כל ה-endpoints |
| `services/orders.js` | createOrderFromPayload, calcWeightPerUnit |
| `services/orderNumbers.js` | הקצאת מספרי הזמנה |
| `status-contracts.js` | חוזה מעברי סטטוס |

---

## הרשאות

| פעולה | תפקיד מינימלי |
|-------|--------------|
| צפייה | viewer |
| יצירה | office |
| עריכת סטטוס | office |
| נעילה/ביטול | manager |

---

## סיכונים פתוחים

| # | תיאור | חומרה |
|---|-------|-------|
| — | ייבוא קובץ לא מאמת כפילויות בכל מקרה | נמוכה |
