# Design Document — Marketplace Beta

## Overview

This design implements the working beta defined in `requirements.md`, on top of the existing
auth-only Next.js 16 + TideCloak app. It preserves the three-layer architecture from
`docs/SYSTEM-ARCHITECTURE.md`:

- **Layer A** — application/database functionality: profile, currency, inventory, shop, marketplace,
  records, and the **temporary application-level ownership transfer**.
- **Layer B** — TideCloak authentication, DPoP, RBAC; `vuid` as the player identity. **Preserved unchanged.**
- **Layer C** — Tide ownership authority (VVK-verifiable statements via the existing `OwnershipSpike`
  policy). **Not extended in this beta**; storage/verify of already-provable statements only.

The beta delivers Category 1 (core) and Category 2 (Tide security) in full, and explicitly does NOT
implement Category 3 (Tide-backed transfer / supersession), which is blocked by the Player B / ORK
issue recorded in `docs/LEARNINGS.md`. The `OwnershipSpike` contract/policy is untouched.

Design principle throughout: **the DB ownership record is never presented as cryptographic proof of
ownership.** Layer A ownership answers "what the application currently shows"; Layer C answers "what the
ORK network cryptographically attested." They are stored and labelled separately.

## Architecture

The system keeps the three layers from `docs/SYSTEM-ARCHITECTURE.md` strictly separated:

- **Layer A (application/DB):** SQLite (`data/app.db`) via `better-sqlite3`, accessed only server-side
  through `lib/db/` repositories. Holds profile, currency, inventory, shop offers, listings, records,
  and the application ownership record (`item_instance.owner_vuid`). This layer performs the temporary
  marketplace transfer.
- **Layer B (identity/authorization):** existing TideCloak OIDC + DPoP (`strict`/`ES256`) + RBAC,
  preserved unchanged. Server-side `verifyTideJWT` (local JWKS, assert `cnf.jkt`) derives the acting
  `vuid` and enforces roles on every protected API.
- **Layer C (Tide ownership authority):** the existing `OwnershipSpike` VVK-verifiable statements.
  In this beta, Layer C is storage/verify only (`tide_ownership_attestation` table); it is NOT extended
  and is NOT moved by the marketplace. Category 3 (transfer/supersession) is blocked.

Request path: Player Browser → (DPoP `secureFetch`) → Next.js API route (`withAuth`/`withRole`) →
`lib/db` repositories → SQLite. Identity/crypto side calls go Browser ↔ TideCloak/ORKs. The full
component diagram is in the Architecture Diagram section below.
## Resolved Design Questions

### 1. Database — SQLite via `better-sqlite3`

**Selected:** a single local **SQLite** database file accessed through **`better-sqlite3`** (synchronous,
zero external services), with all access behind a small repository module (`lib/db/`).

- **Why:** simplest reliable option for a local university PoC; no server/container to run beyond
  TideCloak; synchronous API is easy to reason about in Next.js route handlers; persists across sessions
  and app restarts as a file. Avoids introducing Postgres/Docker infra the beta does not need.
- **How accessed:** only from the server side (route handlers / server modules) via `lib/db/index.ts`
  (opens the connection once) and typed repository functions (`lib/db/players.ts`, `items.ts`,
  `shop.ts`, `marketplace.ts`). The browser never touches the DB directly.
- **Where stored:** `data/app.db` (alongside the existing `data/` dir). Added to `.gitignore` like the
  other `data/*.db` entries already are.
- **Migration path:** schema is defined in one place (`lib/db/schema.sql`) and applied idempotently at
  startup. Repository functions hide SQL behind typed methods, so moving to hosted Postgres later means
  swapping the driver + SQL dialect inside `lib/db/` without changing callers. IDs are app-generated
  UUID strings (not SQLite rowids) so records port cleanly.
- **Dependency note:** `better-sqlite3` is a new dependency. **Requires approval** (see report). If you
  prefer zero new native deps, the fallback is a JSON-file store behind the same repository interface;
  it persists across sessions too but is less robust under concurrent writes. Recommendation:
  `better-sqlite3`.

### 2. Sensitive data — a private "recovery note" / contact field, self-encrypted with Tide

