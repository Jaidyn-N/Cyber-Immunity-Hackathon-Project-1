# Handoff Test Plan — Marketplace Beta

A practical, self-contained plan so a developer who is **not** the original author can set the project
up, run it, exercise the full flow, and reproduce the key Tide demonstrations. No secrets appear in this
file — all credentials are local-only and must be supplied separately.

Companion docs: `README.md` (run guide), `docs/SECURITY-TEST-PLAN.md` (automated security matrix),
`docs/SYSTEM-ARCHITECTURE.md` (layers + API surface), `docs/LEARNINGS.md` (dated evidence).

---

## 1. Setup

1. Install **Node v24 + npm**, **Docker**, and (optional, Layer C research only) the **.NET 8 SDK**.
2. `npm install` (builds the native `better-sqlite3` binary).
3. Copy the env template and fill in your own **local** values: `cp .env.example .env`, then edit.
   Required names (values supplied separately, never committed): `TIDECLOAK_URL`, `TIDECLOAK_REALM`,
   `TIDECLOAK_CLIENT_ID`, `KC_BOOTSTRAP_ADMIN_USERNAME`, `KC_BOOTSTRAP_ADMIN_PASSWORD`,
   `TIDE_OPERATOR_EMAIL`, and the Task 11 admin credentials (`TIDE_ADMIN_REALM` / `TIDE_ADMIN_USERNAME`
   / `TIDE_ADMIN_PASSWORD`, or `TIDE_ADMIN_TOKEN`, or `TIDE_ADMIN_CLIENT_ID` + `TIDE_ADMIN_CLIENT_SECRET`).
4. Start TideCloak in Docker (e.g. `./scripts/init-tidecloak.ps1`); wait for
   `http://localhost:8080/health/ready` → 200. Realm: `login-app-with-tidecloak`.
5. `npm run dev` → open `http://localhost:3000`.
6. The SQLite DB (`data/app.db`) auto-creates and seeds on first use. To reset: stop the app, delete
   `data/app.db*`.

Expected result: the home page loads and offers a login button; no console errors about missing config.

---

## 2. Test accounts and permissions

Credentials are **supplied separately and are local-only** — none are listed here.

- **Player A — the admin / primary account.** Holds the Tide realm `admin` role and the governed
  voucher roles `_tide_dob.selfencrypt` / `_tide_dob.selfdecrypt` (granted via the Task 11 flow). Use A
  to exercise the admin surface and the full private-note encrypt + decrypt round-trip.
- **Player B — a second, genuine Tide account.** A real separate Tide-linked user with its own `vuid`.
  Used for the two-player marketplace obtain. B does not need the admin role.

Permissions are enforced **server-side** from the verified JWT only. A normal user is denied the admin
surface (403). Identity is never taken from the request body/query.

---

## 3. Core user flow (manual script)

Run as Player A unless noted. Each step lists the expected result.

1. **Login.** Click login → complete the Tide enclave. Expected: redirected back authenticated;
   nav shows Shop / Inventory / Marketplace / Account (and Admin only for an admin).
2. **Profile / currency.** Open **Account**. Expected: display name, a starting simulated balance,
   equipped item (none yet), and whether a private note exists.
3. **Shop.** Open **Shop**. Expected: the current rotation's offers (names, rarity, price) and your
   balance. The rotation window is 1 hour; capacity is 5 items.
4. **Purchase.** Buy an affordable item. Expected: balance decreases by the price; a success message;
   the item now appears in Inventory. Buying with insufficient funds is rejected with no balance change.
5. **Inventory + equip.** Open **Inventory**, click **Equip** on an owned item. Expected: an "Equipped"
   badge; the Account page shows it as equipped. Equipping an item you don't own is impossible from the
   UI and rejected (403) server-side.
6. **List on the marketplace.** Open **Marketplace → Create listing**, pick an eligible
   (tradable, unequipped, not already listed) item, set a price, submit. Expected: it appears under
   "My listings" as active, and in the public browse list.
7. **Two-player obtain.** In a separate browser/profile, log in as **Player B**. Open Marketplace,
   find A's listing, click **Obtain**. Expected: B's balance decreases, A's increases; the item's
   application ownership moves A→B; the listing becomes `sold`; the UI states this is a **temporary
   application-level ownership change, NOT a Tide-backed transfer**. Back as A, the item is gone from A's
   inventory; as B it is present and equippable.
