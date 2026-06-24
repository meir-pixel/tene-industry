# PRICING_FINANCE_ITEM_REVIEW

Status: documentation only
Date: 2026-06-24
Scope: Pricing / Finance review against `ORDER_ITEM_CONTRACT.md`

This document defines how Pricing and Finance must read Order Item and Shape Snapshot data without owning or mutating them.

No code, schema, UI, route, or test behavior is changed by this document.

## Sources Reviewed

- `ORDER_ITEM_CONTRACT.md`
- `SHAPE_DATA_CONTRACT_V2.md`
- `docs/spec-dual-pricing.md`
- `docs/modules/finance.md`
- `ENTITY_REGISTRY.md`
- `TASKS_V2.md`

## Contract Summary

Pricing and Finance are consumers of Order Item identity, quantity, immutable shape snapshots, and item-calculated totals. They do not own the order item, the customer order line quantity, or any shape geometry.

Pricing answers: what should the customer pay.

Costing answers: what does the item cost internally.

Invoicing answers: what was officially charged.

Credit answers: whether work may continue for the customer.

Portal answers: what a customer is allowed to see through a scoped projection.

## Ownership Rules

| Data | Owner | Pricing / Finance Access | Write Permission |
| --- | --- | --- | --- |
| `itemId`, `orderId`, `lineNumber` | Orders | Read for traceability and snapshot keys | None |
| `quantity` | Orders | Read only | None |
| `unitOfMeasure` | Orders | Read only | None |
| `shapeSnapshot` | Orders, captured from Shape | Read only | None |
| `shapeSnapshot.data` | Shape / Orders snapshot | Read only | None |
| `shapeSnapshot.calculated` | Shape / Orders snapshot | Read only | None |
| `shapeSnapshot.machineOutput` | Shape / Orders snapshot, Production/Machines consumer | No pricing dependency except audit reference if needed | None |
| `itemCalculated.singleUnitLengthMm` | Orders / Pricing | Read or derive from shape snapshot when contract allows | Pricing may write only derived item-calculated fields under an Orders-approved workflow |
| `itemCalculated.singleUnitWeightKg` | Orders / Pricing | Read or derive from shape snapshot when contract allows | Pricing may write only derived item-calculated fields under an Orders-approved workflow |
| `itemCalculated.totalLengthMm` | Orders / Pricing | Read or derive from `singleUnitLengthMm * quantity` | Pricing may write only derived item-calculated fields under an Orders-approved workflow |
| `itemCalculated.totalWeightKg` | Orders / Pricing | Read or derive from `singleUnitWeightKg * quantity` | Pricing may write only derived item-calculated fields under an Orders-approved workflow |
| `itemCalculated.billingWeightKg` | Pricing / Finance | Read/write as billing snapshot field | Pricing / Finance only through snapshot workflow |
| `finance.pricingSnapshot` | Pricing / Finance | Owns | Pricing / Finance |
| `finance.weightSnapshot` | Pricing / Finance | Owns | Pricing / Finance; produced weight copied from Production only as analysis data |
| `finance.costSnapshot` | Finance | Owns | Finance only |
| `finance.marginSnapshot` | Finance | Owns | Finance only |
| `portal.*` projection controls | Portal / Orders / Platform policy | Read policy only | Portal / Orders / Platform policy |

## Required Read Model

Pricing and Finance must receive an Order Item view that contains at least:

```json
{
  "itemId": "string",
  "orderId": "string",
  "lineNumber": 1,
  "quantity": 10,
  "unitOfMeasure": "unit",
  "shapeSnapshot": {
    "contractVersion": 1,
    "shapeVersion": 1,
    "shapeId": "string",
    "shapeType": "string",
    "family": "bars|mesh|piles",
    "displayName": "string",
    "calculated": {
      "totalLengthMm": 1900,
      "weightKg": 1.69
    },
    "validation": {
      "valid": true
    }
  },
  "itemCalculated": {
    "singleUnitLengthMm": 1900,
    "singleUnitWeightKg": 1.69,
    "totalLengthMm": 19000,
    "totalWeightKg": 16.9,
    "billingWeightKg": 16.9
  }
}
```

