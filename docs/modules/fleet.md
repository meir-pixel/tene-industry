# מודול: fleet — צי רכבים ומשלוחים

## מה הוא עושה
ניהול רכבים, נהגים, תוכניות משלוח, ועדכון סטטוס הזמנות עם יציאה/אישור מסירה.

---

## קלט

| מקור | מה | endpoint |
|------|----|----------|
| UI | פרטי רכב חדש | `POST /api/vehicles` |
| UI | אירוע רכב | `POST /api/vehicle-events` |
| נהג (נייד) | יציאה למשלוח | `POST /api/deliveries/:id/depart` |
| נהג | אישור מסירה | `POST /api/deliveries/:id/confirm` |
| נהג | דיווח בעיה | `POST /api/deliveries/:id/problem` |

---

## פלט

| יעד | מה | דרך |
|-----|----|-----|
| frontend | רשימת משלוחים | `GET /api/deliveries` |
| מודול orders | עדכון סטטוס הזמנה | wsBroadcast('order_status') |
| לקוח | WA עדכון משלוח | `intake.notifyOrderStatus()` |
| Priority ERP | עדכון סטטוס | `priority.updateOrderStatus()` |

---

## טבלאות שבבעלותו

| טבלה | תוכן |
|------|------|
| `vehicles` | רכבים — מספר, סוג, נהג ברירת מחדל |
| `vehicle_events` | אירועי רכב — תדלוק, תקלה, טיפול |
| `vehicle_documents` | מסמכי רכב |
| `drivers` | נהגים |
| `deliveries` | תוכניות משלוח |

---

## זרימת משלוח

```
הזמנה הושלמה
    ↓
יצירת delivery
    ↓
POST /deliveries/:id/depart → status: 'בדרך ללקוח'
    ↓
POST /deliveries/:id/confirm → status: 'סופק – אושר'
    ↓
wsBroadcast + WA ללקוח
```

---

## קבצים

| קובץ | תוכן |
|------|------|
| `routes/fleet.js` | כל ה-endpoints |
| `services/fleet.js` | לוגיקת fleet |

---

## הרשאות

| פעולה | תפקיד מינימלי |
|-------|--------------|
| צפייה | viewer |
| עדכון משלוח | driver |
| ניהול רכבים | office |
| מחיקה | manager |

---

## הערה ארכיטקטונית
deliveries שייכות לוגית ל-Logistics module עתידי.
נשארות ב-fleet עד שהמודול הזה יופרד.
