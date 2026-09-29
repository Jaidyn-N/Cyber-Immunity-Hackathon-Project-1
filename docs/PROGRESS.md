# Project Progress Checkpoint

> Purpose: a resume-from-here record so a fresh Kiro session (e.g. after moving the repo off OneDrive)
> can continue without the chat history. The authoritative detail lives in `docs/LEARNINGS.md` and
> `.kiro/specs/marketplace-beta/{requirements,design,tasks}.md`. This file is a summary/index.
>
> Last updated: 2026-09-07, after Task 7.

## What this project is

A university PoC: a Tide-protected web gaming marketplace built on an existing Next.js 16 (App Router,
React 19) + TideCloak app. Two parallel threads:

1. **Tide ownership PoC** (research) — proving Tide can bind/verify digital-item ownership authority.
2. **Marketplace beta** (application) — the playable app: shop, inventory, equip, marketplace, currency.

## Source-of-truth documents (read these first in a new session)

- `docs/LEARNINGS.md` — the living technical record. Dated sections, labelled
  `[Confirmed]/[Investigation]/[Constraint]/[Blocked]`. Covers the Tide PoC results AND the beta
  implementation (Tasks 0-7).
- `docs/SYSTEM-ARCHITECTURE.md` — the three-layer model (A: app/DB, B: TideCloak auth, C: Tide ownership).
- `docs/DEVELOPMENT-BACKLOG.md` — task backlog / critical path.
- `.kiro/specs/marketplace-beta/requirements.md` — 17 requirements in 3 categories (Core beta / Tide
  security / blocked Tide ownership).
- `.kiro/specs/marketplace-beta/design.md` — the beta design (DB=SQLite/better-sqlite3, self-encrypted
  privateNote, marketplace eligibility, QEA scenario, data model, security boundaries).
- `.kiro/specs/marketplace-beta/tasks.md` — the 19-task plan (waves). THIS is the checklist being executed.

## Tide PoC — status (do NOT redo or modify)

- [Confirmed] Tide ownership signing works: an authenticated `vuid` is bound to an item via the existing
  `OwnershipSpike` Forseti policy; the ORKs threshold-sign a statement that verifies against the realm VVK.
- [Confirmed] Deny path: an unauthorised VUID cannot sign for another VUID — all 20 ORKs reject at PreSign.
- [Confirmed] `contractId` = `72567527A84CA9F4…`; a signed policy is persisted at
  `test-artifacts-temp/OwnershipSpike.signed-policy.bin` (KEEP this file; gitignored).
- [Blocked] Second player (Player B) enrolment fails on an upstream ORK Fabric outage
  (`TidecloakSessionStartTokenSign` 500s). So Tide-backed TRANSFER and SUPERSESSION are unproven/blocked.
- [Constraint] `OwnershipSpike` provides owner-bound signing but NOT revocation/supersession by design.
- **RULES:** do NOT modify `OwnershipSpike` / Tide policies / TideCloak config / DPoP; do NOT fake
  Player B; do NOT represent the beta''s DB (Layer A) transfer as Tide-backed (Layer C).

## Marketplace beta — task status

DONE and approved:
- [x] Task 0 — cleanup + `better-sqlite3@13.0.3` installed (prebuilt win32-x64 binary).
- [x] Task 1 — `lib/db/schema.sql` (7 Layer A tables + separate Layer C `tide_ownership_attestation`).
- [x] Task 2 — `lib/db/` connection (lazy singleton, `foreign_keys=ON`, WAL) + repositories
      (`players.ts`, `items.ts`, `shop.ts`, `marketplace.ts`, `types.ts`, `index.ts`).
- [x] Task 3 — `lib/auth/` (`tidecloakConfig.ts`, `tideJWT.ts`, `protect.ts` withAuth/withRole,
      `currentPlayer.ts`). Verifies JWT via local JWKS, issuer+azp, non-empty vuid, asserts `cnf.jkt`.
- [x] Task 4 — `GET /api/me` (profile/currency/equipped); guarded `creditBalance`/`debitBalance`
      + `InsufficientFundsError` in `players.ts`.
- [x] Task 5 — `GET /api/inventory` (owned instances + details + equipped flag, per-vuid scoped).
- [x] Task 6 — `POST/GET /api/inventory/equip` (equip owned only, unequip via null; server ownership check).
- [x] Task 7 — rotating shop: `lib/db/seed.ts` (catalogue), `lib/shop/rotation.ts` (1h window,
      capacity 4, seeded deterministic selection), `GET /api/shop`, + `materialiseRotation`/
      `hasOffersForWindow` in `shop.ts`.

