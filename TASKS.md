# 📋 לוח משימות — Tene Industry / IronBend

> זהו **מקור האמת היחיד** למשימות פתוחות. מאיר מסמן מה צריך; הסוכנים (Claude / GPT) לוקחים מכאן.
> לוח קליל מעל התיעוד הכבד (`docs/recovery-backlog.md`) — לא מחליף אותו, מצביע אליו.

---

## 🤖 פרוטוקול לקיחה אוטומטית (לסוכנים — חובה)

בתחילת כל סשן, לפני עבודה:

1. **קרא** את `TASKS.md` ואת `START_HERE.md`.
2. **בחר** את המשימה בעדיפות הגבוהה ביותר שבה `status: todo` ו-`owner` ∈ { שמך, `either` }.
3. **בדיקת התנגשות:** אם משימה אחרת ב-`in_progress` חולקת קובץ מתוך ה-`scope` שלך — דלג למשימה הבאה. **לעולם לא שני סוכנים על אותו קובץ.**
4. **תפוס:** שנה `status: in_progress`, הוסף `owner: <שמך>` ו-`claimed: <תאריך>`. **קודם קומיט את `TASKS.md` בנתיב מפורש**, ואז התחל לעבוד.
5. **בכל קומיט עבודה:** נתיב מפורש בלבד (`git commit -- <files>`), וציין אילו קבצים שינית.
6. **בסיום:** `status: done`, הוסף `commit: <hash>`. אל תמחק את הכרטיס — מעבירים לארכיון ב-`## ✅ הושלם`.
7. **אם נחסם:** `status: blocked` + שורת `blocker:` שמסבירה מה חסר (החלטת מאיר / מקור חסר).

**סטטוסים:** `todo` (מוכן ללקיחה) · `approval` (הצעה, ממתין לאישור מאיר) · `in_progress` · `blocked` · `done`
**owner:** `claude` · `gpt` · `either`
**priority:** `P1` (קריטי) · `P2` (חשוב) · `P3` (כשיתאפשר)

> ⚠️ משימה ב-`approval` היא **הצעה** — אסור לסוכן לקחת אותה עד שמאיר משנה ל-`todo`.

---

## 🔓 משימות פתוחות

### T-001 · ספירת משתמשים פעילים ברישיון
- status: done
- owner: gpt
- priority: P1
- scope: services/license.js
- notes: מומש — activeUsersThisMonth() קיימת, last_login בסכמה, activeUsers נשלח ב-checkRemote(). test ב-module-governance.test.js:172 מוודא.
- commit: already-in-codebase

