# Admin / System / Licensing Boundaries

מסמך זה מגדיר את תחום האחריות של מודולי השליטה ב-IronBend V2.
המטרה היא למנוע מצב שבו מסך ניהול אחד הופך לבעלות על כל המערכת.

## העיקרון

Admin/System/Licensing owns control, access, configuration and visibility.
It does not own business entities; it governs how modules expose and protect them.

במילים פשוטות:

- Admin יכול להציג ולנהל מדיניות.
- System יכול למדוד, להתריע ולהגדיר תשתית.
- Licensing יכול לפתוח ולסגור מודולים לפי רישיון.
- אף אחד מהם לא הופך לבעלים של הזמנות, מחירונים, אשראי, ייצור, מלאי או פורטל לקוח.

מסך ניהול יכול לתזמר כמה מודולים, אבל הבעלות נשארת אצל המודול העסקי.

## חלוקת מודולים בתחום

| מודול | בעלות | לא בבעלות |
|---|---|---|
| `core/auth` | זהות, login, logout, refresh, JWT, sessions, WebSocket auth | CRUD משתמשים, הרשאות עסקיות, רישוי |
| `core/permissions` | roles, capabilities, route guards, screen access, permission overrides | אימות סיסמה, משתמשים, החלטות עסקיות |
| `modules/admin-users` | משתמשים פנימיים, role assignment, נעילה, איפוס סיסמה, פרופיל עובד | לקוחות/ספקים חיצוניים, portal identities |
| `core/licensing` | license key, entitlements, max users warning, free/dev/production mode | קטלוג עסקי ידני במסכים, החלטות מחיר |
| `core/module-registry` | manifests, ownership map, consumes/produces, active module list | לוגיקה עסקית של מודולים |
| `core/module-gates` | `requireModule(moduleId)`, חסימת route/module לפי רישיון | הרשאות role בתוך route |
| `modules/system-settings` | הגדרות מערכת, integration status, feature flags, safe runtime config | secrets plaintext, חישובים עסקיים |
| `modules/system-health` | DB health, backup status, queues, schedulers, license health, integration health | תיקון נתונים עסקיים |
| `modules/admin-audit` | audit log, שינויי admin, שינויי הרשאות, שינויי רישוי והגדרות | event history עסקי שמודול אחר owns |

## כלל בעלות למסכי Admin

מסך Admin אינו הוכחה לבעלות.

אם במסך Admin מופיע נתון של מודול אחר:

1. הנתון נשאר בבעלות המודול העסקי.
2. Admin קורא דרך API/service/event מוגדר.
3. Admin יכול לשנות רק policy או configuration שהוא owns.
4. שינוי entity עסקי חייב לעבור דרך API של המודול הבעלים.
5. אם אין API כזה, לא כותבים ישירות לטבלה. פותחים משימת אפיון למודול הבעלים.

## דוגמאות גבול

### ערבות ותנאי תשלום

Flow משתמש: לקוח מעלה ערבות, משרד בודק, אשראי מאושר, הזמנה יכולה להתקדם.

חלוקת בעלות:

| חלק | בעלים |
|---|---|
| העלאת מסמך מהלקוח | Portal או Payment Terms לפי החלטת אפיון |
| חוזה תנאי תשלום וערבות | `modules/payment-terms` |
| החלטה אם מותר לעבוד מול לקוח | `modules/credit` |
| התקדמות הזמנה | `modules/orders` |
| הצגת מצב במסך ניהול | Admin/System כ-view בלבד |
| מי רשאי לאשר | `core/permissions` |
| האם מודול פתוח ללקוח | `core/licensing` |

Admin לא owns את הערבות. Admin רק מאפשר למנהל לראות, לאשר policy, או להגיע למסך המודול הבעלים.

### מחירונים

Pricing owns מחיר מכירה, מחיר לקוח ו-price snapshot.
Costing owns עלויות.
Finance owns חשבוניות ודוחות כספיים.

Admin יכול להגדיר מי רואה את מסכי המחירונים, או האם מודול Pricing פעיל ברישיון.
Admin לא owns את שורות המחירון ולא כותב אליהן ישירות.

### מודולים פעילים

Licensing קובע אם מודול מותר לפי רישיון.
Module Registry יודע אילו מודולים קיימים ומה הם מצהירים.
Permissions קובע מה role יכול לראות/לערוך בתוך מודול פעיל.

אף אחד מהם לא מחליף את route guard של המודול העסקי.

## API ownership rules

| פעולה | איפה צריכה לחיות |
|---|---|
| login/logout/refresh | `core/auth` |
| list/create/disable internal user | `modules/admin-users` |
| change role/screen access | `core/permissions` + `modules/admin-users` |
| list licensed modules | `core/licensing` + `core/module-registry` |
| enable/disable module by license | `core/licensing` |
| show system health | `modules/system-health` |
| update integration setting | `modules/system-settings` |
| approve customer credit | `modules/credit`, not Admin |
| approve customer guarantee | `modules/payment-terms`, not Admin |
| edit price book | `modules/pricing`, not Admin |
| change order status | `modules/orders`, not Admin |

## DB ownership rules

Admin/System/Licensing may own only platform-control tables:

- auth/session tables.
- users and user profile tables.
- permission overrides.
- license cache/status tables.
- module registry snapshots if needed.
- system settings.
- system health snapshots.
- admin audit entries.

They must not own:

- orders.
- order items.
- customers as business entity.
- price books.
- invoices.
- credit exposure.
- guarantees/payment terms as customer business contract.
- inventory.
- production cards.
- logistics entities.

If a platform screen needs to show those, it uses read APIs from the owner module.

## Events

Admin/System/Licensing may produce platform events:

- `auth.login_succeeded`
- `auth.login_failed`
- `permissions.matrix_updated`
- `admin_users.user_created`
- `admin_users.user_disabled`
- `licensing.entitlements_updated`
- `module_registry.module_loaded`
- `system.health_changed`
- `system.setting_changed`
- `admin_audit.entry_created`

Business events remain with business modules:

- `orders.status_changed`
- `pricing.price_book_updated`
- `credit.customer_blocked`
- `payment_terms.guarantee_approved`
- `production.card_completed`

## Definition of Done לכל משימת Admin/System/Licensing

משימה בתחום הזה מוכנה רק אם:

- ברור איזה מודול בתחום owns את השינוי.
- ברור אילו מודולים עסקיים רק מוצגים או נצרכים.
- אין כתיבה ישירה לטבלאות עסקיות.
- יש manifest או README שמצהיר owns/consumes/produces.
- יש API contract אם נחשף endpoint.
- יש permission contract.
- יש audit/event על שינויי platform משמעותיים.
- יש בדיקה שמונעת עקיפת module ownership.
- אם יש מסך Admin, הוא מוגדר כ-control/view ולא כבעלות עסקית.

## כלל עצירה

אם במהלך עבודה בתחום Admin/System/Licensing מתגלה צורך לשנות entity עסקי,
עוצרים ומנסחים חוזה מול המודול הבעלים. לא ממשיכים דרך Admin כקיצור דרך.
