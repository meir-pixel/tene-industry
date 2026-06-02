# Admin Shell Split Plan

Date: 2026-06-01

Owner module: Platform Core

Source:

- `public/admin.html`
- `docs/screen-compliance-map.md`
- `docs/api-route-permission-map.md`
- `docs/recovery-backlog.md`

## Decision

`admin.html` must become the Platform Core administration shell, not the place
where every module puts its hardest screen.

The final Platform Core admin shell should own only:

- system settings,
- user management,
- database backup/download/upload controls,
- audit log,
- deployment/service health checks,
- module enablement flags.

Everything else should move to the module that owns the workflow.

## Current Mixed Responsibilities

| Current tab / area | Current owner in `admin.html` | Target owner | Action |
| --- | --- | --- | --- |
| Modules | Platform Core | Platform Core | Keep in admin shell |
| WhatsApp settings | Platform Core / Integrations | Platform Core | Keep as integration settings, not intake review |
| Email IMAP settings | Platform Core / Intake | Platform Core for credentials; Intake for review queue | Split settings from intake work |
| Integrations | Platform Core | Platform Core | Keep only connection settings and tests |
| OCR settings | Intake / AI | Intake | Move operational OCR review/training out after dedicated intake screen exists |
| OCR training | Intake / AI | Intake | Move to intake/AI module screen |
| Machines | Production / Maintenance | Production / Maintenance | Move to machine/admin module screen |
| Workstations | Production / Kiosk | Production | Move to production/kiosk setup |
| Drivers | Delivery / Logistics | Delivery | Move to delivery/driver management |
| Price list | Finance / CRM | Finance | Move to finance/pricing screen |
| Customer portal links | CRM / External Portals | CRM | Already better placed in `customers.html`; remove from admin later |
| Users | Platform Core | Platform Core | Keep |
| Audit log | Platform Core / Governance | Platform Core | Keep |
| Cloud/database | Platform Core / DevOps | Platform Core | Keep |

## Phase 1: Do Not Break The Existing Screen

No physical page split should happen until each destination module has:

- protected server routes,
- a named screen owner,
- route contract tests where sensitive,
- a minimal navigation destination,
- a rollback path.

This protects the business from losing working operational tools while the
architecture is being untangled.

## Phase 2: First Code Moves

Recommended first moves:

1. Move customer portal link management fully to `customers.html`.
2. Move price list management to `finance.html` or a dedicated pricing screen.
3. Move drivers to a logistics/delivery admin screen.
4. Move OCR training and intake review to an intake review screen.
5. Move machine/workstation setup to production/maintenance setup.

## Acceptance Checks

- `admin.html` no longer expands with new module-specific workflows.
- New admin-only work is limited to Platform Core.
- Any retained tab in `admin.html` maps to Platform Core in the screen registry.
- Any moved tab has an owning module, screen, route policy, and tests where
  sensitive.
