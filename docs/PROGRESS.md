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

- [x] Task 11 — **done — live QEA verified (2026-10-01)**. QEA-governed administrative role grant
      using the EXISTING Tide IGA/QEA mechanism. New server-only IGA client `lib/tide/igaAdmin.ts`
      (`initiateRoleGrantChangeRequest` + read-only `getChangeRequest`/`listPendingChangeRequests`; NO
      approve/commit automation — that is the human enclave step) and admin-only route
      `app/api/admin/private-note-role/route.ts` (`withRole('admin')`). The route hard-restricts the
      grant target to the allowlist `_tide_dob.selfencrypt` / `_tide_dob.selfdecrypt`
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
      Live QEA confirmed: grant captured as IGA change request 1957ce7d… (threshold 1), held pending,
      approved+committed in the admin console enclave; role `_tide_dob.selfencrypt` now on the user.
      See docs/LEARNINGS.md Task 11 live addendum. Task 12 is next.

- [x] Task 12 — **complete (live Tide browser verification)**. Tide-protected private note:
      server route `GET/PUT /api/account/private-note` (`withAuth` ONLY — identity, no `withRole`, no
      app role gate) stores/returns ONLY the opaque self-encrypted ciphertext (plaintext never reaches
      the server; server never decrypts/inspects). Client page `app/account/page.tsx` does `doEncrypt`
      on save / `doDecrypt` on view via `useTideCloak`, sending only ciphertext over `secureFetch`.
      **Tag coupling:** the self-encryption tag is `dob` (NOT `privatenote`) because Tide gates
      tag-based self-encryption on roles `_tide_<tag>.selfencrypt` / `_tide_<tag>.selfdecrypt`, and this
      realm provisions `_tide_dob.*` (Task 11). The account currently holds `_tide_dob.selfencrypt` but
      NOT `_tide_dob.selfdecrypt`, so live encrypt-on-save will succeed while decrypt-on-read is expected
      to be Tide-DENIED until `selfdecrypt` is also granted via the governed Task 11 flow — the intended
      WITHOUT-role→denied / WITH-role→succeeds demonstration (not worked around). Headless validation of
      the SERVER route only (the Tide SDK cannot load in Node): 7/7 cases — 401 unauth GET/PUT, store→read
      same vuid, Player A cannot read Player B's note, body vuid/ownerVuid/targetVuid ignored (identity =
      JWT), ciphertext returned byte-identical (no transform), 400 on wrong type / >100k chars / invalid
      JSON (null allowed), and no governance/role-grant symbol or `withRole` in the route code. `typecheck`
      + `build` clean; both `/account` and `/api/account/private-note` appear in the route list. LIVE Tide
      browser verification PASSED (2026-10-03): the note `Task 12 Tide private note test - Jaidyn` was
      encrypted client-side (`doEncrypt`), stored/retrieved as ciphertext, and — only AFTER
      `_tide_dob.selfdecrypt` was granted via the Task 11 governed IGA/QEA flow (approved + committed) and
      the session refreshed — decrypted client-side (`doDecrypt`) back to plaintext. Before that grant,
      decrypt was correctly Tide-DENIED (account had `_tide_dob.selfencrypt` only). The app never
      decrypted or authorized — Tide did. 7/7 headless route tests remain passed. No forbidden files
      changed; nothing committed. Task 13 is next.
