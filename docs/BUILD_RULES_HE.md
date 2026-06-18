# כללי כתיבה ובניית מודולים

מסמך זה הוא שער הכניסה לכל מפתח, סוכן GPT, או עובד שנוגע בקוד.
אם כלל כאן מתנגש עם נוחות רגעית, הכלל מנצח.

## 1. מה הפרויקט

IronBend / Tene Industry היא מערכת מודולרית לניהול מפעל ותעשייה, שמיועדת
להימכר לפי מודולים שונים ללקוחות שונים.

המערכת הנוכחית ממוקדת פלדה/ברזל, אבל הארכיטקטורה צריכה לאפשר בעתיד מודולי
תעשייה נוספים בלי לבנות את הכל מחדש.

## 2. הארכיטקטורה

הארכיטקטורה היא Strangler Fig:

- `server.js` הוא הגזע הישן שמרוקנים בהדרגה.
- לוגיקת route חדשה לא נכנסת ל-`server.js`.
- כל משפחת API עוברת לקובץ `routes/<module>.js`.
- כל route module נבנה כ-factory function:

```js
module.exports = function createModuleRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  return router;
};
```

- כל dependency מגיע מבחוץ דרך `deps`.
- חובה להשתמש ב-`required()` guard, כדי שכשל dependency יהיה ברור ומיידי.
- שירותי business logic משותפים עוברים ל-`services/*.js`.
- קבועים וחוזי סטטוס משותפים עוברים ל-`constants.js` או `status-contracts.js`.

## 3. כלל ברזל

כל שינוי עובר:

1. אפיון קצר: מה בונים, למי זה שייך, מה לא נוגעים.
2. דעה ארכיטקטונית: האם זה נכון למערכת מודולרית.
3. ביצוע ממוקד.
4. בדיקות.
5. עדכון docs/governance אם האחריות השתנתה.

המשמעות אינה לעצור כל רגע לשאלה. אם האפיון ברור והכיוון נכון, מבצעים.
אם הכיוון לא נכון, עוצרים ומסבירים למה.
לא מבצעים שינוי שלא סוכם גם אם הוא נראה מובן מאליו.

### 3.1 איחוד רעיון מול הפרדת אחריות

מותר ורצוי לאחד רעיונות ברמת חוויית משתמש ותהליך עסקי. אסור לאחד אותם
ברמת ownership, נתונים או קוד רק בגלל שהם מופיעים יחד במסך.

הכלל:

- למשתמש יכול להיות flow אחד חלק.
- בקוד לכל חלק יש מודול בעלים אחד.
- מסך אחד יכול לתזמר כמה מודולים, אבל לא לקחת מהם בעלות.
- API של מודול אחד לא כותב ישירות לטבלאות של מודול אחר.
- אם רעיון חוצה מודולים, מגדירים חוזה: מי owns את הנתון, מי מחליט, מי רק מציג, ואיזה event/API מחבר ביניהם.

דוגמה: לקוח מעלה ערבות בפורטל, תנאי התשלום נבדקים, אשראי מאושר והזמנה
מתקדמת. למשתמש זה flow אחד. בפנים: Portal מעלה מסמך, Payment Terms/Guarantees
מחליט על ערבות, Credit מחליט אם מותר לעבוד, Orders מחליט על התקדמות הזמנה,
ו-Admin/System מציגים ומנהלים. לא מערבבים את האחריות הזו בקובץ אחד.

## 4. איפה הקוד הפעיל

הקוד הפעיל נמצא כאן:

```text
C:\Users\meir-tene\Documents\GitHub\tene-industry
```

לא לעבוד על עותקים ישנים. אם רואים תיקייה אחרת בשם IronBend/ironbend,
בודקים היטב לפני כתיבה.

## 5. איך מריצים בדיקות

בדיקה מלאה:

```powershell
npm test
```

בדיקות ממוקדות:

```powershell
node --check server.js
node --check routes\<module>.js
node --test test\module-governance.test.js
node --test test\security-routes.test.js
node --test test\route-auth-coverage.test.js
```

שינוי backend לא נסגר בלי בדיקות. שינוי route לא נסגר בלי auth/governance.

## 6. מה אסור לגעת

- אסור להוסיף route חדש ל-`server.js`.
- מותר לגעת ב-`server.js` רק כדי:
  - להסיר route ישן.
  - להוסיף `require('./routes/<module>')`.
  - לחבר `app.use('/api', createModuleRouter(...))`.
  - להעביר dependency קיים למודול.
- אסור לערבב אחריות של מודולים.
- אסור לייצר DB חדש בתוך route module. משתמשים ב-`deps.db`.
- אסור לעקוף הרשאות עם headers כמו `x-user-role`.
- אסור להחזיר mock/demo במקום שגיאה אמיתית במסכים תפעוליים.
- אסור לשנות לוגיקה עסקית תוך כדי חילוץ, אלא אם זה נאמר באפיון.

