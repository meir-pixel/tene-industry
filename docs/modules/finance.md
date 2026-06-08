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
| `routes/finance.js` | margin, KPIs, events |
| `routes/financeLedger.js` | customer ledger and customer_credit exposure |
| `routes/financeCosts.js` | order cost calculation, recalculation, lock, snapshots |
| `routes/financeInvoices.js` | invoice list/create/pay/cancel |
| `routes/financeCredit.js` | credit_accounts and credit_transactions |

---

## גבול אחריות עדכני

- `routes/financeInvoices.js` שייך לחשבוניות בלבד: list/create/pay/cancel.
- `routes/financeCosts.js` שייך לעלויות הזמנה בלבד: calculate/recalculate/lock/snapshots.
- `routes/financeLedger.js` שייך ל-ledger ול-customer_credit.
- `routes/finance.js` שייך למרווחים, KPIs ואירועים פיננסיים.
- `routes/financeCredit.js` שייך ל-credit_accounts/credit_transactions ולחסימת אשראי תפעולית.
- אין להחזיר `/api/invoices*` לתוך `routes/finance.js`.
- אין להחזיר `/api/orders/:id/costs*` לתוך `routes/finance.js`.
- אין להחזיר `/api/customers/:id/ledger` או `/api/customers/:id/credit` לתוך `routes/finance.js`.

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


## כלל מחירון ברזל

- מחיר קנייה מגיע מ-steel_price_history בלבד.
- מחיר מכירה בסיסי מגיע מ-price_list.price_list.
- מחיר לקוח מגיע מ-price_list.price_cust היום, ובעתיד מ-customer_price_list.
- אסור לחשב עלות חומר או רווחיות ממחיר מכירה.

