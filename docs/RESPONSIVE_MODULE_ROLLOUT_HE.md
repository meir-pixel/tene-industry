# תוכנית רספונסיביות מודול-מודול

Date: 2026-07-05
Owner: UX/UI
Depends on: `docs/RESPONSIVE_UI_STANDARD_HE.md`
Scope: תכנון ובקרה בלבד. אין שינוי קוד UI, API, DB, Orders, Production, Finance, OCR או Shape V2 Contract במסמך הזה.

## מטרת המסמך

העבודה לא תתבצע יותר כ"תיקון רספונסיביות" כללי. כל מודול יקבל Slice קטן, מוגדר, עם בדיקות מסך, בלי שינוי לוגיקה עסקית.

כל Slice חייב לענות על ארבע שאלות לפני שנוגעים בקוד:

1. איזה מסך או רכיב מתקנים.
2. מה נשבר ברספונסיביות.
3. איזה קבצים מותרים לשינוי.
4. מה אסור לגעת בו.

## סדר עדיפות מערכת

| סדר | מודול | למה ראשון |
|---:|---|---|
| 1 | הזמנה חדשה + Shape Editor | הכי הרבה שימוש, הכי הרבה תלונות UX, הכי הרבה פאנלים וצורות |
| 2 | קליטת הזמנות / OCR | מסך עמוס, מקור מול נתונים, טעויות יקרות |
| 3 | כרטיסיות ייצור + עובד | הדפסה ומובייל עובדים; חייב יציבות לפני רצפת ייצור |
| 4 | לקוחות + פורטל לקוח | הרבה חלונות, זיהוי לקוח, הרשאות ותצוגת מידע |
| 5 | מחירונים + כספים | מסמכים, טבלאות, ערכים כספיים; אסור לשבור תצוגה |
| 6 | מלאי / רכש / מחסן | תפעולי, טבלאות וכרטיסים, בינוני סיכון |
| 7 | איכות / אחזקה / מכונות | מסכי עבודה ודיווח; חשוב אבל פחות מרכזי מהזמנה |
| 8 | דשבורד / דוחות / ניהול | שכבת ניהול; אפשר לנקות אחרי שהבסיס יציב |
| 9 | לוגיסטיקה / נהגים / צי | מסכי מובייל ותפעול; יטופל אחרי מודולי הליבה |

## 1. הזמנה חדשה

- קבצים עיקריים: `public/index.html`, `public/theme.css`, `public/nav.js` רק אם יש אישור מפורש.
- Layout: Workbench.
- בעיות צפויות: פאנלים צדדיים, טבלת פריטים, כפתורי פעולה תחתונים, חיפוש לקוח, פתיחת Shape Editor.
- Slice ראשון בטוח: לייצב shell של הזמנה חדשה ב־390/768/1366 בלי לשנות טופס או חישוב.
- Do not touch: יצירת הזמנה, חישובי פריט, API, לקוחות, מחיר, סטטוסים.
- בדיקה: פתיחה, הוספת פריט, פתיחת עורך צורה, חזרה למסך.

## 2. Shape Editor / Steel-Rebar

- קבצים עיקריים: `public/shape-editor.js`, `public/shape-renderer.js` רק אם השינוי הוא תצוגתי, `test/shape-geometry.test.js` רק אם נדרש חוזה תצוגה.
- Layout: Workbench engineering.
- בעיות צפויות: ציור נחתך, תוויות חופפות, פאנל מדידות צפוף, 2D/3D, מובייל.
- Slice ראשון בטוח: התאמת מסגרת layout בלבד: ציור מרכזי, פאנל ערכים קריא, פעולות קבועות.
- Do not touch: Shape V2 Contract, חישובי אורך/משקל/זוויות, סדר צלעות, יצוא מכונה, Orders/OCR.
- בדיקה: 2D, 3D, מוט, רשת, כלונס, שינוי ערך ועדכון ציור חי.

## 3. Intake / OCR

- קבצים עיקריים: `public/intake.html`.
- Layout: Workbench review.
- בעיות צפויות: השוואת מקור מול טבלה, עומס מידע, כפתורי אישור, תצוגת PDF/תמונה.
- Slice ראשון בטוח: להפריד ויזואלית בין "מקור" לבין "נתונים מזוהים" בלי לשנות OCR.
- Do not touch: OCR parsing, comparison logic, API, יצירת הזמנות, סטטוס קליטה.
- בדיקה: טעינת קובץ, תצוגת מקור, עריכת שורה, השוואה, אישור.

## 4. Production Cards / Worker

- קבצים עיקריים: `services/productionCardPrintPage.js`, `public/production-queue.html`, `public/worker-visual.html`.
- Layout: Print + Operator.
- בעיות צפויות: הדפסה A4, מידות בכרטיס, QR, תצוגת עובד בטלפון.
- Slice ראשון בטוח: להפריד כללי מסך מכללי הדפסה ולוודא שכרטיס נשאר במידות פיזיות.
- Do not touch: יצירת כרטיסים, פיצול כמויות, ברקוד, token, סטטוס ייצור, משקל רצוי/מצוי.
- בדיקה: הדפסה A4, צילום/סריקה, מובייל עובד, desktop queue.

