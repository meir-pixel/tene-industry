# INTEGRATION_GAP_REPORT

Integration review after:

- `SHAPE_DATA_CONTRACT_V2.md`
- `ORDER_CONTRACT` runtime implementation in `services/orderContracts.js`
- `ORDER_ITEM_CONTRACT` runtime implementation in `services/orderContracts.js`
- Production ownership boundary implementation in `routes/production.js` and `routes/productionCards.js`

Scope of this report: documentation only. No code changes were made.

## Executive Summary

The implementation is directionally correct but not fully integrated yet.

Orders now has stable order identity, status validation, manager approval gating, item identity, item-owned quantity, and an immutable `items.shape_snapshot_json` column. Production now blocks unapproved orders from scan/start and production-card operations, and production patch routes forbid mutation of Orders-owned item fields.

The main gap is that Orders does not yet persist the full `SHAPE_DATA_CONTRACT_V2` envelope. Runtime snapshots are currently a reduced compatibility snapshot created by `shapeSnapshotJson()` with legacy fields such as `shapeName`, `diameter`, `segments`, and `totalLengthMm`. Production still consumes the legacy flat item columns (`shape_name`, `diameter`, `segments`, `total_length_mm`, `total_weight`, `quantity`) rather than `shape_snapshot_json`.

## 1. Does Orders Persist The Full Shape Contract Envelope?

Status: **Partial / not yet compliant**.

What exists:

- `db/coreSchema.js` and `db/startup.js` add `items.shape_snapshot_json`.
- `services/orders.js`, `routes/orders.js`, and `routes/portal.js` write `shape_snapshot_json` when creating or adding items.
- `routes/orders.js` keeps `shape_snapshot_json` immutable on item edit using `COALESCE(shape_snapshot_json, ?)`.

Gap:

`services/orderContracts.js` currently builds a reduced local snapshot:

- `contract: "ORDER_ITEM_SHAPE_SNAPSHOT"`
- `version`
- `shapeId`
- `shapeName`
- `diameter`
- `totalLengthMm`
- `spiralDiameterMm`
- `spiralTurns`
- `is3d`
- `segments`

It does **not** persist the full `SHAPE_DATA_CONTRACT_V2` envelope required by the approved contract:

- `contractVersion`
- `shapeVersion`
- `shapeId`
- `shapeType`
- `family`
- `source`
- `approvedAt`
- `displayName`
- `data`
- `calculated`
- `machineOutput.generic`
- `machineOutput.machineProfiles.MEP/PEDAX/SCHNELL`
- `validation.valid`

Additional mismatch:

- `public/shape-editor.js` appears to produce a richer V2 envelope with `contractVersion`, `shapeVersion`, `shapeId`, `shapeType`, `family`, `data`, `calculated`, `machineOutput`, and `validation`.
- Orders is not yet storing that envelope directly. It reconstructs a smaller snapshot from legacy item fields.

Conclusion:

Orders persists an immutable snapshot field, but the content is not yet the approved Shape Contract V2 envelope.

## 2. Does Order Item Store Immutable Shape Snapshots?

Status: **Mostly yes, but snapshot content is incomplete**.

What exists:

- `items.shape_snapshot_json` exists in schema and migration.
- `services/orders.js` writes `shape_snapshot_json` on normal order creation.
- `routes/orders.js` writes `shape_snapshot_json` on manual item add.
- `routes/portal.js` writes `shape_snapshot_json` on portal order creation.
- `routes/orders.js` preserves existing snapshot on item update with `COALESCE(shape_snapshot_json, ?)`.
- `routes/production.js` explicitly forbids production patching `shapeSnapshot` and `shape_snapshot_json`.
- `test/security-routes.test.js` covers snapshot immutability on item edit.
- `test/production-item-boundaries.test.js` covers production mutation boundaries.

Gap:

The snapshot is immutable once present, but it is not yet contract-complete. It also does not appear to enforce `shapeSnapshot.validation.valid === true` before item approval/review approval.

Conclusion:

The persistence and immutability mechanism exists. Contract completeness and validation gates are still missing.

## 3. Does Production Consume The Same Snapshot?

Status: **No**.

What exists:

