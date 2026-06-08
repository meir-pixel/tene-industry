# אפיון: סליקה וחיוב חודשי (לא שילם → ננעל)

> בעלות: `tene-license-server/` בלבד (תחום Claude). לא נוגע באפליקציה.
> ספק: ישראלי, אגנוסטי — עובד עם Cardcom / Tranzila / Grow. הפרטים הספציפיים יושלמו בבחירה.

## עיקרון על — אנחנו לא בונים סליקה
**אסור** לאחסן/לחייב כרטיסי אשראי בעצמנו (תקן PCI, סיכון משפטי). אנחנו **מחברים** לספק סליקה שמחזיק את הכרטיסים ומחייב חודשית. אנחנו רק מקבלים הודעה "שילם / נכשל".

```
ספק הסליקה (ישראלי) — מחזיק כרטיס, מחייב כל חודש
        ↓ webhook
שרת הרישיונות שלנו — מעדכן paid_until
        ↓
שילם  → paid_until מוארך → רישיון פעיל
לא שילם → paid_until עובר → אזהרה → אחרי grace → ננעל
```

---

## מודל נתונים — תוספת ל-licenses
```sql
ALTER TABLE licenses ADD COLUMN paid_until TEXT;           -- עד מתי שולם (YYYY-MM-DD)
ALTER TABLE licenses ADD COLUMN billing_status TEXT DEFAULT 'free';
  -- 'free' | 'trial' | 'active' | 'past_due' | 'cancelled'
  -- free  = ללא תשלום (פיילוט/חבר/הדגמה) — לעולם לא נבדק תשלום, לא ננעל
  -- trial = ניסיון עד תאריך
  -- active= משלם חודשי
  -- past_due = פספס — אזהרה → grace → נעילה
  -- cancelled = בוטל → נעילה
ALTER TABLE licenses ADD COLUMN billing_ref TEXT;          -- מזהה הלקוח אצל ספק הסליקה
ALTER TABLE licenses ADD COLUMN monthly_amount REAL DEFAULT 0;
```

**היחס ל-`expires_at` הקיים:**
- `expires_at` = תוקף החוזה/רישיון (שנתי, נקבע ידנית).
- `paid_until` = מצב התשלום החודשי (אוטומטי מהספק).
- רישיון פעיל = **גם** לא פג (`expires_at`) **וגם** שולם (`paid_until` + grace).

---

## בדיקת תוקף — עדכון ל-/api/check
```javascript
const GRACE_DAYS = 7;  // ימי חסד אחרי שפג התשלום, לפני נעילה

if (lic.revoked_at) return locked('הרישיון בוטל');
if (isExpired(lic)) return locked('הרישיון פג');

// בדיקת תשלום
if (lic.billing_status !== 'trial' && lic.paid_until) {
  const daysPastDue = (Date.now() - new Date(lic.paid_until)) / 86400000;
  if (daysPastDue > GRACE_DAYS) return locked('התשלום החודשי לא התקבל. צור קשר עם Tene Industry.');
  // בתוך grace — תקין, אבל מחזירים אזהרה
  if (daysPastDue > 0) result.paymentWarning = `התשלום באיחור — נעילה בעוד ${Math.ceil(GRACE_DAYS - daysPastDue)} ימים`;
}
```

**עיקרון:** נעילה רק אחרי grace (7 ימים), לא ברגע שפספס. ובכל מקרה — לא נועלים מפעל באמצע יום (הבדיקה לרוב לילית/בהפעלה).

---

## נקודת חיבור אחת — webhook אגנוסטי
```
POST /api/billing/webhook
```
כל ספק שולח webhook אחרי חיוב. מאמתים חתימה (לפי הספק), ואז:
```javascript
// payload מנורמל (לכל ספק adapter קטן שמתרגם לפורמט אחד):
{ billing_ref, event: 'paid'|'failed'|'cancelled', amount, paidUntil }

// paid     → paid_until = סוף החודש הבא, billing_status='active'
// failed   → billing_status='past_due' (לא נועל מיד — grace)
// cancelled→ billing_status='cancelled'
```

**adapter פר-ספק** (`billing/adapters/<provider>.js`) — מתרגם את הפורמט של הספק לפורמט המנורמל. כשבוחרים ספק — כותבים adapter אחד קטן, שאר המערכת לא משתנה.

---

## פאנל Admin — תצוגת תשלום
בכל שורת רישיון:
| לקוח | תוקף | **תשלום** | סטטוס |
|------|------|-----------|-------|
| כהן | 2027 | 🟢 שולם עד 1.7 | פעיל |
| לוי | 2026 | 🔴 באיחור 3 ימים | past_due ⚠️ |

+ פעולות ידניות: "סמן כשולם" (אם שילם בהעברה/מזומן), "השהה חיוב".

---

## גיבוי-על — שלא יינעל בטעות
- נעילת תשלום **לא חוסמת גיבוי** — גם לקוח שלא שילם, הגיבוי שלו ממשיך להישמר (לא מאבדים נתונים בגלל ויכוח כספי).
- התראה אליך (WhatsApp) על כל `failed` — אתה מטפל מולם לפני שזה נועל.

---

## Definition of Done
- [ ] עמודות paid_until / billing_status / billing_ref / monthly_amount
- [ ] /api/check בודק תשלום עם grace 7 ימים
- [ ] POST /api/billing/webhook (אגנוסטי) + נורמליזציה
- [ ] adapter ריק מוכן ל-3 ספקים ישראליים
- [ ] פאנל: עמודת תשלום + "סמן כשולם" ידני
- [ ] התראת WhatsApp על כשל תשלום
- [ ] גיבוי ממשיך גם בנעילת תשלום
