# Implementation Plan — Marketplace Beta

Ordered, dependency-aware tasks derived from `requirements.md` and `design.md`. Categories 1 and 2 are
implemented; Category 3 (Tide-backed transfer/supersession) is NOT implemented. The existing
`OwnershipSpike` policy is untouched, DPoP/TideCloak auth preserved, and the temporary marketplace
transfer updates ONLY the Layer A `item_instance.owner_vuid` (never `tide_ownership_attestation`).

Conventions: check off with `[x]`. Each task lists `_Requirements:_` it satisfies. Run
`npm run typecheck` (and `npm run build` at stage checkpoints) after each major stage.

## Overview

This plan implements the Marketplace Beta (Categories 1 and 2) on the existing TideCloak app. It is
ordered by dependency: data layer → auth foundation → player data → inventory/equip → shop/purchase →
marketplace (Layer A transfer) → Tide-protected private note (gated by a QEA role grant) → admin/RBAC →
frontend + end-to-end flow → testing + docs. Category 3 (Tide-backed transfer/supersession) is out of
scope and forbidden here. Run `npm run typecheck` after each stage and `npm run build` at checkpoints.

## Tasks
- [ ] 0. Pre-implementation cleanup and dependency setup
  - [ ] 0.1 Remove leftover temporary transfer test files: delete `app/tide-transfer-temp/` and
    `app/api/tide-transfer-temp/`. KEEP `test-artifacts-temp/` (persisted signed policy for ongoing Tide research).
  - [ ] 0.2 Install `better-sqlite3` (+ `@types/better-sqlite3`). Confirm `data/*.db` is gitignored (it is).
  - [ ] 0.3 Verify baseline still green: `npm run typecheck` and login → dashboard unaffected.
  - _Requirements: 9 (preserve auth), 17.3 (no OwnershipSpike change)_

## Stage A — Data layer

- [ ] 1. Database setup and schema
  - [ ] 1.1 Create `lib/db/schema.sql` with all Layer A tables (player, item_template, item_instance,
    shop_offer, purchase_record, marketplace_listing, marketplace_transaction) and the SEPARATE Layer C
    table `tide_ownership_attestation`, per the design data model. UUID string PKs.
  - [ ] 1.2 Create `lib/db/index.ts`: open `data/app.db` via `better-sqlite3` once (lazy singleton),
    apply `schema.sql` idempotently at first use. Server-only (never imported by client components).
  - [ ] 1.3 Add a small `scripts/inspect-db.mjs` (read-only) used later to demonstrate ciphertext-at-rest.
  - _Requirements: 3.1, 8, 11.2_

- [ ] 2. Server-side repositories
  - [ ] 2.1 `lib/db/players.ts` — get/create player by `vuid`, get/adjust balance, get/set equipped, get/set private_note_ciphertext.
  - [ ] 2.2 `lib/db/items.ts` — templates, item_instance create/read, ownership read, transfer owner (Layer A only), equip helpers.
  - [ ] 2.3 `lib/db/shop.ts` — read/refresh current offers; purchase-record writes.
  - [ ] 2.4 `lib/db/marketplace.ts` — listing create/read/settle; transaction writes (always `transfer_kind='application-level-temporary'`).
  - [ ] 2.5 Seed data: `lib/db/seed.ts` seeds item_templates (all `tradable: true`) idempotently on first run.
  - _Requirements: 1.2, 3.1, 5, 6, 7, 8_

## Stage B — Auth foundation (preserve existing Tide)