- Production guards now prevent unapproved/draft order work from entering scan/start and production-card flows.
- Production patch route forbids mutation of Orders-owned item fields.
- Production card weight capture writes production-owned weight execution data only.

Gap:

Production still reads legacy flat columns:

- `routes/production.js` scan/start uses `item.segments`, `item.diameter`, `item.total_length_mm`, `item.production_qty || item.quantity` when writing machine parameters.
- `routes/production.js` queue selects `i.shape_id`, `i.shape_name`, `i.diameter`, `i.quantity`, `i.segments`, `i.total_length_mm`, `i.total_weight`.
- `routes/productionCards.js` loads `SELECT * FROM items` and normalizes `item.shape_name` / `item.segments` for print cards.
- `services/productionCards.js` renders from `item.segments`, `item.shape_name`, `item.diameter`, `item.total_length_mm`, `item.quantity`, `item.total_weight`.
- `services/productionCardPrintPage.js` serializes the same legacy fields into client-side card rendering.
- `public/production-queue.html`, `public/machine.html`, `public/kiosk.html`, and `public/worker-visual.html` consume `/api/production-queue`, which currently returns legacy item fields.

Conclusion:

Production consumes the same database row, but not the same immutable `shape_snapshot_json`. It is still integrated through legacy flat fields.

## 4. Integration Points Still Using Legacy Fields

| Area | Current Legacy Fields | Notes |
|---|---|---|
| Order item creation | `shape_name`, `diameter`, `segments`, `total_length_mm`, `weight_per_unit`, `total_weight`, `production_qty` | Snapshot is generated from these fields instead of accepting a full approved shape envelope. |
| Order item edit | same fields | Snapshot remains immutable, but live flat fields can diverge from the snapshot. |
| Portal order creation | `shapeName`, `diameter`, `sides`, `angles`, `qty` mapped to flat item fields | Portal does not submit/attach full V2 shape envelope. |
| Production scan/start | `segments`, `diameter`, `total_length_mm`, `production_qty`, `quantity` | Machine params are still derived from flat fields, not `shapeSnapshot.machineOutput`. |
| Production queue API | `shape_id`, `shape_name`, `diameter`, `quantity`, `segments`, `total_length_mm`, `total_weight` | Queue is status-gated but not snapshot-based. |
| Production cards | `shape_name`, `diameter`, `segments`, `total_length_mm`, `quantity`, `total_weight` | Print/visual rendering ignores `shape_snapshot_json`. |
| Worker visual / machine / kiosk clients | fields returned by `/api/production-queue` | These clients remain coupled to the legacy queue payload. |
| Pricing / portal quote | `diameter`, `sides`, `qty`, calculated `totalWeight` | Pricing is explicitly out of current implementation, but still uses legacy item geometry. |
| Reports / AI / metrics | `quantity`, `production_qty`, `diameter`, `total_length_mm`, `total_weight`, `actual_waste` | Out of current scope, but important for later migration planning. |
| BVBS import | direct `INSERT INTO items` without `shape_snapshot_json` | `routes/bvbs.js` is a clear missing writer path for the new item snapshot contract. |
| Manual machine order | `routes/orders.js` manual endpoint inserts item without `shape_snapshot_json` / `item_uid` | This path starts production directly and is not aligned with the new Order Item snapshot contract. |

## 5. Missing Integrations

### 5.1 Shape Editor to Orders

Missing:

- Orders should accept and persist the full shape contract envelope emitted by `public/shape-editor.js`.
- Orders should reject or hold items when the envelope is missing, malformed, or `validation.valid !== true`, at least before approval.
- A compatibility adapter is needed for legacy items, but it should produce a normalized read model without mutating historical snapshots silently.

### 5.2 Orders to Production

Missing:

- Production queue should expose a snapshot-backed item projection.
- Production scan/start should derive machine params from `shape_snapshot_json.machineOutput.generic`, not from `segments` and `diameter`.
- Production should keep using flat fields only as a compatibility fallback for old rows.

### 5.3 Production Cards

Missing:

- Print cards should render from `shape_snapshot_json.data` and `shape_snapshot_json.calculated`.
- Card target weight should prefer `shapeSnapshot.calculated.weightKg * item.quantity` or the approved item-calculated total.
- Rendering should support `bars`, `mesh`, and `piles` through the contract family rather than only segment polyline assumptions.

