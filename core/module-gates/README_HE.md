# V2 Core/Module Gates - שערי מודולים לפי רישוי

## מטרת המודול

Core/Module Gates אחראי להחליט האם מודול מוצר פתוח ללקוח לפני כניסה ל־routes או למסכים.

המודול אינו מנהל הרשאות role, אינו טוען מודולים, ואינו מחליט החלטות עסקיות. הוא מקבל תשובה מ־Core/Licensing לגבי entitlement ומחזיר החלטת gate ברורה.

## גבולות אחריות

### בתוך המודול

- `checkModule(moduleId, context)` מחזיר allowed/denied עם reason.
- `requireModule(moduleId)` מספק middleware ל־routes.
- מודולי core אינם נחסמים בטעות.
- מצב dev/free/test פתוח כדי לא לחסום פיתוח או מפעל ללא רישוי פעיל.
- production נאכף לפי `isModuleEnabled`.

### מחוץ למודול

- `core/licensing` owns license keys, entitlements, max users ו־free/production state.
- `core/module-registry` owns manifests ורשימת מודולים קיימים.
- `core/permissions` owns role/capability checks.
- מודולים עסקיים owns את ה־routes והנתונים שלהם.

## קלט

| קלט | מקור |
|---|---|
| `moduleId` | route/module manifest |
| `isModuleEnabled(moduleId, context)` | Core/Licensing |
| `licenseMode` | runtime/customer context |
| `coreModules` | platform config |

## פלט

| פלט | משמעות |
|---|---|
| `allowed: true, reason: core_module` | מודול ליבה, לא ננעל |
| `allowed: true, reason: open_mode` | dev/free/test פתוח |
| `allowed: true, reason: licensed` | entitlement קיים |
| `allowed: false, reason: module_not_licensed` | חסום לפי רישוי |

## כללי אבטחה

- Gate מודול אינו מחליף `requireRole` או `requireAnyRole`.
- Gate רישוי חייב לרוץ לפני route business logic.
- מודול core כמו Auth/Permissions/Admin Users לא יכול להיחסם עקב רישוי לקוח.
- production לא מקבל fallback פתוח אלא אם `licenseMode` מוגדר במפורש כ־free/dev/test.

## Definition of Done

- קיים service עצמאי ללא תלות ב־server.js הישן.
- קיימת בדיקה למודול ליבה שאינו נחסם.
- קיימת בדיקה למצב free/dev/test פתוח.
- קיימת בדיקה למודול מוצר חסום בפרודקשן.
- קיימת בדיקת middleware שמחזיר 403 בלי להריץ route.
