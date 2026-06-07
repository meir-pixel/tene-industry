# מודול: finance — כספים

## מה הוא עושה
חישוב עלויות, ניהול חשבוניות, מרווחים, אשראי לקוחות, ו-KPIs פיננסיים.

---

## קלט — מה הוא מקבל

| מקור | מה | endpoint |
|------|----|----------|
| UI | חישוב עלות להזמנה | `GET /api/orders/:id/cost` |
| UI | יצירת חשבונית | `POST /api/invoices` |
| UI | תשלום חשבונית | `POST /api/invoices/:id/pay` |
| UI | עדכון אשראי לקוח | `PATCH /api/credit/:customerId` |

---

## פלט — מה הוא נותן

| יעד | מה | דרך |
|-----|----|-----|
| UI | עלות מפורטת | `GET /api/orders/:id/cost` |
| UI | חשבוניות | `GET /api/invoices` |
| UI | KPIs פיננסיים | `GET /api/finance/kpis` |
| UI | חשיפת אשראי | `GET /api/customers/:id/credit` |

---

## טבלאות שבבעלותו

| טבלה | תוכן |
|------|------|
| `invoices` | חשבוניות — מספר, לקוח, סכום, סטטוס |
| `invoice_items` | שורות חשבונית |
| `order_costs` | עלות מפורטת לפי הזמנה |
| `cost_snapshots` | snapshot של עלות בזמן נעילה |
| `customer_credit` | יתרת חוב — ספר חשבונות |
| `credit_accounts` | מסגרת אשראי + חסימה |
| `credit_transactions` | תנועות אשראי |
| `financial_events` | לוג אירועים פיננסיים |

---

## חישובים

### עלות הזמנה
```
cost_material  = Σ (weight × steel_price_per_ton / 1000)
cost_labor     = הגדרה ב-settings
cost_overhead  = הגדרה ב-settings
total_cost     = cost_material + cost_labor + cost_overhead
gross_margin   = revenue - total_cost
margin_pct     = (gross_margin / revenue) × 100
```

### שני מערכות אשראי (לא לערבב!)
```
customer_credit    → ספר חשבונות, יתרה פנקסנית
credit_accounts    → מסגרת אשראי, חסימה אוטומטית
```

---

## קבצים

| קובץ | תוכן |
|------|------|
| `routes/finance.js` | כל ה-endpoints |

---

## גבול אחריות עדכני

- `routes/financeInvoices.js` שייך לחשבוניות בלבד: list/create/pay/cancel.
- `routes/finance.js` שייך לעלויות הזמנה, מרווחים, ledger, customer_credit, KPIs ואירועים פיננסיים.
- `routes/financeCredit.js` שייך ל-credit_accounts/credit_transactions ולחסימת אשראי תפעולית.
- אין להחזיר `/api/invoices*` לתוך `routes/finance.js`.

---

## הרשאות

| פעולה | תפקיד מינימלי |
|-------|--------------|
| צפייה KPIs | office |
| עריכת חשבוניות | finance |
| נעילת עלויות | manager |
| גישה מלאה | admin |

---

## סיכונים פתוחים

| # | תיאור | חומרה |
|---|-------|-------|
| — | steel_price_history vs price_list — שני מקורות מחיר | בינונית |
| — | אשראי לא חוסם אוטומטית הזמנות חדשות | גבוהה |
