# דרכוני מודולים — IronBend

כל קובץ כאן הוא "דרכון" של מודול — קלט, פלט, חישובים, טבלאות, הרשאות.
לפני שנוגעים במודול — קוראים את הדרכון שלו.

---

## מפה מהירה

| מודול | קובץ | תיאור קצר |
|-------|------|-----------|
| 🔩 ברזל כפוף | [steel-rebar.md](steel-rebar.md) | חישובי משקל, מכונות, BVBS |
| 📋 הזמנות | [orders.md](orders.md) | מחזור חיי הזמנה מלא |
| 🌐 פורטל לקוחות | [portal.md](portal.md) | הזמנות חיצוניות + OTP |
| 💰 כספים | [finance.md](finance.md) | חשבוניות, עלויות, אשראי |
| 📥 קליטה | [intake.md](intake.md) | WA, OCR, מייל → הזמנות |
| 🚚 צי | [fleet.md](fleet.md) | רכבים, נהגים, משלוחים |
| 🔧 ייצור | [production.md](production.md) | מכונות, משמרות, סריקה |
| 🧾 כרטיסיות ייצור | [production-cards.md](production-cards.md) | הדפסה, ברקודים, תחנת עובד, משקל רצוי/מצוי |
| 🔑 רישיון | [license.md](license.md) | Free/Paid/Locked + גיבוי |

---

## ממתינים לדרכון

**כלל:** כשנוגעים במודול — כותבים לו דרכון לפני או תוך כדי השינוי.

| מודול | קובץ route | מתי לכתוב |
|-------|-----------|-----------|
| auth | routes/auth.js | כשנוגעים בזהות/סשנים |
| admin | routes/admin.js | כשנוגעים בהגדרות/משתמשים |
| customers | routes/customers.js | כשנוגעים ב-CRM |
| inventory | routes/inventory.js | כשנוגעים במלאי/ספקים |
| quality | routes/quality.js | כשנוגעים באיכות/תחזוקה |
| warehouse | routes/warehouse.js | כשנוגעים בחבילות/תעודות |
| reports | routes/reports.js | כשנוגעים בדוחות/KPIs |
| companies | routes/companies.js | כשנוגעים בהולדינגס |
| alerts | routes/alerts.js | כשנוגעים בהתראות |
| ai | routes/ai.js | כשנוגעים בחיזוי |
| bvbs | routes/bvbs.js | כשנוגעים בפרסור BVBS |
| search | routes/search.js | כשנוגעים בחיפוש גלובלי |
| priority | routes/priority.js | Phase 2 בלבד |

---

## פורמט דרכון

```markdown
# מודול: [שם]
## מה הוא עושה
## קלט
## פלט
## טבלאות
## חישובים
## קבצים
## הרשאות
## סיכונים
```