- [ ] 3. Server-side authentication and `vuid` ownership checks
  - [ ] 3.1 `lib/auth/tidecloakConfig.ts` — load `data/tidecloak.json` (env override), require `jwk` (local JWKS only, I-04).
  - [ ] 3.2 `lib/auth/tideJWT.ts` — `verifyTideJWT` (issuer + `azp` + exp/iat), `hasRole`, `extractToken` (Bearer/DPoP).
  - [ ] 3.3 `lib/auth/protect.ts` — `withAuth` (assert `cnf.jkt`, `REQUIRE_DPOP=true`, fail closed 401), `withRole` (403). Do NOT re-verify secureFetch DPoP proof (assert binding only).
  - [ ] 3.4 `lib/auth/currentPlayer.ts` — helper that maps verified JWT → `vuid` and get-or-create player row.
  - [ ] 3.5 Unit tests: valid/invalid/expired token; missing `cnf.jkt` → 401; role present/absent.
  - _Requirements: 1.1, 1.4, 9.1, 9.2, 9.3, 9.4_
  - _Checkpoint: `npm run typecheck`; confirm existing login → dashboard still works._

## Stage C — Core player data

- [ ] 4. Player / profile / currency
  - [ ] 4.1 `app/api/me/route.ts` (GET, `withAuth`): returns caller''s profile, balance, equipped instance; creates player on first call with a starting simulated balance.
  - [ ] 4.2 Ensure `vuid` comes ONLY from the verified JWT (never body/query) — the identity boundary.
  - [ ] 4.3 Tests: unauthenticated → 401; authenticated returns only the caller''s record.
  - _Requirements: 1.2, 2.1, 2.2_

## Stage D — Inventory and equipping

- [ ] 5. Inventory
  - [ ] 5.1 `app/api/inventory/route.ts` (GET, `withAuth`): list item_instances where `owner_vuid == caller vuid`, joined to template details (name, category, rarity, equipped flag).
  - [ ] 5.2 Tests: unauthenticated → 401; a player never sees another player''s instances.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 6. Equipping and avatar state
  - [ ] 6.1 `app/api/inventory/equip/route.ts` (POST, `withAuth`): verify caller owns the instance (server-side); set `player.equipped_instance_id`; persist.
  - [ ] 6.2 Reject equipping an instance the caller does not own → 403, no change.
  - [ ] 6.3 Tests: equip owned (ok); equip not-owned (403); equipped state persists and is returned by `/api/me`.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Checkpoint: `npm run typecheck`._

## Stage E — Shop and purchasing

- [ ] 7. Randomised / rotating limited shop
  - [ ] 7.1 `lib/shop/rotation.ts` — compute the active offer set from a time-window seed (deterministic within a window, randomised across windows); no admin hand-picking.
  - [ ] 7.2 `app/api/shop/route.ts` (GET, `withAuth`): return current offers, refreshing `shop_offer` rows if the window rolled over.
  - [ ] 7.3 Tests: rotation changes across windows; an item not in the current window is absent.
  - _Requirements: 5.1, 5.2, 5.3_

- [ ] 8. Purchasing and purchase records
  - [ ] 8.1 `app/api/shop/purchase/route.ts` (POST, `withAuth`): in ONE DB transaction — validate the offer is active/in-window, validate balance, deduct price, create `item_instance` (owner = caller, acquired_via='shop'), write `purchase_record`.
  - [ ] 8.2 Reject: item not in rotation → rejected; insufficient funds → rejected, no state change (rollback).
  - [ ] 8.3 Confirm rotation change does NOT alter existing `owner_vuid` (ownership persists past shop).
  - [ ] 8.4 Tests: successful purchase; unavailable item; insufficient currency; purchase record written.
  - _Requirements: 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 8.2_
  - _Checkpoint: `npm run typecheck`._

## Stage F — Marketplace (Layer A only)

