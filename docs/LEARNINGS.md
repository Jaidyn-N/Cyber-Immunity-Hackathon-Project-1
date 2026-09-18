# Project Learnings

Living document. Records verified technical discoveries, open investigations, assumptions, and
constraints for the Tide-protected gaming marketplace PoC.

**Labels**
- [Confirmed] — verified against installed SDK code, the adapter JSON, the running config, or the Tide MCP pack (marked VERIFIED there).
- [Investigation] — plausible and grounded, but not yet proven end-to-end in this project.
- [Assumption] — operating assumption where sources are silent; must be validated.
- [Constraint] — a hard limit that shapes the design.

> Rule for this file: do not record an unverified Tide capability as working. If it has not been
> demonstrated in this project against a live ORK network, it is [Investigation], not [Confirmed].

---

## 1. Existing application (baseline)

- [Confirmed] Stack: Next.js 16 (App Router) + React 19, TypeScript strict, webpack build
  (Turbopack disabled: `next dev --webpack` / `next build --webpack`). Source: `package.json`, `tsconfig.json`.
- [Confirmed] The app today is an authentication demo only. There is **no backend logic, no API
  routes, no database, and no persistence layer**. State is the auth session. Source: full read of `app/`.
- [Confirmed] App structure: `app/layout.tsx` -> `app/providers.tsx` (`TideCloakProvider`) ->
  `app/page.tsx` (login/logout), `app/dashboard/` (a client-gated page), `app/auth/redirect/` (OAuth callback).
- [Confirmed] There is an in-flight `onboarding-and-rbac` spec under `.kiro/specs/` (requirements +
  design + tasks). It is **planning only** — no `lib/auth/`, no API routes, no `jose`, and no admin page exist on disk yet.

---

## 2. Existing TideCloak / Tide setup

- [Confirmed] SDK installed: `@tidecloak/nextjs@0.14.20`, which depends on `@tidecloak/react` and
  `@tidecloak/verify`. Source: `package.json`, `node_modules/@tidecloak/nextjs/package.json`.
- [Confirmed] The signing/policy packages **are present transitively**: `@tideorg/js` and
  `heimdall-tide` exist in `node_modules`. These expose Forseti policy signing, `Models`
  (`Policy`, `BaseTideRequest`), and VVK threshold signing. Source: `node_modules/@tideorg/js`, `node_modules/heimdall-tide`.
- [Confirmed] Import boundaries (from the pack, VERIFIED): import `Models`/`Contracts` from
  `@tideorg/js`, `PolicySignRequest` from `heimdall-tide`, and `IAMService`/`TideCloak` from
  `@tidecloak/js`. **Do not** import `Models`/`PolicySignRequest` from `@tidecloak/nextjs` — they are `undefined` there at runtime.
- [Confirmed] Authentication is OIDC via TideCloak using the `tidebrowser` flow; callback handled
  at `/auth/redirect` by `useAuthCallback`. Source: `app/auth/redirect/page.tsx`, `tidecloak/realm.json`.
- [Confirmed] DPoP is enabled client-side in strict mode with ES256:
  `useDPoP: { mode: "strict", alg: "ES256" }`. Source: `app/providers.tsx`. Server-side the realm
  client sets `dpop.bound.access.tokens: "true"`. Source: `tidecloak/realm.json`.
- [Confirmed] SWE support files present: `public/silent-check-sso.html` (matches the canonical
  content, I-07) and `public/tide_dpop_auth.html`. The DPoP relay wiring is in place:
  `/tide_dpop/:path*` rewrite plus per-path CSP (`script-src ''unsafe-inline''`, `Allow-CSP-From: *`)
  and a generic `frame-src ''self'' *`. Source: `next.config.ts`.
- [Confirmed] Adapter config the app actually loads is `data/tidecloak.json`, realm
  `login-app-with-tidecloak`, client `login-app-with-tidecloak-client`. It contains the Tide
  extensions required for local verification and Fabric access: embedded `jwk` (EdDSA/Ed25519 VVK),
  `vendorId`, `vvkId`, `gVVK`, `homeOrkUrl`, `orkUrl`, `payerPublic`, and thresholds
  `thresholdT: 14` / `thresholdN: 20`. Source: `data/tidecloak.json`.
- [Confirmed] RBAC / server-side authorization is **not enforced today**. `app/dashboard/layout.tsx`
  is a client-side `useEffect` redirect — UI gating only, not a security boundary (I-08). No route
  or API verifies a JWT server-side. Source: `app/dashboard/layout.tsx`.
- [Confirmed] `@tidecloak/verify` ships `verifyTideCloakToken(config, token, allowedRoles?)` for
  server-side JWT checks (uses `jose`, checks signature/issuer/`azp`/roles). It is **not used
  anywhere yet**. Source: `node_modules/@tidecloak/verify/README.md`.

### Configuration drift discovered

