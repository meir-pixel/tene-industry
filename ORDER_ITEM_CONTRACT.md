# ORDER_ITEM_CONTRACT

This document is the single source of truth for Order Items.

Order Item is the central object connecting Orders, Shapes, Production, Machines, Warehouse, Finance, and Customer Portal.

Scope:

- Documentation only.
- No code changes.
- No UI changes.
- No rendering changes.
- No new shape families.

## Core Rules

- Order Item is an order line, not a reusable shape definition.
- Order Item owns `quantity`, lifecycle status, production state, warehouse state, finance snapshots, and portal projection.
- Shape owns geometry and one-unit calculated values.
- Order Item stores `shapeSnapshot` as immutable production-ready JSON from `SHAPE_DATA_CONTRACT_V2.md`.
- Future Shape changes must not modify existing Order Items.

## 1. Order Item Identity

| Field | Type | Required | Owner | Description |
|---|---|---:|---|---|
| `itemId` | string | yes | Orders | Stable generated id for this order line. |
| `orderId` | string | yes | Orders | Parent order id. |
| `lineNumber` | integer | yes | Orders | Human-visible row number inside the order. |

Rules:

- `itemId` is the primary cross-module id.
- `lineNumber` is display/order position only.
- `orderId + lineNumber` must be unique.
- Cancelled items keep identity for audit and finance history.

## 2. Complete Object Shape

```json
{
  "contractVersion": 1,
  "itemId": "generated-guid",
  "orderId": "order-guid",
  "lineNumber": 1,
  "status": "draft",
  "quantity": 10,
  "unitOfMeasure": "unit",
  "shapeSnapshot": {},
  "itemCalculated": {},
  "production": {},
  "warehouse": {},
  "finance": {},
  "portal": {},
  "audit": {}
}
```

Top-level fields:

| Field | Owner | Description |
|---|---|---|
| `contractVersion` | Orders | Order Item contract version. Starts at `1`. |
| `itemId` | Orders | Stable item id. |
| `orderId` | Orders | Parent order id. |
| `lineNumber` | Orders | Row number inside order. |
| `status` | Orders | Lifecycle status. Transitions may be written by other modules under rules below. |
| `quantity` | Orders | Commercial item quantity. Not owned by Shape. |
| `unitOfMeasure` | Orders | Usually `unit`. |
| `shapeSnapshot` | Orders | Immutable approved Shape payload. |
| `itemCalculated` | Orders / Pricing | Item totals derived from shape snapshot and quantity. |
| `production` | Production | Planning and execution data. |
| `warehouse` | Warehouse / Delivery | Packing, package, shipping, and delivery-note data. |
| `finance` | Pricing / Finance | Pricing, weight, cost, and margin snapshots. |
| `portal` | Customer Portal | Customer-visible projection rules. |
| `audit` | Platform Core | Created/updated/status history metadata. |

## 3. Shape Snapshot Ownership

`shapeSnapshot` is copied from `SHAPE_DATA_CONTRACT_V2.md`.

Required shape snapshot identity:

- `shapeSnapshot.contractVersion`
- `shapeSnapshot.shapeVersion`
- `shapeSnapshot.shapeId`
- `shapeSnapshot.shapeType`
- `shapeSnapshot.family`

Rules:

- Store the full Shape snapshot, not only `shapeId`.
- `shapeSnapshot.validation.valid` must be `true` before item approval.
- `shapeSnapshot` must not contain `quantity`.
- Shape edits after approval create a new snapshot through an Order Item edit/revision workflow.
- Machines and Production may read `shapeSnapshot.machineOutput`; they must not mutate it.

## 4. Quantity And Item Calculations

```json
{
  "quantity": 10,
  "itemCalculated": {
    "singleUnitLengthMm": 1900,
    "singleUnitWeightKg": 1.69,
    "totalLengthMm": 19000,
    "totalWeightKg": 16.9,
    "productionQuantity": 10,
    "wastePercent": 0,
    "billingWeightKg": 16.9
  }
}
```

Rules:

