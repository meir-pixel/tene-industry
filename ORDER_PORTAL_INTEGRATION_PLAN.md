# Order Portal Integration Plan

Generated: 2026-06-24

Scope: define how Customer Portal will use the Orders Contract without directly writing `orders`, `pallets`, or `items`.

This is documentation only. No code, UI, route, or database schema changes are included in this plan.

## Goal

Customer Portal should be an authenticated customer-facing wrapper around Orders. It should collect customer intent, validate customer/site permissions, and call an Orders-owned API/service. It must not become a second Orders implementation.

The target boundary:

```text
Customer Portal
-> validates portal identity, customer, site, portal permissions
-> builds customer-safe order command
-> calls Orders Contract
-> receives order draft/submission result
-> shows customer-safe projection only
```

Orders owns:

```text
order lifecycle, order number, order rows, pallet rows, item rows, item quantities,
shape snapshots, pricing snapshots, status transitions, production approval boundary
```

## Non-Goals

- Do not redesign the Customer Portal UI in this plan.
- Do not change database schema in this plan.
- Do not implement code in this plan.
- Do not decide final Finance/Pricing snapshot schema in this plan.
- Do not move production approval into the portal.

## Current Problem Summary

Current `routes/portal.js` directly inserts into:

- `orders`
- `pallets`
- `items`

It also lets customer approval endpoints promote the order to:

```text
אושרה – ממתין לייצור
```

That creates two problems:

1. Portal duplicates Orders logic and can drift from Orders rules.
2. A customer action can become production approval, which should be an internal Orders/office/finance decision.

## Target Ownership Model

| Responsibility | Owner | Portal Role |
| --- | --- | --- |
| Portal token / OTP / customer session | Customer Portal | Owns fully. |
| Customer site authorization | Customer Portal | Owns validation before calling Orders. |
| Customer can create order permission | Customer Portal | Owns validation. |
| Order number | Orders | Portal receives result only. |
| Order row write | Orders | Portal does not write. |
| Pallet row write | Orders | Portal does not write. |
| Order Item row write | Orders | Portal does not write. |
| Item quantity | Orders / Order Item Contract | Portal sends requested quantity as command input. |
| Shape snapshot | Orders + Steel/Rebar Contract | Portal sends shape input; Orders stores immutable snapshot. |
| Pricing snapshot | Pricing + Orders | Portal may request quote; Orders persists approved/submitted pricing snapshot. |
| Customer-visible status | Orders projection for Portal | Portal displays mapped labels only. |
| Production approval | Internal Orders flow | Portal cannot perform this transition. |
| Machine assignment | Production / Orders internal derivation | Portal does not decide or expose by default. |
| Warehouse/package state | Warehouse/Logistics | Portal sees only customer-safe delivery/document state. |

## 1. Customer Draft Flow

### Purpose

Allow a portal user to build and save a customer draft without creating a production-ready order.

### Actors

- Customer portal user with `can_create_orders`.
- Optional single-site field manager with one authorized `site_id`.
- Customer finance/admin user with wider visibility.

### Flow

```text
1. Portal user opens new order.
2. Portal resolves allowed sites.
3. If user has one site, portal binds that site automatically.
4. If user has multiple sites, portal requires site selection from authorized sites only.
5. Portal collects delivery request, customer notes, and item inputs.
6. Portal calls Orders-owned draft API/service.
7. Orders validates item command, quantity, shape input, and quote context.
8. Orders creates or stores a draft representation according to the selected migration phase.
9. Portal receives customer-safe draft response.
```

### Draft Status

Target canonical status:

```text
טיוטת לקוח
```

If adding a new status is deferred, use a compatibility label externally while internal status remains:

```text
ממתינה לאישור לקוח
```

But the compatibility status must not mean "ready for production".

### Draft Rules

- Draft is editable by authorized customer user until submitted.
- Draft does not trigger production.
- Draft does not allocate machine.
- Draft does not expose machine or production notes.
- Draft may calculate customer-visible quote only if the user can view prices.
- Draft must keep quantity on the Order Item command, outside shape payload.

## 2. Customer Submit Flow

### Purpose

Customer confirms the draft details and sends the order to internal review. This is not production approval.

