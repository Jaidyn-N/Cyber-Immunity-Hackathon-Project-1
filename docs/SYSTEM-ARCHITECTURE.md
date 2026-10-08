# System Architecture

Architecture for the Tide-protected gaming marketplace PoC. It is grounded in the findings in
`docs/LEARNINGS.md` and verified Tide capabilities from the Tide MCP pack.

> Status (2026-10-08, Tasks 0–18 complete): Layer A (application/DB marketplace) and Layer B (TideCloak
> auth + server-side RBAC) are **built and running** — the SQLite data layer, the full application API
> surface, and server-side JWT/DPoP verification all exist. Layer C (Tide ownership attestation) remains
> a **proof-of-concept**: the existing `OwnershipSpike` contract can bind/rebind an item to an owner
> `vuid` and that is independently VVK-verifiable, but it provides no supersession/revocation, and the
> beta marketplace transfer is Layer A only (never writes `tide_ownership_attestation`). Items below that
> described future work now reflect what was built; the Layer C supersession limitation is unchanged and
> noted throughout.

## Implemented API surface (Layer A + B, built)

All routes are Next.js App Router handlers under `app/api/**`, each wrapped in `withAuth` (identity) or
`withRole('admin')` (RBAC); identity is the verified JWT `vuid` only. `GET /api/me`,
`GET /api/inventory`, `POST/GET /api/inventory/equip`, `GET /api/shop`, `POST /api/shop/purchase`,
`GET /api/marketplace`, `POST/GET /api/marketplace/list` + `DELETE /api/marketplace/list/[id]`,
`POST /api/marketplace/obtain` (Layer A temporary transfer, `transfer_kind='application-level-temporary'`,
never Layer C), `GET/PUT /api/account/private-note` (opaque self-encrypted ciphertext only),
`POST /api/admin/private-note-role` (Task 11 governed `_tide_dob.*` grant via Tide IGA/QEA),
`GET /api/admin/summary` (aggregate counts only). Player-facing pages live under the `app/(app)/`
auth-gated route group.

---

## 1. Major application components

| Component | Status (Tasks 0–18) | Role in the PoC |
|-----------|--------------------|-----------------|
| Player Browser (Next.js client + Tide SWE) | Built | Renders shop/inventory/marketplace/account/admin UI (`app/(app)/`); hosts the Tide Secure Web Enclave (SWE) iframe; the **only** place ORK signing / self-encryption can happen (browser-only constraint) |
| Next.js App (App Router, React 19) | Built | Serves pages and the client bundle; hosts the `TideCloakProvider`; hosts the Application API (route handlers) |
| Application API / Server (route handlers under `app/api/*`) | Built | Server-side JWT + DPoP (`cnf.jkt`) verification, RBAC, per-`vuid` scoping, atomic transaction orchestration. (Layer C verify-on-read of signed attestations is PoC-only, not wired into the beta marketplace.) |
| Database / persistence (SQLite via `better-sqlite3`, `lib/db/`) | Built | Players, item templates, item instances, shop offers, purchase records, marketplace listings + transactions (Layer A), and the SEPARATE `tide_ownership_attestation` table (Layer C, not written by the beta) |
| Auth/Identity layer (`lib/auth/`) | Built | `loadTideConfig`, `verifyTideJWT` (local JWKS), `withAuth`/`withRole`, `cnf.jkt` assertion |
| Ownership-authority layer (`OwnershipSpike` Forseti contract) | PoC-verified [Investigation] | Threshold-signs an item→owner-`vuid` statement, VVK-verifiable; binding + rebinding demonstrated. **No supersession/revocation.** NOT extended by the beta; not called by the marketplace |
| Standalone verifier | PoC-verified [Investigation] | Independent check of an ownership attestation against the realm VVK (demonstrated in the Player B investigation) |

---

## 2. External services

| Service | What it is | How the app uses it | Verified? |
|---------|-----------|---------------------|-----------|
| TideCloak (Docker, `http://localhost:8080`) | OIDC provider + Tide vendor endpoints + IGA | Login/logout, token issuance, doken issuance, adapter export, IGA-governed role/policy changes | [Confirmed] running config in `data/tidecloak.json`; realm `login-app-with-tidecloak` |
| Tide Fabric / ORK network (`homeOrkUrl`, e.g. `ork1.tideprotocol.com`) | Decentralized threshold-crypto network (T=14/N=20 here) | Threshold PRISM login, threshold VVK JWT signing, **threshold signing of ownership attestations via Forseti** | [Confirmed] endpoints in adapter; [Investigation] the ownership-signing use |
| Application database | SQLite (`data/app.db`) via `better-sqlite3` | All domain persistence (Layer A) + a separate `tide_ownership_attestation` table (Layer C, unused by the beta) | [Confirmed] built; auto-created + seeded on first use; gitignored |
| Tide MCP (agent/dev-time only) | The Tide agent pack used during development | Verifying capabilities, playbooks, scenarios | [Confirmed] used for this investigation; **not** a runtime dependency |

