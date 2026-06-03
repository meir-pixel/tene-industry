# IronBend - כללי עבודה

לפני שנוגעים בקוד, חובה לקרוא:
[docs/BUILD_RULES_HE.md](docs/BUILD_RULES_HE.md)

המסמך הזה הוא חוק עבודה, לא המלצה.

## קיצור דרך

- הקוד הפעיל: `C:\Users\meir-tene\Documents\GitHub\tene-industry`
- אין להוסיף routes ל-`server.js`; רק לרוקן אותו ולחבר מודולים.
- כל route חדש: `routes/<module>.js`, factory function, `required()` guard.
- כל שינוי: אפיון -> דעה ארכיטקטונית -> ביצוע -> בדיקות.
- לא מבצעים שינוי שלא סוכם גם אם הוא נראה מובן מאליו.
- אם הוסף route: לעדכן `test/module-governance.test.js`.
- בדיקה מלאה: `npm test`.

## קבצי חובה

- `docs/module-inventory.md`
- `docs/api-registry.md`
- `docs/api-route-permission-map.md`
- `docs/change-control-protocol.md`
- `docs/BUILD_RULES_HE.md`
