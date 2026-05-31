# IronBend — Production Hardening Handoff Summary

**תאריך:** מאי 2026  
**מצב:** ממתין לאישור בעל המפעל — אין לכתוב קוד לפני אישור מסמכים

---

## 1. מסמכי אישור — סדר ביצוע נדרש

> ⛔ כל Sprint מחייב אישור מסמך לפני Implementation

| # | מסמך | קובץ | עדיפות | תלות |
|---|------|------|--------|------|
| 1a | Security Auth Core | `SECURITY_DESIGN_V1.docx` | CRITICAL | ראשון בכל מקרה |
| 1b | Security Hardening | `SECURITY_DESIGN_V1.docx` (חלק ב) | CRITICAL | לאחר 1a |
| 2 | Scalability | `SCALABILITY_DESIGN_V1.docx` | HIGH | לאחר 1a |
| 3 | Code Refactor | `CODE_REFACTOR_PLAN_V1.docx` | HIGH | לאחר 2 |
| 4 | Domain Cleanup | `DOMAIN_CLEANUP_REPORT_V1.docx` | MEDIUM | לאחר 3 |
| 5 | State Machines | `STATE_MACHINE_SPEC_V1.docx` | MEDIUM | עצמאי |
| — | Production Readiness | `PRODUCTION_READINESS_REPORT_V1.docx` | — | לאחר הכל |