- [ ] 9. Marketplace listings
  - [ ] 9.1 `app/api/marketplace/list/route.ts` (POST, `withAuth`): verify caller owns the instance, it is `tradable`, not equipped, not already actively listed; create `marketplace_listing`.
  - [ ] 9.2 `app/api/marketplace/route.ts` (GET): return active listings with basic item/price info.
  - [ ] 9.3 Reject: list unowned → 403; list already-listed → rejected.
  - [ ] 9.4 Tests: list eligible (ok); list unowned (403); list already-listed (rejected); unavailable-in-shop item still listable.
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 10. Temporary application-level marketplace transfer + transaction records
  - [ ] 10.1 `app/api/marketplace/obtain/route.ts` (POST, `withAuth`): in ONE DB transaction — validate listing active, buyer≠seller, buyer funds; set `item_instance.owner_vuid = buyer` (LAYER A ONLY); clear seller''s equipped slot if it was this instance; move currency; mark listing `sold`; write `marketplace_transaction` with `transfer_kind='application-level-temporary'`.
  - [ ] 10.2 MUST NOT write/alter `tide_ownership_attestation`. MUST NOT call `OwnershipSpike`. Response + record explicitly labelled temporary/application-level, NOT Tide-backed.
  - [ ] 10.3 Tests: successful transfer (owner_vuid changes); invalid/expired listing → rejected; buyer insufficient funds → rejected (rollback); previous owner loses application access (equip/list now 403); new owner gains access (can equip/list).
  - _Requirements: 7.5, 7.6, 7.7, 8.1, 8.3, 17.1, 17.2, 17.3_
  - _Checkpoint: `npm run typecheck`; `npm run build`._

## Stage G — Tide-protected private data (Category 2)

- [x] 11. QEA-governed voucher-gate role grant (governance demonstration) — GATE for task 12. Live-verified 2026-10-01: CR 1957ce7d…, threshold 1, approved+committed in enclave; `_tide_dob.selfencrypt` granted.
  - [x] 11.1 Ensure the current player holds `_tide_dob.selfencrypt` / `_tide_dob.selfdecrypt`. If absent, grant via the existing TideCloak IGA/QEA process (change request → approve/commit). Do NOT bypass or fake governance.
  - [x] 11.2 Document the grant as the concrete QEA scenario (who requests, who approves, what''s protected, pending-not-applied behaviour).
  - [x] 11.3 **STOP-AND-REPORT gate:** if the grant cannot complete due to the Tide/ORK/QEA blocker, stop task 12, report the blocker, and do NOT weaken the security requirement (no plaintext fallback).
  - _Requirements: 13.1, 13.2, 13.3, 11 (dependency)_

- [ ] 12. Tide-protected private note
  - [ ] 12.1 `app/api/account/private-note/route.ts` — GET returns stored ciphertext for caller; PUT stores caller-supplied ciphertext. Server never sees/handles plaintext.
  - [ ] 12.2 `app/account/page.tsx` — client: `doEncrypt` on save, `doDecrypt` on view (tag `privatenote`), via `useTideCloak`.
  - [ ] 12.3 Demonstrate ciphertext-at-rest with `scripts/inspect-db.mjs` (column is opaque base64, not the typed text; contrast with plaintext `display_name`).
  - [ ] 12.4 Tests: owner can round-trip encrypt/decrypt; stored value is not plaintext; server returns only the caller''s row.
  - _Requirements: 10.1, 10.2, 11.1, 11.2, 11.3_

- [x] 13. Player isolation / security checks — player isolation verified (headless two-VUID cross-player suite, 64/64; no production code change needed).
  - [x] 13.1 Confirmed every player-scoped API derives identity from the verified JWT `vuid` and ignores client-supplied vuid/owner/seller/buyer/target fields. Explicit two-VUID tests: A cannot read B's inventory (excluded), read B's private note (gets null / only own), or mutate B's items/listing/note/balance (403/404; B's DB state byte-identical after every spoof). Harness thrown away; `OwnershipSpike.signed-policy.bin` + `transfer-signatures.json` retained.
  - [x] 13.2 Recorded the cross-player *decryption refusal* as asserted-by-construction (self-encryption identity-bound, Task 12). This task proves the server-side query-scoping/identity boundary (Layer B); the decryption refusal holds by construction independent of it. Headless only — not a live Tide result.
  - _Requirements: 12.1, 12.2, 12.3_

## Stage H — Admin / RBAC

