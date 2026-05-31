# Order Table Integration

The external order workbook will be integrated after Sprint 1a authentication is stable.

## Required Import Flow

1. Upload Excel or CSV.
2. Parse into a staging preview without writing production tables.
3. Validate required customer, order, pallet, item, diameter, quantity, and geometry fields.
4. Detect duplicates using source identifier and order number.
5. Require an authenticated manager to approve the import.
6. Write orders, pallets, and items in one transaction.
7. Record accepted, rejected, and duplicate rows in an import log.

## Compatibility Rule

The workbook remains the source for the planning conversation. IronBend import mapping must be based on its final exported columns before implementation begins.
