# Customer Portal Order Integration Review

Generated: 2026-06-24

Scope: review Customer Portal order creation against the current Orders and Order Item contracts. Documentation first. No application code, UI, or database schema was changed.

## Reviewed Sources

- `routes/portal.js`
- `public/customer.html`
- `routes/orders.js`
- `services/orders.js`
- `db/coreSchema.js`
- `status-contracts.js`
- `docs/modules/orders.md`
- `docs/modules/portal.md`
- `docs/modules/steel-rebar-shape-data-contracts.md`
- `test/shape-geometry.test.js`

## Contract Baseline

### ORDER_CONTRACT

Expected behavior for customer-originated orders:

- Customer portal may create an order draft / customer-submitted order only.
- Customer portal must not approve the order into production.
- Internal Orders flow owns the transition into `אושרה – ממתין לייצור`.
- Order creation should go through the Orders module/service contract, or through a narrow portal adapter that calls the same validation and calculation rules.
- Order status transitions should use the shared status contract, not hard-coded bypass updates.
- Site authorization must be checked server-side before binding `site_id`.
- Customer order data returned to the portal must be customer-safe only.

### ORDER_ITEM_CONTRACT

Expected behavior for portal-created order items:

- `quantity` belongs to Order Item, not to Shape.
- Shape data must be stored as an immutable order-item snapshot, not just as a reference to a live shape definition.
- Shape snapshot should preserve at least family, contract version, diameter, sides/angles or family-specific payload, and derived machine payload when available.
- Portal should not expose internal production, machine, warehouse, finance, or review fields unless explicitly customer-safe.
- Portal should not let browser-provided machine/production values become source of truth.

## Current Behavior

### Order Creation

`POST /api/c/order` in `routes/portal.js` creates rows directly:

- Inserts into `orders`.
- Optionally updates `orders.site_id`.
- Inserts one `pallets` row.
- Inserts `items` rows directly.
- Updates order totals and `portal_price`.
- Broadcasts `new_order`.
- Sends a WhatsApp approval link.

Current initial portal status:

```text
ממתינה לאישור לקוח
```

Current approval behavior:

- `GET /api/c/approve/:token` directly updates the order to:

```text
אושרה – ממתין לייצור
```

- `POST /api/c/approve` does the same when the portal user has `canApprove`.
- The approval message explicitly says production can start.

### Order Item Writes

Portal item creation currently writes:

- `shape_id`
- `shape_name`
- `diameter`
- `segments`
- `total_length_mm`
- `quantity`
- `production_qty`
- `weight_per_unit`
- `total_weight`
- `note`
- `machine`

The portal correctly writes `qty` into `items.quantity`; this part aligns with the Order Item contract.

However, it also calculates and writes:

- `production_qty`
- `machine`

Those are internal production planning fields and should not be decided by the customer portal contract unless Orders service explicitly returns them as internal derived values.

### Shape Snapshot

The portal receives shape data from the browser as:

```js
{ shapeId, shapeName, diameter, sides, angles, azAngles, elAngles, is3d, qty, note }
```

It persists only:

```json
segments: [
  { "length_mm": 1000, "angle_deg": 90 }
]
```

Current storage does not preserve a full immutable `shapeSnapshot` as described by `docs/modules/steel-rebar-shape-data-contracts.md`. It also ignores `azAngles`, `elAngles`, and `is3d` during DB insert, even though the portal sends them.

### Portal Order Detail Exposure

`GET /api/c/orders/:orderId` uses a limited projection for order header, but item projection currently returns:

- `machine`
- `production_qty`
- `status`
- `note`
- `struct_element`
- `struct_floor`
- `sheet_num`
- `weight_per_unit`
- `total_weight`
- `segments`

The UI displays:

- machine
- item status
- production progress percent using `production_qty`
- item note
- weight

This is partially customer-safe for status/quantity visibility, but not cleanly separated. Machine, production quantity, sheet/internal structure fields, and freeform internal notes can leak production or internal planning details.