- [x] 14. QEA-governed admin operation surface
  - [x] 14.1 `app/api/admin/summary/route.ts` (GET, `withRole('admin')`): a minimal admin-only endpoint proving server-side RBAC.
  - [x] 14.2 Document that the security-sensitive admin change (role grant, incl. task 11) is governed by IGA/QEA and not applied while a change request is PENDING.
  - [x] 14.3 Tests: non-admin → 403; admin → 200; unapproved/pending governed change is not reflected (deny-by-default).
  - _Requirements: 1.3, 13.1, 13.2, 13.3_

## Stage I — Frontend and end-to-end flow

- [x] 15. Frontend pages and navigation — implemented; live browser click-through PENDING. Shared
  auth-gated route group `app/(app)/` + persistent `AppNav`; pages consume existing APIs via
  `secureFetch` (absolute URLs); `/account` moved into the group (old file deleted, single route);
  minimal read-only `/admin`. `typecheck`+`build` clean. No API/auth/schema/Tide-config/Task 10-14
  change. Nothing committed.
  - [x] 15.1 Dashboard gained nav links to shop/inventory/marketplace/account; the `/account` page shows profile/currency/equipped via `GET /api/me` (shared auth-gated group also renders the persistent nav). `dashboard/layout.tsx` auth logic unchanged.
  - [x] 15.2 `/shop`, `/inventory`, `/marketplace`, `/account` (moved from `app/account/page.tsx`) wired to the APIs via `secureFetch`. Admin-link visibility uses `hasRealmRole('admin')` (UI gating only; server authoritative). Marketplace labels obtain as temporary application-level (NOT Tide-backed). Task 12 private-note preserved exactly.
  - [x] 15.3 UI kept simple; ALL authed calls go through `secureFetch` with absolute URLs — grep confirms no bare `fetch(` and no manual `Authorization`/`DPoP`/`Bearer` header in the new client code.
  - _Requirements: 2.2, 3.x, 4.3, 5.1, 7.3, 7.7, 11.x_

- [x] 16. Complete beta user flow (integration) — Live browser E2E verified 2026-10-03 (all 8 steps incl. real two-player obtain; Layer A transfer).
  - [x] 16.1 Wire and manually verify: login → profile/currency/inventory → shop → purchase → inventory → equip → avatar shows equipped → list eligible item → (second login) obtain listing → Layer A ownership changes → previous owner loses app access → new owner gains it → private note encrypt/decrypt.
  - [x] 16.2 Note in the flow which steps are app-level (Layer A) vs Tide ownership (Layer C). Player B / rebinding is demonstrated (2026-10-01); exclusive Tide-backed transfer + supersession remain UNRESOLVED and out of beta scope.
  - _Requirements: Success Condition; 1-13, 17_
  - _Checkpoint: `npm run typecheck`; `npm run build`._

## Stage J — Testing and documentation

- [ ] 17. Negative / security testing (server-enforced)
  - [ ] 17.1 Add/collect tests: unauthenticated access (401); cross-player inventory/private-note access (denied); equip not-owned (403); purchase unavailable item (rejected); list unowned (403); list already-listed (rejected); obtain invalid/expired listing (rejected); insufficient currency (rejected); successful purchase; successful marketplace transfer; previous owner loses app access; new owner gains access; private note owner-only; admin-only ops (403 for non-admin); QEA pending change not applied.
  - [ ] 17.2 Ensure every security-sensitive check is SERVER-side (not frontend); no check weakened to make the demo pass.
  - _Requirements: 1.4, 4.4, 6.2, 6.3, 7.2, 7.5, 9.3, 12.1, 12.2, 13, 17_

