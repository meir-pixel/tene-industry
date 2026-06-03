# מודול: production — ייצור

## מה הוא עושה
ניהול מכונות, עובדים, משמרות, סריקת ייצור, ומעקב התקדמות פריטים.

---

## קלט

| מקור | מה | endpoint |
|------|----|----------|
| מפעיל מכונה | סריקת פריט | `POST /api/scan` |
| מפעיל | שינוי סטטוס מכונה | `PATCH /api/machines/:id/state` |
| מנהל | יצירת משמרת | `POST /api/shifts` |
| Modbus | נתוני מכונה | דרך `modbus` service |

---

## פלט

| יעד | מה | דרך |
|-----|----|-----|
| frontend | סטטוס מכונות | `GET /api/machines` |
| frontend | התקדמות הזמנה | `GET /api/orders/:id/progress` |
| מודול orders | הזמנה הושלמה | `checkOrderComplete()` → wsBroadcast |

---

## טבלאות שבבעלותו

| טבלה | תוכן |
|------|------|
| `machines` | מכונות — שם, סטטוס, slave_id, קוטרים |
| `machine_events` | אירועי מכונה |
| `workers` | עובדים |
| `shifts` | משמרות |
| `downtime_reasons` | סיבות השבתה |

---

## מעברי סטטוס מכונה (חוזה)

```
לא מחובר → סרק
סרק → ריצה | הכנה | ידני | לא מחובר
ריצה → סרק | תקלה
הכנה → סרק | ריצה
תקלה → תחזוקה | סרק
תחזוקה → סרק
ידני → סרק
```

---

## קבצים

| קובץ | תוכן |
|------|------|
| `routes/production.js` | כל ה-endpoints |
| `constants.js` | MACHINE_STATES, STATE_TRANSITIONS |

---

## הרשאות

| פעולה | תפקיד מינימלי |
|-------|--------------|
| צפייה | viewer |
| סריקה | kiosk |
| שינוי סטטוס | production |
| ניהול מכונות | manager |