- [Confirmed] There are **two different realm identities** in the repo:
  - `data/tidecloak.json` -> realm `login-app-with-tidecloak` (this is what the app loads at runtime).
  - `tidecloak/realm.json` and `.env.example` -> realm `nextjs-auth-demo` (a stale template).
  - **Decision:** treat `data/tidecloak.json` (`login-app-with-tidecloak`) as the single source of
    truth. The `nextjs-auth-demo` template/env is stale and must be reconciled before provisioning any
    signing roles/policies. Rationale: the running app demonstrably uses the JSON adapter.

---

## 3. Tide SDK capabilities relevant to this PoC

- [Confirmed] Tide provides **no digital-item-ownership API**. There is no ownership primitive.
  Ownership must be modeled by the application. Source: full review of the pack.
- [Confirmed] The relevant primitive is **threshold VVK signing gated by Forseti contracts**: the
  app builds a request, the ORK network runs a C# policy contract, and a threshold Ed25519 signature
  is produced **only if the contract passes**. The signing key never materializes (I-01, I-15).
  Source: canon/concepts, canon/invariants (I-15), scenarios `policy-governed-signing` & `attested-provenance-registry`.
- [Confirmed] The **doken** carries the user''s `vuid`, and a Forseti contract can byte-compare an
  identity embedded in the signed payload against `DokenDto.UserId` (which **is** the vuid — a doken
  has no OIDC `sub`). This is how identity becomes a *network-enforced fact* rather than an app
  assertion. Source: `attested-provenance-registry` scenario + role-policy matrix (AP-66).
- [Confirmed] Server-side JWT verification must use the **embedded** JWKS (`createLocalJWKSet`),
  never `createRemoteJWKSet` (I-04). Verify `iss`, `azp === resource`, `exp`, `iat`, and (for DPoP)
  assert `cnf.jkt` is present (I-12). Source: canon/invariants, feature-mapping.
- [Confirmed] Self-encryption (`doEncrypt`/`doDecrypt` from `useTideCloak()`) is **identity-bound**:
  only the encrypting user can decrypt; granting another user a decrypt role does not let them decrypt
  your data (AP-24/AP-26). **Therefore self-encryption is the wrong tool for transferable ownership.**
  Source: canon/concepts, feature-mapping.
- [Confirmed] Policy-governed VVK encryption *can* gate access across users via a Forseti contract,
  but "ownership" in this PoC is about *authority to act* (equip / list / transfer), which maps to
  **signing**, not decryption. Source: scenario disambiguation (see decision below).

### Scenario alignment (from the Tide MCP)

- [Confirmed] The MCP scenario matcher, given this PoC''s description, returned
  **`git-pr-signing-service`** (category `threshold-signing`) as the closest match — i.e. the pack
  classes this problem as *threshold signing*, not encryption. Source: `tide_choose_scenario`.
- [Confirmed] The closest *pattern* for "who did this, provably, and it cannot be forged by editing a
  row" is **`attested-provenance-registry`**: a threshold-signed statement binding content + identity,
  verified against the realm VVK, and re-verified on read against the DB. Source: `tide_scenario`.
- **Decision:** model ownership as **signed ownership authority** (threshold signing + Forseti
  contract binding item->owner vuid), not as encryption. Rationale: transfer must move authority
  between users; self-encryption cannot transfer, and the pack itself classifies this as signing.

---

## 4. Digital ownership authority — proposed approach

- [Investigation] **Ownership record = a threshold-signed attestation** binding an `itemInstanceId`
  to the current owner''s `vuid`, produced by the ORK network via a Forseti contract and verifiable
  against the realm VVK. Editing the DB `owner` column alone does **not** produce a valid signature,
  so a tampered row fails verification. Modelled on `attested-provenance-registry`. Not yet built or proven here.
- [Investigation] **Exercising ownership** (equip / list): the server requires a valid,
  VVK-verified ownership proof whose bound `vuid` matches the acting user''s `vuid`, cross-checked
  against the DB on read (verify-on-read). Not yet built.
- [Investigation] **Transfer** = a **new** signed ownership attestation superseding the prior one,
  binding the item to the buyer''s `vuid`, produced as part of the marketplace transaction. Once the
  buyer''s attestation is current, the seller''s `vuid` no longer matches and the seller cannot produce
  a valid exercise proof. Not yet built.
- [Investigation] **Open design question — supersession semantics.** The provenance scenario keeps
  *all* attestations and makes *no* ownership determination. This PoC needs the opposite: a single
  *current* owner where a new attestation invalidates the previous one. Whether that supersession is
  enforced by the ORKs (in-contract) or by the app (accept only the latest VVK-signed attestation per
  item, treat superseded proofs as non-authoritative) must be decided and validated. Leaning
  app-enforced supersession, because the ORKs sign statements; they do not maintain per-item state.

---

## 5. Constraints discovered

