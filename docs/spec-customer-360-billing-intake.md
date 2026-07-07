# Customer 360, Delivery Billing And Intake Spec

Status: planning
Owner module: customers / portal
Related modules: orders, pricing, finance, intake, delivery documents, priority export
Rule: modular implementation only. No module owns another module's data.

## Goal

Build a customer workbench that prevents customer work from falling between modules:

- WhatsApp / file intake becomes a controlled review queue, not scattered messages.
- Customer card shows the real operational and financial picture.
- Customer price books are visible and usable wherever order, delivery, or billing work happens.
- Delivery certificates can become billable drafts according to the correct customer pricing rules.
- Priority remains an export target now, while IronBend keeps the future accounting path open.

## Non Goals

- Do not move Orders ownership into Customers.
- Do not move Pricing ownership into Customers.
- Do not move Finance ownership into Portal.
- Do not rewrite WhatsApp/OCR intake in this slice.
- Do not make Priority the source of truth for IronBend operational state.

## Module Boundaries

### Customers Module

Owns:

- Customer identity and contacts.
- Customer sites / projects.
- Customer permissions and portal users.
- Customer 360 screen composition.
- Customer-specific workflow preferences.

Does not own:

- Order item creation.
- Price-book calculation.
- Invoice accounting.
- OCR parsing.
- Production state.

### Pricing Module

Owns:

- General price books.
- Customer price books.
- Future site/project price overrides.
- Price resolution trace.
- Manual price override policy.

Must expose:

- Resolve price for customer + site + item.
- Explain pricing source and missing-price state.
- Return immutable pricing snapshot for billing.

### Orders Module

Owns:

- Order creation.
- Order item creation.
- Shape snapshot persistence.
- Order status contract.

Must expose:

- Create order for customer context.
- Read customer order history.
- Return order totals by customer and site.
- Attach intake source references.

### Delivery Documents Module

Owns:

- Delivery certificate generation.
- Delivery certificate lifecycle.
- Supplied quantity / weight evidence.
- Delivery certificate attachments.

Must expose:

- List delivered-but-not-billed certificates.
- Convert delivery certificate to billable payload.
- Track certificate billing status.

### Finance Module

Owns:

- Invoice drafts.
- Invoice status.
- Ledger / customer balance.
- Profitability and margin reporting.
- Payment status.

Must expose:

- Create invoice draft from delivery certificate.
- Combine multiple delivery certificates into one draft.
- Customer open balance.
- Customer profitability summary.
- Unbilled delivery certificates by customer/site.

### Intake Module

Owns:

- WhatsApp / PDF / image intake queue.
- OCR parsing.
- Source identity and duplicate detection.
- Human review of uncertain fields.

Must expose:

- Intake item status.
- Suggested customer/site/order payload.
- Source document references.
- Approved intake payload for Orders.

### Priority Export Module

Owns:

- Export formatting for Priority.
- Export status and retry log.
- External reference IDs.

Does not own:

- Customer ledger state.
- Invoice business status.

## Customer 360 Screen

The customer card must become a workbench. When a user opens a customer, they should see:

- Customer identity: name, tax ID, phone, email, contacts.
- Terms: payment terms, price policy, credit notes.
- Sites/projects: active sites, budget, ordered kg, delivered kg, billed amount.
- Open work: orders in draft/review/production/delivery.
- Unbilled work: delivery certificates that have not become invoice drafts.
- Finance: open balance, invoice drafts, overdue amounts, recent payments.
- Profitability: sales, material cost, labor cost, gross margin.
- Documents: delivery certificates, guarantees, invoices, attached files.
- Portal: active users, field managers, permissions, link status.
- Intake: pending WhatsApp/PDF/image items for this customer.

Actions from this screen:

- New order with customer prefilled.
- New quote with customer/site/price context.
- New site/project.
- Add portal user.
- Open price book.
- Create invoice draft from delivery certificate.
- Attach document.
- Send portal link.
- Export draft to Priority.

## Customer New Order Flow

From customer card:

1. User clicks New Order.
2. Order screen opens with customer already selected.
3. Sites are filtered to that customer.
4. Customer price context is loaded.
5. Payment terms and price visibility are shown.
6. Items are added through Orders / Shape V2.
7. Pricing module calculates quote and stores pricing snapshot.
8. Order remains owned by Orders.

Acceptance:

- No manual reselecting the same customer.
- No order can be created without customer context when launched from customer card.
- Field user with one site does not choose site.
- Finance fields stay hidden from portal-safe contexts.

## Price Resolution Contract

Price resolution order:

1. Site/project-specific price override.
2. Customer price book.
3. General price book with customer discount.
4. General price book.
5. Missing price state.

Returned fields:

- status: priced | missing_price | requires_approval
- pricePerKg
- pricingSource: site | customer | general_discount | general
- priceBookId
- priceBookVersion
- discountPct
- manualOverride
- approvedBy
- snapshotJson

Rule:

- Billing must use pricing snapshot from the billable event, not recalculate silently later.
- If price is missing, delivery can exist but invoice draft must stop for review.

## Delivery Certificate To Billing Flow

