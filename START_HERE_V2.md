# START_HERE_V2 — IronBend V2

זהו מסמך הכניסה לכל מי שעובד על הבנייה מחדש של IronBend.

## החלטה

IronBend V2 נבנה כמערכת חדשה ונקייה. הקוד הישן הוא reference לחוקים עסקיים בלבד, לא בסיס להמשך פיתוח.

## לפני כל עבודה

1. בצע `git pull`.
2. קרא את `docs/PROJECT_TRUTH_HE.md`.
3. קרא את `TASKS_V2.md`.
4. בחר משימה אחת בלבד עם `status: todo` ו־`owner` מתאים.
5. אם scope הקבצים מתנגש עם משימה `in_progress` — דלג.
6. עדכן את המשימה ל־`in_progress` לפני עבודה.
7. אל תכתוב קוד לפני שיש owner, input, output, DB, API, events, screens ו־Definition of Done.

## כללי V2

- לא מוסיפים קוד עסקי ל־`server.js`.
- לא מערבבים מודולים.
- כל מודול חייב manifest.
- כל API חייב auth, validation, service, audit, event.
- כל LIST חייב pagination.
- כל status חייב transitions.
- כל מסך חייב אפיון לפני קוד.
- כל מודול נבדק בבדיקות ממוקדות; full test רק בסוף מודול/ספרינט.

## קבצי אמת

- `docs/PROJECT_TRUTH_HE.md` — מסמך האמת הראשי.
- `TASKS_V2.md` — לוח המשימות היחיד של V2.
- `START_HERE_V2.md` — מסמך הכניסה הזה.

## תפקידים

- מאיר: בעל מוצר והכרעות עסקיות.
- Codex/GPT: מנהל טכני/אדריכלי, פירוק משימות, ביקורת והובלת ביצוע.
- Claude/סוכנים נוספים: מקבלים משימה מוגדרת בלבד מתוך `TASKS_V2.md`.

## אם משהו לא ברור

לא מנחשים. עוצרים, כותבים blocker במשימה, ומבקשים הכרעה.
