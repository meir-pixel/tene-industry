# Deploy — שרת רישיונות וגיבוי Tene Industry

יש שתי דרכים. **דרך א' (Render) מומלצת** — כי כבר יש לך חשבון Render ואין צורך ב-VPS.

---

## דרך א' — Render (מומלץ, ללא VPS)

שרת זה רץ כשירות **נפרד** מאפליקציית IronBend. הקובץ `render.yaml` בתיקייה כבר מוכן.

**שלבים:**
1. צור Repo חדש ב-GitHub מהתיקייה `tene-license-server/` בלבד
   (או: ב-Render בחר את אותו Repo עם `rootDir = tene-license-server`).
2. ב-Render: **New → Blueprint** → בחר את ה-Repo.
3. Render יזהה את `render.yaml` ויקים שירות `tene-license` עם דיסק קבוע 1GB.
4. מלא משתנה `ADMIN_PASSWORD` (סיסמת ממשק הניהול) ו-`TENE_NOTIFY_PHONE` (הטלפון שלך).
5. אחרי שעולה — הכתובת תהיה למשל `https://tene-license.onrender.com`
6. עדכן באפליקציה של כל לקוח את `LICENSE_SERVER` לכתובת הזו.

**עלות:** plan `starter` (~7$/חודש) — נדרש בשביל דיסק קבוע ששומר את הגיבויים.

**בדיקה:**
```
https://tene-license.onrender.com/health
https://tene-license.onrender.com/admin   (סיסמה: ADMIN_PASSWORD)
```

---

## דרך ב' — VPS (אופציה חלופית)

## מה צריך
- VPS עם Ubuntu 22.04 (Hetzner CX11 — ~5$/חודש)
- דומיין `tene-ind.com` (כבר יש לך)
- גישה SSH לשרת

---

## שלב 1 — הזמן VPS

**Hetzner** (הכי זול, שרת בגרמניה):
1. https://hetzner.com → Cloud → Create Server
2. Ubuntu 22.04 | CX11 (2GB RAM, 20GB) | ~4.5€/חודש
3. שמור את ה-IP שמקבל (לדוגמה: `49.12.34.56`)

---

## שלב 2 — DNS

ב-ספק הדומיין שלך, הוסף A record:
```
license.tene-ind.com  →  49.12.34.56
```
ממתין עד 10 דקות לפרופגציה.

---

## שלב 3 — Deploy (הרץ מה-VPS)

התחבר ל-VPS:
```bash
ssh root@49.12.34.56
```

הרץ את סקריפט ה-deploy:
```bash
curl -fsSL https://raw.githubusercontent.com/meir-pixel/tene-industry/main/tene-license-server/setup.sh | bash
```

---

## מה הסקריפט עושה אוטומטית
1. מתקין Node.js 20 + PM2 + nginx + certbot
2. מוריד את הקוד
3. מבקש ממך סיסמת Admin
4. מגדיר nginx + SSL
5. מפעיל עם PM2 (אוטומטי בכל אתחול)

---

## שלב 4 — בדיקה

```bash
curl https://license.tene-ind.com/health
# ציפייה: {"ok":true,"total":0,"active":0}
```

ממשק Admin:
```
https://license.tene-ind.com/admin
```

---

## יצירת רישיון ראשון (לבדיקה)

1. כנס ל-`https://license.tene-ind.com/admin`
2. לחץ "רישיון חדש"
3. מלא שם + תאריך תפוגה
4. קבל `LICENSE_KEY`
5. שים ב-`.env` של IronBend:
   ```
   LICENSE_KEY=the-key-you-got
   NODE_ENV=production
   ```
6. הפעל IronBend — תראה `[License] ✅ Valid (paid)`

---

## תחזוקה

| פעולה | פקודה |
|-------|-------|
| לוגים | `pm2 logs tene-license` |
| הפעלה מחדש | `pm2 restart tene-license` |
| גיבוי DB | `cp /opt/tene-license/licenses.db ~/backup-$(date +%Y%m%d).db` |
| עדכון גרסה | `cd /opt/tene-license && git pull && pm2 restart tene-license` |

---

## אחסון גיבויים — דיסק או ענן זול

ברירת מחדל: הגיבויים נשמרים על הדיסק (1GB). מספיק ל-1–5 לקוחות.

**כשגדלים — מעבר לאחסון ענן זול (Backblaze B2):**

הגיבויים יישמרו בענן ללא הגבלת נפח, בכמה אגורות לחודש. צריך רק למלא 4 משתנים — בלי שינוי קוד.

1. פתח חשבון ב-Backblaze B2 וצור Bucket.
2. צור Application Key (מקבל `keyID` ו-`applicationKey`).
3. ב-Render → השירות → Environment → מלא:
   ```
   S3_BUCKET      = שם הדלי
   S3_ENDPOINT    = https://s3.us-west-004.backblazeb2.com   (לפי האזור שלך)
   S3_ACCESS_KEY  = keyID
   S3_SECRET_KEY  = applicationKey
   S3_REGION      = us-west-004
   ```
4. Deploy. בלוגים יופיע `[Storage] mode: s3`.

מאותו רגע — כל גיבוי חדש נשמר בענן הזול. אם המשתנים ריקים — חוזר לדיסק אוטומטית.

**עלות B2:** ~6$ ל-טרה-בייט לחודש (100GB ≈ 0.6$). מתאים גם ל-100 לקוחות.