**Selected sensitive field:** a single private profile field, `privateNote` (a free-text private note /
recovery contact the player enters). Smallest concrete example that is genuinely private to one player
and supports the security objective (protecting private player information).

- **Where stored:** in the `player` table as `private_note_ciphertext` (never a plaintext column).
- **How protected:** Tide **self-encryption** — the browser calls `useTideCloak().doEncrypt([{ data,
  tags: ["privatenote"] }])`; the returned ciphertext (TideMemory envelope, base64) is what the server
  stores. Self-encryption is **identity-bound to the encrypting player''s CVK** (per Tide concepts):
  only that player''s authorised Tide session can `doDecrypt` it. No policy/Forseti needed; no
  `OwnershipSpike` involvement.
- **How an authorised user accesses it:** the owning player, in their authenticated session, fetches the
  stored ciphertext and calls `doDecrypt([{ encrypted, tags: ["privatenote"] }])` client-side to reveal
  plaintext. Decryption requires live Fabric threshold participation (online-only).
- **Demonstrating it is not plaintext:** a test/demo reads `data/app.db` directly (e.g. `sqlite3` or a
  `scripts/inspect-db` read) and shows `private_note_ciphertext` is an opaque base64 blob, not the text
  the player typed. Contrast with a plaintext `display_name` column to make the difference visible.
- **Voucher-gate note (to verify at implementation):** self-encryption needs the player to hold
  `_tide_privatenote.selfencrypt` / `_tide_privatenote.selfdecrypt` roles (voucher gate). If the realm''s
  default roles do not include a suitable `_tide_*` gate, assigning these is an IGA change. This is
  flagged as an implementation dependency (see Ready/Blocked) and is the one place Category 2 touches
  governance — which conveniently doubles as the QEA scenario (below).

### 3. Player isolation — `vuid` as the server-side identity boundary

- The server derives the acting player **only** from the verified JWT''s `vuid` claim
  (`verifyTideJWT` → `payload.vuid`), never from a client-supplied id. All player-scoped queries filter
  by that `vuid`.
- For the protected field specifically, isolation is **enforced cryptographically by Tide**, not just by
  the query filter: even if another player somehow read player X''s ciphertext, self-encryption means
  their session cannot `doDecrypt` it (identity-bound to X''s CVK). So isolation holds at two levels:
  server query scoping (Layer B) AND cryptographic binding (Tide).
- **Testing limitation (marked, not worked around):** fully demonstrating "player Y cannot read X''s
  data" live requires a second authenticated player, which is **blocked** by the Player B / ORK issue.
  The design records this as a testing limitation. What IS demonstrable single-player now: (a) X can
  encrypt and decrypt; (b) the stored value is not plaintext; (c) the server rejects any request whose
  `vuid` does not own the row. The cross-player *decryption refusal* is asserted by construction
  (self-encryption is identity-bound) and will be live-tested once Player B is unblocked.

### 4. Marketplace eligibility — "cosmetic items obtained from the shop are listable"

- **Rule:** an item instance is **eligible to be listed** if (a) the acting player currently owns it at
  the application level, AND (b) it is a cosmetic item that originated from the shop (i.e. it is a normal
  tradable cosmetic), AND (c) it is not currently equipped, AND (d) it is not already actively listed.
- **Why:** matches the original user-story intent — limited/shop cosmetics leave the shop and can then be
  exchanged between players. It avoids inventing rarity/economy tiers (out of scope). A simple
  `tradable` boolean on the item template expresses (b); all seeded cosmetics are `tradable: true` for
  the beta, leaving room to mark future non-tradable items without adding economy mechanics.
- Equipped/listed exclusions (c,d) prevent obviously inconsistent states without adding complexity.

### 5. QEA governance scenario — admin grant of a role via existing IGA

- **Concrete change:** granting a realm role to a user (specifically, granting the `admin` role, or the
  `_tide_privatenote.*` voucher-gate roles needed for Req 11) through the TideCloak Admin API on the
  **IGA-enabled realm** (already in `tide` attestor mode per LEARNINGS).
- **Who requests:** an operator/admin initiates the role grant (Admin API call).
- **Who approves:** the change becomes an IGA **change request** requiring the enclave approval /
  quorum flow (`/iga/change-requests/{id}/authorize` → `commit`, or the MultiAdmin enclave `approve`).
  No single admin applies it unilaterally.