### Flow

```text
1. Customer opens draft.
2. Customer confirms delivery/site/items/customer notes.
3. Portal calls customer submit endpoint.
4. Orders changes state from customer draft to submitted/internal review.
5. Orders emits customer-submitted event.
6. Internal users see the order in review queue.
7. Portal displays "נשלחה לבדיקה" or equivalent customer-safe status.
```

### Submit Status

Preferred canonical status:

```text
נשלחה לבדיקה
```

Alternative if status expansion is deferred:

```text
ממתינה לאישור
```

But customer-facing projection should say:

```text
נשלחה לבדיקה
```

### Submit Rules

- Customer submit cannot change to `אושרה – ממתין לייצור`.
- Customer submit cannot assign production queue.
- Customer submit can notify internal office/finance.
- Customer submit can lock customer fields from further customer edits if the business chooses.
- If finance/payment/guarantee checks fail, the order remains submitted but blocked for internal approval, not production-approved.

## 3. Internal Approval Flow

### Purpose

Only internal authorized users approve submitted customer orders into production.

### Actors

- Internal `office`, `finance`, `manager`, or `admin` according to final policy.
- Orders module status endpoint or Orders service.

### Flow

```text
1. Internal user opens submitted portal order.
2. Internal user reviews customer, site, items, shape snapshot, price snapshot, payment/guarantee status.
3. Internal user may correct/order-review fields according to permissions.
4. Internal user approves via Orders-owned status transition.
5. Orders validates transition using status contract.
6. Orders changes status to "אושרה – ממתין לייצור".
7. Production receives the approved order.
8. Portal sees customer-safe "אושרה" status, not internal workflow fields.
```

### Approval Rules

- Approval is never done by `/api/c/*`.
- Approval must use the Orders status contract.
- Approval should create an audit entry.
- Approval may trigger production card availability and production queue visibility.
- Rejection/return-to-customer should be explicit, not silent deletion.

## 4. Order Creation API Ownership

### Target API Boundary

Customer Portal endpoint remains customer-facing:

```text
POST /api/c/orders/draft
POST /api/c/orders/:id/submit
GET /api/c/orders/:id
GET /api/c/orders/history
```

But implementation delegates writes to Orders:

```text
routes/portal.js
-> resolve portal session
-> resolve authorized site
-> build CreateCustomerDraftOrderCommand
-> ordersService.createCustomerDraftOrder(command)
```

Orders-owned internal service:

```js
createCustomerDraftOrder({
  source: 'customer_portal',
  customerId,
  portalUserId,
  siteId,
  delivery: {
    date,
    time,
    address
  },
  customerNotes,
  items,
  quoteContext,
  idempotencyKey
})
```

Orders-owned submit service:

```js
submitCustomerDraftOrder({
  orderId,
  customerId,
  portalUserId,
  siteId
})
```

Internal approval stays with Orders:

```text
PATCH /api/orders/:id/status
```

### API Ownership Rules

- Portal owns `/api/c/*` authentication and customer-safe projection.
- Orders owns all writes to `orders`, `pallets`, and `items`.
- Orders owns status transitions.
- Pricing owns price calculation and price snapshot data.
- Steel/Rebar owns shape payload validation and machine payload derivation.

## 5. Order Item Creation Ownership

### Target Item Command

Portal sends item intent:

```json
{
  "clientLineId": "line-1",
  "quantity": 4,
  "shapeInput": {
    "family": "bars",
    "shapeId": "bar-u-001",
    "name": "U bar",
    "diameterMm": 12,
    "sides": [350, 1200, 350],
    "angles": [90, 90],
    "is3d": false,
    "azAngles": null,
    "elAngles": null
  },
  "customerNote": "for south wall"
}
```

Orders converts this into stored item fields:

- `quantity`
- `shape_id`
- `shape_name`
- `diameter`
- legacy `segments` while compatibility is needed
- immutable shape snapshot when schema exists
- `weight_per_unit`
- `total_weight`
- customer note field or sanitized compatible note

Orders/Production derive later:

- `production_qty`
- machine or `machine_id`
- production status
- worker and actual weight fields

### Item Rules

