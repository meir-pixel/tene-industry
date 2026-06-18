# V2 Core/Auth - זהות וסשנים

## מטרת המודול

Core/Auth הוא מודול ליבה שאחראי על זהות, כניסה, סשנים, JWT, refresh tokens, אימות WebSocket, והזרקת `req.auth` לכל בקשה מאומתת.

המודול אינו מנהל מסכי הרשאות, אינו מחליט איזה מודולים נרכשו, ואינו מחזיק לוגיקה עסקית של הזמנות, ייצור, כספים או לקוחות.

## גבולות אחריות

### בתוך המודול

- אימות שם משתמש וסיסמה או PIN לפי policy מוגדר.
- יצירת access token קצר חיים ו-refresh token ארוך חיים.
- ולידציה של JWT מול secret יציב מה־env.
- החזרת זהות מאומתת ל־`req.auth`.
- ניתוק, רענון סשן, ביטול refresh token, וזיהוי סשן שפג תוקף.
- אימות WebSocket כבר משלב החיבור.
- audit על login/logout/refresh failure/permission-sensitive auth failures.

### מחוץ למודול

- CRUD משתמשים ופרופילים שייך ל־`modules/admin-users`.
- חישוב הרשאות תפקידים, מסכים ופעולות שייך ל־`core/permissions`.
- רישוי מודולים שייך ל־`core/licensing`.
- ניהול מודולים פעילים שייך ל־`core/module-registry` + licensing gate.

## קלט

| קלט | מקור | הערות |
|---|---|---|
| username/password | Login UI | סיסמה נשמרת כ־hash בלבד |
| refresh token | Client session | נשמר hashed בצד שרת |
| WebSocket token | UI realtime | חייב לעבור אותה ולידציה כמו HTTP |
| environment | Server config | `JWT_SECRET` חובה בפרודקשן |

## פלט

| פלט | יעד |
|---|---|
| access token | UI/API client |
| refresh token | UI/API client |
| `req.auth` | route modules |
| `auth.login_succeeded` | Audit/Event bus |
| `auth.login_failed` | Audit/Event bus |
| `auth.session_refreshed` | Audit/Event bus |
| `auth.session_revoked` | Audit/Event bus |

## API Contract

| Method | Path | מטרה | הרשאה |
|---|---|---|---|
| POST | `/api/auth/login` | כניסה וקבלת tokens | public עם rate limit |
| POST | `/api/auth/refresh` | רענון access token | refresh token תקף |
| POST | `/api/auth/logout` | ביטול refresh token נוכחי | authenticated |
| POST | `/api/auth/logout-all` | ביטול כל הסשנים של המשתמש | authenticated |
| GET | `/api/auth/me` | פרטי זהות וסשן נוכחי | authenticated |

## DB Ownership מוצע

| Entity | בעלים | הערות |
|---|---|---|
| `auth_sessions` | Core/Auth | refresh token hash, user id, expiry, revoked_at |
| `auth_login_attempts` | Core/Auth | rate limit, audit, lockout soft policy |

המודול קורא משתמשים דרך service של `admin-users`; הוא לא מנהל פרופיל משתמש בעצמו.

## לוגיקה מחייבת

- role לא מגיע מ־header שניתן לזיוף.
- `AUTH_BYPASS` מותר רק בסביבת dev/test מפורשת, לעולם לא בפרודקשן.
- JWT secret הוא חובה בפרודקשן; fallback זמני גורם לכשל startup.
- refresh token נשמר hashed, לא plaintext.
- access token קצר חיים; הרשאות עדכניות נבדקות דרך `core/permissions` כשצריך.
- WebSocket משתמש באותו token model של HTTP.

## קשרים למודולים אחרים

| צורך | מודול יעד | סיבה |
|---|---|---|
| user lookup/password hash | `modules/admin-users` | אימות credentials |
| role/capability evaluation | `core/permissions` | החלטת גישה אחרי זהות |
| audit append | `core/audit` future | עקבות אבטחה |
| session events | `core/events` future | realtime/admin monitoring |

## בדיקות נדרשות בעת מימוש

- login success/failure.
- refresh token תקף, פג, מבוטל ומזויף.
- anonymous protected route מחזיר 401.
- role forged in header אינו משפיע.
- production בלי `JWT_SECRET` נכשל ברור.
- WebSocket ללא token תקף נדחה.

## Definition of Done לאפיון

- גבול ברור בין Auth, Permissions ו־Admin Users.
- API login/logout/refresh/me מוגדר.
- DB ownership לסשנים מוגדר.
- אין תלות ב־server.js הישן או ב־headers מזויפים.
- WebSocket auth מתוכנן מהיום הראשון.