- **What is protected:** privilege escalation — a role grant is a security-sensitive change; QEA ensures
  it is governed, not an immediate write.
- **If approval is not completed:** the change stays PENDING and is **not applied** — the role does not
  appear in the user''s token, so the app behaves as if the grant never happened (deny-by-default).
- **Reuses existing governance:** no new governance system, no new policy — this relies entirely on the
  realm''s existing IGA configuration. The app''s role is to (a) surface that a governed change is pending
  and (b) never assume a `2xx` from the Admin API means the change is applied (must read back state).

## Data Models

Application entities (Layer A) plus a clearly-separated Tide attestation store (Layer C). IDs are
app-generated UUID strings.

```
player
  vuid              TEXT PK            -- Tide vuid; the identity boundary
  display_name      TEXT               -- PUBLIC (plaintext, on purpose, for contrast)
  currency_balance  INTEGER            -- simulated currency (e.g. cents/coins)
  equipped_instance_id TEXT NULL FK -> item_instance.id
  private_note_ciphertext TEXT NULL    -- SENSITIVE: Tide self-encrypted blob (NEVER plaintext)
  created_at        TEXT

item_template
  id                TEXT PK
  name              TEXT               -- PUBLIC
  category          TEXT               -- e.g. skin | accessory | cape
  rarity            TEXT               -- descriptive only (no economy mechanics)
  base_price        INTEGER
  tradable          INTEGER (bool)     -- marketplace eligibility (b)

item_instance
  id                TEXT PK            -- the owned unit
  template_id       TEXT FK -> item_template.id
  owner_vuid        TEXT FK -> player.vuid   -- LAYER A application ownership record ONLY
  acquired_via      TEXT               -- 'shop' | 'marketplace'
  acquired_at       TEXT
  -- NOTE: owner_vuid is the application record. It is NOT cryptographic proof of ownership.

shop_offer                            -- current rotation (derived/refreshed automatically)
  id                TEXT PK
  template_id       TEXT FK -> item_template.id
  price             INTEGER
  window_start      TEXT
  window_end        TEXT               -- rotation window; offer purchasable only while now in window
  active            INTEGER (bool)

purchase_record
  id                TEXT PK
  buyer_vuid        TEXT
  template_id       TEXT
  instance_id       TEXT
  price             INTEGER
  created_at        TEXT

marketplace_listing
  id                TEXT PK
  instance_id       TEXT FK -> item_instance.id
  seller_vuid       TEXT
  price             INTEGER
  status            TEXT               -- 'active' | 'sold' | 'cancelled'
  created_at        TEXT

marketplace_transaction
  id                TEXT PK
  listing_id        TEXT FK -> marketplace_listing.id
  instance_id       TEXT
  seller_vuid       TEXT
  buyer_vuid        TEXT
  price             INTEGER
  transfer_kind     TEXT               -- ALWAYS 'application-level-temporary' in this beta
  created_at        TEXT

tide_ownership_attestation            -- LAYER C (separate on purpose; storage/verify only)
  id                TEXT PK
  instance_id       TEXT FK -> item_instance.id
  owner_vuid        TEXT               -- the vuid bound INSIDE the signed statement
  signature_hex     TEXT               -- 64-byte Ed25519 threshold signature (VVK-verifiable)
  payload_item      TEXT               -- itemInstanceId used in the signed payload
  created_at        TEXT
  -- This table records Tide-signed statements when available. It is NOT written by the
  -- marketplace transfer (Category 3 blocked). It never substitutes for a Layer A change,
  -- and a Layer A change never writes here.
```

**Relationships:** a `player` owns many `item_instance` (Layer A via `owner_vuid`) and has 0..1 equipped
instance; an `item_instance` is one `item_template`; `shop_offer`/`purchase_record` reference templates
/instances; a `marketplace_listing` references one instance and yields one `marketplace_transaction`;
`tide_ownership_attestation` optionally references an instance and is entirely independent of
`owner_vuid`.

