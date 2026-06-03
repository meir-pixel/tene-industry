# Security Rollout

Sprint 1a introduces the authentication core and explicit route guards.

## Current Safe State

- `/api/auth/login`, `/api/auth/refresh`, and `/api/auth/logout` are available;
  logout now requires an active refresh cookie or access token.
- PIN values can be migrated to bcrypt hashes while plaintext values remain available for the 48-hour rollback window.
- Login is limited to 5 attempts per 15 minutes per client.
- Shared navigation attaches access tokens and refreshes them automatically.
- `requireRole()` now requires JWT-derived identity and no longer trusts `x-user-role` or `x-user-id`.
- `render.yaml` defines a stable generated `JWT_SECRET`.
- There is no global `AUTH_ENFORCEMENT` switch. Guarded routes are protected by
  route middleware, and route coverage is enforced by `test/route-auth-coverage.test.js`.

## Remaining Staging Risks

Some dedicated pages still need stronger runtime validation and external portal
auth decisions. These are usability/product rollout risks, not a global auth
toggle.

## Gate Before Production Release

1. Verify that Render has generated and retained a stable `JWT_SECRET` for the service.
2. Run `npm run auth:migrate:dry-run`, back up the active database, then run `npm run auth:migrate`.
3. Migrate dedicated machine, kiosk, driver, supplier, portal, and service-worker flows as appropriate.
4. Set `WHATSAPP_APP_SECRET` in production so WhatsApp webhook signatures are
   enforced.
5. Verify each role against protected endpoints in staging.
6. Verify anonymous requests to protected production/staging endpoints return 401.

## Protected Route Progress

- `/api/users` GET and POST require `admin`.
- `/api/users/:id` PATCH requires `admin`.
- `/api/users/login` is disabled with HTTP 410; use `/api/auth/login`.
- Spoofed `x-user-role: admin` is rejected by `requireRole()`.
