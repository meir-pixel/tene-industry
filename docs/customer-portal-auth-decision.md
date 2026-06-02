# Customer Portal Auth Decision

Date: 2026-06-01

Status: accepted for Sprint 1.

Owner module: External Portals / Security.

## Decision

Use a customer-scoped signed portal token as the Sprint 1 customer identity.

The customer portal is not an internal staff session and must not accept
`admin`, `office`, `manager`, or any other internal role as customer identity.
Internal users manage customers through internal APIs; customers access only
`/api/c/*` endpoints with a customer-scoped token.

## Product Direction

`customer.html` is the active customer portal product.

`portal.html` is deprecated as a public order lookup screen because it attempted
to query the internal `/api/orders?order_num=...` API by order number. It should
not be treated as a sellable customer portal until it is rebuilt as either:

- a redirect/help page that tells customers to use their secure link, or
- a new scoped tracking product backed by a dedicated public tracking endpoint
  that never exposes internal order search.

## Identity Model

| Actor | Identity proof | Allowed surface |
| --- | --- | --- |
| Customer | `customers.portal_token` via secure staff link or OTP-verified phone bootstrap in `/api/c/auth` + `/api/c/auth/verify` | `/api/c/*` only |
| Staff | JWT access token from `/api/auth/login` | Internal `/api/*` according to role |
| Public anonymous visitor | None | Static public assets and explicitly public health/marketing only |

Current Sprint 1 token source:

- Staff can generate a customer portal link through `/api/customers/:id/token`,
  guarded by `office/manager/admin`.
- `/api/c/auth` can find/create a customer by phone and issue a one-time OTP.
- `/api/c/auth/verify` verifies that OTP and only then returns a portal token.
- Staff can rotate or revoke portal tokens through the protected customer token
  admin endpoints.

## Ownership Rules

Every customer endpoint that returns or mutates customer data must resolve the
customer from the portal token and scope all records to that customer id.

Required invariants:

- `/api/c/me?token=...` returns only that customer's profile projection and
  recent orders.
- `/api/c/orders/:orderId?token=...` must query by both `orderId` and
  `customer_id`.
- `/api/c/approve` must approve only an order matching both `orderId` and the
  token's customer id, and only while status is `ממתינה לאישור לקוח`.
- `/api/c/order` must create orders only for the resolved customer or for a new
  customer created through the approved portal bootstrap.
- `/api/c/price-list` and `/api/c/quote` may use the customer's price tier and
  discount, but must not expose internal cost, margin, ledger, or credit data.
- One-time `/api/c/approve/:token` may approve only the order carrying that
  `confirm_token`, then must clear the token.

## Current Code Evidence

Already aligned:

- `/api/customers/:id/token` is guarded by `office/manager/admin`.
- `/api/customers/:id/pricing` is guarded by `office/manager/admin`.
- `resolveCustomer(token)` scopes portal APIs to `customers.portal_token`.
- `/api/c/orders/:orderId` queries by both order id and customer id.
- `/api/c/approve` checks both order id and customer id.
- `/api/c/auth` no longer returns a portal token directly from a phone number.
- `/api/c/auth/verify` enforces a one-time code with expiry and attempt limits.
- Portal tokens are rejected after revocation or expiry.
- CRM staff can create/copy, rotate, or revoke a customer portal link.
- `customer.html` uses `/api/c/*` endpoints.

Not yet production-ready:

- Browser smoke tests still need to cover OTP login, quote, order submit,
  approval, CRM rotation, and CRM revocation.
- Final production TTL length must be approved; current default is 90 days.
- `portal.html` is not a valid public portal because it used internal order
  search by order number.

## Implementation Gates

Before customer rollout:

1. Add request-level tests for customer A vs customer B ownership. Done for
   order detail and approval.
2. Add rate limits to `/api/c/auth`, `/api/c/quote`, `/api/c/order`, and
   approval endpoints. Done with portal auth/action limiters.
3. Replace phone-only bootstrap with OTP or magic-link verification. Done with
   `/api/c/auth` and `/api/c/auth/verify`.
4. Decide and implement token lifecycle: rotation, revocation, and expiry. Done
   with protected CRM endpoints and a default 90-day TTL.
5. Keep `portal.html` deprecated or rebuild it on a dedicated scoped endpoint.
6. Run browser smoke tests for customer link login, quote, order submit, order
   detail, and approval.

## Non-Goals

- Do not merge customer identity into internal JWT roles.
- Do not expose internal `/api/orders` or `/api/customers` to public portal
  pages.
- Do not use client-side role or URL order number as authorization.