**Distinction (explicit):** `item_instance.owner_vuid` = application ownership record (Layer A). A row in
`tide_ownership_attestation` = a Tide ownership attestation (Layer C). The design and code MUST NOT treat
`owner_vuid` as cryptographic proof, and MUST NOT write a `tide_ownership_attestation` row to represent a
marketplace transfer (that would be faking Category 3).

## Components and Interfaces

### Frontend (client components, App Router)
- `app/dashboard/` — existing; extend to show profile, currency, equipped item (Req 2, 4).
- `app/shop/page.tsx` — rotating limited shop; buy buttons (Req 5, 6).
- `app/inventory/page.tsx` — owned items, details, equip controls, owned-vs-not (Req 3, 4).
- `app/marketplace/page.tsx` — active listings, list-my-item, obtain-listing (Req 7).
- `app/account/page.tsx` — profile + the private note: encrypt-on-save, decrypt-on-view (Req 11, 12).
- Existing `providers.tsx`, `page.tsx`, `auth/redirect/` — unchanged (Layer B preserved).

### Server-side / API (route handlers under `app/api/*`, all behind `withAuth`/`withRole`)
- `lib/auth/` — `tidecloakConfig.ts`, `tideJWT.ts` (`verifyTideJWT`, `hasRole`, `extractToken`),
  `protect.ts` (`withAuth`, `withRole`, `REQUIRE_DPOP=true`, assert `cnf.jkt`). Per verify-jwt-server-side
  playbook; local JWKS only (I-04).
- `app/api/me/route.ts` — GET profile/currency/equipped for the caller''s `vuid`.
- `app/api/account/private-note/route.ts` — GET returns stored ciphertext; PUT stores ciphertext
  (server never sees plaintext; encryption/decryption happen in the browser).
- `app/api/shop/route.ts` — GET current rotation (refresh-if-stale on read).
- `app/api/shop/purchase/route.ts` — POST buy an offered item (server validates rotation + balance).
- `app/api/inventory/route.ts` — GET the caller''s owned instances.
- `app/api/inventory/equip/route.ts` — POST equip an owned instance (server validates ownership).
- `app/api/marketplace/route.ts` — GET active listings.
- `app/api/marketplace/list/route.ts` — POST create listing (server validates eligibility).
- `app/api/marketplace/obtain/route.ts` — POST obtain a listing (server validates funds/ownership,
  performs the temporary Layer A transfer, writes records).
- `app/api/admin/*` — `withRole("admin")` only; example admin surface (Req 13 governance context).
- `lib/db/` — connection + repositories + `schema.sql`.
- `lib/shop/rotation.ts` — deterministic-but-randomised rotation (seed from current time window).

### Data flow (example: purchase)
Browser (shop page) → `secureFetch POST /api/shop/purchase` (Authorization: DPoP + proof) →
`withAuth` verifies JWT + `cnf.jkt` → handler reads `vuid` from JWT → validates the offer is in the
current rotation and the player''s balance → in a single DB transaction: deduct balance, create
`item_instance` (owner_vuid = caller), write `purchase_record` → returns updated inventory. No client
input decides ownership or price; the server does.

## Security Boundaries

| Concern | Client may request | Server MUST enforce |
|---|---|---|
| Identity | login via TideCloak | `vuid` taken ONLY from verified JWT (`verifyTideJWT`), never from body/query |
| Auth | send `secureFetch` w/ DPoP | verify JWT vs local JWKS, assert `cnf.jkt` (I-12), else 401 |
| Roles | show/hide admin UI via `hasRealmRole` | `withRole("admin")` server-side for admin ops (UI gating is not auth, I-08) |
| Ownership (equip/list) | ask to equip/list an instance id | server checks `item_instance.owner_vuid == caller vuid`; else 403 |
| Purchase | ask to buy an offer id | server checks offer active/in-window and balance; server sets price & owner |
| Marketplace obtain | ask to obtain a listing id | server checks listing active, buyer≠seller, buyer funds; performs transfer atomically |
| Private data read | ask for own ciphertext | server returns only the caller''s own row; decryption is client-side Tide (identity-bound) |
| Private data isolation | — | cryptographic: another vuid''s session cannot `doDecrypt` (self-encryption) + query scoping |
| Admin change | request a role grant | governed by IGA/QEA; not applied until approved+committed |