### 5.4 Item Lifecycle Mapping

Missing:

- `ORDER_ITEM_CONTRACT.md` defines item lifecycle statuses such as `draft`, `approved`, `planned`, `in_production`, `produced`, etc.
- Runtime still uses Hebrew legacy statuses from `ITEM_STATUS` and existing DB values.
- A mapping or migration layer is still needed before item status can be considered contract-compliant end to end.

### 5.5 Legacy Writers

Missing or incomplete paths that create/update `items` without full snapshot contract:

- `routes/bvbs.js`
- `routes/orders.js` manual machine-order endpoint
- some tests and seed helpers
- any direct item inserts in future import/integration routes

### 5.6 Snapshot Backfill / Migration Policy

Missing:

- Existing historical items need an explicit policy: leave legacy rows as-is, backfill compatibility snapshots, or mark as `legacy_snapshot`.
- The current migration adds `shape_snapshot_json` but does not backfill full V2 envelopes.

### 5.7 Contract Single Source Of Truth

Missing / conflict:

- There are two shape contract documents with different envelope wording:
  - `SHAPE_DATA_CONTRACT_V2.md`
  - `docs/modules/steel-rebar-shape-data-contracts.md`
- Runtime `public/shape-editor.js` is closer to `SHAPE_DATA_CONTRACT_V2.md`.
- Some tests still target `docs/modules/steel-rebar-shape-data-contracts.md`.

Decision needed:

Choose one canonical Shape envelope, then update tests and integration adapters to that exact envelope.

## Current Compliance Matrix

| Contract Requirement | Current State | Compliance |
|---|---|---|
| Stable order identity | `orders.stable_order_id` added and backfilled from `order_num` | Yes |
| Order status validation | `assertOrderStatusTransition()` validates statuses/transitions | Yes |
| Manager approval boundary | Approval transition requires manager/admin | Yes |
| Order item identity | `items.item_uid` added and populated | Yes |
| Quantity owned by Order Item | `quantity` remains on `items`; snapshot builder removes `quantity` | Yes |
| Immutable shape snapshot on item | `shape_snapshot_json` stored and preserved on item edit; production cannot patch it | Mostly yes |
| Full Shape Contract V2 envelope persisted | Runtime snapshot is reduced and lacks `data/calculated/machineOutput/validation` envelope | No |
| Production consumes immutable snapshot | Production consumes legacy flat fields | No |
| Production cannot mutate Orders-owned fields | Production patch rejects quantity, shape, pricing, warehouse fields | Yes |
| Production start gated by approved/planned order | Scan/start and card operations reject draft/unapproved orders | Yes |
| Shape validation before item approval | No full envelope validation gate found | No |
| Legacy direct item writers aligned | Some direct writers still bypass snapshot | No |

## Recommended Next Increment

Keep this as a small integration slice, not a rewrite:

1. Add a server-side shape snapshot adapter that accepts a full `SHAPE_DATA_CONTRACT_V2` envelope and exposes a legacy-compatible projection for old screens.
2. Change Orders item creation paths to persist the incoming full envelope when provided, with current reduced snapshot only as legacy fallback.
3. Add validation tests that `shape_snapshot_json` contains `contractVersion`, `shapeVersion`, `shapeId`, `shapeType`, `family`, `data`, `calculated`, `machineOutput`, and `validation.valid`.
4. Change `/api/production-queue` to include a parsed `shapeSnapshot` projection while preserving existing flat fields for UI compatibility.
5. Update production scan/start to prefer `shapeSnapshot.machineOutput.generic` and fall back to legacy fields only for old rows.
6. Update production cards to render from `shapeSnapshot` first and legacy `segments` second.
7. Decide whether `SHAPE_DATA_CONTRACT_V2.md` or `docs/modules/steel-rebar-shape-data-contracts.md` is canonical, then align tests.

## Bottom Line

The ownership boundaries are now mostly in place, but the data contract is not fully wired through the system.

The current implementation protects Orders-owned fields from Production and stores an immutable item snapshot, but the snapshot is still a compatibility snapshot. The next real integration step is to make Orders persist the full Shape Contract V2 envelope and make Production consume that same immutable snapshot instead of reconstructing work from legacy flat item columns.
