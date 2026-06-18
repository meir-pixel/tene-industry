# אפיון: מחירונים והצעות מחיר

בעלות: Pricing / Finance / Customers.

## מקור אמת

המחירון הישן לפי קוטר הוסר. מקור האמת היחיד למחירי מכירה ולמחירי לקוח הוא:

- `pricing_price_books` - כותרת מחירון, לקוח, סוג, תנאי תשלום, סטטוס ותוקף.
- `pricing_price_items` - שורות מק"ט, קוטר, תיאור, יחידה, מחיר לפני מע"מ, מטבע ותוקף.

מחירון פעיל בלבד משתתף בחישוב מחיר. מחירון חדש או מיובא נשמר כטיוטה עד אישור.

## סוגי מחירון

| סוג | `price_type` | שימוש |
| --- | --- | --- |
| מחירון כללי | `general` או `sale` | ברירת מחדל ללקוח שאין לו מחירון אישי פעיל. |
| מחירון לקוח | `customer` + `customer_id` | מחירון אישי ללקוח מסוים. אין fallback אוטומטי למחירון כללי. |

## כלל תמחור

1. הזמנה או פורטל מבקשים מחיר דרך `services/pricer.js` בלבד.
2. לקוח עם `price_tier='customer'` חייב לקבל מחיר מתוך מחירון לקוח פעיל שמחובר ל-`customer_id`.
3. אם חסרה שורת קוטר/מק"ט במחירון הלקוח, מחזירים `price_list_requires_update` ולא משתמשים במחירון כללי כתחליף.
4. לקוח רגיל מקבל מחיר ממחירון כללי פעיל.
5. `discount_pct` מוחל רק אחרי שנבחר מקור מחיר.
6. מחיר קנייה/עלות חומר נשאר ב-`steel_price_history` ואסור להשתמש במחיר מכירה כעלות.

## מסך מערכת

המסך הרשמי הוא `public/pricing.html`.

המסך מאפשר:

- יצירת מחירון חדש.
- עריכת כותרת מחירון: קוד, שם, לקוח, סוג, מטבע, תנאי תשלום, תוקף וסטטוס.
- הוספה, עריכה ומחיקה רכה של שורות מק"ט.
- שמירת קוטר בשורת מחירון עבור חישובי ברזל לפי קוטר.
- יצירת דוגמת מחירון מתוך מבנה PDF לקוח/ספק.

## API

- `GET /api/pricing/price-books`
- `POST /api/pricing/price-books`
- `PATCH /api/pricing/price-books/:id`
- `GET /api/pricing/price-books/:id/items`
- `POST /api/pricing/price-books/:id/items`
- `PATCH /api/pricing/price-books/:id/items/:itemId`
- `DELETE /api/pricing/price-books/:id/items/:itemId`

קריאה מותרת ל-`office`, `sales`, `finance`, `manager`, `admin`.
כתיבה מותרת ל-`finance`, `manager`, `admin`.

## Definition of Done

- אין API פנימי של `/api/price-list`.
- אין יצירת schema או seed לטבלת `price_list`.
- `services/pricer.js` קורא רק מ-`pricing_price_books` ו-`pricing_price_items`.
- פורטל לקוח משתמש באותו מנוע תמחור ואינו עוקף הרשאות.
- בדיקות הרשאה, smoke, client contract ו-pricer מכסות את המבנה החדש.