- **Tide-backed vs application-enforced:** identity/auth (Layer B) and the private-note protection
  (Tide self-encryption) are **Tide-backed**. Application ownership, equip/list/purchase validation, and
  the marketplace transfer are **application-enforced** (Layer A). This is stated in the UI/records so the
  two are never conflated.

## Temporary Marketplace Transfer (Layer A only)

Flow: A owns instance → A lists it → B obtains it → **application** ownership changes to B.

Implementation: `POST /api/marketplace/obtain` runs one DB transaction that: verifies the listing is
active and the buyer has funds; sets `item_instance.owner_vuid = buyer`; clears the instance from the
seller''s equipped slot if set; marks the listing `sold`; moves currency seller↔buyer; writes a
`marketplace_transaction` with **`transfer_kind = ''application-level-temporary''`**.

**Labelling (mandatory):** the transaction record, the API response, and the marketplace UI all state
this is a *temporary application-level ownership transfer — NOT Tide-backed ownership transfer*. No
`tide_ownership_attestation` row is created or altered by this flow. `OwnershipSpike` is not called.
Nothing here is described as satisfying Category 3 (Reqs 14–16).

**Future integration seam:** when Player B / ORK is unblocked, a real Tide transfer would additionally
mint a new VVK-verifiable statement bound to B and record supersession — that work attaches at
`obtain` but is explicitly out of scope now.

## Demo / User Flow (with implementable-now vs blocked)

1. Player logs in (existing TideCloak). — **Now**
2. Sees profile / currency / inventory. — **Now**
3. Views rotating limited shop. — **Now**
4. Purchases an available item (simulated currency). — **Now**
5. Item appears in inventory. — **Now**
6. Equips the item (server checks ownership). — **Now**
7. Sees equipped item in avatar/customisation (simple representation). — **Now**
8. Lists an eligible owned item. — **Now**
9. Another player obtains the listing → **application** ownership changes. — **Now (single-machine,
   two logins) — but a second *Tide* player is BLOCKED**; the beta demonstrates the app-level transfer
   and labels it as such. Live two-player Tide test is deferred.
10. Application ownership changes to buyer. — **Now (Layer A)**
11. Previous owner can no longer equip/use it via the app (server ownership check now fails for A). — **Now (Layer A)**
12. New owner can see/equip it. — **Now (Layer A)**
13. Sensitive protected data accessible only via the authorised Tide session (encrypt/decrypt own note;
    backend shows ciphertext). — **Now (single-player); cross-player refusal live-test BLOCKED**
14. Admin-only functionality protected by RBAC; role-grant governed by QEA. — **Now (RBAC now;
    QEA relies on existing IGA)**

**Blocked (Category 3, not in this beta):** Player B receiving Tide ownership authority; Tide-backed
transfer minting a new signed statement to B; supersession/revocation making A''s Tide statement
non-current.

## Architecture Diagram

```
                 +--------------------------------------------------+
                 |                 Player Browser                   |
                 |  Next.js client + Tide SWE (iframe)              |
                 |  - shop / inventory / marketplace / account UI   |
                 |  - useTideCloak: login, hasRealmRole (UI gating) |
                 |  - doEncrypt/doDecrypt (private note, Tide)      |
                 |  - secureFetch (DPoP) to app APIs                |
                 +----------------+---------------------------------+
                                  |
              (B) OIDC login       | (A) app API calls: Authorization: DPoP + proof
              + doken + vuid       v
     +------------------+   +---------------------------------------+     +-----------------------+
     |  TideCloak :8080 |<->|   Next.js App / API (app/api/*)        |     | Tide Fabric / ORKs    |
     |  OIDC + IGA/QEA  |   |   Layer B: verifyTideJWT (local JWKS), |     | (T=14/N=20)           |
     |  DPoP issuance   |   |     assert cnf.jkt, withRole           |     | - PRISM login (B)     |
     |  role grants =   |   |   Layer A: shop/inventory/marketplace, |     | - self-encrypt/decrypt|
     |  QEA change req  |   |     currency, records, TEMP transfer   |<--->|   of private note     |
     +--------+---------+   |   Layer C (store/verify only):         |     | - OwnershipSpike sign |
              |             |     tide_ownership_attestation         |     |   (existing; not used |
     governed |             +------------------+--------------------+     |   by marketplace)     |
     approval |                                | Layer A reads/writes     +-----------------------+
              v                                 v
        (enclave)                       +---------------------------+
                                        |   SQLite  data/app.db     |
                                        |  player, item_template,   |
                                        |  item_instance(owner_vuid)|
                                        |  shop_offer, purchase,    |
                                        |  listing, transaction,    |
                                        |  tide_ownership_attest.   |
                                        +---------------------------+

Auth/identity: Layer B (TideCloak + ORK PRISM).  Authorisation: server-side JWT+role.
Application ownership: Layer A (owner_vuid in SQLite).  Tide ownership authority: Layer C
(separate table; VVK-verifiable; NOT moved by the marketplace).
```