8. **Private note (Account).** As A, type a note and **Save**. Expected: it is encrypted client-side
   (Tide `doEncrypt`, tag `dob`) and only ciphertext is sent; **View/decrypt** returns the plaintext
   (requires `_tide_dob.selfdecrypt`). The server never sees plaintext.

---

## 4. Tide authentication / access-control checks

1. **DPoP binding (`cnf.jkt`).** Every protected API requires a DPoP-bound token. A request with no
   `Authorization`, or a token lacking `cnf.jkt`, returns **401**. (Covered automatically — see §5.)
2. **Server-side role gate.** `GET /api/admin/summary` and `POST /api/admin/private-note-role` require
   the verified `admin` role. A non-admin gets **403**; body `role`/`isAdmin` or `?role=admin` cannot
   elevate. An admin gets 200.
3. **Governed role grant (QEA).** `POST /api/admin/private-note-role` only *initiates* an IGA change
   request (allowlisted to `_tide_dob.selfencrypt` / `_tide_dob.selfdecrypt`). The role is **not**
   effective until it is **approved and committed in the admin browser enclave**. A pending grant is not
   reflected in the token (deny-by-default).

---

## 5. Negative / security cases

These are automated and repeatable:

```bash
npm run test:security   # expect 119/119, exit 0
```

The suite covers: unauthenticated access (401), missing `cnf.jkt` (401), expired/bad-signature tokens
(401), cross-player read/mutate denied (A cannot see or change B's data), equip-not-owned (403),
purchase unavailable item / insufficient funds (rejected, no state change), list unowned (403) /
already-listed (rejected), obtain invalid/expired listing (rejected) and replay (409), marketplace
transaction rollback on forced fault, **0 Tide attestation rows written by obtain** (Layer A/C
boundary), private-note owner-only + opaque ciphertext, and admin-only ops (403 for non-admin). The full
matrix (groups A–I) is in `docs/SECURITY-TEST-PLAN.md`. Every negative case also asserts the target
state is unchanged.

---

## 6. Expected results (summary)

- Core flow steps 1–8 all succeed as described; ownership and balances move correctly on obtain.
- `npm run test:security` → 119/119, exit 0.
- `npm run typecheck` and `npm run build` → clean.
- No protected route is reachable without a valid DPoP-bound token; no request-body field can change
  identity or role.

---

## 7. Known limitations (documented, not failures)

- **Four-eyes / two-person approval is not demonstrated** — the live QEA threshold is 1.
- **No supersession/revocation** — after a second owner is bound via `OwnershipSpike`, the previous
  owner's attestation still verifies against the VVK.
- **No exclusive Tide-backed marketplace transfer** — the beta "obtain" is a **Layer A** application
  transfer only; it never writes `tide_ownership_attestation` and never calls `OwnershipSpike`.
- Non-blocking scope/UI items: 1-hour shop rotation; 5-item shop capacity; a single equipped item (no
  equipment-slot system); some item ids are shown where the API carries no name; the auth-demo and
  dashboard nav are slightly redundant.

---

## 8. Reproducing the key demonstrations

- **Task 11 — governed role grant (live QEA).** As an admin, call
  `POST /api/admin/private-note-role` (allowlisted role) to initiate the IGA change request, then
  **approve + commit it in the admin console enclave**. After a token refresh the user holds the role.
  Original evidence: change request `1957ce7d…`, threshold 1, 2026-10-01 (`docs/LEARNINGS.md`).
- **Task 12 — Tide private note (without → denied / with → succeeds).** On `/account`, before
  `_tide_dob.selfdecrypt` is granted, encrypt-on-save works but decrypt-on-read is **Tide-denied**.
  After the governed grant is approved + committed and the session refreshes, decrypt succeeds and
  returns the plaintext client-side. The app never decrypts.
- **Task 16 — two-player obtain.** Follow §3 steps 6–7 with two real Tide accounts. Confirm the Layer A
  ownership move and balance changes, and that no Tide attestation row is created (verify via
  `GET /api/admin/summary`'s `attestations` count staying 0, or the §5 suite's Layer A/C boundary check).
