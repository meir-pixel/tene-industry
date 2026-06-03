# מודול: license — ניהול רישיון

## מה הוא עושה
שולט על גישה למערכת — מצב חינם, מנוי בתשלום, או נעילה. גיבוי מוצפן לשרת Tene Industry.

---

## שלושה מצבים

| מצב | תנאי | מה קורה |
|-----|------|---------|
| **FREE** | אין `LICENSE_KEY` | עובד מלא, ללא הגבלה, ללא גיבוי ענן |
| **PAID** | `LICENSE_KEY` תקף | עובד מלא + גיבוי ענן אוטומטי |
| **LOCKED** | `LICENSE_KEY` פג/בוטל/מחשב שגוי | דף נעילה HTML על כל API |

---

## קלט — מה הוא מקבל

| מקור | מה | דרך |
|------|----|-----|
| `.env` / settings | `LICENSE_KEY` | process.env / DB |
| שרת רישיונות | אישור תקינות | `POST https://license.tene-ind.com/api/check` |

---

## פלט — מה הוא נותן

| יעד | מה | דרך |
|-----|----|-----|
| Express | middleware לכל `/api` | `licenseService.middleware` |
| DB | סטטוס שמור (settings) | `license_plan`, `license_valid` |
| console | מצב בהפעלה | log messages |

---

## Grace Period
אם שרת הרישיונות לא זמין — המערכת ממשיכה לעבוד **7 ימים** מהאימות האחרון.
אחרי 7 ימים → נעילה.

---

## Machine Binding
בבדיקה הראשונה — ה-`machine_id` (fingerprint מה-MAC + hostname) נשמר בשרת.
לקוח שמנסה להשתמש ברישיון על מחשב אחר → נחסם.
**שחרור:** רק מממשק הAdmin של Tene Industry.

---

## גיבוי ענן

### מתי: כל לילה 02:00 (רק במצב PAID)
### מה: `ironbend.db` מוצפן AES-256-GCM
### לאן: `https://license.tene-ind.com/api/backup/upload`
### הצפנה: מפתח = HMAC-SHA256(LICENSE_KEY + machineId)

---

## קבצים

| קובץ | תוכן |
|------|------|
| `services/license.js` | בדיקת רישיון + middleware |
| `services/backup.js` | גיבוי מוצפן לענן |
| `tene-license-server/server.js` | שרת הרישיונות (repo נפרד) |

---

## הגדרות

| מפתח | ברירת מחדל | תיאור |
|------|-----------|-------|
| `LICENSE_KEY` | ריק (Free) | מפתח ייחודי לכל לקוח |
| `LICENSE_SERVER` | `https://license.tene-ind.com` | שרת הרישיונות |
| `SUPPORT_PHONE` | ריק | טלפון לתמיכה בדף הנעילה |

---

## Deploy שרת הרישיונות
```bash
cd tene-license-server
npm install
echo "ADMIN_PASSWORD=yourpassword" > .env
pm2 start server.js --name tene-license
# SSL: certbot --nginx -d license.tene-ind.com
```