- `singleUnitLengthMm = shapeSnapshot.calculated.totalLengthMm` when available.
- `singleUnitWeightKg = shapeSnapshot.calculated.weightKg`.
- `totalLengthMm = singleUnitLengthMm * quantity`.
- `totalWeightKg = singleUnitWeightKg * quantity`.
- `productionQuantity` may include waste/overproduction policy.
- `billingWeightKg` is captured for pricing/finance and must not silently change with live price/weight rules.

## 5. Status Lifecycle

Allowed statuses:

| Status | Meaning | Primary Owner |
|---|---|---|
| `draft` | Item is being edited. | Orders |
| `approved` | Item is approved commercially and geometrically. | Orders |
| `planned` | Item is assigned to production plan/queue. | Production |
| `in_production` | Work started. | Production |
| `produced` | Required production output accepted. | Production |
| `packed` | Produced item is packed. | Warehouse |
| `shipped` | Item/package left warehouse. | Warehouse / Delivery |
| `delivered` | Customer delivery confirmed. | Delivery / Portal |
| `closed` | Operationally and financially closed. | Finance / Orders |
| `cancelled` | Item cancelled. | Orders |

Allowed transitions:

| From | To | Writer | Rule |
|---|---|---|---|
| `draft` | `approved` | Orders | Requires valid shape snapshot and positive quantity. |
| `draft` | `cancelled` | Orders | Allowed before approval. |
| `approved` | `planned` | Production | Requires queue/plan. |
| `approved` | `cancelled` | Orders | Allowed before production output. |
| `planned` | `in_production` | Production | Requires start event or machine/workstation start. |
| `planned` | `approved` | Production / Orders | Allowed when plan is removed before work starts. |
| `planned` | `cancelled` | Orders + Production | Requires no produced quantity. |
| `in_production` | `produced` | Production | Requires accepted produced quantity or explicit partial-complete decision. |
| `in_production` | `planned` | Production | Pause/requeue only; audit required. |
| `produced` | `packed` | Warehouse | Requires package/packing record. |
| `produced` | `planned` | Production | Rework only; audit required. |
| `packed` | `shipped` | Warehouse / Delivery | Requires shipping assignment or delivery note. |
| `packed` | `produced` | Warehouse | Unpack before shipping; audit required. |
| `shipped` | `delivered` | Delivery | Requires delivery confirmation. |
| `shipped` | `packed` | Warehouse / Delivery | Return-to-warehouse flow; audit required. |
| `delivered` | `closed` | Finance / Orders | Requires finance closure policy. |
| `closed` | `cancelled` | Finance / Manager | Exceptional reversal only; audit required. |

Lifecycle rules:

- `closed` and `cancelled` are terminal for normal operation.
- Status changes must append audit history.
- A module may write `status` only for transitions it owns.

## 6. Production Fields

```json
{
  "production": {
    "machineAssignment": {
      "machineId": null,
      "machineCode": null,
      "machineType": null,
      "assignedAt": null,
      "assignedBy": null
    },
    "productionQueue": {
      "queueId": null,
      "queuePosition": null,
      "plannedDate": null,
      "priority": "normal",
      "batchId": null
    },
    "producedQuantity": 0,
    "scrapQuantity": 0,
    "producedWeightKg": 0,
    "scrapWeightKg": 0,
    "timestamps": {
      "plannedAt": null,
      "startedAt": null,
      "pausedAt": null,
      "resumedAt": null,
      "completedAt": null
    },
    "machineOutputSnapshot": {
      "generic": {},
      "selectedMachineProfile": null,
      "selectedMachinePayload": null
    }
  }
}
```

Rules:

- Production owns queue, machine assignment, produced quantity, produced weight, scrap, and production timestamps.
- Machines read item quantity and `shapeSnapshot.machineOutput` through Production.
- Production must not change pricing snapshots or shape geometry.
- Produced weight is actual execution data and may differ from calculated/billing weight.

## 7. Warehouse Fields

```json
{
  "warehouse": {
    "packageId": null,
    "packageLineId": null,
    "packingStatus": "not_packed",
    "shippingStatus": "not_shipped",
    "deliveryNoteReference": null,
    "packedQuantity": 0,
    "shippedQuantity": 0,
    "deliveredQuantity": 0,
    "timestamps": {
      "packedAt": null,
      "shippedAt": null,
      "deliveredAt": null
    }
  }
}
```

