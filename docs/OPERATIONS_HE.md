# 🎛️ מרכז שליטה — Tene Industry / IronBend

> המסמך הזה הוא נקודת הכניסה היחידה. כל קישור, כל שרת, כל פקודה — כאן.
> אם משהו "הלך לאיבוד" — מתחילים מהמסמך הזה.

---

## 🌐 קישורים חיים

| מה | כתובת |
|----|-------|
| שרת גיבוי ורישיונות | https://tene-license.onrender.com |
| פאנל ניהול (סיסמה) | https://tene-license.onrender.com/admin |
| בדיקת בריאות | https://tene-license.onrender.com/health |
| קוד (GitHub) | https://github.com/meir-pixel/tene-industry |
| לוח Render | https://dashboard.render.com |
| מפרט מערכת (Google Drive) | https://drive.google.com/file/d/1xfigqwGrCtMxVYaesUJX0CnuJZklM9zU/view |

---

## 🖥️ השרתים ב-Render

| שירות | מה זה | סטטוס |
|-------|-------|-------|
| `tene-license` | שרת הגיבוי והרישיונות שלך (Node) | ✅ חי |
| `ironbend` | אפליקציה ראשית — סביבת בדיקה ישנה | ❌ נכשל (לא בשימוש) |

**הערה:** הפרודקשן האמיתי = שרת נפרד לכל לקוח. `ironbend` הישן אפשר לכבות Auto-Deploy או למחוק.

---

## 🔑 איפה כל סוד נשמר

| סוד | איפה |
|-----|------|
| סיסמת פאנל הגיבוי | `ADMIN_PASSWORD` ב-Environment של `tene-license` ב-Render |
| מפתחות רישיון של לקוחות | פאנל הגיבוי `/admin` (נשמר בדיסק) |
| מפתח לקוח בשרת שלו | `LICENSE_KEY` ב-Environment של שרת הלקוח |

⚠️ אף סוד לא נשמר בקוד. הכל ב-Environment של Render.

---

## 👥 הקמת לקוח חדש

### איפה המפתח נכנס
ה-`LICENSE_KEY` נכנס ל-**Environment של שרת הלקוח** ב-Render (לא במקום מרכזי).

### זרימה
```
1. צור רישיון בפאנל:  /admin → "רישיון חדש"  → מקבל LICENSE_KEY
2. הקם שרת ללקוח ב-Render:  New → Web Service מהריפו
3. הדבק ב-Environment של הלקוח:
      LICENSE_KEY=<המפתח מהפאנל>
      LICENSE_SERVER=https://tene-license.onrender.com
      JWT_SECRET=<אקראי>
      BASE_URL=https://<לקוח>.onrender.com
      ACTIVE_INDUSTRY_MODULE=steel-rebar
      DB_PATH=/data/ironbend.db
      BACKUP_DIR=/data/backups
      ALLOW_EMPTY_DB_INIT=true   ← החזר ל-false אחרי עלייה ראשונה
4. הוסף Disk: /data, 1GB
5. Deploy → ודא health → החזר ALLOW_EMPTY_DB_INIT=false
```

### כלי שמכין הכל אוטומטית
```
node tools/provision-customer.js --name "שם לקוח" --module steel-rebar --domain x.onrender.com
```
מייצר רישיון + מגריל סודות + מדפיס את כל בלוק ה-env מוכן להדבקה.

---

## 💾 גיבוי — איך זה עובד

- כל שרת לקוח שולח גיבוי **מוצפן** כל לילה לשרת הגיבוי שלך.
- שרת הגיבוי שומר 30 גיבויים אחרונים לכל לקוח.
- Render עושה גם snapshot יומי של הדיסק.
- לצפייה/הורדה: פאנל `/admin` → "גיבויים" ליד הלקוח.

**להגדלת קיבולת (כשיהיו הרבה לקוחות):** מלא ב-Environment של `tene-license` את משתני B2:
`S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION`

---

## ⚡ פקודות מהירות

| פעולה | פקודה |
|-------|-------|
| בדיקות | `npm test` |
| הקמת לקוח | `node tools/provision-customer.js --name "..." --module steel-rebar` |
| הרצה מקומית | `node server.js` |

---

## 📚 תיעוד מרכזי

| מסמך | קישור |
|------|-------|
| כללי עבודה | [docs/BUILD_RULES_HE.md](BUILD_RULES_HE.md) |
| דרכוני מודולים | [docs/modules/README.md](modules/README.md) |
| הקמת לקוח (אפיון) | [docs/spec-customer-provisioning.md](spec-customer-provisioning.md) |
| חוזה מודול תעשייה | [docs/spec-module-contract.md](spec-module-contract.md) |
| פריסת שרת גיבוי | [tene-license-server/DEPLOY.md](../tene-license-server/DEPLOY.md) |

---

## 🧭 הארכיטקטורה במשפט

```
כל לקוח → שרת ענן משלו (IronBend)  ┐
                                    ├→ גיבוי לילי מוצפן → שרת הגיבוי שלך → אחסון
ראוטר סלולרי גיבוי במפעל (אינטרנט)  ┘
```
