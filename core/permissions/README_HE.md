# V2 Core/Permissions - הרשאות, תפקידים ויכולות

## מטרת המודול

Core/Permissions הוא מודול ליבה שמחשב האם זהות מאומתת רשאית לקרוא, לערוך או לבצע פעולה. הוא מחבר בין role, capabilities, manifest access, customer overrides, וקיר הביטחון של route guards.

המודול אינו מאמת סיסמה, אינו מנהל משתמשים, ואינו מחליט אילו מודולים ברישיון. הוא מקבל זהות מאומתת מ־Core/Auth ומודולים פעילים מ־Module Registry/Licensing.

## גבולות אחריות

### בתוך המודול

- הגדרת role model פנימי ל־V2.
- מיפוי role אל capabilities.
- חישוב `effectiveAccess(role, screenId)` לפי manifest + override.
- בדיקת `can(role, capability, context)` לפעולות עסקיות.
- תמיכה ב־`requireRole`, `requireAnyRole`, `requireCapability` כ־middleware contracts.
- מניעת העלאת הרשאה דרך override: override יכול רק לצמצם.

### מחוץ למודול

- זהות וסשנים שייכים ל־`core/auth`.
- CRUD משתמשים ותפקיד משתמש שייכים ל־`modules/admin-users`.
- מקור המודולים הפעילים שייך ל־`core/module-registry` + `core/licensing`.
- פעולות עסקיות ספציפיות נשארות במודולים העסקיים.

## Role Model בסיסי

המודול מאמץ את החלטת `docs/role-model-decision.md`:

| Role | שימוש |
|---|---|
| `admin` | ניהול מערכת מלא |
| `manager` | ניהול ותפעול בכיר |
| `office` | הזמנות, לקוחות ותפעול משרד |
| `finance` | כספים, חשבוניות, אשראי ועלויות |
| `production` | ייצור ותור עבודה |
| `quality` | איכות, NCR/CAPA ובקרות |
| `maintenance` | תחזוקה ותקלות |
| `warehouse` | מלאי, חבילות והעמסה |
| `driver` | נהג פנימי בלבד |
| `sales` | מכירות ולקוחות בהרשאה מוגבלת |
| `viewer` | צפייה בלבד |
| `kiosk` | תחנת עבודה מצומצמת |

`customer` ו־`supplier` אינם roles פנימיים. הם identities חיצוניים עם portal-scoped auth.

## קלט

| קלט | מקור |
|---|---|
| `req.auth.userId` / role | Core/Auth |
| module manifests | Module Registry |
| license enabled modules | Licensing |
| access overrides | Settings/Admin Users |
| route policy | route module |
| context ownership | business module service |

## פלט

| פלט | שימוש |
|---|---|
| `effectiveAccess` | UI nav, page guard, admin matrix |
| `allowedCapabilities` | route/service validation |
| `denyReason` | audit/debug/admin UI |
| `permissions.changed` | event/audit |

## API Contract

| Method | Path | מטרה | הרשאה |
|---|---|---|---|
| GET | `/api/permissions/me` | המסכים והיכולות שלי | authenticated |
| GET | `/api/permissions/matrix` | מטריצת role x screen | admin |
| PUT | `/api/permissions/matrix` | שמירת override מצמצם | admin |
| GET | `/api/permissions/roles` | רשימת roles חוקיים ותיאור | admin/manager read |

## חישוב גישה למסכים

```text
effective(role, screen) =
  license allows module
  AND module manifest exposes screen
  AND min(manifest access, customer override)
  AND route/page security floor
```

סולם הגישה: `hidden < read < edit`.

Override מותר רק להוריד גישה. אם manifest או route guard לא מאפשרים `edit`, מסך הניהול מציג את התא כ־disabled ולא מאפשר העלאה.

## Capability Model מוצע

| Domain | דוגמאות capabilities |
|---|---|
| platform | `platform.users.manage`, `platform.settings.manage`, `platform.audit.read` |
| orders | `orders.read`, `orders.create`, `orders.approve`, `orders.status.change` |
| finance | `finance.invoice.create`, `finance.margin.read`, `finance.credit.override` |
| production | `production.card.update`, `production.queue.read`, `production.weight.record` |
| licensing | `licensing.status.read`, `licensing.modules.manage` |

Capabilities הן חוזה פנימי. UI יכול להסתיר לפי screen access, אבל API חייב לבדוק capability/role בצד שרת.

## DB Ownership מוצע

| Entity | בעלים | הערות |
|---|---|---|
| `permission_overrides` | Core/Permissions | role, screenId, access level, updated_by |
| `permission_audit` | Core/Permissions/Audit | שינוי מטריצה, deny רגיש |

רשימת roles ו־capabilities יכולה להתחיל כ־manifest/static contract, ורק override נשמר בטבלה.

## Events

| Event | מתי |
|---|---|
| `permissions.matrix_updated` | admin שינה override |
| `permissions.access_denied` | deny רגיש או חוזר |
| `permissions.role_policy_changed` | שינוי חוזה roles/capabilities בגרסה |

## בדיקות נדרשות בעת מימוש

- override אינו יכול להעלות מ־read ל־edit מעבר לקיר הביטחון.
- מודול לא מורשה לא מופיע ב־`/api/permissions/me`.
- anonymous לא מקבל מטריצה.
- admin בלבד יכול לשנות override.
- customer/supplier לא מתקבלים כ־staff roles.
- כל route חדש משתמש ב־role/capability guard ולא ב־header.

## Definition of Done לאפיון

- מודל roles מוגדר לפי מסמכי ההחלטה הקיימים.
- המסך הניהולי משתמש ב־manifest access + overrides, לא בטבלה ידנית מנותקת.
- API permissions מוגדר.
- DB ownership ל־overrides מוגדר.
- ברור מה לא שייך להרשאות: זהות, CRUD משתמשים ורישוי.