1. Order is delivered and delivery certificate is generated.
2. Delivery certificate receives status delivered_not_billed.
3. Finance module lists it under customer unbilled work.
4. User selects one or more certificates.
5. Finance asks Pricing for billable lines.
6. Invoice draft is created.
7. Draft can be edited only under Finance permissions.
8. Draft can be exported to Priority.
9. Delivery certificates become billing_linked.
10. When invoice is finalized, certificates become billed.

Required invoice draft fields:

- customerId
- siteId
- sourceDeliveryCertificateIds
- orderIds
- lineItems
- pricingSnapshotJson per line
- subtotal
- vat
- total
- status
- priorityExportStatus

## WhatsApp / File Intake Flow

1. Message/file enters Intake queue.
2. Intake identifies or suggests customer.
3. Intake identifies site if possible.
4. Intake extracts items, quantities, dates, notes.
5. Unknown fields are flagged.
6. Human reviews and approves.
7. Orders module creates draft order.
8. Source identity is linked to order.

Acceptance:

- Intake never creates production-ready order.
- OCR uncertainty remains visible.
- Duplicate WhatsApp/PDF submissions are detected by source identity.
- Source document remains attached to order/customer.

## Customer Portal Impact

Portal should expose customer-safe pieces only:

- Orders and statuses projected for customer.
- Delivery certificates that belong to customer/site.
- Invoice summaries only for users with finance permission.
- Price book only if configured visible.
- Attachments that are customer-approved.

Portal must not expose:

- Internal cost.
- Margin.
- Machine fields.
- Production notes.
- Warehouse notes.
- Internal finance notes.

## Implementation Slices

### Slice 1: Customer 360 Read Model

Add customer card API read model:

- Customer details.
- Sites/projects summary.
- Orders summary.
- Delivery certificates summary.
- Unbilled summary.
- Finance balance summary.
- Price book status summary.

No write behavior change.

### Slice 2: Customer Context New Order

Fix new order from customer card:

- Open order with customer prefilled.
- Preload customer sites.
- Preload price context.
- Preserve Orders ownership.

### Slice 3: Delivery Certificate Billing Queue

Add finance-owned unbilled queue:

- delivered_not_billed certificates.
- group by customer/site.
- create invoice draft.

### Slice 4: Pricing Snapshot For Billing

Add pricing snapshot:

- line-level price source.
- price book version.
- manual override policy.

### Slice 5: Priority Export From Invoice Draft

Export only approved finance drafts:

- payload preview.
- export status.
- retry log.

### Slice 6: Intake Workbench Integration

Connect intake queue to customer card:

- pending messages/files per customer.
- reviewed source documents.
- create order draft via Orders.

## Data Ownership Matrix

| Data | Owner | Readers | Writers |
| --- | --- | --- | --- |
| Customer details | Customers | Orders, Finance, Portal | Customers |
| Customer sites | Customers | Orders, Portal, Finance | Customers / authorized portal admin |
| Price books | Pricing | Orders, Finance, Portal | Pricing |
| Orders | Orders | Customers, Finance, Portal, Production | Orders |
| Order items | Orders | Production, Finance, Portal projection | Orders |
| Shape snapshot | Orders / Shape contract | Production, Finance | Orders |
| Delivery certificate | Delivery documents | Customers, Finance, Portal | Delivery documents |
| Invoice draft | Finance | Customers, Priority Export | Finance |
| Ledger / balance | Finance | Customers, Portal finance users | Finance |
| Intake source | Intake | Customers, Orders | Intake |
| Priority external ID | Priority Export | Finance, Customers | Priority Export |

## API Sketch

Customer read model:

- GET /api/customers/:id/workbench
- GET /api/customers/:id/sites-summary
- GET /api/customers/:id/unbilled
- GET /api/customers/:id/profitability

Order launch:

- GET /api/customers/:id/order-context
- POST /api/orders with customerId and siteId

Pricing:

- POST /api/pricing/resolve
- GET /api/pricing/customers/:id/active-book

Delivery billing:

- GET /api/finance/customers/:id/unbilled-deliveries
- POST /api/finance/invoice-drafts/from-deliveries

Priority:

- POST /api/finance/invoice-drafts/:id/export/priority

Intake:

- GET /api/intake/customers/:id/pending
- POST /api/intake/:id/approve-order-draft

## UI Principles

- The customer card is an operating screen, not a CRM note page.
- Every action launched from customer card carries customer context.
- Repeated items are tables, not decorative cards.
- Finance data is visually separated from operations.
- Customer-safe and internal views are different projections of the same source data.
- Warnings must be actionable: missing price, unbilled delivery, overdue payment, over-budget site.

## Risks

- Tight coupling if Customers directly writes invoices or orders.
- Wrong billing if pricing is recalculated after price-book changes.
- Duplicate billing if delivery certificate billing status is not locked.
- Customer data leakage if portal uses internal workbench projection.
- Priority mismatch if export result becomes the source of truth.

## Required Guardrails

- Invoice drafts must be idempotent by delivery certificate IDs.
- Price snapshots must be immutable once draft is approved.
- Orders cannot approve themselves to production from portal/intake.
- Portal projections must strip internal finance/cost/machine fields.
- Priority export can fail without changing invoice accounting status.

## First Concrete Build Recommendation

Start with Slice 1 and Slice 2:

1. Customer workbench read model.
2. New order from customer card with customer/site/price context.

This removes the daily pain first without risking finance correctness.
