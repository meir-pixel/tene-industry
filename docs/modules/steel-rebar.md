# מודול: steel-rebar — ברזל כפוף

## מה הוא עושה
כל הלוגיקה הייחודית לתעשיית הברזל הכפוף — חישובי משקל, שיוך מכונות, נורמליזציה של צורות, ופרסור קבצי BVBS.

---

## קלט — מה הוא מקבל

| מקור | מה | דרך |
|------|----|-----|
| כל route שיוצר פריט | קוטר (mm) + אורך (mm) | `rebarKgPerMeter(diameter)` |
| routes/bvbs.js | תוכן קובץ BVBS | `parseBVBS(content)` |
| routes/intake.js | צלעות גולמיות מ-OCR | `normalizeFactorySegments(shapeName, segments)` |
| routes/portal.js | פריטי הזמנה מהפורטל | `autoAssignMachine(diameter)` |

---

## פלט — מה הוא נותן

| יעד | מה | דרך |
|-----|----|-----|
| כל route | ק"ג למטר לפי קוטר | `rebarKgPerMeter(diameter)` |
| routes/orders.js | שם מכונה (A/B/D) | `autoAssignMachine(diameter)` |
| routes/intake.js | צלעות מנורמלות | `normalizeFactorySegments()` |
| routes/bvbs.js | פריטים מפורסרים | `parseBVBS(content)` |

---

## טבלאות שבבעלותו
אין — המודול הוא pure logic, לא כותב לDB.

---

## חישובים

### משקל ק"ג למטר
```
קוטר ידוע → טבלת REBAR_KG_PER_M
קוטר לא ידוע → diameter² × 0.00617  (נוסחת ברזל עגול)
```

### משקל פריט
```
weight = (total_length_mm / 1000) × rebarKgPerMeter(diameter)
```

### שיוך מכונה
```
diameter ≤ 12mm → מכונה A (XINJE)
diameter ≤ 20mm → מכונה B (XINJE)
diameter > 20mm → מכונה D (עתידי)
```

### קוטרים תקניים
`6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40` mm

---

## קבצים

| קובץ | תוכן |
|------|------|
| `modules/steel-rebar/index.js` | entry point — כל ה-exports |
| `modules/steel-rebar/weights.js` | REBAR_WEIGHTS, rebarKgPerMeter, VALID_DIAMETERS |
| `modules/steel-rebar/machines.js` | autoAssignMachine |
| `modules/steel-rebar/shapes.js` | normalizeFactorySegments, normalizeFactoryShapeName |
| `modules/steel-rebar/bvbs.js` | parseBVBS, parseBVBSLine |

---

## תלויות
אין תלויות חיצוניות — רק Node.js built-ins.

---

## סיכונים פתוחים

| # | תיאור | חומרה |
|---|-------|-------|
| BUG-06 | autoAssignMachine לא לוקח בחשבון עומס מכונה | בינונית |
| — | מכונה C (MEP) לא ממופה עדיין | נמוכה |

---

## כיצד להרחיב
כשיגיע מודול עץ/אריזה — יוצרים `modules/wood/index.js` עם אותו ממשק.
`constants.js` ממשיך לעשות re-export לתאימות לאחור.

## כלל סימון חזותי לחישוק

סימון חישוק הוא ריבוע/מלבן עם סימן פינה פנימית. הסימון תמיד פונה פנימה. התוספת היא חלק פנימי של סימון הפינה/חפיפה, לא שתי קרניים או קווים חיצוניים.

## חוק מכונה לחישוק: עודף הופך לצלע ראשונה ואחרונה

בחישוק עם אורך כולל גדול מסכום הצלעות הגיאומטריות, ההפרש הוא עודף סגירה. לצורך תצוגה למשתמש אפשר להציג אותו כ"עודף פתיחה" ו"עודף סגירה", אבל לצורך מעבר למכונה הוא חייב להפוך לשתי צלעות אמיתיות ברצף המכונה.

נוסחה:

- `visibleSegmentsSum = sum(visibleSegments)`
- `surplusTotal = totalLength - visibleSegmentsSum`
- `startSegment = surplusTotal / 2`
- `endSegment = surplusTotal / 2`
- `machineSegments = [startSegment, ...visibleSegments, endSegment]`

דוגמה מחייבת:

- צלעות נראות: `100, 100, 100, 100`
- אורך כולל: `420`
- סכום צלעות נראה: `400`
- עודף כולל: `20`
- צלע מכונה ראשונה: `10`
- צלע מכונה אחרונה: `10`

לכן למכונה עובר:

```json
{
  "shapeType": "stirrup",
  "visibleSegments": [100, 100, 100, 100],
  "totalLength": 420,
  "surplusTotal": 20,
  "machineSegments": [10, 100, 100, 100, 100, 10]
}
```

אסור להעביר למכונה רק `[100,100,100,100]` עם הערת עודף בצד. העודף חייב להיות חלק מהרצף המכני כצלע ראשונה וצלע אחרונה.

## חוק ספירלה: פרמטרים ייעודיים ללא צלעות וזוויות

ספירלה אינה צורה מקופפת רגילה. אסור להציג או להעביר עבורה צלעות וזוויות. ספירלה מוגדרת לפי פרמטרים ייעודיים בלבד.

שדות חובה:

- `barDiameter` — קוטר ברזל.
- `coilDiameter` — קוטר ספירלה כפי שמופיע בטופס.
- `turns` — מספר כריכות.
- `quantity` — כמות יחידות, אם יש יותר מספירלה אחת.

שדות אופציונליים:

- `pitch` — פסיעה / מרווח בין כריכות, אם מופיע או נדרש למכונה.
- `diameterBasis` — בסיס הקוטר (`form_value`, `inner`, `outer`, `centerline`). בשלב האפיון ברירת המחדל היא `form_value`, כלומר הקוטר כפי שהלקוח/הטופס מציין.

דוגמה:

```json
{
  "shapeType": "spiral",
  "barDiameter": 8,
  "quantity": 1,
  "spiral": {
    "coilDiameter": 50,
    "diameterBasis": "form_value",
    "turns": 160,
    "pitch": null
  }
}
```

כלל UI ומכונה:

- אין להציג שדות זווית בספירלה.
- אין להציג צלע א/ב/ג/ד בספירלה.
- אין לחשב עודף קצוות כמו בחישוק.
- השרטוט חייב להיראות כעיגול חיצוני עם ספירלה פנימית במבט על, ועם קו קוטר מסומן וברור (`coilDiameter`). אסור להציג ספירלה כגל סינוס, כקו גלי, כקפיץ צדדי או כצורה מקופפת.
- אם OCR מזהה ספירלה אך חסרים `coilDiameter` או `turns`, השורה נשמרת כטיוטה בלבד ודורשת תיקון אנושי.





