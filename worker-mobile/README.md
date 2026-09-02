# אפליקציית עובדים – Android ו־iPhone

זו מעטפת Capacitor לאפליקציית הסריקה הקיימת בענן. היא שומרת את כל האכיפה בשרת: משתמש אישי, מכשיר מאושר, והרשאות למסכי הייצור/המחסן. הקישור המודפס נשאר `customer-scan.html`: בלי האפליקציה הוא פותח פורטל לקוח; עם אפליקציית עובדים מותקנת ומקושרת הוא נמסר למסך הסריקה בלבד.

## לפני בנייה

יש להגדיר את הערכים הבאים גם בענן וגם במחשב הבנייה:

```text
BASE_URL=https://כתובת-הענן-האמיתית
WORKER_APP_WEB_URL=https://כתובת-הענן-האמיתית
WORKER_APP_ID=il.co.tene.work
WORKER_ANDROID_PACKAGE_ID=il.co.tene.work
WORKER_ANDROID_CERT_SHA256=AA:BB:...:FF
WORKER_IOS_TEAM_ID=XXXXXXXXXX
WORKER_IOS_BUNDLE_ID=il.co.tene.work
```

`WORKER_ANDROID_CERT_SHA256` הוא טביעת האצבע של מפתח החתימה של גרסת ההפצה, לא של גרסת דיבוג. מזהי Apple חייבים להיות זהים למזהים שבחשבון המפתחים.

## Android

1. מתוך התיקייה הזו: `npm install` ואז `npx cap add android`.
2. הגדר `WORKER_APP_WEB_URL` והרץ `npm run links:android`.
3. הרץ `npm run sync` ובנה חתום ב־Android Studio.
4. רק אחרי שיודעים את טביעת האצבע של החתימה, הגדר אותה בענן ובדוק ש־`/.well-known/assetlinks.json` מחזיר JSON תקין ב־HTTPS.
5. בדוק במכשיר אמיתי באמצעות סריקת QR מודפס. מומלץ לפרסם תחילה ב־Google Play Internal testing.

## iPhone

1. צריך Mac עם Xcode וחשבון Apple Developer. מתוך התיקייה: `npm install` ואז `npx cap add ios`.
2. הגדר `WORKER_APP_WEB_URL` והרץ `npm run links:ios`, אחר כך `npm run sync` ופתח את Xcode.
3. בחר Team ו־Bundle ID תואמים לערכי הענן, וחתום את האפליקציה.
4. ודא ש־`/.well-known/apple-app-site-association` נגיש ב־HTTPS ללא הפניה, ואז בדוק על מכשיר אמיתי דרך TestFlight.

## בדיקת התנהגות

- עובד מאושר עם האפליקציה: המצלמה הרגילה מקבלת את הקישור ומעבירה אותו למסך הסריקה. השרת עדיין מאמת משתמש ומכשיר.
- עובד שטרם אושר: האפליקציה יכולה להיפתח, אך היא נשארת חסומה עד אישור מנהל.
- אדם ללא האפליקציה: אותו קישור ממשיך לפורטל הלקוח.

מערכות ההפעלה קובעות את פתיחת האפליקציה. ב־iPhone סריקה דרך המצלמה או דפדפן עשויה להציג פעולה “פתח באפליקציה” במקום מעבר שקט; זו התנהגות מערכת ולא הרשאה שניתן לעקוף.