## Contract Gaps

| Gap | Severity | Current Behavior | Required Behavior |
| --- | --- | --- | --- |
| Portal can approve into production | High | `/api/c/approve/:token` and `/api/c/approve` update status to `אושרה – ממתין לייצור`. | Customer action should only submit/confirm draft; internal Orders/office/finance gate approves to production. |
| Portal bypasses Orders service | High | `routes/portal.js` inserts `orders`, `pallets`, and `items` directly. | Portal should call Orders module/service or a shared order creation adapter. |
| Hard-coded status transition | High | Portal updates status directly without `isValidOrderTransition`. | All status changes should go through shared status contract and internal authorization. |
| No full immutable shape snapshot | High | Only legacy `segments` JSON is stored. | Order Item must store canonical `shape_payload_json` / `shape_machine_json` or equivalent snapshot. |
| 3D shape fields are dropped | Medium | `azAngles`, `elAngles`, `is3d` are sent by UI but ignored in item insert. | Snapshot must preserve 3D data or reject unsupported 3D orders. |
| Portal decides production fields | Medium | Portal route calculates `production_qty` and assigns `machine`. | Orders/Production should derive those fields after internal acceptance. |
| Portal exposes internal item fields | Medium | Item detail returns/displays `machine`, `production_qty`, `status`, internal structure fields and notes. | Portal response should map to customer-safe view model only. |
| Customer note and internal item note share one column | Medium | Browser-provided `item.note` is stored in `items.note`, same column used elsewhere. | Separate customer note from internal production/review notes or sanitize as customer_note. |
| Price snapshot is incomplete | Medium | `portal_price` is stored on order, but per-item price source snapshot is not visible in item/order contract. | Pricing source, unit price, discount, and quote timestamp should be snapshotted through Orders/Pricing contract. |
| Site binding partly aligned | Low | Server validates `siteId` via `resolveAuthorizedSite`. | Keep this behavior; move into portal order adapter when refactoring. |

## Required API Changes

### 1. Replace Portal Direct Insert With Orders Adapter

Add a customer-portal order creation path owned by Orders, for example:

```text
POST /api/c/order
  -> validate portal token and site authorization
  -> build Orders payload
  -> call Orders service createCustomerDraftOrder()
  -> return customer-safe result
```

Required service shape:

```js
createCustomerDraftOrder({
  customerId,
  portalUserId,
  siteId,
  delivery,
  customerNotes,
  items,
  pricingContext
})
```

The service should own:

- order number
- order status
- pallets/items creation
- item quantity
- shape snapshot validation
- pricing snapshot
- total/billing weight
- optional stock/procurement behavior only after internal acceptance, if required by business rules

### 2. Introduce Customer Draft Status Contract

Current statuses include:

```text
ממתינה לאישור לקוח
אושרה – ממתין לייצור
```

Required portal statuses should separate customer submission from production approval:

```text
טיוטת לקוח
נשלחה לבדיקה
ממתינה לאישור משרד / כספים
אושרה – ממתין לייצור
```

Minimum safe path:

```text
Portal creates: נשלחה לבדיקה
Internal user approves: אושרה – ממתין לייצור
Customer cannot call production approval endpoint
```

### 3. Replace `/api/c/approve` Semantics

Current:

```text
customer approve -> production approval
```

Required:

```text
customer confirm -> submitted/ready for internal review
internal approve -> production approval
```

Possible API split:

| Endpoint | Actor | Effect |
| --- | --- | --- |
| `POST /api/c/orders/:id/confirm` | Customer portal user | Confirm customer draft and send to office/finance review. |
| `PATCH /api/orders/:id/status` | Internal authorized user | Approve to production using shared status contract. |

The old WhatsApp approve link should not move an order to production. It should confirm customer submission only.

### 4. Add Customer-Safe Order Projection

Add a portal-only mapper:

```js
toCustomerOrderView(order, items, caps)
```

Allowed fields:

- order number
- customer-visible status label
- delivery date/time/address
- site name
- customer notes
- item shape label
- diameter
- quantity
- customer-visible length/shape summary
- total/billing weight
- price only when `canViewPrices`
- delivery note/invoice references only when permitted

Blocked fields by default:

- machine
- machine_id
- production_qty
- produced_qty unless exposed as coarse customer progress
- worker_id
- actual_waste
- actual_weight_kg
- weight_deviation_pct
- review_status
- review_notes
- reviewed_by
- internal notes
- warehouse zone/package internals
- cost/margin/price source internals

### 5. Store Shape Snapshot Through Order Item Contract

Required target payload for bars:

```json
{
  "version": 1,
  "family": "bars",
  "shapeId": "bar-u-001",
  "name": "custom bar",
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

Quantity stays outside the shape snapshot:

```json
{
  "quantity": 4,
  "shapeSnapshot": { "...": "..." }
}
```

Until DB schema has explicit snapshot columns, the portal should not claim full contract compliance. A temporary compatibility path can keep `segments` while also documenting that it is legacy.

## Safe Fixes

These are small, local changes that can be done safely after approval and tests:

1. Hide `machine` from `GET /api/c/orders/:orderId` item projection and `public/customer.html` display.
2. Hide `production_qty` from portal API response; if progress is needed, return a coarse `progressPct` computed server-side only after internal approval.
3. Remove the customer-facing text that says customer approval starts production.
4. Change WhatsApp wording from "לאישור ותחילת ייצור" to "לאישור פרטי ההזמנה ושליחה לבדיקה".
5. Make `/api/c/orders/:orderId` delete or avoid returning item `note` unless the note is explicitly a customer note.
6. Add tests that assert portal order detail does not include `machine`, `production_qty`, `worker_id`, `review_notes`, cost, or margin fields.
7. Add a review note in `docs/modules/portal.md` linking this report as the current order-integration gap list.

## Risky Fixes To Defer

These require API/schema/contract coordination and should not be slipped into a small portal patch:

1. Add new DB columns for canonical shape snapshots:
   - `items.shape_family`
   - `items.shape_payload_json`
   - `items.shape_machine_json`
   - `items.shape_contract_version`
2. Replace `routes/portal.js` direct inserts with a new Orders service adapter.
3. Redesign status lifecycle for customer draft, customer confirmation, finance approval, and production approval.
4. Split customer notes from internal production notes at schema/API level.
5. Add per-item pricing snapshot fields or a dedicated pricing snapshot table.
6. Decide whether inventory deduction/procurement shortage logic should run when portal draft is created or only after internal acceptance.
7. Migrate historical portal orders from legacy `segments` to canonical snapshots.

## Recommended Implementation Order

1. Documentation and tests:
   - Add portal-safe projection tests.
   - Add order contract tests for "portal cannot approve to production".
2. Safe leak cleanup:
   - Remove `machine`, `production_qty`, and internal notes from portal detail response.
   - Update wording so customer confirmation is not production approval.
3. Orders adapter:
   - Create `createCustomerDraftOrder()` in Orders service.
   - Keep `/api/c/order` as portal auth/site wrapper only.
4. Status contract:
   - Add explicit customer draft/submitted statuses.
   - Route production approval only through internal `PATCH /api/orders/:id/status`.
5. Shape snapshot:
   - Add schema and migration for immutable shape payload.
   - Make portal, intake, OCR, and manual Orders all use the same snapshot builder.
6. Pricing snapshot:
   - Persist per-item/customer pricing snapshot before invoice/finance integration.

## Bottom Line

The portal currently creates valid-looking order rows and correctly writes `qty` into `items.quantity`, but it is not yet compliant with the intended Orders/Order Item contract.

The two biggest changes needed are:

1. Portal must create a customer draft/submission only, not approve to production.
2. Portal must stop owning direct order/item persistence and instead go through the Orders contract, including immutable shape snapshots and customer-safe response mapping.
