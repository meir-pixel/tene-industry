# Production Item Integration Review

Documentation-only review of how Production consumes approved Order Items under `ORDER_ITEM_CONTRACT.md`.

No code changes. No UI changes. This file defines the integration contract and current gaps for Production, Production Cards, Machines, and Warehouse handoff.

## Scope Reviewed

- `ORDER_ITEM_CONTRACT.md`
- `routes/production.js`
- `routes/productionCards.js`
- `services/productionCardPrintPage.js`
- `public/worker-visual.html`
- `docs/modules/production-cards.md`
- related legacy schema references in `db/coreSchema.js`

## Contract Position

Production does not create the commercial Order Item. Production consumes an Order Item only after Orders has approved it commercially and geometrically.

The approved Order Item is the work instruction for Production. It must include stable item identity, requested quantity, immutable shape snapshot, calculated target values, lifecycle status, and empty or initialized production/warehouse state.

Production may then plan, start, execute, measure, and complete the work. Production must not rewrite the request.

## Required Item Fields For Production

Production requires these fields before an item can enter the production queue or be printed as a production card:

| Field | Required For Production | Owner | Production Use |
| --- | --- | --- | --- |
| `contractVersion` | yes | Orders | Validate item payload version. |
| `itemId` | yes | Orders | Stable cross-module identity for queue, scan, card, work log, and warehouse handoff. |
| `orderId` | yes | Orders | Parent order context and grouping. |
| `lineNumber` | yes | Orders | Human-visible row/card reference. Not an identity replacement. |
| `status` | yes | Orders / transition owner | Gate whether Production may read, plan, start, or complete the item. |
| `quantity` | yes | Orders | Requested commercial quantity. Production reads it only. |
| `unitOfMeasure` | yes | Orders | Quantity interpretation, usually `unit`. |
| `shapeSnapshot` | yes | Orders | Immutable approved geometry and machine-ready data. |
| `shapeSnapshot.validation.valid` | yes | Orders | Must be true before approval and before production use. |
| `shapeSnapshot.machineOutput` | required when machine integration exists | Orders snapshot / Shape | Machine payload read through Production; never mutated by Production. |
| `itemCalculated.singleUnitLengthMm` | when available | Orders / Pricing | Target planning value. |
| `itemCalculated.singleUnitWeightKg` | when available | Orders / Pricing | Target planning/card weight value. |
| `itemCalculated.totalLengthMm` | when available | Orders / Pricing | Production/card display and planning. |
| `itemCalculated.totalWeightKg` | when available | Orders / Pricing | Target weight for card split and deviation checks. |
| `itemCalculated.productionQuantity` | yes if different from `quantity` | Orders / Production | Planned manufacturing quantity including approved overproduction/waste policy. |
| `production` | yes, may be empty/default | Production | Production-owned queue and execution state. |
| `warehouse` | yes, may be empty/default | Warehouse | Handoff target after production completion. |

Legacy mapping in the current system:

| Legacy Field | Contract Field |
| --- | --- |
| `items.id` | `itemId` |
| order join / `pallets.order_id` | `orderId` |
| `items.quantity` | `quantity` / requested quantity |
| `items.production_qty` | `itemCalculated.productionQuantity` when used |
| `items.produced_qty` | `production.producedQuantity` |
| `items.actual_waste` | `production.scrapQuantity` |
| `items.actual_weight_kg` | `production.producedWeightKg` or card actual weight |
| `items.weight_deviation_pct` | production/card weight deviation |
| `items.segments`, `shape_name`, `shape_id`, `diameter`, `total_length_mm` | legacy substitute for `shapeSnapshot` until explicit snapshot exists |
| `items.package_id`, `zone` | warehouse fields, not Production-owned |

## Required Statuses

Production may consume only approved or later items. Draft items are not production work.

| Status | Production Read? | Production Write? | Meaning For Production |
| --- | ---: | ---: | --- |
| `draft` | no | no | Not approved. Must not enter queue, print, scan, or machine setup. |
| `approved` | yes | yes, to `planned` | Approved by Orders; eligible for planning and possibly card printing. |
| `planned` | yes | yes, to `in_production` or back to `approved` | In Production queue/plan. Worker scan may start from here. |
| `in_production` | yes | yes, to `produced` or back to `planned` | Work has started. Production records execution. |
| `produced` | yes, read/handoff | yes, to `planned` only for rework | Production complete and ready for Warehouse handoff. |
| `packed` | read only | no | Warehouse owns this state. |
| `shipped` | read only | no | Warehouse/Delivery owns this state. |
| `delivered` | read only | no | Delivery/Portal owns this state. |
| `closed` | read only | no | Finance/Orders closure. |
| `cancelled` | no active production | no | Terminal except exceptional audit flows. |