- [x] Task 13 — **player isolation verified (headless cross-player suite)**. A two-VUID (Player A +
      Player B) suite drove every player-scoped route directly against a temp DB with fixture Ed25519
      DPoP-bound JWTs and asserted BOTH the HTTP status AND B's underlying DB state after each spoof.
      Result: 64/64 assertions passed and NO production code change was needed — every player-scoped
      route already derives identity ONLY from the verified JWT `auth.vuid` and ignores client-supplied
      `vuid`/`owner`/`seller`/`buyer`/`target` fields. Covered: unauthenticated + missing-`cnf.jkt` →
      401 on all protected routes; `/api/me` returns only the caller + never leaks the note ciphertext;
      inventory excludes B's instances; A cannot equip/list/cancel B's items (403, B unchanged); A's
      private-note PUT with spoofed `vuid:B`/`ownerVuid:B` writes only A's row (B's ciphertext
      byte-identical); obtain/purchase force the buyer to A and never honour a spoofed `buyerVuid`
      (spoof vuid never created/debited; B's balance+inventory unchanged); the only path param (listing
      id in cancel) is authorized by `seller_vuid === auth.vuid`, not by the path (A 403s on B's listing
      id, B 200s on the same id). Layer separation held: zero `tide_ownership_attestation` rows created.
      `typecheck` + `build` clean; the route list is unchanged (no new/auth-bypassing route; all 15
      handlers across 11 route files wrap `withAuth`/`withRole`). Throwaway harness deleted;
      `test-artifacts-temp/OwnershipSpike.signed-policy.bin` + `transfer-signatures.json` retained.
      Headless only — not a live Tide result. See docs/LEARNINGS.md Task 13 entry. Task 14 is next.
- [x] Task 14 — **admin/RBAC surface added (headless-verified)**. New admin-only endpoint
      `GET /api/admin/summary` under `withRole('admin')` proving server-side RBAC: 401 unauthenticated
      (incl. missing `cnf.jkt`), 403 for a non-admin, 200 for an admin. The admin role is read ONLY from
      the verified Tide JWT (`realm_access.roles`/`resource_access`) — body `role`/`isAdmin`/`admin` and
      `?role=` query params cannot elevate (confirmed: non-admin + those spoofs still 403). The response
      is aggregate ADMINISTRATIVE counts ONLY — `{ ok, requestedByAdminVuid: auth.vuid, summary: {
      players, itemInstances, activeListings, soldListings, cancelledListings, marketplaceTransactions,
      activeShopOffers, attestations } }` — no private player data (no ciphertext/balance/note/per-row
      field; `requestedByAdminVuid` is the verified admin vuid, never client-supplied). SQL lives in a
      new read-only `lib/db/admin.ts` (`getAdminSummaryCounts`, parameter-free `COUNT(*)` only; the
      `tide_ownership_attestation` COUNT is a count, not content). The Task 11 governed role-grant route
      (`/api/admin/private-note-role`) and `lib/tide/igaAdmin.ts` are UNCHANGED — allowlist stays exactly
      `_tide_dob.selfencrypt`/`_tide_dob.selfdecrypt`, no approve/commit logic in the app. Task 14 adds
      NO governance of its own: sensitive role changes remain governed by Tide IGA/QEA (Task 11 is the
      live demonstration); a user whose governed grant is still PENDING simply lacks the role in their
      token and is treated as a non-admin (403, deny-by-default). Does NOT touch OwnershipSpike / Forseti
      / Layer C contents / DPoP / `data/tidecloak.json` / `lib/db/schema.sql`. Headless validation 39/39
      (fixture Ed25519 DPoP-bound JWTs, temp DB, handlers invoked directly, IGA stubbed at
      `_setFetchForTests`): the auth boundary, counts-only + no-private-data scan, spoof-can't-elevate,
      seeded counts match, Task 11 regression (unauth 401 / non-admin 403 / arbitrary role 400-422 with
      initiate never called / allowlisted role → initiate once + pending; no approve/commit symbol), and
      player/admin separation (non-admin still 200 on `/api/me` + `/api/inventory`). `typecheck` + `build`
      clean; route list now includes `/api/admin/summary` alongside `/api/admin/private-note-role` and all
      prior routes; every `app/api/**/route.ts` handler still wraps `withAuth`/`withRole`. Throwaway
      harness deleted; `OwnershipSpike.signed-policy.bin` + `transfer-signatures.json` retained. Headless
      only — no live QEA claimed. See docs/LEARNINGS.md Task 14 entry. Task 15 is next.
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


