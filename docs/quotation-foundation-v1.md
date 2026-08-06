# Quotation Foundation V1

## Canonical VAT contract

- `VAT_RATE` is the single canonical server setting used by Quotation Foundation V1.
- Its representation is a decimal rate in the inclusive range `0..1`; for example, `0.18` means 18%.
- The built-in default is defined by the settings service and is `0.18`.
- A persisted setting takes precedence over the built-in definition default.
- An explicit empty, non-numeric, negative, or greater-than-one value is a server configuration error. Values such as `18` are rejected and are not converted to `0.18`.
- Draft calculations use the current canonical rate whenever the draft is created or recalculated.
- Issue reads the current canonical rate once inside the issue transaction and stores the resulting rate, line VAT amounts, totals, payload, and evidence hash atomically.
- Issued revisions and issued quotation print output use only the immutable stored VAT snapshot. They never recalculate against the live setting.
- A new draft revision may use a newer canonical rate without altering any earlier issued revision.

Existing VAT constants and defaults in legacy order, billing, invoice, and schema paths remain acknowledged technical debt outside Quotation Foundation V1. This phase does not migrate or reinterpret those modules.