Pricing and Finance may read this view. They must not persist edited copies back into Orders except for their owned snapshot fields.

## Check Results

### 1. Pricing Uses Item Quantity

Decision: required.

Pricing must calculate line quantity from `OrderItem.quantity` only.

Pricing must not read quantity from:

- `shapeSnapshot`
- `shapeSnapshot.data`
- shape display labels
- OCR rows after the Order Item is approved
- portal client payloads

Pricing formula:

```text
pricingQuantity = orderItem.quantity
```

If the pricing unit is per item:

```text
lineSubtotal = unitPrice * orderItem.quantity
```

If the pricing unit is per kg:

```text
lineSubtotal = pricePerKg * billingWeightKg
```

If the pricing unit is per meter:

```text
lineSubtotal = pricePerMeter * (itemCalculated.totalLengthMm / 1000)
```

### 2. Pricing Uses Shape Snapshot Calculated Weight/Length

Decision: required.

Pricing may use only immutable approved calculated values:

```text
singleUnitLengthMm = shapeSnapshot.calculated.totalLengthMm
singleUnitWeightKg = shapeSnapshot.calculated.weightKg
totalLengthMm = singleUnitLengthMm * orderItem.quantity
totalWeightKg = singleUnitWeightKg * orderItem.quantity
```

Preferred source order:

1. Use `itemCalculated.totalLengthMm`, `itemCalculated.totalWeightKg`, and `itemCalculated.billingWeightKg` when already captured by Orders/Pricing contract.
2. If missing and the item is still in an allowed pricing draft workflow, derive from `shapeSnapshot.calculated` and `quantity`.
3. Never recalculate geometry from raw sides/angles in Pricing.
4. Never open or call the Shape Editor from Pricing to calculate a live value.

### 3. Finance Stores Pricing/Cost Snapshots

Decision: required.

Finance must store immutable snapshots under the `finance` section of the Order Item or in finance-owned snapshot tables keyed back to `itemId` and `orderId`.

Required `pricingSnapshot` fields:

```json
{
  "priceSource": "price_book|customer_price_book|manual_approval|quote_override",
  "priceBookId": "string|null",
  "priceBookItemId": "string|null",
  "currency": "ILS",
  "pricingUnit": "item|kg|meter|ton",
  "unitPrice": 0,
  "pricePerKg": 0,
  "quantityUsed": 10,
  "lengthMmUsed": 19000,
  "weightKgUsed": 16.9,
  "billingWeightKg": 16.9,
  "discountAmount": 0,
  "taxCode": "VAT_STANDARD",
  "taxAmount": 0,
  "lineSubtotal": 0,
  "lineTotal": 0,
  "capturedAt": "ISO-8601",
  "capturedBy": "user-id",
  "snapshotVersion": 1
}
```

Required `weightSnapshot` fields:

```json
{
  "singleUnitLengthMm": 1900,
  "singleUnitWeightKg": 1.69,
  "totalCalculatedLengthMm": 19000,
  "totalCalculatedWeightKg": 16.9,
  "billingWeightKg": 16.9,
  "producedWeightKg": null,
  "source": "shape_snapshot",
  "capturedAt": "ISO-8601"
}
```

Required `costSnapshot` fields:

```json
{
  "materialCost": 0,
  "laborCost": 0,
  "machineCost": 0,
  "overheadCost": 0,
  "totalCost": 0,
  "costBasis": "steel_price_history|manual_cost|locked_snapshot",
  "weightKgUsed": 16.9,
  "capturedAt": "ISO-8601",
  "snapshotVersion": 1
}
```

Finance must not use a live price book, live steel price, or live weight rule to change an already approved invoice or quote. Corrections require a new snapshot version or explicit correction document.