Recommended status gate:

- Queue planning may consume `approved` items.
- Card printing may consume `approved` or `planned` items, depending on business decision.
- Worker scan/start must require `planned` or an explicit `released_to_production` equivalent.
- Machine setup must require `planned` or `in_production`.
- Warehouse handoff starts only from `produced`.

Current legacy gap:

- `/api/production-queue` filters to production-relevant legacy statuses and approved/in-production order statuses for normal reads.
- `/api/scan` currently starts from item lookup and should add an explicit approved/released/planned gate before changing state.
- `/api/orders/:id/print-cards` currently loads order items for printing and should require approved/released items before card creation/printing.

## Production Ownership

Production owns only the `production` object and Production-owned lifecycle transitions.

Production-owned fields:

- `production.machineAssignment.machineId`
- `production.machineAssignment.machineCode`
- `production.machineAssignment.machineType`
- `production.machineAssignment.assignedAt`
- `production.machineAssignment.assignedBy`
- `production.productionQueue.queueId`
- `production.productionQueue.queuePosition`
- `production.productionQueue.plannedDate`
- `production.productionQueue.priority`
- `production.productionQueue.batchId`
- `production.producedQuantity`
- `production.scrapQuantity`
- `production.producedWeightKg`
- `production.scrapWeightKg`
- `production.timestamps.plannedAt`
- `production.timestamps.startedAt`
- `production.timestamps.pausedAt`
- `production.timestamps.resumedAt`
- `production.timestamps.completedAt`
- `production.machineOutputSnapshot` when storing the exact machine payload sent/used
- production card work logs, weight checks, print/reprint records, and deviation alerts

Production may write these status transitions only:

- `approved -> planned`
- `planned -> in_production`
- `in_production -> produced`
- `in_production -> planned` for pause/requeue with audit
- `produced -> planned` for rework with audit
- `planned -> approved` when removing a plan before work starts

Production must not write:

- `quantity`
- `shapeSnapshot`
- `shapeSnapshot.machineOutput`
- pricing or finance snapshots
- warehouse package, packing, shipping, delivery-note, zone, or delivered quantity fields
- customer portal projection fields
- parent Order commercial status directly

Current legacy gap:

- `PATCH /api/items/:id/status` is production-like but uses legacy status strings and should become explicit transition commands.
- `PATCH /api/items/:id` mixes production fields (`produced_qty`, `actual_waste`, `actual_weight_kg`) with warehouse fields (`package_id`, `zone`) and should be split by module ownership.
- `/api/scan` updates parent order status directly; under the contract it should emit/record item production status and let order aggregate status be derived or handled by the owning module.

## Machine Touchpoints

Machines do not own Order Items. Machines receive work through Production.

Machine read inputs through Production:

- `itemId`
- `quantity` or `itemCalculated.productionQuantity`, depending on approved production policy
- `shapeSnapshot.machineOutput`
- selected machine profile/payload
- diameter/material values when included in the approved snapshot
- production queue and machine assignment context

Machine write outputs through Production:

- start/resume/pause/complete events
- produced quantity counter
- scrap/waste quantity
- produced/actual weight when measured at machine/workstation
- machine execution payload snapshot used for audit
- machine errors or stop reasons when supported

Machine restrictions:

- Machine integrations must not update `quantity`.
- Machine integrations must not update `shapeSnapshot`.
- Machine integrations must not write Warehouse packing/shipping data.
- Machine integrations must write execution results through Production-owned commands or events.

Current legacy behavior:

- `/api/scan` reads legacy `segments`, `diameter`, `quantity`/`production_qty`, and length values to prepare machine parameters.
- End-of-day and scan flows update `produced_qty` and `actual_waste`, which aligns conceptually with Production ownership.
- The contract target is to replace legacy shape reads with `shapeSnapshot.machineOutput` and store the selected machine payload as `production.machineOutputSnapshot`.

