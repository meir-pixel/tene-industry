# Intake/OCR Order Integration Review

Documentation-only review for Intake/OCR against the order and order-item contracts. This review defines how OCR and external imports should create reviewable draft orders without bypassing the Orders module.

No code changes are included in this review.

## Scope

Reviewed areas:

- Intake/OCR routes and workflow: `routes/intake.js`, `routes/intakeReview.js`, `routes/intakeChannels.js`, `services/intakeWorkflow.js`
- Orders creation and item persistence: `services/orders.js`, `routes/orders.js`, `db/coreSchema.js`
- Contract and module documentation: `ORDER_ITEM_CONTRACT.md`, `SHAPE_DATA_CONTRACT_V2.md`, `docs/modules/orders.md`, `docs/modules/intake.md`, `docs/order-import-integration.md`, `status-contracts.js`

Important gap: no `ORDER_CONTRACT.md` file currently exists in the repository. This review treats `docs/modules/orders.md`, `status-contracts.js`, and the order tables in `db/coreSchema.js` as the current practical order-header contract sources, but a formal `ORDER_CONTRACT.md` is still required.

## Executive Summary

| Requirement | Current state | Result |
| --- | --- | --- |
| OCR creates draft/review order only | Intake rows start as `pending_review`; approve creates an Orders record through `createOrderFromPayload` with the default pending-approval order status. There is no formal draft-order contract object. | Partial |
| OCR does not approve production | Intake approval does not set production lifecycle statuses. However, item `production_qty` is calculated at creation and a `new_order` broadcast is emitted, so downstream consumers must not treat import approval as production approval. | Mostly compliant, needs guardrails |
| Duplicate external imports use `source_system` + `external_id` | Current duplicate checks rely mainly on source order number/import row state. There are no durable `source_system` and `external_id` fields in `intake_log`, `order_imports`, or `orders`. | Gap |
| Uncertain OCR fields become review notes | OCR prompts and workflow preserve notes, and review tasks are inferred from item notes. There is no structured mapping to `review_notes`/field-level uncertainty before item approval. | Partial |
| Shape data is validated through Shape Contract | Orders run legacy segment validation. They do not require a `SHAPE_DATA_CONTRACT_V2` snapshot with `validation.valid === true`. | Gap |
| Approved orders are not silently mutated by later imports | Intake approval is idempotent per intake row, and order import approval is idempotent per import row. There is no global external-source identity or explicit conflict/revision policy for later imports. | Partial |

## Current Flow

### Intake capture

OCR/manual/channel intake creates an `intake_log` row with:

- `source`
- `raw_content`
- `parsed_data`
- original file fields where applicable
- `status = 'pending_review'`
- optional `order_id` after approval

This is the correct first boundary: OCR stores extracted data as review material and does not directly create production work during capture.

### Intake review and approval

`POST /api/intake/:id/approve` is the main transition from OCR review into Orders.

Current behavior:

1. Load the `intake_log` row.
2. If `order_id` already exists, mark the intake row approved if needed and return the existing order.
3. Merge user corrections from the review UI into `parsed_data`.
4. Save a correction example when corrected data differs from the original OCR parse.
5. Convert parsed intake data using `intakeToOrderPayload(...)`.
6. Call `createOrderFromPayload(...)` in the Orders service.
7. Update the intake row to `status = 'approved'` and store `order_id`.
8. Broadcast `new_order`.

The important positive point is that Intake/OCR does not insert directly into `orders`/`items`; it uses the Orders service. The missing contract point is that this service call creates a real order immediately after review, not a formal draft/review order artifact with explicit import identity, field uncertainty, and shape-contract validation state.

### Order creation

`createOrderFromPayload(...)` normalizes customer/order fields and inserts:

- one order header
- one or more items
- calculated item fields such as total length, weight, line total, and production quantity

The order header receives the database default pending-approval status. Items receive current local defaults rather than the `ORDER_ITEM_CONTRACT.md` lifecycle terms.

### Shape handling

Imported item shape data is normalized to local fields such as:

- `shape_id`
- `shape_name`
- `diameter`
- `segments`
- `total_length_mm`
- spiral fields where applicable

The Orders service performs legacy geometry validation on segments. This is useful but not equivalent to `SHAPE_DATA_CONTRACT_V2.md`, which requires a validated immutable shape snapshot with contract version, shape version, source, data, calculated values, machine output, and validation status.

### External spreadsheet/order import

The spreadsheet import flow creates previews in `order_imports`, then approval creates orders from preview payloads. Duplicate handling is based on import row status and source order number style matching. It does not yet have a durable `(source_system, external_id)` contract.

## Contract Gaps

### 1. Missing formal order-header contract

`ORDER_ITEM_CONTRACT.md` exists, but `ORDER_CONTRACT.md` is missing. This leaves ambiguous rules for:

- draft/review order creation
- external source identity
- import idempotency
- approval transitions
- whether imports may revise existing approved orders
- required review note structure

Required contract decision: create `ORDER_CONTRACT.md` or expand the existing Orders module contract with the same authority.

### 2. OCR approval currently means intake approval and order creation

The current flow correctly requires human review before creating the order. However, the word `approved` is overloaded:

- Intake row approved means OCR review accepted.
- Order approved should mean the business order is approved for downstream workflow.
- Item approved should mean it passed `ORDER_ITEM_CONTRACT.md` requirements.
- Production approval must remain a separate downstream transition.

Required contract decision: Intake/OCR approval may create only an order in draft/review status. It must not imply order, item, or production approval.

### 3. Item status vocabulary does not match `ORDER_ITEM_CONTRACT.md`

`ORDER_ITEM_CONTRACT.md` defines canonical item statuses such as `draft`, `approved`, `planned`, `in_production`, and beyond. Current persistence uses local defaults and nullable review fields.

Required contract decision: imported items should start as `draft` or explicit `review_required`; they should not enter `approved`, planning, or production states until Orders validates the item contract.

### 4. Missing `source_system` + `external_id`

The duplicate external import requirement is not met as a durable contract. Source order numbers are useful but insufficient because different systems can reuse numbers, file names can change, and OCR/manual capture may not have a reliable customer order number.

Required contract decision:

- Every import attempt gets `source_system`.
- Every external document/order candidate gets `external_id`.
- The pair `(source_system, external_id)` is unique for order creation.
- Re-import of the same pair must return the existing draft/review order or create an explicit conflict/revision review task.

### 5. Uncertain OCR fields are not structured review notes

Current OCR uncertainty can appear in free-text item notes and can later trigger review logic by text matching. That is not strong enough for contract enforcement.

Required contract decision:

- Each uncertain field should become structured review data, for example `review_notes` with field name, OCR value, confidence, source page/row, and message.
- Uncertain quantity, diameter, shape, length, customer, delivery date, or price fields should block item/order approval until reviewed.
- General operational order notes must remain separate from OCR uncertainty notes.

### 6. Shape validation is not Shape Contract validation

Legacy geometry validation catches basic segment problems, but it does not prove the item has a valid immutable Shape Contract snapshot.

Required contract decision:

- OCR/import may propose a shape candidate.
- Orders may accept an item for approval only when the shape has a valid `SHAPE_DATA_CONTRACT_V2` snapshot.
- The item stores an immutable shape snapshot, not only mutable shape IDs and segments.
- Shape quantity remains on the order item, never inside shape data.

### 7. Later imports do not have a formal no-silent-mutation rule

Current intake/import row idempotency prevents repeated approval of the same stored row. It does not fully prevent a later file or OCR run from mutating an already approved order if future reconciliation code is added.

Required contract decision:

- Imports never silently mutate approved orders.
- Same `(source_system, external_id)` against an approved order returns existing order plus a revision/conflict result.
- Changes to approved orders must go through explicit Orders revision/edit commands with audit trail.

## Required Commands

Use these commands when implementing or validating the integration boundary:

```powershell
rg -n "source_system|external_id|order_imports|intake_log|shapeSnapshot|review_status|production_qty" routes services db docs
node --test test/intake-workflow.test.js
node --test test/intake-parser.test.js
node --test test/status-contracts.test.js
node --test test/shape-geometry.test.js
node --test test/client-auth-contract.test.js
node --test test/module-governance.test.js
node --test test/security-routes.test.js
npm test
```

Add focused tests before implementation is considered complete:

- OCR approval creates only a draft/review order.
- OCR approval never sets order, item, or production status to approved/planned/in-production.
- Duplicate imports are keyed by `(source_system, external_id)`.
- Re-import of an approved order returns a conflict/revision review result and does not mutate the order.
- Uncertain OCR fields become structured review notes.
- Invalid shape candidates cannot produce approved order items.
- A valid order item stores an immutable Shape Contract snapshot.

## Required Validation

### Intake/OCR validation before creating an order draft

Validate that the import request contains:

- `source_system`
- `external_id`
- original document reference or intake row ID
- parsed customer/order fields
- parsed item candidates
- OCR confidence/review notes for uncertain fields

If `source_system` or `external_id` is missing, create a review-only intake record but do not create an order draft until identity is resolved.

### Duplicate validation

Before creating an order draft:

1. Look up `(source_system, external_id)`.
2. If no match exists, create a new draft/review order.
3. If a matching draft/review order exists, return that order and allow explicit review updates.
4. If a matching approved or later order exists, return conflict/revision review and do not mutate the order.

### Order contract validation

An OCR/import-created order must start in a review state. Required order-level checks:

- customer is resolved or marked for review
- delivery date is resolved or marked for review
- source identity is persisted
- original document reference is preserved
- no production approval fields are set by OCR/import

### Item contract validation

Each imported item must start as draft/review. Required item-level checks:

- positive quantity
- diameter present and valid
- shape candidate present or explicitly marked missing
- uncertain OCR fields in structured review notes
- no item approval until Shape Contract validation passes

### Shape contract validation

For each imported item:

1. OCR/import creates a shape candidate.
2. Shape editor or shape service validates the candidate against `SHAPE_DATA_CONTRACT_V2.md`.
3. Orders item approval requires `shapeSnapshot.validation.valid === true`.
4. The approved item stores the immutable snapshot.
5. Later shape catalog changes do not mutate the item snapshot.

### Mutation validation

Imports may create or propose revisions, but must not silently update approved business data. Required checks:

- Block import-driven mutation when order status is approved or later.
- Require an explicit Orders command for revisions.
- Preserve before/after values and reviewer identity.
- Keep source document and OCR parse history available for audit.

## Risks

### Production leakage risk

Because intake approval creates a real order and broadcasts `new_order`, downstream modules could accidentally treat it as actionable production work. This must be prevented by status gates in Orders and Production.

### Duplicate order risk

Without `(source_system, external_id)`, the same external document can create multiple orders when imported from a different file, channel, or OCR run.

### Silent mutation risk

Future import reconciliation could overwrite an approved order unless the contract explicitly blocks import-driven mutation after approval.

### OCR uncertainty risk

Free-text uncertainty notes are easy to miss. Field-level uncertainty should be structured so the UI can force review before approval.

### Shape correctness risk

Legacy segment validation can allow data that is not a valid Shape Contract snapshot. This can produce wrong lengths, weights, machine output, or visual comparison rows.

### Contract drift risk

Orders, Intake/OCR, Shape Editor, and Production currently rely on partially overlapping local status terms. A formal `ORDER_CONTRACT.md` plus mapping from intake review to order/item draft states is needed to prevent modules from interpreting the same state differently.

## Target Integration Rule

The target rule should be:

> Intake/OCR imports documents into reviewable order drafts owned by Orders. It may preserve OCR candidates, source references, uncertainty notes, and shape candidates, but it may not approve order items, approve production, bypass Shape Contract validation, or silently mutate approved orders.

This keeps OCR as an intake and recognition module, while Orders remains the owner of order identity, lifecycle, approval, revision, and downstream readiness.