- [ ] 18. Documentation and cleanup
  - [ ] 18.1 Update `docs/LEARNINGS.md`: [Confirmed] implemented features and decisions; [Constraint] Category 3 — rebinding demonstrated (2026-10-01), supersession unresolved, still out of beta scope; any errors + fixes.
  - [ ] 18.2 Update `docs/DEVELOPMENT-BACKLOG.md`: mark SHOP-1/INV-1/MKT-1 (and DATA-1/AUTH-1/AUTH-2 as applicable) progressed; note temporary-transfer status.
  - [ ] 18.3 Confirm temp test app files removed; `test-artifacts-temp/` retained; no OwnershipSpike change; DPoP/auth intact.
  - _Requirements: documentation; 17 (guards)_
  - _Checkpoint: final `npm run typecheck` + `npm run build`._

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["0"], "description": "Cleanup + install better-sqlite3; verify baseline" },
    { "wave": 2, "tasks": ["1", "3"], "description": "DB schema/connection; auth foundation (independent)" },
    { "wave": 3, "tasks": ["2"], "description": "Server-side repositories (needs schema)" },
    { "wave": 4, "tasks": ["4"], "description": "Player/profile/currency (needs repositories + auth)" },
    { "wave": 5, "tasks": ["5", "7"], "description": "Inventory; shop rotation (need player layer)" },
    { "wave": 6, "tasks": ["6", "8"], "description": "Equipping; purchasing + records" },
    { "wave": 7, "tasks": ["9"], "description": "Marketplace listings (need equip + purchase)" },
    { "wave": 8, "tasks": ["10"], "description": "Temporary Layer A transfer + transaction records" },
    { "wave": 9, "tasks": ["11"], "description": "QEA voucher-gate role grant (GATE; may STOP-AND-REPORT)" },
    { "wave": 10, "tasks": ["12", "14"], "description": "Private note (needs 11); admin/RBAC (needs auth)" },
    { "wave": 11, "tasks": ["13"], "description": "Player isolation checks (needs inventory + private note)" },
    { "wave": 12, "tasks": ["15"], "description": "Frontend pages + navigation (needs APIs)" },
    { "wave": 13, "tasks": ["16"], "description": "Complete beta user flow (integration)" },
    { "wave": 14, "tasks": ["17"], "description": "Negative/security testing" },
    { "wave": 15, "tasks": ["18"], "description": "Documentation and cleanup" }
  ]
}
```

Dependency notes:
- Task 2 needs 1; task 4 needs 2 and 3; 5/7 need 4; 6 needs 5; 8 needs 7 (and 2).
- 9 needs 6 + 8; 10 needs 9. 11 gates 12 (may stop the private-note branch if the ORK/QEA blocker hits).
- 12 needs 3 + 11; 13 needs 5 + 12; 14 needs 3. 15 needs the APIs (4-14); 16 needs 15; 17 needs the
  features under test; 18 last.
## Notes

- **Layer separation (non-negotiable):** `item_instance.owner_vuid` = Layer A application ownership;
  `tide_ownership_attestation` = Layer C Tide authority. Task 10 updates ONLY Layer A and never writes
  Layer C, never calls `OwnershipSpike`, and labels the transfer temporary/application-level.
- **QEA gate (task 11):** if the voucher-gate role grant cannot complete due to the Tide/ORK/QEA
  blocker, STOP task 12 and report — do not add a plaintext fallback or otherwise weaken Requirement 11.
- **Preserve existing Tide:** do not remove DPoP, do not replace TideCloak auth, do not weaken
  server-side ownership checks, do not modify `OwnershipSpike`.
- **Category 3 status:** second Tide player (Player B) and ownership rebinding are **demonstrated**
  (2026-10-01); **exclusive Tide-backed transfer and supersession/revocation remain UNRESOLVED** (not
  provided by the current `OwnershipSpike` contract). All of Category 3 is intentionally excluded from
  every task above regardless — this beta implements only Layer A/B.

## Explicitly NOT in this plan (Category 3 — excluded from the beta / forbidden)

- No second Forseti ownership contract; no modification to `OwnershipSpike`.
- No Tide-backed transfer; no minting a new signed statement to a buyer.
- No supersession/revocation / latest-valid-attestation logic.
- No representing the Layer A transfer as Tide-backed (Player B is real now, but the beta transfer is still Layer A only).
- No removal of DPoP; no replacement of TideCloak auth; no weakening of server-side ownership checks.


