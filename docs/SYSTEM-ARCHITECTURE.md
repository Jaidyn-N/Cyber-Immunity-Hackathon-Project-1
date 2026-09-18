# System Architecture (Initial / Proposed PoC)

Proposed architecture for the Tide-protected gaming marketplace PoC. It is grounded in the findings in
`docs/LEARNINGS.md` and verified Tide capabilities from the Tide MCP pack. Components that are not yet
verified in this project are marked [Investigation]; everything else reflects the current codebase or
VERIFIED pack guidance.

> Scope note: this describes the *target* PoC, built incrementally. Only the authentication layer
> exists today. The database, application API, and Tide ownership-authority layer are proposed.

---

## 1. Major application components

| Component | Status today | Role in the PoC |
|-----------|--------------|-----------------|
| Player Browser (Next.js client + Tide SWE) | Exists (auth only) | Renders shop/inventory/marketplace UI; hosts the Tide Secure Web Enclave (SWE) iframe; the **only** place ORK signing can happen (browser-only constraint) |
| Next.js App (App Router, React 19) | Exists | Serves pages and the client bundle; hosts the `TideCloakProvider`; hosts the Application API (route handlers) |
| Application API / Server (route handlers under `app/api/*`) | Not built | Server-side JWT + DPoP verification, RBAC, ownership-proof verification, verify-on-read, transaction orchestration |
| Database / persistence | Not built | Players, characters, items, item instances, inventory, shop listings, marketplace listings, transactions, and stored ownership attestations |
| Auth/Identity layer (`lib/auth/`) | Not built | `loadTideConfig`, `verifyTideJWT` (local JWKS), `withAuth`/`withRole`, `cnf.jkt` assertion |
| Ownership-authority layer (`lib/ownership/`, `forseti/`) | Not built [Investigation] | Build/verify signed ownership attestations; the Forseti contract binding item->owner vuid; VVK verification; supersession logic |
| Standalone verifier | Not built [Investigation] | Independent check of an ownership attestation against the realm VVK (no dependency on app code) |

---

## 2. External services

| Service | What it is | How the app uses it | Verified? |
|---------|-----------|---------------------|-----------|
| TideCloak (Docker, `http://localhost:8080`) | OIDC provider + Tide vendor endpoints + IGA | Login/logout, token issuance, doken issuance, adapter export, IGA-governed role/policy changes | [Confirmed] running config in `data/tidecloak.json`; realm `login-app-with-tidecloak` |
| Tide Fabric / ORK network (`homeOrkUrl`, e.g. `ork1.tideprotocol.com`) | Decentralized threshold-crypto network (T=14/N=20 here) | Threshold PRISM login, threshold VVK JWT signing, **threshold signing of ownership attestations via Forseti** | [Confirmed] endpoints in adapter; [Investigation] the ownership-signing use |
| Application database | App-owned datastore (engine TBD) | All domain persistence + stored attestations | Not built |
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
  making the request*. [Confirmed] wiring exists for login/DPoP/callback; server-side verification is
  proposed.
- **Layer C — Wider Tide security (ownership authority).** [Investigation] Threshold-signed ownership
  attestations produced by a Forseti contract that binds an item instance to an owner `vuid`, verified
  against the realm VVK, cross-checked against the DB on read, and superseded on transfer. This is what
  makes a tampered `owner` row insufficient to steal or exercise ownership.

The PoC''s thesis is that **Layer C authority sits on top of Layer A data**, so Layer A tampering alone
cannot grant the ability to *exercise* ownership.

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
  Application API. Position: guards every protected route/API. [Proposed, pattern VERIFIED]
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
