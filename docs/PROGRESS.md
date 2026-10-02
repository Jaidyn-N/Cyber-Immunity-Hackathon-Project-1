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
  security / Tide ownership — rebinding demonstrated, supersession unresolved).
- `.kiro/specs/marketplace-beta/design.md` — the beta design (DB=SQLite/better-sqlite3, self-encrypted
  privateNote, marketplace eligibility, QEA scenario, data model, security boundaries).
- `.kiro/specs/marketplace-beta/tasks.md` — the 19-task plan (waves). THIS is the checklist being executed.

## Tide PoC — status (do NOT redo or modify)

Player B is NO LONGER blocked — the two-player investigation completed 2026-10-01 (details:
`docs/LEARNINGS.md` → "Player B ownership attestation / supersession investigation (2026-10-01)").
Capability status (no ranking/verdict — each line independent):

- [Confirmed] Bind item to owner''s VUID: Tide ownership signing works — an authenticated `vuid` is
  bound to an item via the existing `OwnershipSpike` policy; the ORKs threshold-sign a statement that
  verifies against the realm VVK.
- [Confirmed] Prevent another VUID minting an attestation for that owner: all 20 ORKs reject at PreSign.
  Demonstrated in BOTH directions (A→other and B→A).
- [Confirmed] Independent VVK verification of an attestation.
- [Confirmed] **Player B receives a new Tide ownership attestation.** A genuine second Tide-authenticated
  account (vuid `c0f0c8d6…37bb9`) signed `spike-item-0001 → B`; 64-byte threshold signature; VVK verify = true.
- [Confirmed] **Ownership rebinding via a new attestation** — the same item can receive a new attestation
  bound to Player B when B is the authenticated executor. (This is rebinding / a new attestation, NOT
  complete exclusive ownership transfer.)
- [Unproven / not provided by current contract] Previous owner''s attestation automatically invalidated;
  supersession/revocation; exclusive "latest ownership statement wins". After B signed, A''s original
  attestation STILL independently verifies against the VVK — the contract checks only
  `boundOwnerVuid == DokenDto.UserId` and holds no current-owner/version/nonce/revocation state.
- [Unproven] Full exclusive Tide-backed transfer (new owner gains authority AND previous owner loses it).
- [Confirmed] `contractId` = `72567527A84CA9F4…`; a signed policy is persisted at
  `test-artifacts-temp/OwnershipSpike.signed-policy.bin` (KEEP this file; gitignored).
- [Constraint] `OwnershipSpike` provides executor-to-bound-owner matching only — no revocation/supersession by design.

### Next unresolved Tide ownership question (NOT being implemented yet)

> **How should supersession/revocation be implemented so that a new ownership attestation makes the
> previous owner''s authority unusable?** (e.g. application-side "current owner" state treating only the
> latest VVK-signed attestation as authoritative, and/or a different contract with explicit
> versioning/revocation.) This is design-only for now — do NOT implement it as part of the beta.

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

- [x] Task 8 — Purchasing + purchase records: `POST /api/shop/purchase` (atomic `purchaseOffer` in
      `lib/db/shop.ts`): validate active/in-window offer + funds (`debitBalance`), `createInstance`
      (owner=caller, acquired_via=''shop''), `recordPurchase` — all in one transaction (rollback on failure).

- [x] Task 9 — marketplace listings: `GET /api/marketplace` (active listings + item details),
      `POST /api/marketplace/list` (create, with server-side eligibility: owns + tradable + not equipped
      + not already listed; non-negative integer price), `GET /api/marketplace/list` (own listings),
      `DELETE /api/marketplace/list/[id]` (owner-scoped cancel). Layer A only — no ownership change,
      no transaction, no Tide attestation. Repo: `createListingWithEligibility`, `cancelListing`,
      `listActiveListingsWithDetails`, `listListingsForSeller` in `lib/db/marketplace.ts`.

- [x] Task 10 — temporary **application-level** (Layer A) marketplace transfer + transaction records:
      `POST /api/marketplace/obtain` (atomic `obtainListing` in `lib/db/marketplace.ts`): validate active
      listing + seller still owns + buyer≠seller + buyer funds → debit buyer / credit seller → move
      `item_instance.owner_vuid` seller→buyer (Layer A ONLY) → clear equipped slot → record
      `marketplace_transaction` (`transfer_kind='application-level-temporary'`) → mark listing `sold`,
      all in ONE transaction (full rollback on any fault). Does NOT touch Layer C
      (`tide_ownership_attestation`), OwnershipSpike, Tide policies, DPoP, or the schema. Buyer identity
      = verified JWT vuid only; body buyer/seller/owner vuids ignored.

- [~] Task 11 — **implemented — pending live QEA verification.** QEA-governed administrative role grant
      using the EXISTING Tide IGA/QEA mechanism. New server-only IGA client `lib/tide/igaAdmin.ts`
      (`initiateRoleGrantChangeRequest` + read-only `getChangeRequest`/`listPendingChangeRequests`; NO
      approve/commit automation — that is the human enclave step) and admin-only route
      `app/api/admin/private-note-role/route.ts` (`withRole('admin')`). The route hard-restricts the
      grant target to the allowlist `_tide_privatenote.selfencrypt` / `_tide_privatenote.selfdecrypt`
      (reject 400/422 otherwise, before any CR), takes the requesting admin from the verified JWT only,
      and reports the grant as PENDING (not granted) — effective only after the Tide QEA quorum approves
      + commits via the admin browser enclave. Env/MultiAdmin limitation: TideCloak is NOT running and
      the realm is MultiAdmin (Tide) mode, so the live change-request→approve→commit flow (and the real
      threshold value, the requester-self-approval refusal, and role-becomes-effective-post-commit)
      could NOT be exercised headlessly — those are a MANUAL enclave step and remain to be live-verified.
      Governance is Tide IGA ONLY — NO application approval/quorum table or QEA state was created. No
      changes to OwnershipSpike / `tide_ownership_attestation` / marketplace-ownership logic / DPoP /
      auth config / `data/tidecloak.json` / `lib/db/schema.sql`. Headless validation (54/54 assertions,
      IGA HTTP stubbed at the igaAdmin boundary): 401 unauth, 403 player, 401 missing cnf.jkt, allowlist
      rejects arbitrary roles (initiate never called), allowlisted role → initiate called once +
      `status:'pending'`, body-supplied requester ignored, 202-CR → pending, immediate-apply (200 no CR)
      and connection-refused → clear 5xx (no pretend success), missing admin credential → fail closed.
      This demonstrates Tide GOVERNANCE (Layer B / IGA), NOT Layer C cryptographic item ownership.
      Task 12 is next.

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