### T-002 · מטריצת הרשאות מבוססת-מודול + מסך ניהול
- status: done
- owner: claude
- priority: P2
- scope: services/accessControl.js (חדש), routes/access.js (חדש), public/access-guard.js (חדש), public/nav.js, public/admin.html, modules/*/manifest
- spec: docs/spec-module-permissions.md
- accept: כל מודול מצהיר `screens`+`access`; nav מסנן hidden; כניסה ישירה נחסמת; ברירת מחדל hidden חוץ מאדמין; npm test ירוק
- notes: ⚠️ נוגע ב-permissions.js/nav — לתאם בין הסוכנים לפני התחלה

### T-003 · עדכון BUILD_RULES — הצהרת הרשאות חובה במודול
- status: done
- owner: claude
- priority: P2
- scope: docs/BUILD_RULES_HE.md
- accept: סעיף 8 מחייב `manifest.access` בכל מודול; ברירת מחדל hidden
- progress: ✅ נוסף סעיף 8.1 ל-BUILD_RULES_HE.md (הצהרת screens+access, ברירת מחדל hidden, קיר ביטחון בקוד)

### T-004 · ניתוב OCR לפי סוג מסמך
- status: done
- owner: gpt
- claimed: 2026-06-09
- priority: P2
- scope: routes/intake.js, public/inventory.html, מסך השוואה מקור↔פענוח
- spec: docs/spec-dual-pricing.md (סעיף ניתוב)
- accept: המשתמש בוחר סוג מסמך מראש (הזמנה/מחירון/ספק); prompt נפרד לכל סוג; ה-AI לא מנתב לבד
- notes: Done by GPT. Order OCR keeps only order/bar-schedule documents in the order intake flow; supplier delivery notes route to inventory receipt OCR; price lists route to finance price-list. Contract test covers the routing.
- commit: 9c66c41


### T-005 · שני סוגי מחירון (קנייה / מכירה)
- status: in_progress
- owner: gpt
- claimed: 2026-06-11
- priority: P2
- scope: services/pricing-importer.js (חדש), price_list, מסכי מחירון
- spec: docs/spec-dual-pricing.md
- accept: מחירון שלי מול מחירון לקוח; נקלט מתמונה/קובץ/ידני; מחיר קנייה מ-steel_price_history בלבד

### T-006 · ייצוא ל-Priority
- status: todo
- owner: either
- priority: P3
- scope: routes/priority.js
- spec: docs/spec-priority-export.md
- accept: ייצוא סוג פריט+משקל+מחיר (לא צורות כיפוף)

### T-007 · מפת מודולים חיה
- status: todo
- owner: either
- priority: P3
- scope: כל manifest (consumes/produces), wsBroadcast, מסך גרף חדש
- spec: docs/spec-module-map.md
- accept: כל מודול מצהיר consumes/produces; ניטור תקשורת ב-wsBroadcast; מסך גרף עם סטטוס

### T-008 · הפרדת ניהול ספק מול לקוח
- status: todo
- owner: either
- priority: P2
- scope: public/admin.html, services/settings.js
- spec: docs/spec-vendor-vs-customer-admin.md
- accept: ⚠️ אבטחה — אסור כפתורי ספק (מודולים/רישיון/מכסה) בצד הלקוח

### T-009 · שכבת מיתוג White-Label (צד לקוח)
- status: done
- owner: claude
- claimed: 2026-06-09
- priority: P1
- scope: services/branding.js, routes/branding.js, public/brand-client.js, services/settings.js, public/nav.js
- spec: docs/spec-customer-side.md
- accept: שם/לוגו/צבע נטענים מ-settings פר-לקוח; הלקוח יכול לערוך מיתוג; npm test ירוק (195/195)
- progress: ✅ branding.js+routes (Claude) → mount ב-server.js (GPT) → הגדרות BRAND_ customer-editable ב-settings.js (Claude) → brand-client נטען בכל הדפים דרך nav.js + hookים ללוגו (Claude). מסך כניסה + מיתוג בהקמה = T-010.

### T-010 · רושם ראשון — מסך כניסה ממותג + מיתוג בהקמה
- status: todo
- owner: claude
- priority: P2
- scope: public/login.html, tools/provision-customer.js, docs/customer-onboarding.md
- spec: docs/spec-customer-side.md
- accept: login מציג מותג לקוח; provision-customer מזריק BRAND_* כברירת מחדל
- notes: תלוי ב-T-009; כפיית סיסמה ראשונה (#3) מסומן GPT — לתאם

### T-011 · תפקידי פורטל (מזמין / מאשר)
- status: in_progress
- owner: claude
- claimed: 2026-06-09
- priority: P1
- scope: services/portalAccess.js, routes/portal.js, routes/portalAdmin.js, public/customer.html
- spec: docs/spec-portal-roles.md
- accept: כמה משתמשים לכל לקוח עם תפקיד; מזמין=פורטל מלא בלי מחיר/אישור; מאשר=מחיר+אישור; ניהול ע"י לקוח+טנא
- progress: ✅ portal_users+roleCaps · ✅ טוקן פר-משתמש+role · ✅ שער מחיר/אישור בכל /c/* · ✅ כניסה לפי טלפון אישי · ✅ ניהול משתמשים בפורטל (GET/POST /c/users, deactivate — מאשר בלבד). 195/195. נשאר (UI+פנימי): מסך ניהול משתמשים ב-customer.html, ניהול ע"י טנא ב-portalAdmin, שרטוט צורות+מידות, מעקב סטטוס.

### T-012 · פרויקטים ותקציב בפורטל
- status: todo
- owner: claude
- priority: P2
- scope: projects (לבדוק קיים), routes/portal.js, public/customer.html, public/projects.html
- spec: docs/spec-project-budgets.md
- accept: פרויקט+תקציב; ניצול; מצב advisory/blocking בשליטת המאשר; אזהרה/חסימה ביצירת הזמנה; בר תקציב לפי role
- notes: תלוי ב-T-011 (תפקידים)

### T-013 · רב-לשוניות לייצור (עברית/תאילנדית/אנגלית)
- status: approval
- owner: either
- priority: P2
- scope: tbd (i18n — בעיקר פרמטרי ייצור/מסכי שטח)
- accept: פרמטרי הייצור ומסכי השטח בשלוש שפות; בחירת שפה למשתמש
- notes: נכנס מהבוט (Meir 10/06). ממתין לאפיון ואישור היקף.

---

## 📥 נכנס (ממתין לסידור)

> הערות שנשלחו דרך בוט הטלגרם נוחתות כאן. הן **לא** משימות todo — מאיר/Claude הופכים אותן לכרטיס מסודר. הביצוע האוטונומי לא נוגע בסקשן הזה.

<!-- INBOX -->
- [ ] צריך שהתוכנה תדע לדבר בשלוש שפות עברית תאילנדית ואנגלית כל הפרמטרים בעיקר של הייצור  _(Meir, 2026-06-10 07:28)_
- [ ] ניסיון  _(Meir, 2026-06-09 20:19)_

---

## ✅ הושלם

> כרטיסים שהושלמו עוברים לכאן עם `commit:`. לא נמחקים.

- T-000 · `START_HERE.md` — מדריך כניסה למצטרף · owner: claude · commit: 0a7649d
- T-003 · BUILD_RULES §8.1 — הצהרת screens+access חובה במודול · owner: claude
- T-009 · שכבת מיתוג White-Label — שם/לוגו/צבע פר-לקוח, customer-editable · owner: claude (+GPT wired server.js)