- Portal never sends or sets `production_qty`.
- Portal never sends or sets `machine`.
- Portal never sends or sets item status.
- Portal never sends or sets review status.
- Quantity stays at item level.
- Shape payload must not contain `quantity`.

## 6. Shape Snapshot Ownership

### Owner

Steel/Rebar owns the shape data contract. Orders owns copying the validated shape snapshot onto the order item.

### Target Snapshot

For bars:

```json
{
  "version": 1,
  "family": "bars",
  "shapeId": "bar-u-001",
  "name": "U bar",
  "diameterMm": 12,
  "sides": [350, 1200, 350],
  "angles": [90, 90],
  "is3d": false,
  "azAngles": null,
  "elAngles": null,
  "metadata": {
    "source": "customer_portal"
  }
}
```

Derived machine payload:

```json
{
  "version": 1,
  "family": "bars",
  "machineType": "polyline_bar",
  "diameterMm": 12,
  "segments": [
    { "index": 1, "lengthMm": 350, "bendAfterDeg": 90 },
    { "index": 2, "lengthMm": 1200, "bendAfterDeg": 90 },
    { "index": 3, "lengthMm": 350, "bendAfterDeg": null }
  ],
  "totalCutLengthMm": 1900
}
```

### Compatibility With Current Schema

Current implementation stores only `items.segments`. Migration can be staged:

1. Keep writing legacy `segments`.
2. Add a code-level snapshot builder that can produce canonical payload in memory.
3. Add tests proving quantity is outside shape payload.
4. Add DB columns in a later schema task.
5. Write both legacy `segments` and new snapshot columns.
6. Read from snapshot first, fall back to legacy `segments`.
7. Backfill historical portal items.

### Snapshot Rules

- Snapshot is immutable after order submission except through an explicit internal revision flow.
- Saved shape catalog changes do not alter historical order items.
- OCR, Portal, Manual Orders, BVBS, and Production Cards must use the same snapshot builder.
- 3D fields must either be preserved or blocked before order submission.

## 7. Portal-Safe Status Projection

### Problem

Internal statuses expose operational detail and can imply customer authority over production.

### Target Mapper

Portal should not display raw status directly. Use a projection:

| Internal Status | Portal Status | Customer Meaning |
| --- | --- | --- |
| `טיוטת לקוח` | `טיוטה` | Customer can still edit or submit. |
| `נשלחה לבדיקה` | `נשלחה לבדיקה` | Tene/office is reviewing. |
| `ממתינה לאישור` | `בבדיקה` | Internal approval not complete. |
| `אושרה – ממתין לייצור` | `אושרה` | Accepted and waiting for work. |
| `בתור ייצור` | `בתכנון ייצור` | Scheduled internally. |
| `בייצור` | `בייצור` | Work has started. |
| `הושלם – ממתין לאיסוף` | `מוכן לאספקה` | Ready for pickup/delivery. |
| `בדרך ללקוח` | `בדרך אליך` | Delivery in progress. |
| `בעיה באספקה` | `בעיה באספקה` | Customer-safe issue state. |
| `סופק – אושר` | `סופק` | Delivered/confirmed. |
| `בוטלה` | `בוטלה` | Cancelled. |

### Portal-Safe Field Projection

Portal order header may include:

- `id`
- `orderNum`
- `portalStatus`
- `createdAt`
- `deliveryDate`
- `deliveryTime`
- `deliveryAddress`
- `siteName`
- `totalWeight`
- `billingWeight`
- `price` only when `canViewPrices`

Portal item may include:

- `id`
- `lineNo`
- `shapeName`
- `diameterMm`
- `quantity`
- `lengthSummary`
- `shapePreviewData`
- `totalWeight`
- `customerNote`
- `progressPct` only as coarse customer-safe number after internal approval

Portal must not include by default:

- `machine`
- `machine_id`
- `production_qty`
- `worker_id`
- `actual_waste`
- `actual_weight_kg`
- `weight_deviation_pct`
- `review_status`
- `review_notes`
- `reviewed_by`
- internal finance/cost/margin fields
- warehouse zone/package internals
- internal production notes

## 8. Migration Path From Current Portal Implementation

### Phase 0: Freeze Contract

