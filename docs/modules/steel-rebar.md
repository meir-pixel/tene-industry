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

