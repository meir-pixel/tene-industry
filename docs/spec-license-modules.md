# אפיון: חבילות ומודולים ברישיון

> מטרה: מפאנל אחד (שרת הרישיונות), לקבוע לכל לקוח אילו מודולים פתוחים — מרחוק, בלי לגעת בשרת שלו.

## התמונה
```
פאנל הרישיונות (אצלך)
  └─ לכל לקוח: ✓ הזמנות  ✓ מלאי  ✗ כספים  ✓ איכות ...
        ↓ (נשמר ברישיון)
שרת הלקוח שואל בבדיקת רישיון: "מה מותר לי?"
        ↓
מפעיל רק את המודולים שאושרו (תפריט + API)
```

---

## רשימת מודולים לשליטה

| מודול | מפתח | ליבה (תמיד פתוח) |
|-------|------|------------------|
| דשבורד | `dashboard` | ✓ |
| הזמנות | `orders` | ✓ |
| לקוחות | `customers` | ✓ |
| ייצור | `production` | ✓ |
| מלאי | `inventory` | — |
| מחסן | `warehouse` | — |
| צי ומשלוחים | `fleet` | — |
| כספים | `finance` | — |
| איכות ותחזוקה | `quality` | — |
| דוחות | `reports` | — |
| פורטל לקוח | `portal` | — |
| קליטת AI/OCR | `intake_ai` | — |
| חברות/הולדינגס | `companies` | — |
| BVBS | `bvbs` | — |

## חבילות מוכנות (presets)
| חבילה | כולל |
|-------|------|
| **בסיסי** | dashboard, orders, customers, production, inventory |
| **מקצועי** | בסיסי + finance, warehouse, fleet, quality, reports |
| **ארגוני** | מקצועי + portal, intake_ai, companies, bvbs |

---

## שלב A — צד שרת הרישיונות (שלי, אפשר לבנות עכשיו)

### DB
```sql
ALTER TABLE licenses ADD COLUMN modules TEXT;   -- JSON array: ["orders","inventory",...]
ALTER TABLE licenses ADD COLUMN package TEXT;   -- 'basic'|'pro'|'enterprise'|'custom'
```

### תגובת /api/check — מוסיפים entitlements
```json
{
  "valid": true,
  "expiresAt": "2031-12-31",
  "customerName": "טנא תעשיות ברזל",
  "entitlements": { "package": "pro", "modules": ["dashboard","orders","customers","production","inventory","finance","warehouse","fleet","quality","reports"] }
}
```

### פאנל Admin
- בטופס רישיון: בחירת **חבילה** (ממלאת checkboxes אוטומטית) + אפשרות לסמן/לבטל מודולים ידנית.
- בעריכת רישיון קיים: שינוי מודולים → נשמר מיד.

---

## שלב B — צד שרת הלקוח (אפיון ל-GPT, לא עכשיו)

### צריכה
בבדיקת הרישיון (`services/license.js`), לשמור את `entitlements.modules` ב-settings (`license_modules`).

### אכיפה — שתי שכבות
1. **תפריט/ניווט** — להסתיר מסכים של מודולים שלא אושרו.
2. **API (החשוב!)** — middleware שחוסם routes של מודול לא-מאושר:
```javascript
function requireModule(key) {
  return (req, res, next) => {
    const enabled = JSON.parse(settingsService.get('license_modules','[]'));
    if (!enabled.includes(key)) return res.status(403).json({ error: 'מודול לא כלול ברישיון', module: key });
    next();
  };
}
// app.use('/api', requireModule('finance'), createFinanceRouter(...))
```

### הערת אבטחה כנה
הלקוח מריץ את השרת שלו, אז אכיפה היא "גדר", לא "כספת" — לקוח טכני יכול לעקוף. **המנוף האמיתי הוא הרישיון** (אם פג/בוטל → נעילה מלאה). לרוב לקוחות B2B זה מספיק לחלוטין.

---

## זרימת שימוש
```
פאנל → ערוך רישיון "טנא" → חבילה: מקצועי → שמור
        ↓
שרת הלקוח, בבדיקה הלילית/הפעלה הבאה → מקבל modules מעודכן
        ↓
מודול הכספים נפתח/נסגר אוטומטית — בלי לגעת בשרת הלקוח
```

---

## Definition of Done
**שלב A (שרת רישיונות):**
- [ ] עמודות modules + package
- [ ] /api/check מחזיר entitlements
- [ ] פאנל: בחירת חבילה + checkboxes למודולים
- [ ] עריכת מודולים לרישיון קיים

**שלב B (שרת לקוח — GPT):**
- [ ] license.js שומר license_modules
- [ ] requireModule middleware
- [ ] תפריט מסתיר מודולים סגורים
- [ ] ברירת מחדל: אם אין entitlements (מצב Free) → כל המודולים פתוחים