- [Constraint] **Browser-only signing.** ORK signing is available only through the JS SDK in an
  authenticated browser session. There is **no** server-side / REST / service-account / device-code
  signing path (pack GAPs 063/064). This shapes transfer UX: the acting user must be present in the
  browser to produce a signature. A backend job cannot mint a transfer signature on someone''s behalf.
  Source: `attested-provenance-registry` scenario.
- [Constraint] **Forseti contract realities.** Contracts are C#, compiled and IL-vetted **on the
  ORKs**, gas-limited (default 50,000), and blocked from `System.IO`/`Net`/`Threading`/`Reflection`,
  `DateTime.Now`, etc. `ValidateData` and `ValidateExecutor` receive **disjoint** contexts (data vs
  doken) — capture identity in `ValidateData`, compare in `ValidateExecutor`, fail closed if capture
  never ran. Source: canon/concepts, canon/invariants (I-15), scenario anti-patterns.
- [Constraint] **Contract edits are expensive.** `contractId` is the uppercase SHA-512 of the source;
  any edit — even a comment — invalidates the deployed policy and costs a fresh browser enclave approval
  to redeploy. Compile locally first; pin the wire format to the contract with a test. Source: scenario bootstrap.
- [Constraint] **IGA governs role/policy changes.** With IGA enabled, admin mutations return `2xx` as
  *accepted*, not *applied* — they become change requests that must be authorized + committed, and roles
  appear in the token only after refresh (up to ~120s). Source: canon/concepts (IGA), canon/invariants (I-10).
- [Constraint] **VVK for verification lives in the adapter `jwk`, not the OIDC JWKS.** A verifier
  pointed at `/protocol/openid-connect/certs` gets HTTP 200 with the *wrong* (RSA) key. Any public
  verify route must serve `jwk.keys` and state the copy comes from the issuer. Source: scenario.
- [Constraint] **DPoP is mandatory doctrine and asymmetric by default.** Server enforcement is
  asserting `cnf.jkt` on the verified access token, not re-verifying the `secureFetch` proof as RFC
  9449. Do not add `frame-ancestors ''self''` to CSP — it breaks the enclave. Source: canon/invariants (I-12).

---

## 6. Assumptions to validate before/at implementation

- [Assumption] The live realm `login-app-with-tidecloak` is **fully provisioned for signing**:
  licensed (`setUpTideRealm`), IGA enabled (implied by `jwk` present), an admin user with
  `tide-realm-admin` and a linked Tide account, and the ability to deploy + sign a custom Forseti
  policy. Presence of `jwk`/`gVVK`/`vvkId` is strong evidence of licensing but does not prove a policy
  can be deployed. Must verify.
- [Assumption] `@tidecloak/nextjs@0.14.20` in this app can reach the signing methods
  (`IAMService._tc.createTideRequest` / `executeSignRequest`) with `Models` from `@tideorg/js` and
  `PolicySignRequest` from `heimdall-tide`, under the existing webpack config. Must verify with a minimal spike.
- [Assumption] A `vuid` protocol mapper is present on the client so the `vuid` claim is in the
  token/doken for identity binding. Required for the ownership contract. Must verify against a real token.
- [Assumption] App-enforced supersession (accept only the latest VVK-signed ownership attestation per
  item) is sufficient to make "previous owner loses authority" hold. Must be validated with a negative test.

---

## 7. Technical decisions and rationale

1. [Confirmed] **Keep TideCloak; do not swap auth providers.** The existing auth, DPoP, callback,
   and SWE wiring are correct and reusable.
2. [Confirmed] **`data/tidecloak.json` (`login-app-with-tidecloak`) is the source of truth**;
   reconcile the stale `nextjs-auth-demo` template/env.
3. [Confirmed] **Model ownership as threshold *signing*, not encryption.** Authority to act must
   transfer between users; self-encryption is identity-bound and cannot transfer.
4. [Confirmed] **Build an insecure DB-only ownership baseline first, then prove the tamper gap, then
   layer Tide authority on top.** The before/after comparison is the point of the PoC.
5. [Investigation] **App-enforced supersession** for "current owner" rather than expecting the ORKs to
   hold per-item state. ORKs sign statements; they are not a stateful ledger.

---

## 8. Problems encountered and solutions

- **Problem:** Two realm identities in the repo (`login-app-with-tidecloak` vs `nextjs-auth-demo`)
  create ambiguity about which realm to provision against.
  **Solution / status:** [Confirmed] source of truth is the adapter the app loads
  (`data/tidecloak.json`). Reconciliation tracked as backlog item `ENV-1`.
- **Problem (anticipated):** Forseti contract iteration is expensive (each edit -> new SHA-512 -> fresh
  enclave approval).
  **Solution / status:** [Constraint] compile locally and pin wire-format tests before any on-ORK
  deploy; treat policy deployment as a distinct, gated step (backlog `TIDE-2`).

---

## Related documents