כל המסמכים נמצאים ב: `C:\Users\meir-tene\Downloads\`  
הדוח הסופי `PRODUCTION_READINESS_REPORT_V1.docx` — מעריך 41% מוכנות, 8 blockers, 7 שבועות לייצור.

---

## 2. Sprint 1 — פירוט (SECURITY_DESIGN_V1)

### Sprint 1a — Auth Core + Migration (Days 1–5, ~15–21 שעות)
- [ ] **Day 1**: `npm install jsonwebtoken bcryptjs express-rate-limit helmet` + ENV setup + `CREATE TABLE refresh_tokens`
- [ ] **Day 2**: `ALTER TABLE users ADD COLUMN pin_hash TEXT` + Migration script (hash all PINs) + lockout fields
- [ ] **Day 3**: `/api/auth/login`, `/api/auth/logout`, `/api/auth/refresh` endpoints  
- [ ] **Day 4**: `requireAuth()` + `requireRole()` rewrite (JWT, לא x-user-role header) + protect all endpoints
- [ ] **Day 5**: Frontend token management + auto-refresh interceptor + integration tests

**Gate 1a**: כל roles מתחברים בהצלחה + JWT enforced → אישור להמשיך

### Sprint 1b — WebSocket + Helmet + Hardening (Days 6–8, ~5–8 שעות)
- [ ] **Day 6**: WebSocket upgrade auth (verify JWT on `upgrade` event)
- [ ] **Day 7**: `helmet()` + CORS + Rate limits (login: 5/15min, API: 200/15min, admin: 30/15min)
- [ ] **Day 8**: Full checklist + staging deploy + basic penetration test

**Gate 1b**: Rate limit tests pass + WS auth verified + Helmet headers OK

---

## 3. סיכון קריטי — customer_credit (תיקון ניתוח)

> ⚠️ **שגיאה בניתוח ראשוני תוקנה ב-DOMAIN_CLEANUP_REPORT_V1**

`customer_credit` (server.js שורה 5136) היא טבלה **פעילה לחלוטין**, לא orphan:
- `GET /api/customers/:id/ledger` — קורא, כותב, auto-creates (שורות 5332, 5335, 5337, 5363)
- `PATCH /api/customers/:id/credit` — כותב (שורה 5382)

**מה אסור לעשות:**
- ❌ אסור `DROP TABLE customer_credit` ללא migration מלאה
- ❌ אסור לשנות schema ללא אישור Sprint 4

**מה נכון:**
- `credit_accounts` = ניהול חסימה + credit_transactions (endpoints: `/api/credit/*`)
- `customer_credit` = ספר חשבון לקוח + analytics (endpoint: `/api/customers/:id/ledger`)
- שני השדות `credit_limit` ו-`payment_terms` קיימים בשתי הטבלאות — **עלולים לצאת מסינכרון**

---

## 4. Rollback Plan — Sprint 1a

**תנאי rollback:** login failures > 5% בשעה הראשונה לאחר deploy

```bash
# 1. Revert code
git revert <security-sprint-1a-hash>
git push origin main

# 2. Verify pin field still exists (do NOT run step 5/nullify before 48h)
sqlite3 ironbend.db "SELECT id, pin, pin_hash FROM users LIMIT 3;"

# 3. If pin is already NULL (step 5 was run prematurely): restore from backup
cp ironbend.db.bak.TIMESTAMP ironbend.db

# 4. Drop refresh_tokens (no data loss — table was empty at rollback point)
sqlite3 ironbend.db "DROP TABLE IF EXISTS refresh_tokens;"

# 5. Verify old login still works
curl -X POST /api/users/login -d '{"user_id":1,"pin":"1234"}'
```

**⛔ חוק ברזל:** שלב nullify של `pin` (SET pin = NULL) — **רק לאחר 48 שעות** של פעולה תקינה מאומתת. תמיד גיבוי לפני.

---

## 5. endpoint DB Upload/Download

**קיים ב-server.js שורות 5468–5497:**

```
GET  /api/admin/database/download  → מוריד ironbend.db (admin only)
POST /api/admin/database/upload    → שחזור DB מקובץ (admin only, BUG-20)
```

ה-endpoint קיים. BUG-20 בcomments מציין שצריך לטפל ב-edge cases (close+reopen DB).

---

## 6. החלטות פתוחות — נדרשת החלטה מבעל המפעל

| # | שאלה | אפשרות A | אפשרות B | דחיפות |
|---|------|----------|----------|--------|
| D1 | מי מנהל refresh_token sessions? | Admin UI לניהול sessions פעילים | אוטומטי בלבד | לפני Sprint 1a |
| D2 | כמה ימי token validity? | 7 ימים (current design) | 30 ימים (נוחות) | לפני Sprint 1a |
| D3 | Portal לקוחות — JWT או sessions נפרד? | JWT unified (כרגע) | Sessions נפרד + longer expiry | לפני Sprint 1a |
| D4 | customer_credit vs credit_accounts — מי authoritative ל-credit_limit? | credit_accounts | customer_credit | לפני Sprint 4 |
| D5 | production_events — להוסיף reader API או להסיר? | GET /api/production-events endpoint | DROP TABLE | לפני Sprint 4 |
| D6 | NCR/CAPA state machines — endpoints חדשים? | כן (Sprint 5) | stub בלבד | לפני Sprint 5 |

---

## 7. קבצים שנוצרו בסשן זה (documentation only)

```
C:\Users\meir-tene\Downloads\
├── FINAL_ARCHITECTURE_AUDIT.docx     — 38 findings (3 CRITICAL, 13 HIGH)
├── SECURITY_DESIGN_V1.docx           — Sprint 1a+1b design (28 KB)
├── SCALABILITY_DESIGN_V1.docx        — Sprint 2 design (21 KB)
├── CODE_REFACTOR_PLAN_V1.docx        — Sprint 3 design (19 KB)
├── DOMAIN_CLEANUP_REPORT_V1.docx     — Sprint 4 analysis (20 KB) ← תוקן
├── STATE_MACHINE_SPEC_V1.docx        — Sprint 5 spec (28 KB)
└── PRODUCTION_READINESS_REPORT_V1.docx — ציון 41%, 8 blockers (21 KB)

C:\Users\meir-tene\ironbend\
├── HANDOFF_SUMMARY.md                — מסמך זה
├── gen-security.js                   — מחולל SECURITY_DESIGN_V1
├── gen-scalability.js                — מחולל SCALABILITY_DESIGN_V1
├── gen-refactor.js                   — מחולל CODE_REFACTOR_PLAN_V1
├── gen-domain-cleanup.js             — מחולל DOMAIN_CLEANUP_REPORT_V1
├── gen-state-machines.js             — מחולל STATE_MACHINE_SPEC_V1
└── gen-production-readiness.js       — מחולל PRODUCTION_READINESS_REPORT_V1
```

---

## 8. Constraints שלא ישתנו (Production Hardening Phase)

- ❌ אסור להוסיף: פיצ'רים חדשים, מסכים חדשים, AI, מודולים חדשים, טבלאות חדשות (מעבר למה שמוגדר במסמכי Sprint), Integrations חדשות
- ✅ מותר: תיקון bugs, security fixes, refactor קיים, performance של קיים
- 📋 כל Sprint מחייב: קרא מסמך → קבל אישור → בצע implementation → בצע tests → commit

---

*נוצר על-ידי Claude | IronBend Production Hardening | מאי 2026*
