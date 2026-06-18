# מודול V2: Admin Users - ניהול משתמשים ותפקידים

## מטרת המודול

Admin Users הוא מודול מוצר-ליבה לניהול משתמשי המערכת: יצירה, עריכה, נעילה, איפוס סיסמה, שיוך role, צפייה בסשנים פעילים, והפעלת מדיניות בסיסית למשתמשים.

המודול אינו מאמת סיסמאות בעצמו ואינו מחשב הרשאות בפועל. הוא מנהל את רשומת המשתמש וה־role, ואז Core/Auth ו־Core/Permissions משתמשים במידע דרך services מוגדרים.

## משתמשים

| משתמש | הרשאות עיקריות |
|---|---|
| מנהל מערכת | יצירה/עריכה/נעילה/איפוס סיסמה/ניהול roles |
| מנהל | צפייה במשתמשים ונעילת משתמשים לפי policy עתידי |
| משתמש רגיל | צפייה בפרופיל וסשנים של עצמו בלבד |

## גבולות אחריות

### בתוך המודול

- יצירת משתמש פנימי.
- עריכת שם, אימייל, טלפון, role, סטטוס ופרטי עובד בסיסיים.
- נעילה/שחרור משתמש.
- איפוס סיסמה או הזמנת משתמש להגדיר סיסמה.
- הצגת סשנים פעילים דרך Core/Auth.
- audit לכל שינוי משתמש.
- מניעת מחיקת משתמש עם היסטוריה; משתמשים עוברים ל־`disabled`.

### מחוץ למודול

- login/logout/refresh שייכים ל־`core/auth`.
- חישוב הרשאות ומטריצה שייך ל־`core/permissions`.
- רישוי max users שייך ל־`core/licensing`; כאן מוצגת אזהרה בלבד.
- customer/supplier portal identities אינם משתמשים פנימיים רגילים.

## קלט

| קלט | מקור | הערות |
|---|---|---|
| user profile | Admin UI | שם, אימייל, טלפון, role |
| password reset request | Admin UI / self service future | לא מחזיר סיסמה קיימת |
| role assignment | Admin UI | role מתוך רשימה חוקית בלבד |
| status change | Admin UI | active/disabled/locked |

## פלט

| פלט | יעד |
|---|---|
| user profile | Auth/Permissions/UI |
| password hash update | Auth lookup |
| `admin_users.user_created` | Audit/Event bus |
| `admin_users.user_updated` | Audit/Event bus |
| `admin_users.user_disabled` | Audit/Event bus |
| `admin_users.password_reset_requested` | Audit/Event bus |

## DB Ownership מוצע

| Entity | בעלים | הערות |
|---|---|---|
| `users` | Admin Users | פרופיל, role, סטטוס, password hash reference |
| `user_profile_history` | Admin Users | שינויי role/status/contact |
| `user_invites` | Admin Users/Auth | הזמנות/איפוס סיסמה עם expiry |

`auth_sessions` אינו בבעלות Admin Users; הוא שייך ל־Core/Auth.

## API Contract

| Method | Path | מטרה | הרשאה |
|---|---|---|---|
| GET | `/api/admin/users` | רשימת משתמשים עם pagination | admin |
| POST | `/api/admin/users` | יצירת משתמש | admin |
| GET | `/api/admin/users/:id` | פרטי משתמש | admin או self מוגבל |
| PATCH | `/api/admin/users/:id` | עריכת פרופיל/role/status | admin |
| POST | `/api/admin/users/:id/disable` | נעילת משתמש | admin |
| POST | `/api/admin/users/:id/password-reset` | יצירת איפוס סיסמה | admin |
| GET | `/api/admin/users/:id/sessions` | סשנים פעילים | admin או self |
| POST | `/api/admin/users/:id/sessions/revoke` | ביטול סשנים | admin או self |

כל LIST חייב pagination. כל כתיבה מחייבת audit.

## מסכים

| מסך | מטרה | בעלות |
|---|---|---|
| `/admin/users.html` | רשימת משתמשים, חיפוש, סטטוס ופעולות מהירות | Admin Users |
| `/admin/users/:id` future | פרטי משתמש, role, audit וסשנים | Admin Users |
| `/profile.html` future | פרופיל וסשנים של המשתמש עצמו | Admin Users/Auth |

לפני בניית UI אמיתי נדרש mockup תחת `docs/mockups/` ואישור ויזואלי.

## Permissions

| פעולה | תפקידים |
|---|---|
| צפייה ברשימת משתמשים | admin |
| יצירה/עריכת משתמש | admin |
| שינוי role | admin |
| נעילה/שחרור משתמש | admin |
| צפייה בפרופיל עצמי | authenticated self |
| ביטול סשנים עצמיים | authenticated self |

## קשרים למודולים אחרים

| צורך | מודול יעד | סיבה |
|---|---|---|
| password verification/session revoke | Core/Auth | auth owns sessions |
| role list/capabilities | Core/Permissions | ולידציה של role |
| max users warning | Core/Licensing future | אזהרת חריגה ברישוי |
| audit append | Core/Audit future | תיעוד שינויים |

## Events

| Event | מתי נוצר |
|---|---|
| `admin_users.user_created` | משתמש חדש נוצר |
| `admin_users.user_updated` | פרופיל או role עודכן |
| `admin_users.user_disabled` | משתמש ננעל/בוטל |
| `admin_users.user_enabled` | משתמש הוחזר לפעילות |
| `admin_users.password_reset_requested` | נוצר איפוס סיסמה |
| `admin_users.sessions_revoked` | בוטלו סשנים |

## סיכונים פתוחים

- החלטה אם `manager` יקבל יכולת read-only לרשימת משתמשים עדיין פתוחה.
- מנגנון kiosk/PIN דורש אפיון נפרד לפני מימוש.
- max users ברישוי הוא אזהרה רכה; נדרשת החלטת UI איך מציגים חריגה בלי לחסום מפעל באמצע יום.
- self-service password reset תלוי בהגדרת email/SMS adapter עתידית.

## Definition of Done לאפיון

- user ownership מוגדר ולא מעורבב עם Auth sessions.
- API users מוגדר עם guards.
- events, permissions, screens ו־DB ownership מוגדרים.
- ברור ש־customer/supplier portal identities אינם משתמשים פנימיים רגילים.
- אין קוד V2 חדש לפני mockup למסכים ולפני מימוש Core/Auth/Core/Permissions.