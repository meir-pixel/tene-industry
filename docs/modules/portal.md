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

## rate limiters

| limiter | מגבלה | על מה |
|---------|-------|-------|
| customerPortalAuthLimiter | 20/15 דקות | auth, verify |
| customerPortalActionLimiter | 60/15 דקות | כל שאר הפורטל |