- `docs/SYSTEM-ARCHITECTURE.md` — the proposed system based on these findings.
- `docs/DEVELOPMENT-BACKLOG.md` — the work required to build and prove that architecture.

---

# Investigation Log — ENV-1..ENV-3, TIDE-1, and supersession (2026-09-07)

Scope: blockers ENV-1 through TIDE-1 plus the ownership-supersession design question. No marketplace
or ownership code implemented. Two temporary probe files were created to prove SDK reachability and
then **deleted** (see TIDE-1).

## Environment status at time of investigation

- [Confirmed] **Docker daemon is NOT running and TideCloak is NOT reachable** at
  `http://localhost:8080` (`/health/ready` connection refused; `docker` CLI present at
  `...DockerDesktop\resources\bin\docker.exe` but the engine pipe is absent). Consequence: **all
  live-realm checks (parts of ENV-2 and all of ENV-3) could not be executed** and remain blocked on a
  manual environment start. Static/SDK checks were completed.

## ENV-1 — Realm configuration drift  →  RESOLVED (documented; no working config changed)

- [Confirmed] Three files reference realm identity; they disagree:
  - `data/tidecloak.json` → realm `login-app-with-tidecloak`, client
    `login-app-with-tidecloak-client`. **This is the adapter the app actually loads**
    (`app/providers.tsx` imports it). **Source of truth.**
  - `tidecloak/realm.json` → realm `nextjs-auth-demo`. **Stale template.**
  - `.env` → `TIDECLOAK_REALM=nextjs-auth-demo`, `TIDECLOAK_CLIENT_ID=nextjs-auth-demo`. **Stale.**
    (`.env` also contains a real `KC_BOOTSTRAP_ADMIN_PASSWORD` and `TIDE_OPERATOR_EMAIL` —
    local-only, correctly gitignored; not echoed here.)
- [Confirmed] The runtime code path does not read `.env` or `tidecloak/realm.json` for the realm — the
  Next.js client is configured purely from `data/tidecloak.json`. So the drift does **not** affect the
  running app today; it only matters for future provisioning scripts and re-bootstrap.
- **Change made:** none to any working configuration. Per the instruction "do not change the working
  TideCloak configuration unnecessarily," `data/tidecloak.json` was left untouched, and the stale
  `tidecloak/realm.json` / `.env` were **not** rewritten (rewriting `.env` risks breaking a future
  re-bootstrap that may still target those names, and neither file is on the runtime path). Instead the
  drift is recorded here and tracked as backlog `ENV-1`.
- **Recommendation (deferred, not done):** when the environment is next bootstrapped, align `.env`
  (`TIDECLOAK_REALM`/`TIDECLOAK_CLIENT_ID`) and any provisioning script to
  `login-app-with-tidecloak` / `login-app-with-tidecloak-client`, or regenerate the realm from a
  template that matches. Do this as a deliberate provisioning step, not an ad-hoc edit.

## ENV-2 — Signing provisioning  →  PARTIALLY VERIFIED (requirements confirmed; live state blocked)

- [Confirmed via MCP] What the realm needs before a custom Forseti signing policy can be **deployed and
  executed** (Tide MCP `deploy-forseti-policy` playbook + `attested-provenance-registry`
  bootstrap):
  1. TideCloak running with the realm bootstrapped, **licensed** (`setUpTideRealm`) and **IGA enabled**
     (`toggle-iga`). Ordering is license → IGA → policy.
  2. An **admin user with the `tide-realm-admin` client role**, linked to a Tide account (enclave
     approval needs a human).
  3. The **realm admin policy** (`tide-realm-admin`) must exist — it is created as part of granting
     `tide-realm-admin` to the first admin, and it is attached to every policy deployment.
  4. Contract uploaded (`POST /admin/realms/{realm}/iga/forseti-contracts` — scriptable, no enclave).
  5. Policy built with all five fields (`version:"3"`, uppercase-SHA-512 `contractId`, `modelId`,
     `keyId=vendorId`, `params` as pairs), transported with the three-level `"forseti"` nesting, and
     **signed via one browser enclave operator approval** (`createTideRequest` →
     `requestTideOperatorApproval` → `executeSignRequest`). Store `policy.toBytes()` with the signature.
  6. Local .NET 8 compile harness to compile the contract **before** the enclave step (each on-ORK
     failure costs an approval).
- [Confirmed] Adapter evidence of licensing is present: `data/tidecloak.json` has `jwk`, `vendorId`,
  `vvkId`, `gVVK`, `homeOrkUrl`, thresholds 14/20 — strong evidence the realm was licensed and had a
  Tide vendor key at export time. **Per instruction, this is NOT treated as proof that policy
  deployment works** — the `jwk`/`gVVK` presence only proves a vendor key existed, not that
  `tide-realm-admin` is granted, that IGA is in Tide mode, or that an enclave approval can complete.
