# S5 Status Usage Audit

Working audit for Sprint 5. The goal is to align Orders and Production screens
around `status-contracts.js` instead of page-local Hebrew strings and transition
logic.

## Scope

- `public/orders.html`
- `public/index.html`
- `public/production-queue.html`
- `public/machine.html`
- `public/kiosk.html`
- `public/worker.html`
- `public/worker-visual.html`
- `status-contracts.js`
- related API calls in `server.js` during follow-up implementation

## Findings

### P1: Orders screen owns a parallel order transition UI

Evidence:

- `public/orders.html:202-206` hard-codes filter statuses.
- `public/orders.html:327-329` and `public/orders.html:377-379` hard-code
  row/card transition buttons.
- `public/orders.html:548-552` hard-codes the detail status button list.
- `public/orders.html:387-391` sends any selected status to
  `/api/orders/:id/status`; server validation exists, but the UI does not render
  from the same allowed transition contract.

Impact:

- The page can drift from `status-contracts.js`, especially when statuses or
  transitions change for delivery or customer approval.

Follow-up:

- S5-02 should introduce a browser-safe status adapter or embedded contract data
  for `orders.html`.

### P1: Production screens duplicate item status actions

Evidence:

- `public/production-queue.html:491-493`, `public/production-queue.html:538-551`
  hard-code waiting/start/done actions.
- `public/machine.html:727-747`, `public/machine.html:760-764` duplicate the
  same item start/done behavior.
- `public/kiosk.html:682-685` marks an active item done directly.
- `public/worker-visual.html:48-50`, `public/worker-visual.html:76-77`, and
  `public/worker-visual.html:103` define their own item status mapping and
  mutation path.

Impact:

- Production queue, machine, kiosk, and worker experiences can diverge on item
  lifecycle labels and allowed actions.

Follow-up:

- S5-04 should define a shared production item status adapter and keep each
  screen's action set role/auth-specific.

### P1: Machine screen still has an older order-derived queue path

Evidence:

- `public/machine.html:586-592` loads `/api/orders?status=אושרה` and filters
  items locally.
- `public/machine.html:687` also loads `/api/production-queue`.

Impact:

- The screen has two sources for production work. This can reintroduce the same
  bug fixed on the dashboard: approved/pending work may be interpreted
  differently than the production queue source of truth.

Follow-up:

- S5-04 should remove the order-derived queue path or prove it is only a legacy
  manual assignment helper with server-side approval guarantees.

### P2: Order creation success text promises production queue behavior

Evidence:

- `public/index.html:1001` and `public/index.html:1596` say the order was sent
  to the production queue after creation.

Impact:

- If new orders should start as approval-pending, this text is commercially
  misleading and operationally dangerous.

Follow-up:

- S5-03 should align success messaging with the actual order status returned by
  `/api/orders`.

### P2: Worker visual uses English labels and local mapping

Evidence:

- `public/worker-visual.html:49` exposes English UI labels for item status.
- `public/worker-visual.html:50` maps local keys to Hebrew API statuses.

Impact:

- This may be intentional for shop-floor clarity, but it is still another local
  status translation layer that needs ownership and tests.

Follow-up:

- S5-04 should decide whether worker visual remains English, becomes Hebrew, or
  uses display labels from a shared adapter.

## Recommended Implementation Order

1. S5-02: orders screen status adapter and safe rendering cleanup.
2. S5-04 first slice: remove or quarantine `machine.html` order-derived queue.
3. S5-04 second slice: shared item status adapter for production queue,
   machine, kiosk, and worker visual.
4. S5-03: order creation messaging and intake boundary cleanup.

## Verification

- Add contract tests that detect hard-coded forbidden order transitions in
  `orders.html`.
- Add contract tests that detect production screens mutating item statuses
  outside allowed `ITEM_STATUS` values.
- Run `npm test`.
- Run Edge smoke for `orders.html`, `production-queue.html`, `machine.html`,
  `kiosk.html`, and `worker-visual.html` once the smoke script includes them.