Allowed packing statuses:

- `not_packed`
- `partially_packed`
- `packed`
- `unpacked`

Allowed shipping statuses:

- `not_shipped`
- `ready_to_ship`
- `partially_shipped`
- `shipped`
- `delivered`
- `returned`

Rules:

- Warehouse owns package id, packing status, packed quantity, and packing timestamp.
- Delivery/Warehouse own shipping status, shipped quantity, delivery note, and delivery timestamp.
- Packed quantity must not exceed produced quantity without manager override.
- Shipped quantity must not exceed packed quantity without approved partial/override flow.

## 8. Finance Fields

```json
{
  "finance": {
    "pricingSnapshot": {
      "currency": "ILS",
      "priceSource": null,
      "unitPrice": null,
      "pricePerKg": null,
      "lineSubtotal": null,
      "discountAmount": 0,
      "taxCode": null,
      "taxAmount": null,
      "lineTotal": null,
      "capturedAt": null,
      "capturedBy": null
    },
    "weightSnapshot": {
      "singleUnitWeightKg": null,
      "totalCalculatedWeightKg": null,
      "billingWeightKg": null,
      "producedWeightKg": null,
      "source": "shape_snapshot"
    },
    "costSnapshot": {
      "materialCost": null,
      "laborCost": null,
      "machineCost": null,
      "overheadCost": null,
      "totalCost": null,
      "capturedAt": null
    },
    "marginSnapshot": {
      "grossMarginAmount": null,
      "grossMarginPercent": null,
      "capturedAt": null
    }
  }
}
```

Rules:

- Pricing/Finance owns pricing snapshot and billing weight snapshot.
- Finance owns cost and margin snapshots.
- Invoice/quote reads snapshots; it must not recalculate from mutable live price books.
- Produced weight may be copied into `finance.weightSnapshot.producedWeightKg` for analysis.
- Cost and margin are restricted internal fields.

## 9. Portal Visibility

```json
{
  "portal": {
    "visibleToCustomer": true,
    "customerDisplayStatus": "approved",
    "customerVisibleFields": [],
    "internalFields": [],
    "restrictedFields": []
  }
}
```

Customer-visible fields may include:

- `lineNumber`
- customer-safe item tracking id when allowed
- customer display status
- `quantity`
- `shapeSnapshot.displayName`
- approved shape dimensions needed for confirmation
- `itemCalculated.totalWeightKg` only if customer policy exposes weight
- approved price fields only if customer policy exposes prices
- shipping status
- delivery note reference
- delivery date/status

Internal fields:

- raw internal status
- production queue
- machine assignment
- package id
- internal notes
- non-customer audit metadata

Restricted fields:

- `finance.costSnapshot`
- `finance.marginSnapshot`
- machine output payloads
- vendor machine profiles
- security/audit internals
- raw customer credit risk fields

Rules:

- Portal reads a customer-scoped projection, never raw Order Item JSON.
- Portal must never expose restricted fields.
- Portal can show simplified status labels while raw internal status remains unchanged.

## 10. Ownership Matrix