> The Tide MCP is a **development-time** aid, not a component of the running system. It is listed only
> to be explicit that it does not appear in the runtime data path.

---

## 3. Three layers of functionality (kept distinct)

The checklist requires clearly separating normal app functionality, TideCloak authentication, and the
wider Tide security functionality. The PoC keeps them in three layers:

- **Layer A — Normal application / database functionality.** Catalogue, shop, inventory display,
  listing metadata, transaction records, equip state. A plain DB `owner` column lives here. On its own
  this layer is the *insecure baseline*: editing the `owner` row transfers the item.
- **Layer B — TideCloak authentication (identity).** OIDC login via the `tidebrowser` flow, DPoP-bound
  tokens, the `vuid` identity claim, server-side JWT verification, and RBAC. This answers *who is
  making the request*. [Confirmed] wiring exists for login/DPoP/callback; **server-side verification is
  built** (`lib/auth/`: `verifyTideJWT` with local JWKS, `cnf.jkt` assertion, `withAuth`/`withRole`),
  enforced on every protected route.
- **Layer C — Wider Tide security (ownership authority).** Threshold-signed ownership attestations
  produced by the existing `OwnershipSpike` Forseti contract that binds an item instance to an owner
  `vuid`, verified against the realm VVK. **Confirmed (2026-10-01):** both Player A and Player B can each
  obtain a valid attestation for the *same* item when they are the authenticated executor; the ORKs
  reject any attempt to mint an attestation for a different `vuid` (both directions). The current
  contract provides **executor-to-bound-owner matching only** — it maintains NO current-owner, version,
  nonce, or revocation state. Consequence: **multiple independently valid attestations can exist for the
  same item at once** (A''s and B''s both verify). So Layer C currently provides ownership *binding* and
  *rebinding*, but NOT supersession/revocation — see the limitation note below. Layer C remains strictly
  separate from Layer A (`item_instance.owner_vuid`): a Layer A marketplace transfer is NOT a Tide-backed
  transfer and never writes `tide_ownership_attestation`.

The PoC''s thesis is that **Layer C authority sits on top of Layer A data**, so Layer A tampering alone
cannot grant the ability to *exercise* ownership.

> **Current Layer C limitation (confirmed 2026-10-01).** The `OwnershipSpike` contract has no
> current-owner/version/revocation state, so issuing Player B a new attestation does NOT invalidate
> Player A''s earlier one — both continue to verify independently against the VVK. Full exclusive
> Tide-backed transfer (new owner gains authority AND previous owner loses it), supersession/revocation,
> and "latest ownership statement wins" are therefore **not provided by the current contract** and
> remain an open design question (application-side current-owner state and/or a version/revocation-aware
> contract). Not being implemented in the beta.

---

## 4. High-level architecture diagram

```
                          +---------------------------------------------------+
                          |                  Player Browser                   |
                          |  Next.js client (React 19)  +  Tide SWE (iframe)   |
                          |                                                   |
                          |  - Shop / Inventory / Marketplace UI              |
                          |  - useTideCloak(): login, logout, hasRealmRole    |
                          |  - secureFetch() attaches DPoP proof              |
                          |  - ORK SIGNING happens HERE (browser-only) -------+----+
                          +-----------------+---------------------------------+    |
                                            |                                      |
                       (1) OIDC login       | (3) API calls: Authorization: DPoP   | (C) build ownership
                       redirect + doken     |     + fresh DPoP proof (secureFetch) |     attestation request
                                            v                                      v
     +----------------------+      +------------------------------------+   +--------------------------+
     |  TideCloak (:8080)   |<---->|      Next.js App / Application API  |   |   Tide Fabric / ORKs     |
     |  OIDC + IGA + vendor  | (2)  |          (app/api/* handlers)      |   |   (T=14 / N=20)          |
     |                      |      |                                    |   |                          |
     |  - tidebrowser flow  |      |  Layer B: verifyTideJWT (local     |   |  - threshold PRISM login |
     |  - issues JWT+doken   |      |    JWKS), assert cnf.jkt, RBAC     |   |  - threshold VVK JWT sig |
     |  - adapter export     |      |  Layer C: verify ownership proof   |   |  - Forseti contract runs |
     |  - IGA change reqs    |      |    vs realm VVK; verify-on-read;   |<--+    on every ORK; produces |
     +----------+-----------+      |    supersession; RBAC gate         | (C)   threshold Ed25519 sig  |
                |                  +------------------+-----------------+   +--------------------------+
                | signs JWT via                       |
                | Fabric (VVK)                        | (4) read/write domain data + stored attestations
                v                                     v
        (threshold, no                        +---------------------------+
         whole key exists)                    |   Application Database     |
                                              |  players, characters,      |
                                              |  items, item_instances,    |
                                              |  inventory, shop_listings, |
                                              |  market_listings,          |
                                              |  transactions,             |
                                              |  ownership_attestations    |
                                              +---------------------------+

Legend:
  (1)(2)(3)(4) = normal auth + app data flow
  (C)          = Tide ownership-authority flow (Layer C) [Investigation]
```

