# 👋 התחל כאן — מדריך כניסה למצטרף לפרויקט

> אתה בא לעזור לבנות את IronBend / Tene Industry. הדף הזה לוקח אותך מאפס
> ל"רץ אצלי על המחשב + מבין את המפה + יודע מאיפה להתחיל" ב-15 דקות.
> אחרי שתבין את הדף הזה — כל שאר התיעוד ייקרא הגיוני.

---

## 1. מה זה הפרויקט (במשפט)

מערכת מודולרית לניהול מפעל ותעשייה, שנמכרת **לפי מודולים ללקוחות שונים**.
היום ממוקדת בברזל/פלדה (כיפוף, ייצור, מלאי, פורטל לקוחות, כספים), אבל
הארכיטקטורה בנויה כך שהוספת תעשייה חדשה (עץ, וכו') = הוספת **מודול אחד**,
לא שכתוב.

מודל מסחרי: כל לקוח מקבל **שרת ענן משלו**, עם רישיון שמגדיר אילו מודולים פתוחים.

---

## 2. הרצה מקומית (60 שניות)

```powershell
git clone https://github.com/meir-pixel/tene-industry
cd tene-industry
npm install
npm test        # ודא שהכל ירוק לפני שנוגעים בקוד
node server.js  # מריץ מקומית
```

- DB: SQLite (קובץ מקומי, נוצר אוטומטית). אין צורך בשרת DB חיצוני.
- אם `npm test` לא ירוק אצלך מההתחלה — **עוצרים ומדברים**, לא ממשיכים.

---

## 3. מפת הקוד — איפה כל דבר יושב

| תיקייה | מה יש שם |
|--------|----------|
| `server.js` | הגזע הישן. **לא מוסיפים בו routes חדשים** — רק מרוקנים ומחברים מודולים |
| `routes/<module>.js` | כל משפחת API. כל אחד factory function עם `required()` guard |
| `services/*.js` | לוגיקה עסקית משותפת (settings, license, pricer, moduleLoader) |
| `modules/steel-rebar/` | מודול התעשייה הפעיל — חישובי משקל, צורות, BVBS |
| `public/*.html` | המסכים (frontend). מסך לכל תחום |
| `shared/module-catalog.json` | מקור האמת לאילו מודולי-פיצ'ר קיימים |
| `test/*.test.js` | בדיקות. governance + security + auth-coverage שומרות על המבנה |
| `tene-license-server/` | repo נפרד — שרת הרישיונות והגיבוי (תחום נפרד מהאפליקציה) |

**הארכיטקטורה במשפט:** Strangler Fig — מוציאים לוגיקה מ-`server.js` למודולים, מודול אחר מודול.

---

## 4. החוקים שאסור לשבור (קרא לפני שנוגעים בקוד)

📕 **חובה:** [docs/BUILD_RULES_HE.md](docs/BUILD_RULES_HE.md) — זה חוק, לא המלצה.

תמצית הכי קריטית:
- **אסור** להוסיף route חדש ל-`server.js`. route חדש = `routes/<module>.js`.
- כל endpoint חייב הרשאה (`requireRole`/`requireAnyRole`) — אסור לעקוף עם headers.
- אסור לערבב אחריות בין מודולים. לא ברור מי הבעלים? לא כותבים עד שמחליטים.
- אסור mock/demo שמסתיר כשל אמיתי במסך תפעולי.
- שינוי backend לא נסגר בלי `npm test` ירוק.
- אם הוספת route → עדכן `test/module-governance.test.js`.

---

## 5. כלל הזהב נגד התנגשויות ⚠️

בפרויקט עובדים **כמה גורמים במקביל**. לכן, לפני שנוגעים בקובץ:

1. `git pull` — ראה מה השתנה.
2. הסכמה מראש **בדיוק על אילו קבצים** אתה לוקח.
3. commit עם **נתיב מפורש** וציון מה שינית:
   ```powershell
   git commit -m "תיאור — שיניתי public/x.html בלבד" -- public/x.html
   ```
   (אסור `git commit` בלי pathspec — זה גורף קבצים של אחרים בטעות.)
4. בענפים: לא דוחפים ל-main בלי תיאום.

> זה הכלל שהכי הרבה כסף וזמן נשרף עליו בעבר. קח אותו ברצינות.

---

## 6. מאיפה להתחיל לתרום

| רמה | משימה טובה ראשונה | קישור |
|-----|-------------------|-------|
| קל | קרא דרכון מודול אחד והבן קלט/פלט | [docs/modules/README.md](docs/modules/README.md) |
| בינוני | קח משימה פתוחה עם אפיון מוכן | טבלת המשימות ב-[docs/OPERATIONS_HE.md](docs/OPERATIONS_HE.md) |
| מתקדם | המשך לרוקן route מ-`server.js` למודול | [docs/spec-module-contract.md](docs/spec-module-contract.md) |

יש **8 משימות פתוחות עם אפיון מוכן** ב-`OPERATIONS_HE.md` — כל אחת אפשר לקחת עצמאית.

---

## 7. כל הקישורים החיים

הכל מרוכז כאן → 📍 **[docs/OPERATIONS_HE.md](docs/OPERATIONS_HE.md)** (שרתים, סודות, פריסה, הקמת לקוח).

| מה | כתובת |
|----|-------|
| קוד | https://github.com/meir-pixel/tene-industry |
| פאנל רישיונות/גיבוי | https://tene-license.onrender.com/admin |
| לוח Render | https://dashboard.render.com |

---

## 8. סדר קריאה מומלץ למצטרף

1. הדף הזה (`START_HERE.md`)
2. [docs/BUILD_RULES_HE.md](docs/BUILD_RULES_HE.md) — החוקים
3. [docs/modules/README.md](docs/modules/README.md) — דרכוני המודולים (מה כל מודול עושה)
4. [docs/OPERATIONS_HE.md](docs/OPERATIONS_HE.md) — איך הכל רץ בענן + משימות פתוחות

אחרי 4 הקבצים האלה אתה יכול לתרום בלי לשבור כלום.