## 5. Customers / CRM

- קבצים עיקריים: `public/customers.html`.
- Layout: App shell + Detail panel.
- בעיות צפויות: זיהוי לקוחות לא מספיק ברור, פאנל פרטים צפוף, חיפוש, כרטיס לקוח, הזמנות אחרונות.
- Slice ראשון בטוח: רשימת לקוחות + פאנל פרטי לקוח עם היררכיה ברורה וחזרה אחורה.
- Do not touch: API לקוחות, אנשי קשר, מחירון לקוח, הרשאות, תנאי תשלום.
- בדיקה: חיפוש לקוח, פתיחת לקוח, מובייל, חזרה לרשימה.

## 6. Customer Portal

- קבצים עיקריים: `public/customer.html`, `public/portal.html`, `public/login.html`.
- Layout: Portal.
- בעיות צפויות: יותר מדי אזורים באותו מסך, הרשאות מחיר/כסף, הזמנת לקוח במובייל.
- Slice ראשון בטוח: ניווט אזורי ברור בתוך הפורטל, בלי לשנות יכולות.
- Do not touch: portal token, הרשאות, מחירים, תקציבים, יצירת הזמנה, אתרים/משתמשים.
- בדיקה: כניסה, בית, הזמנה, מסמכים, מחירון לפי הרשאה.

## 7. Pricing / Finance

- קבצים עיקריים: `public/pricing.html`, `public/finance.html`, `public/profitability.html`.
- Layout: Document + App shell.
- בעיות צפויות: מסמך מחירון רחב, טבלאות, שדות סכומים, כרטיסי KPI.
- Slice ראשון בטוח: עטיפת טבלאות ומסמך מחירון כך שלא ייחתכו במובייל.
- Do not touch: חישובי מחיר, מחירון פעיל, visibility ללקוח, Finance API, DB.
- בדיקה: מחירון, הדפסה, finance dashboard, מובייל.

## 8. Inventory / Procurement / Warehouse

- קבצים עיקריים: `public/inventory.html`, `public/procurement.html`, `public/warehouse.html`, `public/supplier.html`.
- Layout: App shell operations.
- בעיות צפויות: טבלאות רחבות, כרטיסי מלאי, מודאלים, פעולות רכש.
- Slice ראשון בטוח: רכיב טבלה רספונסיבי אחיד ו־cards במובייל למסך אחד בלבד.
- Do not touch: FIFO, ניכוי מלאי, בקשות רכש, ספקים, API.
- בדיקה: רשימה, חיפוש, פתיחת מודאל, פעולה ראשית.

## 9. Quality / Maintenance / Machine

- קבצים עיקריים: `public/quality.html`, `public/maintenance.html`, `public/machine.html`, `public/kiosk.html`.
- Layout: Operator + App shell.
- בעיות צפויות: סטטוסים, טפסי דיווח, מסכי עובד, תצוגת מכונה.
- Slice ראשון בטוח: לחזק קריאות וגדלי מגע במובייל בלי לשנות status mapping.
- Do not touch: סטטוס מכונה, עצירות, איכות, פעולות אחזקה, API.
- בדיקה: מובייל, טאבלט, מצב ריק, מצב שגיאה.

## 10. Dashboard / Reports / Admin

- קבצים עיקריים: `public/dashboard.html`, `public/reports.html`, `public/admin.html`, `public/docs.html`.
- Layout: App shell analytics/admin.
- בעיות צפויות: KPI grids, inline styles, טבלאות, מודאלים, navigation.
- Slice ראשון בטוח: KPI grid ו־table wrapper אחידים בדשבורד בלבד.
- Do not touch: הגדרות מערכת, הרשאות, דוחות API, nav behavior.
- בדיקה: desktop רחב, 1366, 768, mobile.

## 11. Logistics / Fleet / Driver

- קבצים עיקריים: `public/driver.html`, `public/delivery-admin.html`, `public/projects.html`.
- Layout: Operator mobile + App shell.
- בעיות צפויות: נהג במובייל, פעולות מהירות, טבלאות משלוחים.
- Slice ראשון בטוח: מסך נהג מובייל קודם, כפתורים גדולים, ללא שינוי פעולות.
- Do not touch: מסלולים, סטטוס משלוח, אישורי מסירה, API.
- בדיקה: מובייל צר, טאבלט, פעולת נהג ראשית.

## כלל עבודה מעכשיו

לא מתחילים מודול חדש לפני שסיימנו Slice אחד, בדקנו אותו, ודיווחנו:

- קבצים ששונו.
- מה נבדק ב־390/768/1366.
- מה לא נגעתי בו.
- commit hash.
- סיכון שנשאר.

## Slice ראשון מומלץ

התחלה מומלצת: `הזמנה חדשה + Shape Editor shell`.

הסיבה: זה המסך שממנו רוב העבודה מתחילה. אם הוא יציב, כל השאר מקבל בסיס טוב יותר: OCR, לקוח, ייצור וכרטיסיות.

הגבול של הסלייס הראשון: layout בלבד. לא צורות, לא חישובים, לא API, לא הזמנות.