## 7. חוקי חובה לכל endpoint

כל endpoint חדש חייב להגדיר:

- `requireRole` או `requireAnyRole`, אלא אם הוא public במפורש.
- `auditLog` על כתיבה עסקית משמעותית, כשקיים audit מתאים.
- `wsBroadcast` על שינוי מצב שמסכים אחרים צריכים לראות.
- חוזה סטטוסים ברור לכל entity עם `status`.
- pagination בכל LIST שיכול לגדול.
- ownership check בפורטלים חיצוניים: לקוח רואה רק את שלו.

## 8. כללי מודול

כל מודול חייב לדעת:

- שם מודול.
- מסכים שבבעלותו.
- routes שבבעלותו.
- טבלאות/ישויות שבבעלותו.
- events שהוא שולח.
- הרשאות מינימליות.
- risks פתוחים.
- בדיקות שמגנות עליו.

אם לא ברור מי הבעלים, לא כותבים קוד לפני שמחליטים.

### 8.1 הצהרת מסכים והרשאות ב-manifest (חובה)

כל route module מצהיר ב-`manifest` על המסכים שהוא חושף ועל הרשאת ברירת המחדל:

- `screens` — המסכים שהמודול חושף (id, path, label, group). זהו מקור האמת לניווט.
- `access` — `default` + `roles`. **ברירת המחדל הבטוחה:** מודול חדש = `default: 'hidden'`, `roles: { admin: 'edit' }` בלבד. פותחים גישה במפורש, לא משאירים פתוח.
- ההצהרה הזו מופיעה אוטומטית במסך "ניהול מערכת" (ראה `docs/spec-module-permissions.md`).
- ההרשאה ב-manifest **אינה מחליפה** את `requireAnyRole`/`requireRole` ב-endpoints — הקוד נשאר קיר הביטחון; ה-manifest יכול רק להגביל, לא להעלות.

## 9. מחירון ותמחור

המחירון אינו "קובץ שקורא הכל" ואינו route פיננסי רגיל.

הכיוון הנכון:

```text
Excel / CSV / ERP / Supplier API
        ↓
services/pricing-importer.js
        ↓
price_list canonical table
        ↓
services/pricer.js
        ↓
portal / orders / finance / catalog
```

- `pricing-importer.js` יתרגם פורמטים חיצוניים לפורמט פנימי אחד.
- `price_list` הוא מקור האמת הקנוני.
- `pricer.js` יענה כמה עולה מוצר ללקוח, לפי tier, discount, customer rules,
  ובהמשך לפי מודול תעשייה.
- לא לשבור עכשיו את `price_list`; מוסיפים שכבות מעליו.

## 10. קבצי docs שחובה לבדוק

- `docs/module-inventory.md`
- `docs/api-registry.md`
- `docs/api-route-permission-map.md`
- `docs/change-control-protocol.md`
- `docs/agent-assignment-matrix.md`
- `docs/recovery-backlog.md`
- `docs/entity-registry.md`
- `docs/event-registry.md`
- `test/module-governance.test.js`
- `test/security-routes.test.js`
- `test/route-auth-coverage.test.js`

## 11. Definition Of Done

שינוי נחשב גמור רק אם:

- הקוד יושב במודול הנכון.
- `server.js` לא גדל בלוגיקת route.
- ההרשאות ברורות.
- אין mock שמסתיר כשל.
- יש בדיקות רלוונטיות.
- `npm test` עובר, או נרשם במפורש למה לא הורץ.
- docs עודכנו אם השתנתה בעלות או ארכיטקטורה.
- אם הוסף route — עודכן `test/module-governance.test.js`.

---

## 12. תצוגה ויזואלית לפני אישור מסך (חובה)

לכל שינוי או מסך **שמשתמש רואה** (UI), לפני בנייה והטמעה במערכת האמיתית:

1. בנה **mockup עצמאי** (HTML יחיד, ללא תלויות) תחת `docs/mockups/`.
2. **הצג אותו ויזואלית למאיר** (צילום מסך מרונדר), לא תיאור טקסטואלי.
3. קבל **אישור ויזואלי** — מראה, פריסה, צבע, תוכן.
4. רק אחרי אישור — הטמע במסך האמיתי.

- הרצת תצוגה: `npx http-server docs/mockups -p 4599` ואז צילום מסך.
- המטרה: מאיר מאשר בשנייה לפי מראה, לא קורא ספקים. פחות "עומדים במקום", החלטות מהירות.
- חל על שני הסוכנים (Claude ו-GPT). לוגיקת backend טהורה (ללא UI) פטורה.
