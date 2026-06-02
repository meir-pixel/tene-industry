# Security Rollout

Sprint 1a introduces the authentication core without enabling full API enforcement.

## Current Safe State

- `/api/auth/login`, `/api/auth/refresh`, and `/api/auth/logout` are available;
  logout now requires an active refresh cookie or access token.
- PIN values can be migrated to bcrypt hashes while plaintext values remain available for the 48-hour rollback window.
- Login is limited to 5 attempts per 15 minutes per client.
- Shared navigation attaches access tokens and refreshes them automatically.
- `requireRole()` now requires JWT-derived identity and no longer trusts `x-user-role` or `x-user-id`.
- `render.yaml` defines a stable generated `JWT_SECRET`.
- `AUTH_ENFORCEMENT` is explicitly set to `false` in `render.yaml` until the staging gate passes.

## Why Enforcement Remains Off

Several dedicated pages do not load `public/nav.js` and still need the shared authentication client. Turning enforcement on before those pages are migrated would interrupt production workflows.

## Gate Before Enabling Enforcement

1. Verify that Render has generated and retained a stable `JWT_SECRET` for the service.
2. Run `npm run auth:migrate:dry-run`, back up the active database, then run `npm run auth:migrate`.
3. Migrate dedicated machine, kiosk, driver, supplier, portal, and service-worker flows as appropriate.
4. Set `WHATSAPP_APP_SECRET` in production so WhatsApp webhook signatures are
   enforced.
4. Verify each role against protected endpoints in staging.
5. Set `AUTH_ENFORCEMENT=true` only after the staging checklist passes.

## Protected Route Progress

- `/api/users` GET and POST require `admin`.
- `/api/users/:id` PATCH requires `admin`.
- `/api/users/login` is disabled with HTTP 410; use `/api/auth/login`.
- Spoofed `x-user-role: admin` is rejected by `requireRole()`.