### 4. Finance Does Not Change Item Quantity

Decision: prohibited.

Finance may read `quantity` and copy it into `finance.pricingSnapshot.quantityUsed` for audit, but it must never write `OrderItem.quantity`.

Allowed:

```text
finance.pricingSnapshot.quantityUsed = orderItem.quantity
```

Prohibited:

```text
orderItem.quantity = financeQuantity
shapeSnapshot.quantity = financeQuantity
```

If a finance user discovers that quantity is wrong, the required flow is:

1. Finance raises a correction/repricing requirement.
2. Orders owns the item revision or cancellation/reissue workflow.
3. Pricing captures a new pricing snapshot after the Orders-approved revision.
4. Invoicing issues a corrected invoice or credit note if needed.

### 5. Finance Does Not Change Shape Geometry

Decision: prohibited.

Finance must never write:

- `shapeSnapshot.data`
- `shapeSnapshot.calculated`
- `shapeSnapshot.machineOutput`
- sides, angles, diameters, spiral fields, mesh fields, pile cage fields
- Shape Editor state

If geometry is wrong, the required flow is:

1. Finance marks pricing/cost snapshot as requiring review, if money was affected.
2. Orders starts an item edit/revision workflow.
3. Shape Editor produces a new approved shape payload.
4. Orders captures a new immutable `shapeSnapshot`.
5. Pricing/Finance capture new snapshot versions.

### 6. Portal Sees Prices Only Through Approved Projection

Decision: required.

Portal must never receive raw Order Item JSON.

Portal may show price fields only through a customer-scoped projection that has already applied:

- customer identity
- portal user site authorization
- customer price visibility policy
- item/order status policy
- approved pricing snapshot existence
- restricted-field filtering

Allowed portal price source:

```text
portalOrderItemProjection.price = orderItem.finance.pricingSnapshot approved for this customer
```

Prohibited portal sources:

- live `pricing_price_books`
- live `pricing_price_items`
- raw `finance.costSnapshot`
- raw `finance.marginSnapshot`
- internal discount/margin fields
- raw credit exposure fields
- unapproved draft pricing snapshots

Portal may display:

- `quantity`
- customer-safe item label
- `shapeSnapshot.displayName`
- approved dimensions needed for confirmation
- weight only if customer policy exposes weight
- approved line subtotal/total only if customer policy exposes prices
- simplified customer status
- delivery note/status fields

Portal must not display:

- cost snapshots
- margin snapshots
- machine output payloads
- vendor machine profiles
- raw audit/security metadata
- internal credit risk fields

## Pricing Module Contract

Pricing may:

- read active price books and price items
- resolve the applicable customer/general price source
- read `OrderItem.quantity`
- read `shapeSnapshot.calculated` and `itemCalculated`
- calculate line price
- write `finance.pricingSnapshot`
- write `finance.weightSnapshot.billingWeightKg`
- mark `price_list_requires_update` when a required price row is missing

Pricing must not:

- write item quantity
- write shape geometry
- change order status except through an agreed Orders workflow
- use purchase price as sale price
- calculate material cost
- expose internal price book names to the customer portal
- recalculate old approved snapshots from live price books

## Costing / Finance Module Contract

Costing/Finance may:

- read `OrderItem.quantity`
- read `itemCalculated.totalWeightKg` and `billingWeightKg`
- read `shapeSnapshot.calculated.weightKg` only as the immutable source for item weight
- read purchase/cost sources such as `steel_price_history`
- write `finance.costSnapshot`
- write `finance.marginSnapshot`
- copy `production.producedWeightKg` into `finance.weightSnapshot.producedWeightKg` for analysis

Costing/Finance must not:

- use sale price as material cost
- mutate order item quantity
- mutate shape snapshot geometry
- mutate produced quantity or produced weight
- expose cost/margin to portal
- update invoice totals from live cost or live price after invoice creation

## Invoicing Contract

Invoicing must read from locked snapshots, not from live source tables.

Invoice line source:

```text
invoiceItem.lineTotal = orderItem.finance.pricingSnapshot.lineTotal
invoiceItem.quantity = orderItem.finance.pricingSnapshot.quantityUsed
invoiceItem.billingWeightKg = orderItem.finance.weightSnapshot.billingWeightKg
```

Invoicing must not:

- call price book lookup for already approved line totals
- recalculate item geometry
- change quantity
- change shape snapshot
- overwrite existing invoice totals silently

Corrections require explicit cancellation, credit note, or invoice correction workflow.

## Snapshot Lifecycle

Recommended lifecycle:

1. Order Item draft is edited by Orders and Shape Editor.
2. Shape Editor approves geometry and calculated one-unit values.
3. Orders captures immutable `shapeSnapshot` and owns `quantity`.
4. Orders/Pricing derives `itemCalculated`.
5. Pricing captures `pricingSnapshot` and `weightSnapshot`.
6. Costing captures `costSnapshot`.
7. Finance captures `marginSnapshot` when both revenue and cost are locked.
8. Invoicing reads the locked pricing snapshot.
9. Portal reads only the approved customer projection.

Snapshot immutability rule:

- Approved snapshots are append-only/versioned.
- A change to quantity or geometry creates a new Order Item revision or correction workflow.
- A change to price source creates a new pricing snapshot version.
- A change to cost source creates a new cost snapshot version.

## Required Guards

Any future Pricing/Finance implementation should enforce these guards:

- Reject pricing if `quantity <= 0`.
- Reject pricing if `shapeSnapshot.validation.valid !== true`.
- Reject pricing if `shapeSnapshot` contains `quantity`.
- Reject direct write attempts to `quantity` from Pricing/Finance endpoints.
- Reject direct write attempts to `shapeSnapshot` from Pricing/Finance endpoints.
- Require a snapshot version when replacing a pricing, cost, or margin snapshot.
- Require portal projections to strip cost, margin, machine output, and restricted audit fields.

## Documentation Conflicts / Notes

`docs/modules/finance.md` still contains legacy text that references `price_list.price_list` and `price_list.price_cust`. The newer Pricing split in `docs/spec-dual-pricing.md`, `TASKS_V2.md`, and `ENTITY_REGISTRY.md` points to `pricing_price_books` and `pricing_price_items` as the active Pricing source. For this review, the newer Pricing split should win.

`ORDER_ITEM_CONTRACT.md` says `itemCalculated` is owned by Orders / Pricing. This review narrows that rule: Pricing may write only derived calculation/snapshot fields under an Orders-approved workflow, and must never use that shared ownership to alter item identity, quantity, or shape geometry.

## Acceptance Checklist

- [ ] Pricing reads `OrderItem.quantity` and never reads quantity from Shape.
- [ ] Pricing reads `shapeSnapshot.calculated.totalLengthMm` and `shapeSnapshot.calculated.weightKg` as one-unit immutable values.
- [ ] Pricing calculates totals from one-unit shape values multiplied by `OrderItem.quantity`.
- [ ] Pricing writes only `finance.pricingSnapshot`, `finance.weightSnapshot`, and allowed derived billing fields.
- [ ] Finance writes `finance.costSnapshot` and `finance.marginSnapshot` only.
- [ ] Finance never writes `OrderItem.quantity`.
- [ ] Finance never writes `shapeSnapshot` or shape geometry fields.
- [ ] Invoicing reads locked pricing snapshots instead of live price books.
- [ ] Portal receives only customer-scoped projections.
- [ ] Portal never exposes `finance.costSnapshot`, `finance.marginSnapshot`, machine output, vendor profiles, or raw audit/security metadata.
- [ ] Corrections create explicit new versions or correction documents; no silent recalculation of approved snapshots.

## Decision

Pricing and Finance may depend on Order Item as a read model and may own financial snapshots attached to that item. They must not become alternate owners of item quantity, shape geometry, production quantities, or portal visibility rules.