| Field / Group | Owner Module | Read Modules | Write Modules |
|---|---|---|---|
| `contractVersion` | Orders | All internal modules | Orders |
| `itemId` | Orders | Orders, Production, Machines, Warehouse, Finance, Portal | Orders |
| `orderId` | Orders | Orders, Production, Warehouse, Finance, Portal | Orders |
| `lineNumber` | Orders | Orders, Production, Warehouse, Finance, Portal | Orders |
| `status` | Orders | Orders, Production, Warehouse, Finance, Portal | Orders, Production, Warehouse, Delivery, Finance by allowed transition |
| `quantity` | Orders | Orders, Production, Machines, Warehouse, Finance, Portal | Orders |
| `unitOfMeasure` | Orders | Orders, Production, Warehouse, Finance, Portal | Orders |
| `shapeSnapshot` | Orders | Orders, Production, Machines, Warehouse, Finance, Portal projection | Orders at approval/edit snapshot time |
| `shapeSnapshot.shapeId` | Shape Editor / Orders snapshot | Orders, Production, Machines, Finance, Portal projection | Shape Editor before approval; Orders when captured |
| `shapeSnapshot.shapeType` | Shape Editor / Orders snapshot | Orders, Production, Machines, Finance, Portal projection | Shape Editor before approval; Orders when captured |
| `shapeSnapshot.family` | Shape Editor / Orders snapshot | Orders, Production, Machines, Finance, Portal projection | Shape Editor before approval; Orders when captured |
| `shapeSnapshot.data` | Shape Editor / Orders snapshot | Orders, Production, Machines, Finance, Portal projection | Shape Editor before approval; Orders when captured |
| `shapeSnapshot.calculated` | Shape Editor / Orders snapshot | Orders, Production, Machines, Finance, Portal projection | Shape Editor before approval; Orders when captured |
| `shapeSnapshot.machineOutput` | Shape Editor / Orders snapshot | Orders, Production, Machines | Shape Editor before approval; Orders when captured |
| `itemCalculated.singleUnitLengthMm` | Orders / Pricing | Orders, Production, Warehouse, Finance, Portal projection | Orders / Pricing |
| `itemCalculated.singleUnitWeightKg` | Orders / Pricing | Orders, Production, Warehouse, Finance, Portal projection | Orders / Pricing |
| `itemCalculated.totalLengthMm` | Orders / Pricing | Orders, Production, Warehouse, Finance, Portal projection | Orders / Pricing |
| `itemCalculated.totalWeightKg` | Orders / Pricing | Orders, Production, Warehouse, Finance, Portal projection | Orders / Pricing |
| `itemCalculated.productionQuantity` | Orders / Production | Orders, Production, Warehouse, Finance | Orders / Production |
| `itemCalculated.wastePercent` | Orders / Pricing | Orders, Production, Finance | Orders / Pricing |
| `itemCalculated.billingWeightKg` | Pricing / Finance | Orders, Finance, Portal if exposed | Pricing / Finance |
| `production.machineAssignment` | Production / Machines | Orders, Production, Machines, Warehouse | Production / Machines |
| `production.productionQueue` | Production | Orders, Production, Machines, Warehouse | Production |
| `production.producedQuantity` | Production | Orders, Production, Warehouse, Finance, Portal projection | Production |
| `production.scrapQuantity` | Production | Orders, Production, Finance | Production |
| `production.producedWeightKg` | Production | Orders, Production, Warehouse, Finance | Production |
| `production.scrapWeightKg` | Production | Production, Finance | Production |
| `production.timestamps` | Production | Orders, Production, Warehouse, Finance, Portal projection | Production |
| `production.machineOutputSnapshot` | Production / Machines | Production, Machines | Production / Machines |
| `warehouse.packageId` | Warehouse | Orders, Production, Warehouse, Delivery | Warehouse |
| `warehouse.packageLineId` | Warehouse | Orders, Warehouse, Delivery | Warehouse |
| `warehouse.packingStatus` | Warehouse | Orders, Production, Warehouse, Delivery, Portal projection | Warehouse |
| `warehouse.shippingStatus` | Warehouse / Delivery | Orders, Warehouse, Delivery, Portal | Warehouse / Delivery |
| `warehouse.deliveryNoteReference` | Warehouse / Delivery | Orders, Warehouse, Delivery, Finance, Portal | Warehouse / Delivery |
| `warehouse.packedQuantity` | Warehouse | Orders, Warehouse, Delivery | Warehouse |
| `warehouse.shippedQuantity` | Warehouse / Delivery | Orders, Warehouse, Delivery, Portal projection | Warehouse / Delivery |
| `warehouse.deliveredQuantity` | Delivery | Orders, Warehouse, Delivery, Finance, Portal projection | Delivery |
| `warehouse.timestamps` | Warehouse / Delivery | Orders, Warehouse, Delivery, Finance, Portal projection | Warehouse / Delivery |
| `finance.pricingSnapshot` | Pricing / Finance | Orders, Finance, Portal if exposed | Pricing / Finance |
| `finance.weightSnapshot` | Pricing / Finance | Orders, Production, Warehouse, Finance, Portal if exposed | Pricing / Finance; produced weight from Production |
| `finance.costSnapshot` | Finance | Finance, Manager reports | Finance |
| `finance.marginSnapshot` | Finance | Finance, Manager reports | Finance |
| `portal.visibleToCustomer` | Customer Portal / Orders | Orders, Portal | Orders / Portal |
| `portal.customerDisplayStatus` | Customer Portal | Portal, Orders | Portal / Orders |
| `portal.customerVisibleFields` | Customer Portal | Orders, Portal | Portal / Orders |
| `portal.internalFields` | Customer Portal / Platform Core | Orders, Portal admin | Portal / Platform Core |
| `portal.restrictedFields` | Platform Core / Security | Platform Core, Portal admin | Platform Core / Security |
| `audit.createdAt` | Platform Core | Internal modules | Platform Core / Orders |
| `audit.createdBy` | Platform Core | Internal modules with audit permission | Platform Core / Orders |
| `audit.updatedAt` | Platform Core | Internal modules with audit permission | Platform Core |
| `audit.updatedBy` | Platform Core | Internal modules with audit permission | Platform Core |
| `audit.cancelledAt` | Platform Core / Orders | Orders, Finance, Production, Warehouse | Orders / Platform Core |
| `audit.cancelledBy` | Platform Core / Orders | Orders, Finance, Production, Warehouse | Orders / Platform Core |
| `audit.statusHistory` | Platform Core | Orders, Production, Warehouse, Finance, audit reports | All status-writing modules through append-only audit service |