- [Confirmed constraint] `asgard-tide` (which the playbook imports `BasicCustomRequest` from) is **NOT
  installed**. However, `@tidecloak/js@0.14.20` exposes `Models.BaseTideRequest` and the signing
  methods directly (see TIDE-1), so a `BaseTideRequest`-based construction is available without
  `asgard-tide`. Whether `BasicCustomRequest` specifically is needed depends on approval-card
  rendering; to be settled during the actual contract spike, not now.
- [Blocked] Could not verify the **live** realm state (is it running, licensed, IGA-in-Tide-mode, is
  `tide-realm-admin` granted, does `GET /admin/realms/{realm}/iga/role-policies` return the
  `tide-realm-admin` policy). Requires TideCloak running. See "Manual actions required".

## ENV-3 — VUID mapper  →  BLOCKED (cannot verify without a live token)

- [Confirmed] The `vuid` claim cannot be verified statically: the adapter JSON contains no mappers
  (grep for `vuid` in `data/tidecloak.json` → no matches), and the stale `tidecloak/realm.json` does
  not declare the client''s protocol mappers. Per the pack, Tide protocol mappers (`vuid`,
  `tideUserKey`) are auto-created on client creation by `setUpTideRealm`, but their presence **must be
  confirmed against a real issued token**, not assumed.
- [Blocked] Verifying a real access token carries a non-empty `vuid` requires logging in against the
  running realm. Docker/TideCloak is down, so this could not be done.
- **Required fix if the mapper is missing (from MCP, not yet needed):** add an
  `oidc-usermodel-attribute-mapper` on the client with `user.attribute: vuid`, `claim.name: vuid`, and
  `access.token.claim/id.token.claim/userinfo.token.claim/introspection.token.claim/lightweight.claim`
  all `true`. A missing `vuid` mapper is a silent, total failure of any ownership contract that binds
  to the vuid (the contract has nothing to compare against).

## TIDE-1 — SDK signing reachability  →  VERIFIED (static + toolchain), one nuance

- [Confirmed] Installed and version-matched at `0.14.20`: `@tidecloak/js`, `@tideorg/js`,
  `heimdall-tide`, `@tidecloak/nextjs`, `@tidecloak/react`, `@tidecloak/verify`. **Not installed:**
  `asgard-tide` and `@tidecloak/policy` (the latter is an optional peer used only by the
  `@tidecloak/js/policy-react` subexport — not required for core signing).
- [Confirmed] **Correct imports for signing in this app** (from installed type declarations and built
  index files):
  - `import { TideCloak, IAMService, Models } from "@tidecloak/js";`
  - `import { PolicySignRequest } from "heimdall-tide";` (also re-exported by `@tidecloak/js`)
  - `Models` (from `@tideorg/js`) exposes `Policy`, `BaseTideRequest`, etc.
  - **Do NOT import `Models`/`PolicySignRequest`/`IAMService`/`TideCloak` from `@tidecloak/nextjs`** —
    verified its `index.d.ts` re-exports only auth/provider/hooks (+ `RequestEnclave`); the signing
    helpers are absent there.
- [Confirmed] The `TideCloak` class (`@tidecloak/js/dist/types/lib/tidecloak.d.ts`) exposes the signing
  methods **directly** as first-class methods — better than the older `_tc`-only guidance:
  `createTideRequest(encodedRequest)`, `requestTideOperatorApproval(requests)`,
  `executeSignRequest(request, waitForAll?)`. It also exposes `doken`/`dokenParsed`, `secureFetch`,
  and encrypt/decrypt.
- [Confirmed] **Toolchain proof.** A temporary probe module importing the signing symbols and
  referencing the three method names via a `Pick<TideCloak, ...>` type:
  - passed `npm run typecheck` (tsc `--noEmit`) with exit 0, and
  - passed a full `next build --webpack` production build (`Compiled successfully in 18.6s`,
    TypeScript OK, pages generated).
  This proves the symbols resolve and bundle under the project''s real Next.js 16 + webpack toolchain.
  The probe files (`lib/tide/tide1-signing-probe.ts` and a temp `app/api/__tide1_probe/route.ts`) were
  **deleted** afterwards; the app tree is back to its prior state (no `lib/`, no `app/api/`).
- [Confirmed nuance / Constraint] A raw **Node ESM** import of these packages fails
  (`ERR_MODULE_NOT_FOUND` / `ERR_UNSUPPORTED_DIR_IMPORT`) because `@tideorg/js` and `heimdall-tide` use
  extensionless / directory-style ESM imports. This is **expected** and is exactly why `next.config.ts`
  sets `config.module.strictExportPresence = false` and aliases `@tidecloak/react`. **Implication:**
  signing code must run through the bundler (Next.js), and per the browser-only constraint it runs in
  the browser/client context — do not attempt to `import` these in a plain Node script or a
  non-bundled context.

## Design open question — ownership supersession  →  REMAINS AN INVESTIGATION ITEM (not resolved)

