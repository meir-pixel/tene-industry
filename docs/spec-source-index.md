# Specification Source Index

This file records the current specification sources found locally from the
Drive-synced/downloaded folder:

`C:\Users\meir-tene\Downloads\02_מסמכים`

The Google Drive connector tools are not currently exposed in this Codex
session, so these local files are the authoritative readable copies for now.

## Master And Gap Documents

| File | Role In Recovery |
| --- | --- |
| `כרך_י_Master_Architecture_Bible_Core_Integration_טנא_תעשיות_ברזל.docx` | Highest-priority architecture source. Defines the "stop the salad" rule: one entity registry, one screen registry, one API registry, one event registry, one permission registry. |
| `MASTER_GAP_ANALYSIS.docx` | Existing gap analysis. Defines MVP, production-ready, and commercial-release gap tiers. |
| `ARCHITECTURE_STATUS_REPORT_V2.docx` | Current status report. Claims 66% alignment with Volume 10 and lists open critical/high architecture issues. |
| `IronBend_Audit_Report.docx` | Audit reference. Needs deeper pass after the first module map is stable. |
| `IronBend_סיכום.docx` | Short project summary. Useful for product framing. |

## Registry Documents Found Outside `02_מסמכים`

These files were found directly under `C:\Users\meir-tene\Downloads` and appear
to be companion sources for the Volume 10 "single source of truth" requirement:

| File | Role In Recovery |
| --- | --- |
| `IronBend_API_Registry.docx` | Candidate source for the formal API registry. |
| `IronBend_Entity_Registry.docx` | Candidate source for the formal entity registry. |
| `IronBend_Permission_Matrix.docx` | Candidate source for the permission registry. |
| `IronBend_Architecture_Diagram.docx` | Architecture visual/reference source. |

## Specification Volumes

| Volume | File | Primary Responsibility |
| --- | --- | --- |
| א | `אפיון_מפורט_אלפי_משפטים_טנא_תעשיות_ברזל_כרך_א.docx` | Core factory process: order lifecycle, customers, projects, documents, workflow, audit, permissions. |
| ג | `אפיון_מפורט_כרך_ג_Technical_Blueprint_טנא_תעשיות_ברזל.docx` | Backend, API, DB, event bus, machine gateway, frontend engineering, OCR/BVBS, scheduling, DevOps, cybersecurity, SaaS/multi-tenant, QA/DR. |
| ד | `כרך_ד_מלא_מתוקן_Factory_Operations_Bible_טנא_תעשיות_ברזל.docx` | Factory operations: shifts, machine states, incidents, scrap, maintenance, warehouse/logistics, safety, quality, finance impact, AI operational governance. |
| ה | `כרך_ה_מלא_Deep_Spec_Industrial_AI_טנא_תעשיות_ברזל.docx` | Industrial AI: scheduling, digital twin, confidence, governance, explainability, self-healing, autonomous decisions. |
| ו | `כרך_ו_מלא_Deep_Spec_Enterprise_Industrial_Ecosystem_טנא_תעשיות_ברזל-2.docx` and duplicates | Enterprise ecosystem: procurement, suppliers, customers, organization, broader economic layer. Multiple duplicate copies exist and should be deduplicated. |
| ז | `כרך_ז_Autonomous_Industrial_Civilization_טנא_תעשיות_ברזל-1.docx` | Advanced autonomous intelligence. Treat as future/strategic, not MVP. |
| ח | `כרך_ח_Deep_Spec_UI_UX_מסכים_טנא_תעשיות_ברזל.docx` | UI/UX source of truth: RTL, screen layout rules, actions, alerts, skeleton loading, responsive behavior, portals, role-specific screens. |
| ט | `כרך_ט_Deep_Spec_Core_Platform_Finance_Governance_טנא_תעשיות_ברזל.docx` | Core platform, finance, governance, permissions, audit, search, timeline, offline/fail-safe, Israeli accounting, feature flags, consistency scanner. |
| י״ב | `כרך_יב_Deep_Spec_Industrial_Economics_Financial_Intelligence_טנא_תעשיות_ברזל-1.docx` | Financial intelligence: cost engine, profitability, ledger, credit, dynamic pricing, market intelligence, ERP/bank/tax integration. |

## Missing Or Not Yet Located Volumes

The local search found 10 unique numbered volumes:

- א
- ג
- ד
- ה
- ו
- ז
- ח
- ט
- י
- י״ב

The following expected volumes were not found in the local folders searched:

- כרך ב׳
- כרך י״א

Volume ו׳ previously appeared in multiple duplicate copies. The duplicate
copies `(1)`, `(2)`, and `(3)` were deleted after verifying that their extracted
text hash matched the retained canonical file:

- `כרך_ו_מלא_Deep_Spec_Enterprise_Industrial_Ecosystem_טנא_תעשיות_ברזל-2.docx`

Until Drive search is available directly in this session or the missing files are
provided, gap analysis should mark כרך ב׳ and כרך י״א as missing source inputs.

## Extracted Non-Negotiable Requirements

These requirements appear repeatedly across the volumes and must govern every
future sprint:

1. One source of truth for entities, screens, APIs, events, and permissions.
2. Every important action must become an event with id, time, source, user,
   business context, old value, new value, and result.
3. No critical operational action may execute without identity, permission check,
   and audit trail.
4. Every module must use central authorization, audit, versioning, and governance.
5. Every screen must be RTL-first for Hebrew, role-aware, and should expose each
   primary action only once.
6. Tables must support search, filter, sorting, column visibility, and export by
   permission where relevant.
7. Critical alerts must appear both globally and in the local context where they
   were created.
8. Screens must include loading, empty, error, disabled, focus, hover, and retry
   states where relevant.
9. Customer/supplier/portal screens must never expose internal profitability,
   material, or other-customer data.
10. Machine, worker, material, order, shift, and finance changes must be
    recoverable, explainable, and auditable.
11. AI and automation must be explainable, reversible, permissioned, and must not
    act on stale or incomplete data.
12. The system must tolerate partial failures: internet, tablet, API, queue,
    gateway, ERP, or sync failure.
13. Finance must be tied to real batches, material cost, labor, machine runtime,
    waste, delay, credit, and Israeli accounting constraints.
14. The product must be prepared for SaaS/multi-tenant and future customer
    packages, not hardcoded only to one rebar factory.

## Immediate Interpretation For This Codebase

The current codebase has useful implementation work, but it violates the master
architecture rule in Volume 10:

- APIs are not registered in one registry.
- Screens are not registered in one registry.
- Entities are implicit in `server.js` and SQLite table creation.
- Events are partial and not a universal ledger.
- Permissions are partial and not enforced globally.
- UI behavior is duplicated across standalone HTML screens.

Therefore the next recovery step is not "make the screens prettier"; it is to
establish registries, ownership, and enforcement gates before additional module
work continues.