## 11. Validation Rules

An Order Item is valid when:

- `contractVersion === 1`.
- `itemId`, `orderId`, and `lineNumber` exist.
- `lineNumber` is a positive integer.
- `status` is in the allowed lifecycle list.
- `quantity > 0` unless preserving a cancelled historical item.
- `shapeSnapshot.validation.valid === true`.
- `shapeSnapshot` does not contain `quantity`.
- `itemCalculated.totalLengthMm` matches `shapeSnapshot.calculated.totalLengthMm * quantity` when available.
- `itemCalculated.totalWeightKg` matches `shapeSnapshot.calculated.weightKg * quantity` when available.
- Production and warehouse quantities are non-negative.
- Packed quantity does not exceed produced quantity without override.
- Shipped quantity does not exceed packed quantity without override.
- Delivered quantity does not exceed shipped quantity without override.
- Portal projection does not expose restricted fields.
- Finance snapshots are immutable after approval unless a formal correction/repricing workflow creates a new snapshot version.

## 12. Module Boundaries

Orders:

- Owns item identity, quantity, approval, cancellation, shape snapshot capture, and order context.

Shape Editor:

- Produces approved Shape payloads. Does not own quantity or Order Item status.

Production:

- Owns planning, queue, machine assignment, produced quantities, produced weights, and production timestamps.

Machines:

- Read `shapeSnapshot.machineOutput` and write execution results only through Production.

Warehouse:

- Owns packages, packing status, shipping status, package quantities, and delivery note references until delivery handoff.

Finance:

- Owns pricing, weight, cost, and margin snapshots.

Customer Portal:

- Owns customer projection and customer-visible status labels. Reads scoped Order Item views only.

Platform Core:

- Owns audit, permissions, security policy, and cross-module write guards.

## 13. Acceptance Checklist

This contract defines:

- Order Item identity: `itemId`, `orderId`, `lineNumber`.
- Immutable `shapeSnapshot` ownership rules.
- Full status lifecycle and allowed transitions.
- Production fields: machine assignment, production queue, produced quantity, produced weight, timestamps.
- Warehouse fields: package id, packing status, shipping status, delivery note reference.
- Finance fields: pricing, weight, cost, and margin snapshots.
- Portal visibility: customer-visible, internal, restricted fields.
- Ownership matrix with owner, read modules, and write modules.
- Clear separation between Shape-owned geometry and Order Item-owned quantity/status/finance/production data.
