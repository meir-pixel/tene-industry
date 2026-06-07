# אפיון: הקמת לקוח חדש בדקות (Provisioning)

> כלי צד-ספק (Tene Industry). לא חלק מאפליקציית IronBend של הלקוח.
> מטרה: לקוח חדש = כמה דקות, לא יום עבודה.

## המודל
כל לקוח = שרת ענן עצמאי משלו (Render), עם נתונים ומודול תעשייה משלו, שמגבה לשרת המרכזי שלך.

---

## מה כל שרת לקוח צריך (env)

### ייחודי לכל לקוח
| משתנה | מקור |
|--------|------|
| `LICENSE_KEY` | נוצר בשרת הרישיונות שלך |
| `JWT_SECRET` | מגרילים אקראית |
| `SESSION_SECRET` | מגרילים אקראית |
| `BASE_URL` | הכתובת של הלקוח (למשל `https://cohen.ironbend.app`) |
| `ACTIVE_INDUSTRY_MODULE` | `steel-rebar` / `wood` / ... |
| `SUPPORT_PHONE` | הטלפון שלך לתמיכה |

### קבוע לכל הלקוחות
| משתנה | ערך |
|--------|-----|
| `NODE_ENV` | `production` |
| `LICENSE_SERVER` | כתובת שרת הגיבוי המרכזי שלך |
| `DB_PATH` | `/data/ironbend.db` |
| `BACKUP_DIR` | `/data/backups` |
| `ALLOW_EMPTY_DB_INIT` | `true` בהקמה ראשונה, אחר כך `false` |

### לפי הלקוח (החשבונות שלו או שלך)
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`,
`OPENAI_API_KEY`, `INTAKE_AI_ENABLED` — נמלאים מאוחר יותר במסך ההגדרות, לא חובה בהקמה.

---

## הכלי: `tools/provision-customer.js`

### שימוש
```bash
node tools/provision-customer.js --name "מפעל כהן" --module steel-rebar --domain cohen.ironbend.app
```

### מה הוא עושה
1. **יוצר רישיון** — קורא לשרת הרישיונות שלך:
   ```
   POST {LICENSE_SERVER}/admin/create  (עם Basic Auth)
   body: customer_name, expires_at (+שנה), license_key (UUID חדש)
   → מחזיר LICENSE_KEY
   ```
2. **מגריל סודות** — `JWT_SECRET`, `SESSION_SECRET` (כל אחד 32 בייט אקראיים).
3. **בונה בלוק env** מוכן להדבקה ב-Render.
4. **מדפיס צ'קליסט** קצר של מה שנותר.

### פלט לדוגמה
```
✅ רישיון נוצר: מפעל כהן
LICENSE_KEY=3f9a2c1b-...

── הדבק ב-Render Environment ──
NODE_ENV=production
LICENSE_KEY=3f9a2c1b-...
LICENSE_SERVER=https://tene-license.onrender.com
JWT_SECRET=<אקראי>
SESSION_SECRET=<אקראי>
BASE_URL=https://cohen.ironbend.app
ACTIVE_INDUSTRY_MODULE=steel-rebar
DB_PATH=/data/ironbend.db
BACKUP_DIR=/data/backups
ALLOW_EMPTY_DB_INIT=true   ← החזר ל-false אחרי העלייה הראשונה
SUPPORT_PHONE=050-XXXXXXX

── צ'קליסט ──
[ ] New → Web Service מהריפו
[ ] הדבק את ה-env למעלה
[ ] הוסף Disk: /data, 1GB
[ ] Deploy
[ ] ודא health ירוק → החזר ALLOW_EMPTY_DB_INIT=false
```

### תלות
משתני סביבה לכלי עצמו:
```
LICENSE_SERVER   — כתובת שרת הרישיונות
LICENSE_ADMIN_PW — סיסמת הניהול של שרת הרישיונות
```

---

## שני שלבים

### שלב א' (עכשיו) — כלי + צ'קליסט
הכלי מייצר רישיון + env + צ'קליסט. ההקמה ב-Render ידנית (~10 דקות). מתאים ל-5–10 לקוחות ראשונים.

### שלב ב' (בעתיד) — אוטומציה מלאה דרך Render API
אם מוגדר `RENDER_API_KEY`, הכלי יוצר את השירות + הדיסק + ה-env אוטומטית בקריאת API אחת. לקוח חדש = פקודה אחת, בלי לגעת בלוח Render. נבנה כשכמות הלקוחות תצדיק.

---

## הקמת לקוח — סיכום זרימה
```
provision-customer "מפעל כהן" steel-rebar cohen.ironbend.app
        ↓
רישיון נוצר בשרת שלך
        ↓
env מוכן + צ'קליסט
        ↓
Render: שירות חדש + דיסק + env  (שלב א' ידני / שלב ב' אוטומטי)
        ↓
עלייה ראשונה (ALLOW_EMPTY_DB_INIT=true) → DB נוצר ונזרע
        ↓
החזרת ALLOW_EMPTY_DB_INIT=false
        ↓
✅ הלקוח חי. גיבוי לילי מתחיל לזרום לשרת המרכזי.
```

---

## Definition of Done (שלב א')
- [ ] `tools/provision-customer.js` קיים
- [ ] יוצר רישיון בשרת הרישיונות
- [ ] מגריל JWT_SECRET + SESSION_SECRET
- [ ] מדפיס env + צ'קליסט מוכנים
- [ ] תיעוד שימוש ב-README של הכלי