## Design Constraints Honoured

- Existing auth NOT rewritten; DPoP and RBAC preserved; `data/tidecloak.json` remains the config source.
- `OwnershipSpike` contract/policy untouched; no new Forseti contract.
- No fake Tide transfer; DB ownership never called Tide ownership.
- No unnecessary infrastructure (SQLite file, no new servers); no features beyond documented scope.
- Appropriate for a university PoC/beta.

## Correctness Properties

### Property 1: Server-derived identity
 For every protected operation, the acting player is the JWT `vuid`;
  no client-supplied identifier can change whose data is read or written.

**Validates: Requirements 1, 2, 3, 12**

### Property 2: Ownership gating
 Equip/list/obtain succeed only when the server confirms
  `item_instance.owner_vuid == caller vuid` (for equip/list) or valid buyer/funds (for obtain);
  otherwise no state changes.

**Validates: Requirements 4, 7**

### Property 3: Rotation gating
 A purchase succeeds only if the target offer is active and within its
  rotation window; non-offered items cannot be bought from the shop.

**Validates: Requirements 5, 6**

### Property 4: Ownership persists past the shop
 Rotation changes never alter `item_instance.owner_vuid`.

**Validates: Requirements 5**

### Property 5: Layer separation invariant
 A Layer A ownership change never writes
  `tide_ownership_attestation`, and no code path labels a Layer A change as Tide-backed transfer.

**Validates: Requirements 8, 17**

### Property 6: Protected-data confidentiality
 The sensitive field is stored only as a Tide-self-encrypted
  blob; the backend never holds its plaintext; only the owning player''s session can decrypt it.

**Validates: Requirements 11, 12**

### Property 7: Deny-by-default admin
 Admin operations require a server-verified `admin` role; governed
  admin changes are not applied until IGA approval+commit.


**Validates: Requirements 1, 13**

## Error Handling

- **401** — missing/invalid JWT, or DPoP-bound token without `cnf.jkt` (fail closed; generic body).
- **403** — authenticated but not the owner (equip/list), or lacking a required role (admin).
- **400** — malformed request (unknown offer/listing/instance id, bad body).
- **409 / rejected** — insufficient funds, offer out of rotation, listing not active, buyer==seller,
  item equipped or already listed. No partial state change (DB transaction rolls back).
- **Tide/crypto errors** — `doEncrypt`/`doDecrypt` failures (e.g. Fabric offline, missing voucher-gate
  role) surface a clear client message; the server stores only ciphertext and never a plaintext fallback.
- **Governance** — a `2xx` from an admin write is treated as *accepted, not applied*; state is re-read
  before reporting success.
## Testing Strategy

- **Unit/integration (server):** ownership checks (equip/list/obtain reject non-owner), rotation gating
  (cannot buy non-offered item), balance checks, and that the marketplace transfer sets `owner_vuid` and
  writes a `transfer_kind='application-level-temporary'` record.
- **Tide security demo:** save a private note (browser encrypts) → read `data/app.db` and show the
  column is ciphertext, not plaintext → decrypt in-session to show plaintext returns. Player-Y refusal
  is asserted by construction and marked BLOCKED for live test.
- **RBAC:** non-admin blocked from `/api/admin/*` (403) server-side.
- **Preservation:** login → dashboard, DPoP relay, `/auth/redirect` still work.
- Verify with `npm run typecheck` and `npm run build`.