- [Investigation] Not resolvable by assumption or by static inspection. The ORK network signs
  *statements*; nothing observed indicates the ORKs maintain per-item "current owner" state. The
  candidate model is **app-enforced supersession**: store each transfer as a new VVK-signed attestation
  binding `itemInstanceId → newOwnerVuid`, and treat only the latest valid attestation as
  authoritative.
- **What must be tested to decide it (once signing is live):**
  1. Can a second attestation for the same `itemInstanceId` bind a *different* `vuid` and be
     threshold-signed by the ORKs? (Confirms transfer can be represented.)
  2. After a second (buyer) attestation exists, does server-side verify-on-read, when it selects the
     latest valid attestation, correctly reject an *exercise* request whose actor `vuid` matches only
     the **previous** (seller) attestation? (Confirms the seller loses authority — app-enforced.)
  3. Is there any in-contract mechanism (e.g. a monotonic sequence / nonce the contract checks, or a
     rejection of stale attestations) that would let the ORKs themselves refuse a superseded proof,
     rather than relying solely on the app to pick the latest? (Determines whether supersession is
     app-enforced only, or can be partly network-enforced.)
  4. Negative test: can a superseded (old) attestation, replayed on its own, ever verify as current?
     It must not.
- Status: [Investigation]. Cannot be proven until TideCloak is running and the ownership signing spike
  (backlog TIDE-2/TIDE-3) exists. Recorded here so it is not silently assumed.

## Manual actions required from the operator (to unblock ENV-2 live checks and ENV-3)

1. **Start Docker Desktop and the TideCloak container**, then confirm
   `http://localhost:8080/health/ready` returns 200. (The `scripts/init-tidecloak.ps1` script creates
   the container on first run; it errors if a `tidecloak` container already exists, so check
   `docker ps -a` first.)
2. Once up, an agent/script can then verify (no further human step unless multiAdmin enclave approval
   is required):
   - realm is licensed and IGA is enabled **in Tide mode** (`iga.attestor=tide`);
   - the admin user has `tide-realm-admin` and a linked Tide account;
   - `GET /admin/realms/login-app-with-tidecloak/iga/role-policies` returns a `tide-realm-admin` policy;
   - a fresh login produces an access token containing a non-empty `vuid` (ENV-3).
3. **Enclave approval (human, later):** deploying the ownership Forseti policy (backlog TIDE-2) requires
   the admin to approve once in the Tide enclave popup in the browser. Not needed yet.

---

# Live Verification Results — ENV-2 & ENV-3 (2026-09-07, against running TideCloak)

Method: temporary read-only diagnostic page (`app/tide-verify-temp/page.tsx`) run inside the
operator''s existing authenticated browser session (user `jaidyndinh06`). Local token inspection for
ENV-3; DPoP-bound admin `GET`s (via `secureFetch` with the session token) for ENV-2. No master-admin
used. No auth/config changed.

## Routing note (resolved)
- [Confirmed] The first diagnostic folder `app/__tide-verify/` returned 404 because **Next.js App
  Router excludes underscore-prefixed folders from routing (private/colocation folders)**. The file was
  correct; the `__` name was the problem. Renamed to `app/tide-verify-temp/` → route resolved. No code
  change to the page. Lesson: do not prefix temporary route folders with `_`.

## ENV-2 — PASS (live)
- [Confirmed] Realm `login-app-with-tidecloak` admin settings readable (HTTP 200 with the operator''s
  own `tide-realm-admin` session token — no master-admin needed).
- [Confirmed] **IGA enabled = `true`**.
- [Confirmed] **IGA attestor = `tide`** — cryptographic (VVK-sealed) governance mode, not tideless.
  This is the mode required for the security properties to hold.
- [Confirmed] **`tide-realm-admin` role-policy present** (`GET /iga/role-policies` → `["tide-realm-admin"]`),
  status 200. This is the admin policy that must be attached during Forseti policy deployment.
- [Confirmed] Operator account **holds the `tide-realm-admin` client role**
  (`hasClientRole('tide-realm-admin','realm-management') === true`).
- [Confirmed] `GET /admin/realms/{realm}/iga/forseti-contracts` reachable (HTTP 200) — the contract
  upload target for the spike is available to this account.
- Net: the realm is provisioned to **deploy and execute** a custom Forseti signing policy, and the
  operator''s account has the rights and admin-policy prerequisite to do it. The earlier assumption
  (that `jwk`/`gVVK` presence did not prove deployability) is now upgraded: deployability prerequisites
  are confirmed. The only remaining unproven part is the actual deploy+sign, which needs one enclave
  approval (spike).

## ENV-3 — PASS (live)
- [Confirmed] Access token `vuid = 88eae7da…0bf5f0` (64-hex), **non-empty**.
- [Confirmed] ID token carries the **same** `vuid` (consistent across tokens).
- [Confirmed] Corresponds to the expected identity: `preferred_username = jaidyndinh06`,
  `sub = 48763d41-…-f3602dce01c2`. (Note: `sub` != `vuid`; the ownership contract must bind to `vuid`,
  which is `DokenDto.UserId`, never `sub` — AP-66.)