---

## 5. Component communication

1. **Login (Layer B).** Browser -> TideCloak OIDC (`tidebrowser` flow). Threshold PRISM runs across
   ORKs; TideCloak returns an access token (threshold-VVK-signed), refresh token, id token, and a
   **doken** (carries `vuid` + role claims). Callback handled at `/auth/redirect`. [Confirmed]
2. **Adapter / verification config.** The server loads `data/tidecloak.json` (embedded `jwk`) and
   verifies JWTs locally with `createLocalJWKSet` — never remote JWKS (I-04). [Confirmed pattern]
3. **Protected API calls (Layer B).** Browser calls `app/api/*` via `secureFetch`, which sends
   `Authorization: DPoP <token>` plus a fresh DPoP proof. The server runs `verifyTideJWT`, asserts
   `cnf.jkt` is present (I-12), and applies RBAC. [Proposed]
4. **Domain data (Layer A).** The API reads/writes the database for catalogue, inventory, listings,
   and transactions. [Proposed]
5. **Ownership authority (Layer C).** [Investigation]
   - **Mint / verify identity binding:** in the browser, the app builds an ownership-attestation
     request (item instance + owner `vuid`) and submits it to the ORKs via
     `createTideRequest` / `executeSignRequest`. Each ORK runs the Forseti contract; if the executor''s
     doken `vuid` matches the bound owner and the role check passes, the ORKs produce a threshold
     Ed25519 signature. The signed attestation is stored in the DB alongside the item instance.
   - **Exercise (equip/list):** the server verifies the stored attestation against the realm VVK and
     that its bound `vuid` equals the acting user''s `vuid` (verify-on-read + DB cross-check). A
     tampered `owner` row has no matching valid signature, so authority is refused.
   - **Transfer:** a new attestation binding the item to the buyer''s `vuid` supersedes the previous
     one; the app treats only the latest VVK-signed attestation as authoritative. The seller''s `vuid`
     no longer matches, so the seller can no longer exercise the item.

---

## 6. Where Tide sits in the architecture

- **Authentication** — TideCloak + ORK threshold PRISM. Position: between Browser and App;
  identity origin. [Confirmed]
- **Server-side authorization** — `verifyTideJWT` (local JWKS) + `cnf.jkt` (DPoP) + RBAC in the
  Application API. Position: guards every protected route/API. [Confirmed] built and enforced.
- **Tide-backed ownership authority** — Forseti contract on the ORKs producing threshold-signed
  ownership attestations. Position: Layer C on top of Layer A data. [Investigation]
- **Ownership verification** — VVK signature check + `vuid` match + verify-on-read against the DB, in
  the Application API and in a standalone verifier. Position: read path and any authority-exercising
  write path. [Investigation]
- **Ownership transfer / signing** — new superseding attestation minted in the browser during a
  marketplace transaction. Position: the marketplace purchase flow. [Investigation]
- **Protected data (optional, not core)** — Tide E2EE (self-encryption) *could* protect user-private
  data, but is **out of scope** for the ownership thesis and is not included to avoid overstating what
  is required. [Investigation / likely out of scope]

---

## 7. What is deliberately NOT in the architecture

To avoid adding unverified or unnecessary components:

- No second auth provider (TideCloak stays).
- No self-encryption / E2EE for ownership (self-encryption is identity-bound and cannot transfer —
  wrong tool; see LEARNINGS section 3).
- No server-side ORK signing service (browser-only signing constraint — none is possible).
- No reliance on the OIDC JWKS for VVK verification (returns the wrong key).
- No claim that the ORKs maintain per-item current-owner state (they sign statements; supersession is
  app-enforced pending validation).

---

## Related documents

- `docs/LEARNINGS.md` — the discoveries this architecture is based on.
- `docs/DEVELOPMENT-BACKLOG.md` — the work required to build and prove this architecture.

