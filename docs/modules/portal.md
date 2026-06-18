# מודול: portal — פורטל לקוחות

## מה הוא עושה
ממשק חיצוני ללקוחות — אימות בטלפון (OTP), הגשת הזמנות, אישור מ-WhatsApp, ומחירון אישי.

---

## קלט — מה הוא מקבל

| מקור | מה | endpoint |
|------|----|----------|
| לקוח (נייד) | טלפון לאימות | `POST /api/c/auth` |
| לקוח | קוד OTP | `POST /api/c/auth/verify` |
| לקוח | פריטים להזמנה | `POST /api/c/order` |
| קישור WhatsApp | אישור הזמנה | `GET /api/c/approve/:token` |
| משתמש פנימי | טוקן גישה ללקוח | `GET /api/customers/:id/token` |

---

## פלט — מה הוא נותן

| יעד | מה | דרך |
|-----|----|-----|
| לקוח | טוקן גישה + קישור | `portalAuthResponse()` |
| לקוח | מחירון אישי | `GET /api/c/price-list` |
| לקוח | ציטוט מחיר | `POST /api/c/quote` |
| מפעל | הזמנה חדשה | `wsBroadcast('new_order')` |
| לקוח/מפעל | WA אישור + קישור | `intake.sendWhatsApp()` |

---

## טבלאות שבבעלותו (חלקית)

| טבלה | מה הפורטל עושה בה |
|------|------------------|
| `customers` | קורא בלבד (portal_token, price_tier) |
| `customer_portal_otps` | כותב OTP ומוחק |
| `orders` | יוצר הזמנות פורטל |
| `price_list` | קורא בלבד |

---

## חישובים

### מחיר פריט לפי tier
```
tier = 'list'     → price_list
tier = 'customer' → price_cust
מחיר סופי = מחיר_בסיס × (1 - discount_pct / 100)
```

### waste בהזמנת פורטל: 3% קבוע

---

## מקור מחיר להצעת מחיר בפורטל

הפורטל לא בוחר מחיר לבד ולא מחשב מחירון בצד לקוח. כל הצעת מחיר עוברת דרך שירות תמחור מרכזי (`services/pricer.js`) ומקבלת תשובה שמסבירה מאיזה מחירון נלקח המחיר.

בפורטל יש שני מקורות מחיר בלבד:

1. מחירון כללי ללקוחות שוטפים.
2. מחירון אישי ללקוחות שמוגדר להם הסכם או מחירון משלהם.

אין מצב עסקי של "אין מחירון". אם המחירון הרלוונטי חסר, ישן או לא מכסה קוטר מסוים, הפורטל מציג "מחירון דורש עדכון" ולא יוצר הצעת מחיר סופית עד עדכון/אישור.

### סוגי לקוחות

| סוג לקוח | מקור מחיר | התנהגות בפורטל |
|---|---|---|
| לקוח שוטף רגיל | מחירון מכירה כללי | הלקוח רואה הצעה לפי מחירון טנא הכללי |
| לקוח עם מחירון אישי | מחירון לקוח | הלקוח רואה הצעה לפי המחירון שהוגדר לו |

### חוזה תשובת מחיר לפורטל

כל שורת הצעת מחיר צריכה לקבל מהשרת:

```json
{
  "diameter": 12,
  "unitPrice": 3.8,
  "pricingSource": "general",
  "pricingLabel": "מחירון כללי",
  "discountPct": 0,
  "warnings": []
}
```

ללקוח אישי:

```json
{
  "diameter": 12,
  "unitPrice": 3.55,
  "pricingSource": "customer",
  "pricingLabel": "מחירון אישי",
  "customerPriceListId": 17,
  "discountPct": 0,
  "warnings": []
}
```

אם המחירון הרלוונטי דורש עדכון:

```json
{
  "diameter": 14,
  "unitPrice": null,
  "pricingSource": "customer",
  "pricingLabel": "מחירון אישי",
  "status": "price_list_requires_update",
  "warnings": ["price_list_requires_update"]
}
```

### חוקים

- לקוח שמוגדר עם מחירון אישי חייב לקבל מחירון אישי כאשר קיים מחיר לקוטר.
- אם המחירון הרלוונטי לא מעודכן, הפורטל לא מציג מחיר כרגיל; הוא מציג סטטוס "מחירון דורש עדכון" ודורש עדכון/אישור מנהל לפני הפיכת ההצעה להזמנה.
- אין החלפה אוטומטית ממחירון אישי למחירון כללי.
- הצעת מחיר חייבת לשמור snapshot של מקור המחיר, כדי ששינוי מחירון עתידי לא ישנה הזמנה שכבר אושרה.
- מחירון קנייה לא נחשף לפורטל לקוח בשום מצב.

---

## אבטחה ⚠️

| בעיה | פתרון |
|------|-------|
| BUG-40 | לא מחזיר price_tier/discount_pct ללקוח (פרטים פנימיים) |
| BUG-41 | הקרנה מוגבלת — CUSTOMER_PORTAL_COLS בלבד |
| BUG-42 | /api/c/orders לא חושף עלות/שדות פנימיים |

---

## קבצים

| קובץ | תוכן |
|------|------|
| `routes/portal.js` | כל ה-endpoints |

---

## הרשאות

| endpoint | auth |
|----------|------|
| `/api/c/*` | טוקן פורטל (לא JWT) |
| `/api/customers/:id/token*` | JWT — office/manager/admin |
| `/api/customers/:id/pricing` | JWT — office/manager/admin |

---

## גבול אחריות עדכני

- `routes/portal.js` שייך רק ללקוח החיצוני: `/api/c/*`.
- `routes/portalAdmin.js` שייך רק למשתמש פנימי שמנהל קישור פורטל, rotate/revoke, ותמחור לקוח.
- `services/portalAccess.js` הוא המקום היחיד ללוגיקת OTP, token, resolveCustomer ו-portalAuthResponse.
- אין להחזיר token/pricing management ל-CRM או ל-portal.js.

---

## rate limiters

| limiter | מגבלה | על מה |
|---------|-------|-------|
| customerPortalAuthLimiter | 20/15 דקות | auth, verify |
| customerPortalActionLimiter | 60/15 דקות | כל שאר הפורטל |