- [Confirmed] `tideuserkey` claim present; `cnf.jkt` present (DPoP binding live on the real token,
  consistent with I-12 and the server advertising DPoP).
- Net: the `vuid` the signing flow will bind to exists, is non-empty, and is the logged-in user''s.

## Status of blockers after this run
- ENV-1: resolved (documented earlier).
- ENV-2: **PASS** (was: partially verified / live-blocked).
- ENV-3: **PASS** (was: blocked).
- TIDE-1: verified earlier (SDK signing reachable under the toolchain).
- Next: ownership signing spike (TIDE-2/TIDE-3), which requires one browser enclave approval.

---

# Signing Spike — Attempt 1 (2026-09-07): ORK compile failure, root-caused

## What got proven along the way (before the failure)
- [Confirmed] Contract upload endpoint works with the operator token: `POST /iga/forseti-contracts` → 200.
- [Confirmed] `tide-realm-admin` admin policy is fetchable and non-empty (376 bytes).
- [Confirmed] The deploy request built with `PolicySignRequest.New(policy).addForsetiContractToUpload(source)`
  reached the ORKs, the **enclave approval popup worked, and the operator approval succeeded**
  (`approval status=approved`). So: policy-signing transport + approval flow are reachable end-to-end
  in THIS app with the installed SDK (no `asgard-tide` needed for the IMPLICIT path).
- [Confirmed] `contractId` computed in-browser = `70FFE730DD7FBCDA…` (uppercase SHA-512), model id
  `BasicCustom<OwnershipSpike>:BasicCustom<1>` — client-side pre-flight assertions all passed.

## The failure
- [Confirmed] `executeSignRequest` failed at the ORK with `VmHost.CompileFailed`:
  `CS1929: 'byte[]' does not contain a definition for 'TryGetValue' ... requires a receiver of type
  'System.ReadOnlyMemory<byte>'` at the two `ctx.Data.TryGetValue(...)` call sites.
- **Root cause:** on the real ORK Forseti SDK, `DataContext.Data` is a **`byte[]`**, and
  `GetValue`/`TryGetValue` are extension methods on **`ReadOnlyMemory<byte>`** (namespace
  `Serialization`). The contract called them directly on `ctx.Data` (a `byte[]`), which does not bind.
  Fix: wrap as `ReadOnlyMemory<byte> data = ctx.Data;` (implicit `byte[]`→`ReadOnlyMemory<byte>`) — or
  `new ReadOnlyMemory<byte>(ctx.Data)` — before calling the accessors.
- **Why local compile missed it [Constraint / lesson]:** my compile-harness stub typed
  `DataContext.Data` as `ReadOnlyMemory<byte>`, so `ctx.Data.TryGetValue(...)` compiled locally. The
  harness only catches shape errors if the stub shapes are faithful. The real receiver type is `byte[]`.
  Harness stub corrected to `public byte[] Data { get; set; }` so it reproduces the ORK''s binding rules.
- [Constraint] Each failed `executeSignRequest` costs one enclave operator approval. Attempt 1 spent one.
  The corrected contract has a NEW `contractId` (source changed), so a fresh upload + policy sign is
  required; the previously deployed `OwnershipSpike` policy references the old (broken) contract hash
  and is now stale.

## Status
- Signing spike: **not yet proven** (contract compiled on ORK failed). Deploy/approval plumbing proven.
- Next: fix stub + contract, re-compile locally against the corrected stub, then re-run (one more approval).

---

# Signing Spike — Attempt 2 (2026-09-07): contract compiled on ORK; policy DEPLOYED; client bug after

## Proven this attempt
- [Confirmed] The corrected contract (`contractId 72567527A84CA9F4…`) **compiled on the ORK** — no
  `VmHost.CompileFailed`. The local-harness fix (typing `DataContext.Data` as `byte[]`) correctly
  predicted ORK compilation this time.
- [Confirmed] **A custom Forseti policy was threshold-signed and deployed**: create → operator approval
  (enclave popup) → executeSignRequest returned a signed policy; `policy.toBytes()` = **465 bytes**
  (TideMemory-serialized policy with the 64-byte Ed25519 VVK signature attached). This proves the realm
  can deploy+sign a custom policy end-to-end, and that the operator (`jaidyndinh06`, `tide-realm-admin`)
  can complete the enclave approval. ENV-2 deployability is now fully demonstrated, not just prerequisite-checked.

## The failure (client-side, my bug — NOT Tide)
- [Confirmed] After deploy, the OWNERSHIP-statement step threw
  `InvalidCharacterError: atob ... not correctly encoded`. Cause: my code tried to `atob()` the whole
  `tc.doken` (a JWT-format, dot-separated base64url value) as a single base64 blob to build
  `addAuthorizer(dokenBytes)`. That is malformed and unnecessary.
