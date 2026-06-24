# קובץ פקודות מערכת - IronBend / Tene Industry

> קובץ זה מרכז פקודות תפעול שימושיות לפרויקט.
> הוא לא כולל סודות, טוקנים, סיסמאות או הנחיות פנימיות של Codex.

## מיקום הריפו

```powershell
cd C:\Users\meir-tene\Documents\GitHub\tene-industry
```

## Git

```powershell
git status
git pull
git diff
git log --oneline -10
```

הוספה ו-commit עם נתיבים מפורשים:

```powershell
git add -- public\customer.html routes\portal.js
git commit -m "describe change" -- public\customer.html routes\portal.js
git push
```

## הרצה מקומית

```powershell
npm run start:local
```

כתובות מקומיות נפוצות:

```text
http://localhost:3100/dashboard.html
http://localhost:3100/customer.html
http://localhost:3100/customers.html
http://localhost:3100/pricing.html
http://localhost:3100/finance.html
```

בדיקת פורט 3100:

```powershell
cmd /c netstat -ano | findstr :3100 | findstr LISTENING
```

עצירת תהליך לפי PID:

```powershell
Stop-Process -Id <PID>
```

## בדיקות

בדיקות מלאות:

```powershell
npm test
```

בדיקות ממוקדות לפורטל לקוח:

```powershell
node --test test\client-auth-contract.test.js
node --check routes\portal.js
```

בדיקת smoke בסיסית:

```powershell
node scripts\edge-smoke.js
```

## פורטל לקוח - API מרכזיים

פרטי לקוח והזמנות אחרונות:

```text
GET /api/c/me?token=<TOKEN>
```

אתרים של הלקוח:

```text
GET /api/c/sites?token=<TOKEN>
POST /api/c/sites
```

סיכום אתר:

```text
GET /api/c/sites/<SITE_ID>/summary?token=<TOKEN>
```

מחירון לקוח:

```text
GET /api/c/price-list?token=<TOKEN>
```

מסמכי ערבות:

```text
GET /api/c/guarantee-documents?token=<TOKEN>
POST /api/c/guarantee-documents
```

הצעת מחיר:

```text
POST /api/c/quote
```

פתיחת הזמנה:

```text
POST /api/c/order
```

אישור הזמנה:

```text
POST /api/c/approve
```

פרטי הזמנה:

```text
GET /api/c/orders/<ORDER_ID>?token=<TOKEN>
```

## פורטל לקוח - מסך בקרה כספי

סיכום כספי:

```text
GET /api/c/finance/summary?token=<TOKEN>
```

פירוק לפי אתרים:

```text
GET /api/c/finance/sites?token=<TOKEN>
```

התראות תשלום לפי תנאי תשלום:

```text
GET /api/c/finance/payments-due?token=<TOKEN>
```

היסטוריית הזמנות:

```text
GET /api/c/orders/history?token=<TOKEN>
```

## הרשאות פורטל לקוח

הרשאות חשובות:

```text
canCreateSites
canManageUsers
canAssignSiteUsers
canOrder
canApprove
seePrice
canViewBudget
canSetBudget
canViewInvoices
canViewPaymentAlerts
canViewDeliveryNotes
```

כלל חשוב:

```text
canApprove לא נותן אוטומטית הרשאת פתיחת אתר או צפייה בכספים.
צריך הרשאות מפורשות לכסף, תקציב, חשבוניות או התראות תשלום.
```

## קישורי ענן

```text
https://ironbend.onrender.com/dashboard.html
https://ironbend.onrender.com/customer.html
https://ironbend.onrender.com/customers.html
```

אם Render עדיין לא סיים פריסה, יש להמתין כמה דקות אחרי `git push`.

## קבצים חשובים לפורטל לקוח

```text
public/customer.html
routes/portal.js
services/portalAccess.js
routes/customers.js
db/coreSchema.js
db/startup.js
test/client-auth-contract.test.js
docs/spec-customer-finance-control-dashboard.md
```

## סדר עבודה מומלץ לפני שינוי

```powershell
cd C:\Users\meir-tene\Documents\GitHub\tene-industry
git pull
git status
```

אחרי שינוי:

```powershell
node --check routes\portal.js
node --test test\client-auth-contract.test.js
git diff
git add -- <FILES>
git commit -m "short message" -- <FILES>
git push
```
