# Deploy — שרת רישיונות Tene Industry

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