- **Fix:** remove the hand-rolled doken decode / `addAuthorizer` entirely and let the SDK authorize the
  request from the active session (the policy-deploy request succeeded WITHOUT any manual authorizer,
  so the ownership request should follow the same pattern). No new enclave approval needed for the
  ownership sign (IMPLICIT, no popup).
- [Constraint] The doken is NOT a single base64 string. Do not `atob` it whole. If raw bytes are ever
  needed, decode per-segment as base64url — but for this flow the SDK handles authorization.

## Status
- Policy deploy + ORK contract compile: **PROVEN**.
- Ownership statement signing + VVK verification: **not yet reached** (blocked by the client bug above).
- Next: patch the page (drop the broken authorizer block) and re-run the ownership sign only. No approval expected.

---

# Signing Spike — Attempt 3 (2026-09-07): SUCCESS (end-to-end against live ORKs)

## Result: ok=true
- [Confirmed] Custom Forseti contract `OwnershipSpike` (contractId `72567527A84CA9F4…`, 2587 bytes)
  compiled and executed on the ORK network.
- [Confirmed] Custom policy threshold-signed and deployed (signed policy bytes = 465).
- [Confirmed] The ORKs produced a **64-byte Ed25519 threshold signature** over the statement payload
  binding a DUMMY item instance to the operator''s vuid:
  - payload = TideMemory[ "spike-item-0001", vuid(88eae7da…) ]
  - signature (hex) = 9850c955e9d55311b21f351b10873d796e7c1fc9acc193455aec0e272014664273625e4fbe3057e53643d63f6336420378b4583eaac7aad1ea5a9fa922282301
- [Confirmed] **The signature verifies against the realm VVK** (embedded Ed25519 jwk from
  `data/tidecloak.json`) using browser WebCrypto `crypto.subtle.verify({name:"Ed25519"}, …)` over the
  exact payload bytes → `true`. So the signed message is the raw payload bytes (no extra envelope) in
  this flow, and a third party holding only the public VVK can verify the statement.

## What this PROVES (and only this)
- [Confirmed] Tide can **create and verify a threshold-signed statement binding an item instance to a
  user''s vuid**, where:
  - the signing key never materializes (threshold across ORKs, I-01/I-02);
  - a Forseti contract gated the signature on `boundOwnerVuid == DokenDto.UserId` (the vuid), so the
    ORKs will only sign when the executing session''s vuid matches the bound owner;
  - verification is against the public VVK, independent of the app DB.
- [Confirmed] Therefore a signed ownership statement is **not forgeable by editing a database row**:
  a DB `owner` column has no bearing on whether a VVK-verifiable signature exists for a given
  (item, vuid) pair. This is the core of PoC research question 1, demonstrated for a single item.

## What this does NOT prove (explicitly out of scope of the spike) [Investigation]
- Does NOT prove marketplace ownership TRANSFER. No second user, no re-binding to a buyer vuid.
- Does NOT prove SUPERSESSION (that a new attestation invalidates the previous owner''s authority).
  That remains the open design question — see the supersession investigation item; it needs the
  transfer test (second attestation to a different vuid + app-enforced "latest valid attestation wins"
  + negative test that a superseded statement is not treated as current).
- Does NOT prove the negative cases: that the ORKs REFUSE to sign when the executor vuid != bound vuid.
  The contract contains that check and compiled, but a deny-path test was not run. (Signing succeeding
  for the matching case does not prove the mismatch case is rejected.) [Investigation — next test]
- Does NOT establish item lifecycle, inventory, equip, or any persistence — none were built.

## Constraints reconfirmed during the spike
- [Constraint] Signing is browser/session-only (ran in the authenticated page; SDK authorized from the
  session — no manual doken decode; the doken is JWT-format, not a single base64 blob).
- [Constraint] Each ORK sign attempt that reaches threshold costs one enclave approval; contract edits
  change contractId and require re-deploy. Local compile-harness with FAITHFUL stub shapes
  (DataContext.Data is byte[]) is essential to avoid burning approvals on shape errors.
- [Constraint] `asgard-tide` and `@tidecloak/policy` are NOT installed and were NOT needed: the IMPLICIT
  path used `PolicySignRequest` (heimdall-tide) + `Models.BaseTideRequest`/`Policy`/`Tools.TideMemory`
  (@tidecloak/js). VVK verify used browser WebCrypto Ed25519.

## Artifacts left in the realm (governed, intentional)
- A Forseti contract named `OwnershipSpike` and at least one signed policy for it (two versions were
  deployed across attempts 2 and 3; the attempt-1 contract hash was never successfully deployed).
  Left in place deliberately (removing a committed policy is itself a governed action). Not used by any
  production code. Documented here so it is not mistaken for app functionality.