## Warehouse Handoff

Warehouse starts after Production has accepted the produced output.

Handoff trigger:

- Item status is `produced`.
- `production.producedQuantity` is greater than zero or an explicit partial/zero-output decision exists.
- `production.completedAt` is set.
- Actual weight and scrap/waste are recorded when applicable.
- Production card completion/weight deviation state is available for Warehouse/Quality visibility.

Warehouse-owned fields after handoff:

- `warehouse.packageId`
- `warehouse.packageLineId`
- `warehouse.packingStatus`
- `warehouse.shippingStatus`
- `warehouse.deliveryNoteReference`
- `warehouse.packedQuantity`
- `warehouse.shippedQuantity`
- `warehouse.deliveredQuantity`
- `warehouse.timestamps.packedAt`
- `warehouse.timestamps.shippedAt`
- `warehouse.timestamps.deliveredAt`

Warehouse rules from the Order Item contract:

- `produced -> packed` is Warehouse-owned.
- Packed quantity must not exceed produced quantity without manager override.
- Shipped quantity must not exceed packed quantity without approved partial/override flow.
- Delivery note references are Warehouse/Delivery-owned, not Production-owned.

Current legacy gap:

- `PATCH /api/items/:id` currently allows `package_id` and `zone` through a broad item patch endpoint that is also used for Production updates.
- Contract-compliant implementation should expose Warehouse handoff as a separate Warehouse command consuming produced items, not as a side effect of Production item patching.

## Production Cards Consumption Rule

Production cards are a projection of an approved Order Item, not a new source of truth.

Each card must carry:

- `itemId`
- optional card split identity, for example `cardIndex/cardTotal`
- `orderId` and visible order/card reference
- requested or split quantity for this card
- target weight derived from immutable item calculation
- shape display derived from `shapeSnapshot`
- scan token resolving back to the item/card identity

Cards may record:

- start/completion state
- worker identity
- produced quantity for the card
- actual weight
- weight deviation
- note/exception if Production-owned

Cards must not record or overwrite:

- requested item quantity
- item shape snapshot
- price or billing weight
- warehouse package/shipping fields

Current legacy behavior:

- Printed cards already use item identity in the card token/QR flow.
- Card target weight is derived from legacy `total_weight` and `quantity`.
- Shape rendering currently uses legacy item fields (`segments`, `shape_name`, `diameter`) and should migrate to explicit `shapeSnapshot`.

## Current Compliance Summary

| Check | Result | Notes |
| --- | --- | --- |
| Required item fields | Partial | Legacy fields provide most data, but explicit `shapeSnapshot`, V2 status, and nested `production`/`warehouse` objects are not yet represented in the runtime flow. |
| Required statuses | Partial | Queue filtering exists; scan and print need explicit approved/released/planned gates. |
| Production ownership | Partial | Produced quantity/weight/waste are separate, but some endpoints mix Production with Warehouse and parent Order status. |
| Machine touchpoints | Partial | Machines are driven through Production scan/setup logic, but still use legacy fields instead of `shapeSnapshot.machineOutput`. |
| Warehouse handoff | Partial | Produced quantity exists separately; package/zone writes need to move behind Warehouse-owned commands. |

## Required Follow-Up Before Code Changes

1. Define the exact legacy-to-V2 status mapping, including Hebrew runtime statuses.
2. Decide whether card printing is allowed from `approved`, or only from `planned` / `released_to_production`.
3. Add an explicit Production read model for approved/released items.
4. Add explicit `shapeSnapshot` consumption for cards, scan, and machine setup.
5. Split broad item patching into Production-owned commands and Warehouse-owned commands.
6. Add contract tests proving draft/unapproved items cannot enter queue, print, scan, or machine setup.
7. Define Warehouse handoff command/event from `produced` to `packed`.

## Review Conclusion

Production should consume approved Order Items as immutable work instructions: stable `itemId`, requested `quantity`, valid immutable `shapeSnapshot`, calculated target values, and an allowed lifecycle status.

Production then owns execution only: planning, machine assignment, worker progress, produced quantity, produced weight, scrap/waste, timestamps, and production card measurements.

Machines touch Order Items only through Production. Warehouse receives items only after Production marks them `produced`, and Warehouse alone owns packing, package, shipping, and delivery-note fields.
