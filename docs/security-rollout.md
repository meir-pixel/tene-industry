# Security Rollout

Sprint 1a introduces the authentication core without enabling full API enforcement.

## Current Safe State

- `/api/auth/login`, `/api/auth/refresh`, and `/api/auth/logout` are available.
- PIN values can be migrated to bcrypt hashes while plaintext values remain available for the 48-hour rollback window.
- Login is limited to 5 attempts per 15 minutes per client.
- Shared navigation attaches access tokens and refreshes them automatically.
- `AUTH_ENFORCEMENT` defaults to `false`.

## Why Enforcement Remains Off

Several dedicated pages do not load `public/nav.js` and still need the shared authentication client. Turning enforcement on before those pages are migrated would interrupt production workflows.

## Gate Before Enabling Enforcement

1. Configure a stable random `JWT_SECRET` in the deployment environment.
2. Run `npm run auth:migrate:dry-run`, back up the active database, then run `npm run auth:migrate`.
3. Migrate dedicated machine, kiosk, driver, supplier, portal, and service-worker flows as appropriate.
4. Verify each role against protected endpoints in staging.
5. Set `AUTH_ENFORCEMENT=true` only after the staging checklist passes.