NEXT — start here in the new session:
- [ ] **Task 8 — Purchasing and purchase records.** `POST /api/shop/purchase`: in ONE DB transaction,
      validate the offer is active/in-window (`isOfferPurchasable`) and the player has funds
      (`debitBalance` guard), then `items.createInstance(owner=caller, acquired_via='shop')` and
      `shop.recordPurchase(...)`. Reject unavailable item / insufficient funds (rollback, no state change).
      Requirements 5.4, 6.1-6.5, 8.2.

REMAINING after Task 8:
- [ ] Task 9 — marketplace listings (`/api/marketplace/list`, `/api/marketplace`).
- [ ] Task 10 — temporary Layer A marketplace transfer + transaction records (`/api/marketplace/obtain`).
- [ ] Task 11 — QEA-governed `_tide_privatenote.*` voucher-gate role grant (GATE; STOP-AND-REPORT if
      ORK/QEA blocked; do not weaken).
- [ ] Task 12 — Tide-protected private note (self-encryption; `GET/PUT /api/account/private-note`; `app/account`).
- [ ] Task 13 — player isolation/security checks.
- [ ] Task 14 — admin/RBAC surface (`/api/admin/*` withRole('admin')) + QEA doc.
- [ ] Task 15 — frontend pages + nav (shop/inventory/marketplace/account; dashboard).
- [ ] Task 16 — end-to-end beta flow (also first LIVE-token exercise of the APIs).
- [ ] Task 17 — negative/security tests.
- [ ] Task 18 — docs + cleanup.

## Working conventions established (follow these)

- One task at a time; STOP and report after each; wait for approval before the next.
- Identity = verified JWT `vuid` only (via `withAuth`/`getOrCreateCurrentPlayer`); never trust a
  client-supplied vuid. All security checks server-side. `cnf.jkt` required (DPoP).
- Raw SQL only inside `lib/db/`; parameterised; server-only (`typeof window` guard, no `server-only` dep).
- Layer A (`item_instance.owner_vuid`) is application ownership; Layer C (`tide_ownership_attestation`)
  is Tide authority — kept strictly separate; the marketplace transfer updates ONLY Layer A and labels
  it `transfer_kind='application-level-temporary'`.
- No test framework: validation via throwaway Node `.mjs` scripts with a resolve hook that maps `@/` and
  extensionless imports to `.ts`, using a fixture Ed25519 key + temp DB (`APP_DB_PATH` override), removed
  after each run. Real signature verification (not faked). Keep the DB path override + `_resetForTests`
  seams in `lib/db/index.ts` and `lib/auth/*`.
- AVOID TypeScript parameter properties in `lib/` (Node strip-only mode used by validation scripts rejects them).
- After each task: `npm run typecheck` + `next build --webpack`; update `docs/LEARNINGS.md` with a dated subsection.

## Environment notes

- `better-sqlite3@13.0.3` + `@types/better-sqlite3@9.6.0` installed. DB file: `data/app.db` (gitignored).
- .NET 8 SDK at `C:\Program Files\dotnet\dotnet.exe` (used for the Tide Forseti compile harness; not needed for the beta).
- TideCloak runs in Docker at `http://localhost:8080`, realm `login-app-with-tidecloak`. Login -> dashboard works.
- [Constraint] **OneDrive path caused intermittent `next build` failures**: `EPERM: unlink
  '.next\server\app\api\...'` during finalisation (transient OneDrive/AV lock; compile itself always
  succeeds). Workaround was to delete `.next` before building. **Moving the repo off OneDrive should
  remove this** — after the move, re-run `npm install` (native `better-sqlite3` binary) and a clean
  `npm run build` to confirm.

## After moving the repo (checklist for the new session)

1. `npm install` (rebuild/relink `better-sqlite3`).
2. `npm run typecheck` and `npm run build --webpack` — expect clean (no more EPERM off OneDrive).
3. Confirm `data/tidecloak.json`, `test-artifacts-temp/OwnershipSpike.signed-policy.bin`, and `docs/*`
   came across intact.
4. Read `docs/LEARNINGS.md` + `.kiro/specs/marketplace-beta/tasks.md`, then resume at Task 8.