Documentation and test planning only.

Deliverables:

- This plan.
- Link to `PORTAL_ORDER_INTEGRATION_REVIEW.md`.
- Identify exact code paths to change later:
  - `routes/portal.js`
  - `public/customer.html`
  - `services/orders.js`
  - `status-contracts.js`
  - tests

### Phase 1: Customer-Safe Projection Without Schema Change

Small safe implementation phase.

Changes:

- Add portal projection mapper.
- Remove `machine`, `production_qty`, and internal note exposure from `/api/c/orders/:orderId`.
- Keep current DB writes temporarily.
- Change wording so customer confirmation does not say production starts.
- Add tests for blocked fields.

Risk:

- Low. Mostly response shaping and text.

### Phase 2: Stop Customer Approval From Reaching Production

Medium implementation phase.

Changes:

- Change `/api/c/approve/:token` and `/api/c/approve` semantics to customer confirmation only.
- Add or reuse submitted/internal-review status.
- Notify internal users instead of notifying production that work can start.
- Ensure only `PATCH /api/orders/:id/status` can approve production.

Risk:

- Medium. It changes customer workflow and operational expectations.

### Phase 3: Orders-Owned Portal Draft Adapter

Core integration phase.

Changes:

- Add `createCustomerDraftOrder()` to Orders service.
- Make `/api/c/order` call Orders service instead of inserting rows directly.
- Move order number, pallet, item, totals, and item validation into Orders service.
- Keep `portal.js` responsible only for portal auth/site/capability checks.

Risk:

- Medium/high. Must preserve existing portal behavior while removing duplicate writes.

### Phase 4: Shape Snapshot Schema and Builder

Schema/contract phase.

Changes:

- Add shape snapshot columns to item schema in a dedicated task.
- Add one shape snapshot builder shared by Portal, Orders, Intake, OCR, BVBS, and Production Cards.
- Store both legacy `segments` and canonical snapshot during transition.
- Read snapshot first, fallback to legacy segments.

Risk:

- High. Affects Orders, Production Cards, Intake, and Shape Editor.

### Phase 5: Pricing Snapshot Integration

Finance/Pricing integration phase.

Changes:

- Persist per-item price source and quote snapshot.
- Ensure invoices use order snapshot, not live price book.
- Ensure portal only sees money fields when permitted.

Risk:

- High. Requires Pricing/Finance ownership decisions.

### Phase 6: Backfill and Cleanup

Cleanup phase after production stability.

Changes:

- Backfill existing portal-created orders with best-effort shape snapshots.
- Remove direct portal item write logic.
- Remove legacy portal approval-to-production path.
- Remove fallback reads once historical data is clean.

Risk:

- Medium. Requires data audit and rollback plan.

## Proposed Future API Contract

### Customer Portal

```text
POST /api/c/orders/draft
POST /api/c/orders/:orderId/submit
GET  /api/c/orders/:orderId
GET  /api/c/orders/history
POST /api/c/quote
```

### Internal Orders

```text
POST  /api/orders
PATCH /api/orders/:id/status
POST  /api/orders/:orderId/items
PATCH /api/orders/:orderId/items/:itemId
```

### Ownership Rule

`/api/c/*` may request order actions but must not write order tables directly.

## Acceptance Criteria Before Code Work

- Product decision: exact customer draft/submitted status labels.
- Product decision: whether customer confirmation locks edits.
- Product decision: whether finance approval is required before production approval.
- Technical decision: whether Phase 1 may hide `machine`/`production_qty` immediately.
- Technical decision: shape snapshot schema task owner.
- Tests planned for:
  - portal cannot approve to production
  - portal order detail excludes internal fields
  - quantity is item-level only
  - shape snapshot is immutable
  - single-site user order binds authorized site
  - cross-site order submit is forbidden

## Summary

The correct integration is not to make Customer Portal smarter. It is to make the portal thinner.

Customer Portal should own customer identity, site authorization, portal permissions, and customer-safe display. Orders should own creation, item persistence, status transitions, shape snapshots, and production readiness.

This plan migrates from the current direct-write portal to an Orders-owned flow in stages, starting with safe projection cleanup and ending with canonical shape/pricing snapshots.
