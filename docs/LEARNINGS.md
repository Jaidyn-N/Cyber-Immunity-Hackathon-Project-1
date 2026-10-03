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

  > **Update (2026-10-01):** this open question was investigated end-to-end with a real Player B.
  > Outcome: rebinding / a new attestation for a second owner is **Demonstrated**, but the current
  > OwnershipSpike contract provides **no supersession/revocation** — A''s prior attestation still
  > verifies after B''s. See `# Player B ownership attestation / supersession investigation (2026-10-01)` below. Supersession remains the open design item; not implemented.

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

---

# Ownership Deny-Path Test — CONFIRMED (2026-09-07, live ORK network)

## Setup
- Reused the existing `OwnershipSpike` contract; deployed `contractId` fetched from the realm and
  asserted == `72567527A84CA9F4…` before any governed step (matched: true). Contract source and the
  security condition were NOT changed. No new policy created.
- Original signed policy bytes were never persisted, so the identical policy was **re-signed once**
  (one enclave approval, provided by the operator). Result: 465-byte signed policy — same size/shape as
  the successful spike''s policy.
- Signed policy bytes persisted locally to `test-artifacts-temp/OwnershipSpike.signed-policy.bin`
  (465 bytes) so future allow/deny/transfer tests can reuse them WITHOUT another enclave approval.
  This file is test-only and is NOT imported by any production/application code.
- authenticated player vuid **A** = `88eae7da…0bf5f0` (real, from live token).
- deliberately mismatched bound owner vuid **B** = `00000000…deadbeef` (64-hex, not A).
- Same dummy item instance `spike-item-0001`, executed through the OwnershipSpike Forseti policy.

## Expected vs actual
- Expected: Forseti/ORKs REJECT because `boundOwnerVuid (B) != DokenDto.UserId (A)`; no threshold
  signature produced.
- Actual: **exactly that.**

## Result: [Confirmed] — the deny path holds
- [Confirmed] **All 20 of 20 ORKs independently denied** the request at `PreSign` with the contract''s
  own message: `Forseti policy denied (Data, Executor): Executor vuid does not match the bound owner
  vuid`. (Per-ORK gas 1497–5506, i.e. each ORK actually executed the contract.)
- [Confirmed] Threshold was NOT reached (`TIDE-TIDEJS-NET-THRESHOLD_FAILURE: 0 of 20 required, 20
  failed`). **No valid threshold signature was produced** (`signature_produced: false`).
- [Confirmed] The rejection is an **intentional Tide/Forseti policy denial distributed across every
  ORK** — NOT client-side validation and NOT an infrastructure failure. Evidence: the deny string is
  the exact `PolicyDecision.Deny` text from `ValidateExecutor`, returned independently by all 20 ork
  nodes at the `PreSign` stage; classification = `ORK_FORSETI_REJECTION`.

## What is now proven (combined with the earlier success)
- [Confirmed] Positive path (attempt 3): the ORKs threshold-sign item→owner-vuid ONLY for the matching
  owner, and the signature verifies against the realm VVK.
- [Confirmed] Negative path (this test): the ORKs REFUSE to sign when the executor vuid != bound owner
  vuid. Together these establish that a Tide ownership statement''s authority is cryptographically bound
  to the owner vuid: it cannot be minted for an owner the caller is not, and a DB `owner` row cannot
  substitute for a VVK-verifiable signature. This fully answers PoC research question 1 for a single
  item, both directions (grant + refuse).

## What remains unproven (still out of scope; do NOT assume)
- [Investigation] Ownership TRANSFER: re-binding an item to a second user''s (buyer) vuid. Not attempted.
- [Investigation] SUPERSESSION: that a new attestation strips the previous owner''s authority and that a
  superseded statement is not treated as current. Still the open design question; needs the transfer
  test + "latest valid attestation wins" + a negative test that a superseded statement is rejected.
- No persistence/inventory/equip/marketplace/UI — none built (deliberately).

## Notes / constraints reconfirmed
- [Constraint] The signed policy bytes are the reusable artifact; the contract source alone is not
  enough to run a governed request. Persisting `policy.toBytes()` (done here) avoids future approvals
  for allow/deny/transfer tests against this same policy.
- [Constraint] Deny fires at `PreSign` before any partial signature — so a denied request costs ORK
  compute (gas) but produces nothing signable; it does not consume an enclave approval (only the
  policy deploy/re-sign does).

---

# Transfer / Supersession PoC (TESTS 1-4) — partial: TEST 1 CONFIRMED; TEST 2/3 BLOCKED (ORK Fabric 500)

Scope: TESTS 1-4 only, reusing the existing OwnershipSpike contract + persisted signed policy
(test-artifacts-temp/OwnershipSpike.signed-policy.bin, 465 bytes). No contract change, no new policy,
no new enclave approval. Isolated temp test code under app/tide-transfer-temp + app/api/tide-transfer-temp.

## TEST 1 — Player A initial ownership — [Confirmed]
- Player A vuid = `88eae7dad1eee3e681ac8c009d65aad2b3d51f8745e8ca6c8a54f46f500bf5f0`.
- Item = `spike-item-0001`.
- Reused the persisted signed policy (465 bytes) with NO new enclave approval; signed
  `(spike-item-0001 -> A.vuid)` via IMPLICIT executeSignRequest.
- Result: 64-byte Ed25519 signature; **VVK verify = true**. A''s ownership statement re-established and
  independently verified. Signature (hex): b619c3e4…ede000d. Saved as role A.

## TEST 2 & 3 — transfer to Player B — [Blocked]
> **Superseded (2026-10-01):** this [Blocked] status was accurate on 2026-09-07 (ORK outage).
> Player B now works — see `# Player B ownership attestation / supersession investigation (2026-10-01)`.
> This block is retained as a point-in-time record; do not read it as the current status.
- Blocked BEFORE the test could run: creating/authenticating **Player B** fails at account creation
  with client error "Error creating user account. Network request failed".
- **Root cause (infrastructure, NOT our code/policy):** the shared Tide ORK Fabric
  (`ork1..24.tideprotocol.com`) is currently returning **500 Internal Server Error** on the
  `TidecloakSessionStartTokenSign:1` signing model. TideCloak logs (2026-09-22 ~00:00:24-00:00:39):
  `[Midgard] PromiseRace task[0..19] failed: ... 500 (Internal Server Error)` across all 20 ORKs →
  `SignModel failed: Not enough orks returned an ok response` →
  `Tide ORK signing failed during token encode: ... TidecloakSessionStartTokenSign:1`.
- Account creation + new-session start require ORK threshold signing, which is what is 500-ing.
- **Not our test code** (test page runs only post-login), **not the OwnershipSpike contract/policy**,
  **not local config** (ORK roots return HTTP 200; Player A''s session and ownership-sign work).
- **Intermittent:** A''s ownership sign (TEST 1) succeeded and a RealmAttestationExporter run succeeded,
  interleaved with the 500s — characteristic of transient shared-test-Fabric instability (cf. the
  earlier self-resolving auth loop).

## TEST 4 — both statements independently valid — [Not reached / Investigation]
- Cannot be executed without B''s signature (needs TEST 2/3). The verify-both harness is in place and
  will independently verify A''s and B''s statements against the realm VVK once B can sign.

## Supersession — [Unproven] (and design-limited regardless of the outage)
- Independent of the outage, PRIOR ANALYSIS STANDS: the existing OwnershipSpike contract signs a
  standalone `(item, ownerVuid)` statement with NO version/nonce/revocation and the ORKs keep no
  per-item current-owner state. Therefore even once B signs, **A''s original signature will remain
  cryptographically valid** — the contract provides owner-bound signing authority but **not**
  revocation/supersession. Supersession would require application-side "current pointer" state and/or
  a different (sequence/nonce-aware) contract — a governed change deliberately NOT made here.
- Marked **UNPROVEN**; not to be solved yet per instruction.

## What Tide/Forseti enforces vs not (confirmed so far)
- Enforces: owner-bound signing (only executor whose doken vuid == bound owner vuid gets a signature;
  positive path TEST 1/earlier spike, negative path earlier deny-test all-20-ORK reject).
- Does NOT enforce (by this contract): revocation/supersession of a previously issued ownership
  signature. Old signatures remain valid; "latest wins" is not a Tide-provided property here.

## Manual action required
- **Retry TEST 2/3 later** once the ORK Fabric recovers (the 500s on `TidecloakSessionStartTokenSign`
  are server-side on the shared test ORKs). Practical check before retrying: attempt Player B account
  creation again; if it still fails, re-inspect `docker logs tidecloak` for the same
  `Not enough orks returned an ok response` signature. No config/policy/code change should be made to
  "fix" this — it is an upstream ORK availability issue.
- Player B must be a **Tide-linked** second account (reach dashboard once) to obtain a real vuid.

---

# Marketplace Beta Implementation — Tasks 0-3 (2026-09-07)

Findings from building the beta application layer (Categories 1 and 2 of the marketplace-beta spec).
This is the working application on top of the proven Tide PoC. It does NOT touch `OwnershipSpike`,
Tide auth/DPoP config, or the Tide ownership research; the existing Tide findings below this section
remain fully in force.

## Task 0 — SQLite / native dependency

- [Confirmed] `better-sqlite3@13.0.3` was introduced as the approved database dependency (plus
  `@types/better-sqlite3@9.6.0` dev). It was the only runtime dependency added.
- [Confirmed] The native binding loaded and completed an in-memory query round-trip on the development
  machine — the module works here.
- [Constraint] `better-sqlite3@13` ships **prebuilt platform binaries** (incl. `win32-x64.node`), so on
  this Windows environment no native source compilation / build toolchain was required. (If the app is
  ever moved to a platform without a matching prebuild, a compile step would be needed.)
- [Confirmed] `npm run typecheck` and `next build --webpack` both passed after installation.
- [Constraint] A transient typecheck failure after removing the temporary Tide-transfer test routes was
  caused by **stale generated `.next/dev/types` references** to the deleted routes, NOT by application
  source. Removing the generated type artifacts (they regenerate on dev/build) cleared it. This recurs
  whenever a route is deleted — clear stale `.next` types rather than treating it as a code error.

## Task 1 — SQLite schema (Layer A + separate Layer C)

- [Confirmed] The schema (`lib/db/schema.sql`) covers the seven Layer A tables (player, item_template,
  item_instance, shop_offer, purchase_record, marketplace_listing, marketplace_transaction) plus the
  **separate** Layer C table `tide_ownership_attestation`.
- [Constraint] SQLite type mapping in use: UUIDs as `TEXT` (app-generated, not rowids, for clean future
  migration), booleans as `INTEGER 0/1` with CHECK constraints, timestamps as ISO-8601 `TEXT`.
- [Confirmed] A **partial unique index** (`WHERE status = 'active'`) enforces at most one active
  marketplace listing per item instance while still allowing re-listing after cancellation/sale. A
  plain UNIQUE constraint would have wrongly blocked re-listing.
- [Constraint] SQLite enforces foreign keys **per connection** (`PRAGMA foreign_keys = ON`), so this
  became an explicit requirement of the application connection layer (Task 2), not just the schema file.
- [Confirmed] Schema validation against a fresh DB exercised and confirmed: foreign-key enforcement,
  the `currency_balance >= 0` CHECK, the `transfer_kind = 'application-level-temporary'` CHECK, the
  `acquired_via IN ('shop','marketplace')` CHECK, and the active-listing uniqueness rule.

## Task 2 — database architecture

- [Confirmed] The app uses a **lazy, module-level singleton** SQLite connection (`lib/db/index.ts`) —
  one shared connection, opened on first use (safe for `next build`).
- [Confirmed] `PRAGMA foreign_keys = ON` is set explicitly on the real application connection (not
  relying only on the schema file). `journal_mode = WAL` is enabled for the application database.
- [Constraint] Database access is **server-side only** and isolated behind `lib/db/` repositories
  (players, items, shop, marketplace). A runtime guard throws if the connection module is evaluated in a
  browser context (no `server-only` npm dependency was added). Raw SQL is confined to the repository
  layer and uses **parameterised** statements throughout.
- [Confirmed] Layer A `item_instance.owner_vuid` and Layer C `tide_ownership_attestation.owner_vuid`
  are deliberately separate columns in separate tables and are **not** automatically synchronised by any
  repository method.
- [Confirmed] The marketplace transfer path changes **only** Layer A ownership (`setOwnerVuid`) and
  records a `marketplace_transaction` (`transfer_kind='application-level-temporary'`); it does not
  create or modify a Tide ownership attestation.
- [Confirmed] Repository validation confirmed that writing a Layer C attestation with a *different*
  `owner_vuid` leaves the Layer A owner unchanged — the two layers stay independent.

## Task 3 — server-side authentication (verified-JWT boundary)

- [Confirmed] Server-side API authorization relies on **verified JWT claims**, not frontend auth state.
  The existing client TideCloak/DPoP flow (login/logout, relay, config, dashboard) is unchanged; this
  task only adds the server-side verification boundary in `lib/auth/`.
- [Confirmed] JWTs are verified cryptographically with `jose` using the **embedded/local** JWK from the
  existing TideCloak adapter (`data/tidecloak.json`) — local only, never remote (I-04). A token is never
  trusted decoded without signature verification.
- [Confirmed] The verifier checks the expected issuer (`<auth-server-url>/realms/<realm>`) and the
  `azp === resource` relationship (TideCloak puts the client id in `azp`, not `aud`), plus `exp`/`iat`.
- [Confirmed] A **non-empty `vuid`** is required and becomes the trusted application identity. `withAuth`
  exposes it via an `AuthContext { vuid, token }`.
- [Confirmed] A **client-supplied `vuid` cannot override** the `vuid` extracted from the verified token
  (validated by test — the handler used the token vuid and ignored a body-supplied one).
- [Confirmed] `withRole` checks realm/client roles from **verified token claims**, never from request
  body/query. 401 if unauthenticated/unbound, 403 if authenticated but missing the role.
- [Confirmed] The server requires `cnf.jkt` to be present for the existing DPoP-bound `secureFetch`
  path (fail closed with 401 if absent).
- [Constraint] The implementation does **not** independently verify the Tide-specific DPoP proof itself
  (the `secureFetch` proofs are Tide-specific, not RFC 9449 compact JWS). It relies on the Tide
  issuance/binding mechanism and asserts the `cnf.jkt` binding claim server-side (I-12). This is a
  deliberate design choice, NOT RFC 9449 proof verification — do not imply otherwise.
- [Confirmed] Automated validation covered: valid token accepted + vuid extracted; invalid signature,
  expiry, wrong issuer, wrong azp, missing/empty vuid, missing DPoP `cnf.jkt`, and missing
  authentication all rejected; `hasRole` realm+client; `withRole` role enforcement (403); and the
  client-supplied-vuid substitution attempt (ignored).
- [Constraint / Investigation] The automated tests used a **fixture Ed25519 keypair** (the loader
  pointed at a fixture adapter via `CLIENT_ADAPTER`). They prove the JWT verification logic against real
  cryptographic signatures, but they do **not** by themselves prove end-to-end acceptance of a
  live Tide-issued token. Live-token verification will occur when the API routes are exercised against
  the running TideCloak environment (Task 4+).

## Validation method note (Tasks 1-3)

- [Constraint] The project has no test framework installed; validation used throwaway Node scripts
  (the project''s existing approach), removed after each run, with no permanent test artifacts added.
  The repos/auth modules use extensionless relative imports (idiomatic for the Next.js bundler,
  `moduleResolution: "bundler"`); raw Node ESM cannot resolve these, so validation scripts used a small
  dev-only resolve hook. Correctness under the real toolchain is independently confirmed by
  `npm run typecheck` and `next build --webpack` passing with the extensionless imports intact.

## Relationship to the existing Tide findings (unchanged)

The beta''s Layer A application ownership (`item_instance.owner_vuid`) and its temporary marketplace
transfer do NOT affect, and are kept strictly separate from, the previously recorded Tide ownership
research below: the confirmed Tide ownership signing, the vuid-bound signing, the all-20-ORK deny-path
result, the Player B / ORK infrastructure blocker, and the confirmed limitation that `OwnershipSpike`
provides owner-bound signing authority but NOT supersession/revocation. Those findings remain in force.

## Task 4 — player / profile / currency API (2026-09-07)

- [Confirmed] Implemented `GET /api/me` (`app/api/me/route.ts`): returns the authenticated player''s own
  profile — `vuid`, `displayName`, `currencyBalance`, `equippedInstanceId`, `hasPrivateNote` (boolean),
  `createdAt`. Built on the Task 3 `withAuth` → `AuthContext.vuid` → `getOrCreateCurrentPlayer` flow;
  a new player row is auto-created on first call with a starting simulated balance.
- [Confirmed] Identity is taken ONLY from the verified JWT. A `vuid` supplied in the request body does
  not override it (tested). Per-`vuid` isolation confirmed: a different authenticated caller gets their
  own auto-created record.
- [Confirmed] The route exposes a **safe projection** — the Tide-self-encrypted `private_note_ciphertext`
  blob is never returned (only a `hasPrivateNote` boolean). Sensitive DB fields are not leaked.
- [Confirmed] Added guarded currency helpers to `lib/db/players.ts` for later tasks (shop/marketplace):
  `creditBalance` (rejects negative amounts), `debitBalance` (guards server-side and throws
  `InsufficientFundsError` before mutating if funds are short), and an `InsufficientFundsError` class.
  Currency non-negativity is enforced at BOTH layers: server-side guard AND the schema
  `CHECK (currency_balance >= 0)`. Validation confirmed a raw negative update is rejected by the DB CHECK.
- [Confirmed] Persistence: a player''s balance survives closing and reopening the SQLite connection
  (same `data/app.db` file) — i.e. it persists across an application restart, not just within a session.
- [Constraint] Node''s TypeScript **strip-only** runtime (used by the throwaway validation scripts) does
  not support **parameter properties** (`constructor(public readonly x: ...)`). This is a validation-tool
  limitation, not a build limitation (Next.js/webpack transpiles fully), but `InsufficientFundsError` was
  rewritten with explicit field declarations to keep the code strip-mode-compatible for validation.
  General note for later tasks: avoid TS parameter properties in `lib/` so the Node validation scripts run.
- [Confirmed] Validation (project''s throwaway-Node-script approach; fixture Ed25519 key for real
  signature checks; temp DB; removed after): 9/9 passed — currency guards + DB CHECK backstop;
  `GET /api/me` unauthenticated/malformed/missing-cnf.jkt → 401; authenticated returns own safe profile
  (no ciphertext); client-supplied vuid cannot override; per-vuid isolation with auto-create; balance
  persists across connection close/reopen. `npm run typecheck` and `next build --webpack` both pass;
  the build lists `/api/me` as a dynamic route.
- [Investigation] Same live-token limitation as Task 3 stands: `/api/me` was validated with a
  fixture-signed token, not a live Tide-issued one. End-to-end acceptance of a real TideCloak
  `secureFetch` token against `/api/me` will be observed once the frontend calls it (Task 15/16).
- Category 3 (Tide-backed transfer/supersession) and the Player B / ORK blocker are untouched by this task.

## Task 5 — inventory retrieval (2026-09-07)

- [Confirmed] Implemented `GET /api/inventory` (`app/api/inventory/route.ts`): returns the item
  instances whose Layer A `owner_vuid` matches the VERIFIED JWT vuid, each with template details
  (name, category, rarity, tradable), acquisition info (`acquiredVia`, `acquiredAt`), an `owned: true`
  marker, and an `equipped` flag computed from the player''s `equipped_instance_id`. Also returns
  `equippedInstanceId` and a `count`.
- [Confirmed] Reused the existing architecture with no new mechanism: `withAuth` →
  `getOrCreateCurrentPlayer` → the Task 2 repository `items.listInstancesForOwner(vuid)`. The
  ownership filter (`WHERE owner_vuid = ?`) lives in the repository (parameterised); no raw SQL was
  added outside `lib/db/`.
- [Confirmed] Identity/security: the vuid comes only from the verified token; a body-supplied `vuid`
  cannot override it (tested). Cross-player isolation confirmed — player A never sees player B''s
  instances and vice-versa. No Layer C attestation, OwnershipSpike, or DPoP config touched.
- [Constraint] The approved schema/design has **no `description` column** on `item_template`; "item
  details" for the UI are the defined fields (name, category, rarity, equipped) per Requirement 3.3.
  A description field was deliberately NOT added — that would be scope expansion beyond the approved
  design. If a richer description is wanted later it is a schema/design change, not part of Task 5.
- [Confirmed] Validation (throwaway Node script; fixture Ed25519 key; temp DB; removed after): 8/8
  passed — unauthenticated → 401; missing `cnf.jkt` → 401; authenticated retrieval returns own items
  with details + equipped flag; only the verified player''s items returned; cross-player isolation;
  client-supplied vuid cannot override; empty inventory returns count 0; inventory persists across
  connection close/reopen (restart). `npm run typecheck` and `next build --webpack` both pass;
  build lists `/api/inventory` as a dynamic route.
- [Investigation] Same standing limitation as Tasks 3-4: validated with a fixture-signed token, not a
  live Tide-issued one; live-token acceptance will be observed when the frontend calls `/api/inventory`
  (Task 15/16). Category 3 and the Player B / ORK blocker are untouched.

## Task 6 — equipping and avatar state (2026-09-07)

- [Confirmed] Implemented `app/api/inventory/equip/route.ts`:
  - `POST /api/inventory/equip { instanceId }` — equip an item the verified player owns; `instanceId: null`
    unequips (clears the slot).
  - `GET /api/inventory/equip` — return the caller''s current `equippedInstanceId`.
- [Confirmed] Reused existing implementation with NO new mechanism, NO new DB fields/tables: `withAuth`
  + `getOrCreateCurrentPlayer` (identity), `items.getInstance`/`items.isOwnedBy` (Layer A ownership
  check), `players.getEquipped`/`players.setEquipped` (the existing `player.equipped_instance_id`
  field). `/api/inventory` already reports the `equipped` flag (Task 5) and continues to do so.
- [Confirmed] Server-side ownership/security: the vuid is taken only from the verified JWT; before
  changing `equipped_instance_id` the route requires the item to exist (404 if not) AND be owned by the
  verified vuid (`isOwnedBy`, else 403). A body-supplied `vuid`/`owner_vuid` is ignored — only
  `instanceId` is read. `cnf.jkt` DPoP binding still required (inherited from `withAuth`).
  Layer A ownership stays separate from Layer C; no Tide attestation/OwnershipSpike/DPoP config touched.
- [Confirmed] Validation (throwaway Node script; fixture Ed25519 key; temp DB; removed after): 11/11
  passed — unauthenticated → 401; missing `cnf.jkt` → 401; equip own item; inventory reports correct
  equipped item; cannot equip another player''s item (403, equipped unchanged); client-supplied
  vuid/owner cannot override; non-existent item → 404; invalid `instanceId` type → 400; unequip (null)
  clears the slot; equipped state persists across DB close/reopen; per-player equipped isolation
  (equipping B''s item does not affect A). `npm run typecheck` and `next build --webpack` both pass;
  build lists `/api/inventory/equip` as a dynamic route.
- [Constraint] Avatar representation is intentionally minimal: the "avatar" is the equipped item id +
  its template details (name/category/rarity via `/api/inventory`); detailed artwork/complex
  customisation is out of scope per the approved design.
- [Investigation] Live-token acceptance remains deferred (validated with a fixture-signed token), to be
  observed when the frontend calls these routes (Task 15/16).
- Category 3 (Tide-backed transfer/supersession), the Player B flow, and the ORK blocker remain blocked
  and untouched by this task.

## Task 7 — randomised / rotating limited shop (2026-09-07)

- [Confirmed] Implemented the limited shop:
  - `lib/db/seed.ts` — idempotent catalogue of 8 cosmetic item templates (PUBLIC; the pool the shop
    draws from; NOT admin hand-picking of current stock). `ensureCatalogueSeeded()` seeds only if empty.
  - `lib/shop/rotation.ts` — deterministic-per-window, randomised-across-windows selection.
  - `lib/db/shop.ts` — added `hasOffersForWindow` + `materialiseRotation` (idempotent, transactional).
  - `app/api/shop/route.ts` — `GET /api/shop` returns the current rotation.
- [Confirmed] Rotation/randomisation: the current rotation is identified by its **time window**
  (WINDOW = 1 hour) and selection is a seeded shuffle (mulberry32, seed = window-start seconds) of the
  catalogue, capped at **SHOP_CAPACITY = 4**. Because the seed is the window start, **every request in
  the same window computes the identical selection** (refreshes do NOT reshuffle); a new window
  produces a new selection; the same item can reappear in a later window. (These two numbers — 1h
  window, capacity 4 — were left unspecified by the approved design; chosen as the smallest sensible
  values and recorded here. No rarity/economy mechanics were added; price = template `base_price`.)
- [Confirmed] Active-window determination + persistence: `GET /api/shop` seeds the catalogue, computes
  the window rotation, then `materialiseRotation` (one transaction) **deactivates expired offers**
  (`window_end <= now`) and **inserts this window''s offers only if not already present** (deterministic
  offer id `<windowStartIso>::<templateId>`), and returns `listActiveOffers(now)` (active=1 AND
  window_start <= now < window_end). Off-window offers are therefore not current and not purchasable
  (`isOfferPurchasable` false). This also gives Task 8 stable offer ids to validate against.
- [Confirmed] Reused existing architecture: `withAuth` (verified JWT -> vuid, `cnf.jkt` required),
  the existing `shop_offer`/`item_template` schema, and `lib/db/shop.ts`/`items.ts`. No new tables or
  fields. The shop is player-agnostic and never reads or writes any player''s inventory.
- [Confirmed] Purchased ownership survives rotation: expiring/deactivating offers does not touch
  `item_instance.owner_vuid`; a player''s owned instance is unchanged after an offer expires (tested).
- [Confirmed] Validation (throwaway Node script; fixture Ed25519 key; temp DB; removed after): 12/12
  passed — unauthenticated → 401; missing `cnf.jkt` → 401; authenticated retrieval (capacity respected,
  details+price present); rotation consistent across repeated requests; deterministic per window and
  changes across windows; item can reappear in a future rotation; off-window offers not current / not
  purchasable; active count within capacity; player ownership survives expiry; shop player-agnostic and
  exposes no inventory (client vuid cannot alter it); rotation persists across DB close/reopen; empty
  catalogue handled safely (zero offers).
- [Confirmed] `npm run typecheck` passes. `next build --webpack` compiles successfully and lists
  `/api/shop` (with `/api/me`, `/api/inventory`, `/api/inventory/equip`).
- [Constraint] **Build flakiness on this OneDrive path (environmental, not code):** `next build`
  intermittently exits 1 with `EPERM: operation not permitted, unlink '.next\server\app\api\shop'` —
  a transient OneDrive/AV lock on the stale `.next` artifact during finalisation. The compile + page
  generation succeed every time; only the final artifact cleanup races the lock. **Workaround:** delete
  `.next` before building (`Remove-Item .next -Recurse -Force`), then build — verified `EXIT=0`,
  `Compiled successfully`. This will recur on the synced path; it is not a defect in the app.
- [Investigation] Live-token acceptance remains deferred (validated with fixture-signed tokens);
  observed when the frontend calls `/api/shop` (Task 15/16).
- Layer A / Layer C separation preserved (shop touches only Layer A `shop_offer`/`item_template`;
  no Tide attestation). Category 3 (Tide-backed transfer/supersession), the Player B flow, and the ORK
  blocker remain blocked and untouched.

## Task 8 — shop purchasing and purchase records (2026-09-07)

- [Confirmed] Implemented `POST /api/shop/purchase` (`app/api/shop/purchase/route.ts`) and an atomic
  `purchaseOffer(buyerVuid, offerId)` in `lib/db/shop.ts` (the smallest repo extension; raw SQL stays
  in `lib/db/`, no new tables/fields).
- [Confirmed] Purchase transaction flow (all in ONE `better-sqlite3` `db.transaction`, all-or-nothing):
  1) resolve the offer server-side (404 if absent); 2) verify active AND within window at `now`
  (409 `offer_unavailable` otherwise); 3) guarded `debitBalance` of the authoritative price (402
  `insufficient_funds` if short, thrown BEFORE any item is created); 4) `createInstance`
  (owner = verified vuid, `acquired_via='shop'`); 5) `recordPurchase`.
- [Confirmed] Authoritative price = `shop_offer.price` resolved server-side; the client-supplied
  `price` is ignored. Buyer identity = verified Tide JWT `vuid` only (via `withAuth` +
  `getOrCreateCurrentPlayer`); body-supplied `vuid`/`owner_vuid`/`acquired_via` are ignored.
- [Confirmed] Atomicity enforced by the single transaction: a validation (unit-style) test injected a
  failure at the `purchase_record` insert and confirmed the currency debit, the item instance, AND the
  purchase record were ALL rolled back (no partial state). Insufficient funds leaves balance unchanged.
- [Confirmed] Purchase-record behaviour: on success a `purchase_record` row (buyer, template, instance,
  price, timestamp) is written; the purchased instance appears in the buyer''s `/api/inventory`.
- [Confirmed] Ownership persists after the item leaves the shop: deactivating/expiring the offer does
  not change `item_instance.owner_vuid` (tested).
- [Confirmed] An off-rotation/expired offer cannot be purchased even if its id is known (409, no charge).
  Offers are not single-use in this beta: a well-funded buyer can buy the same active offer repeatedly,
  yielding distinct instances with a consistent balance (replay test).
- [Confirmed] Error handling (no DB details leaked): 401 unauth/invalid/missing-`cnf.jkt`; 400 invalid
  body; 404 nonexistent offer; 409 offer unavailable/expired; 402 insufficient funds.
- [Confirmed] Validation (throwaway Node script; fixture Ed25519 key; temp DB; removed after): 14/14
  passed, covering all 18 required cases (some combined). Two initial failures were TEST-HARNESS bugs,
  not implementation bugs — (a) ESM module bindings cannot be redefined, so the atomicity injection was
  switched to spying on the DB connection''s `prepare()`; (b) a replay-test balance bookkeeping error was
  fixed with a fresh well-funded buyer. After fixing the tests: 14/14.
- [Confirmed] `npm run typecheck` passes; `next build --webpack` passes and lists `/api/shop/purchase`.
- [Confirmed] **OneDrive build issue resolved:** after `attrib +U +P` on the project folder (pin
  always-local), `next build` completed cleanly on the FIRST attempt with NO `.next` pre-clear and NO
  `EPERM: unlink '.next\...'` error. The earlier Task-7 EPERM flakiness appears fixed by the always-local
  pinning; the `.next`-clear workaround is no longer needed here.
- Layer A / Layer C separation preserved: the purchase writes only Layer A (`item_instance`,
  `purchase_record`, `player.currency_balance`); it does NOT write `tide_ownership_attestation`, does
  NOT call `OwnershipSpike`, and is NOT a Tide-backed ownership transfer.
- [Investigation] Live-token acceptance remains deferred (fixture-signed tokens); observed at frontend
  integration (Task 15/16).
- Category 3 (Tide-backed transfer/supersession), the Player B flow, and the ORK blocker remain blocked
  and untouched.

---

# Player B ownership attestation / supersession investigation (2026-10-01)

The previously-blocked second-player (Player B) Tide experiment now works: Player B is a genuine,
separately Tide-authenticated account. Ran the two-real-session PoC with the EXISTING `OwnershipSpike`
contract + persisted signed policy (`test-artifacts-temp/OwnershipSpike.signed-policy.bin`). NO
contract/policy/realm/DPoP change; ownership signing is IMPLICIT (no enclave approval). All signature
verification done in-browser against the realm VVK (Ed25519) via WebCrypto.

VUIDs used (test identities, local PoC):
- Player A vuid: `88eae7dad1eee3e681ac8c009d65aad2b3d51f8745e8ca6c8a54f46f500bf5f0`
- Player B vuid: `c0f0c8d6dc7cfec8fca96922ec538e5388d689de33d5c06a16b3a90282a37bb9`
- Item: `spike-item-0001`

## Results

- [Confirmed] **TEST 1 — Player A ownership reconfirmed.** A''s session signed `spike-item-0001 -> A`;
  signature `b3bd6e0f…c49708`; VVK verify = true.
- [Confirmed] **TEST 2 — Player B received a Tide-backed ownership attestation.** B''s REAL session
  signed `spike-item-0001 -> B`; the ORKs accepted and produced a 64-byte threshold signature
  `6a177a82…834f03`; VVK verify = true. The signed statement contains the expected item id and B''s vuid.
  This is the first time the Player B half has been demonstrated (previously blocked by the ORK outage).
- [Confirmed] **TEST 3 — a player cannot mint an attestation naming someone else.** Player B''s session
  attempted `spike-item-0001 -> A`; ALL 20/20 ORKs rejected at PreSign with the contract''s own message
  *"Forseti policy denied (Data, Executor): Executor vuid does not match the bound owner vuid"*; no
  signature produced (`rejected_by_ork: true`). (This is the B->A direction; the earlier deny-path test
  proved the A->other direction. Both directions now confirmed.)
- [Confirmed] **TEST 4 — both attestations remain independently valid.** Verifying A''s original
  signature AND B''s new signature against the realm VVK: both `verifies: true`
  (`both_independently_valid: true`). B receiving a new attestation did NOT invalidate A''s earlier one.

## TEST 5 — what the current OwnershipSpike mechanism provides (separate findings)

- **Ownership binding: demonstrated** [Confirmed] — the ORKs threshold-sign a statement binding an item
  to a vuid, verifiable against the VVK.
- **Prevention of forging an attestation for another vuid: demonstrated** [Confirmed] — executor vuid
  must equal the bound owner vuid; 20/20 ORKs reject otherwise (both directions).
- **Transfer / rebinding via a NEW attestation: demonstrated** [Confirmed] — Player B obtained a valid
  new attestation for the same item bound to B. (B must sign it himself; no one can mint it for him.)
- **Supersession / revocation of the previous owner''s attestation: NOT provided** [Confirmed] — A''s
  original `spike-item-0001 -> A` signature is still cryptographically valid after B''s new statement
  exists. The contract checks only `boundOwnerVuid == DokenDto.UserId`; it holds no version/nonce/
  current-owner state and cannot retract an already-issued signature. "Latest statement wins" is NOT a
  property of the current contract.

## Classification (per the brief)

- **new/rebound ownership attestation: DEMONSTRATED**
- **supersession/revocation: NOT provided by the current contract**

Full Tide-backed transfer semantics (new owner gains authority AND previous owner loses it) are
therefore **NOT** demonstrated by `OwnershipSpike` alone. Achieving them would require application-side
"current owner" state (treat only the latest VVK-signed attestation as authoritative) and/or a
different, sequence/nonce-aware contract with explicit revocation — a governed change deliberately NOT
made here.

## Remaining limitations / notes

- Signing is browser-only (interactive session per player) — unchanged constraint.
- The beta marketplace transfer (Task 10, not yet built) is a Layer A/DB change only and must NOT be
  described as satisfying this Tide-backed transfer; supersession specifically remains unprovided at the
  Tide layer.
- No `OwnershipSpike`/policy/realm/DPoP changes were made; Player B was a real Tide account, not faked;
  VUIDs were not altered; no Layer A/marketplace code was touched by this investigation.
- Infra note: the earlier ORK `TidecloakSessionStartTokenSign` outage that blocked Player B has cleared;
  both A and B authenticated and signed against the live 20-ORK network.
- Validation-tooling note: raw Node cannot load `@tidecloak/js` (transitive `heimdall-tide` extensionless
  ESM imports fail outside the bundler), so VVK verification was done in the browser page. A first
  verify-both attempt failed with `JWK member "kty" missing` because the client `getConfig()` jwk shape
  differed; fixed by serving the raw embedded VVK jwk from `data/tidecloak.json` via the temp route and
  importing that. Not an implementation issue with the attestations.

## Task 9 — marketplace listings (2026-10-01)

- [Confirmed] Implemented the marketplace **listing** layer (Task 10 obtaining/transfer NOT started):
  - `GET /api/marketplace` — active listings joined to item/template details (name, category, rarity,
    price, sellerVuid, createdAt). Public listing info only; no private player profile/inventory/contact.
  - `POST /api/marketplace/list` — create a listing for the verified caller.
  - `GET /api/marketplace/list` — the caller''s own listings (all statuses).
  - `DELETE /api/marketplace/list/[id]` — owner-scoped cancel of the caller''s own active listing.
  - Repository (parameterised SQL, existing patterns, no second DB abstraction):
    `createListingWithEligibility`, `cancelListing`, `listActiveListingsWithDetails`,
    `listListingsForSeller` in `lib/db/marketplace.ts` (reusing `createListing`/`getListing`/
    `getActiveListingForInstance`/`setListingStatus`).
- [Confirmed] Eligibility enforced SERVER-SIDE in one transaction (`createListingWithEligibility`):
  item exists (404), owned by the verified vuid (403), template `tradable` (409), not equipped (409),
  not already actively listed (409). A client-supplied `owner_vuid` is ignored — ownership is read from
  `item_instance.owner_vuid` against the verified JWT vuid. The partial-unique index on active listings
  is the concurrency backstop (a racing duplicate maps cleanly to `already_listed`, not a raw SQL error).
- [Confirmed] Price validated server-side: must be a **non-negative integer** (simulated currency;
  schema `INTEGER CHECK (price >= 0)`). Rejected (400): missing, non-numeric (string), non-integer
  (decimal), negative. The client supplies instanceId + price; the server decides ownership/eligibility.
- [Confirmed] Cancel is owner-scoped: the UPDATE matches `id AND seller_vuid AND status='active'`, so a
  player cannot cancel another player''s listing (403) and cannot double-cancel (409 `not_active`).
  Re-listing an item after its listing is cancelled is allowed (tested).
- [Confirmed] Validation (throwaway Node script; fixture Ed25519 key; temp DB; removed after): 19/19
  passed — unauthenticated → 401; missing `cnf.jkt` → 401; A listing B''s item → 403; non-numeric /
  missing / non-integer / negative price → 400; non-tradable → 409; equipped → 409; list own eligible →
  200; already-listed → 409; nonexistent item → 404; GET active listing shows details with no private
  data; A cannot cancel B''s listing → 403 (B''s listing stays active); player cancels own → 200;
  cancelled no longer active; re-list after cancel allowed; and **listing/cancel created NO
  tide_ownership_attestation**. `npm run typecheck` and `next build --webpack` both pass; build lists
  `/api/marketplace`, `/api/marketplace/list`, `/api/marketplace/list/[id]`.
- [Confirmed] Layer separation preserved: Task 9 uses **Layer B** (verified JWT → vuid) to authenticate
  and **Layer A** (`item_instance`, `marketplace_listing`) to manage listings. Creating/cancelling a
  listing does NOT change `item_instance.owner_vuid`, does NOT create a `marketplace_transaction`, and
  does NOT write/read `tide_ownership_attestation` or touch `OwnershipSpike`/Tide policies/DPoP/TideCloak
  config. A listing is explicitly NOT a Tide-backed ownership transfer.
- [Investigation] Live-token acceptance remains deferred (fixture-signed tokens); observed at frontend
  integration (Task 15/16).
- Category 3 (Tide-backed transfer/supersession) unchanged: rebinding demonstrated (2026-10-01),
  supersession unresolved — untouched by this task.

## Task 10 — temporary application-level marketplace transfer ("obtain") + transaction records (Layer A)

- [Confirmed] Built `POST /api/marketplace/obtain` (thin `withAuth` route) over a new atomic
  `obtainListing(buyerVuid, listingId)` in `lib/db/marketplace.ts`, mirroring the Task 8 `purchaseOffer`
  transaction pattern (`const tx = db.transaction((): Result => {...}); return tx();`, discriminated-union
  result). One better-sqlite3 transaction does, in order: resolve listing (not_found) → require active
  (not_active) → resolve instance (not_found) → consistency guard: seller must still own the instance
  (seller_no_longer_owns) → reject buyer==seller (cannot_obtain_own) → guarded `debitBalance(buyer)`
  (insufficient_funds, no state change) → `creditBalance(seller)` → `setOwnerVuid(instance, buyer)`
  (Layer A ONLY) → `clearEquippedByInstance` → `recordTransaction(transfer_kind='application-level-temporary')`
  → `setListingStatus(listing,'sold')`. Any unexpected throw propagates and rolls the whole transaction back.
- [Confirmed] Identity boundary: buyer vuid is the verified JWT `auth.vuid` only. The route honours
  ONLY `listingId` from the body and explicitly ignores any `buyerVuid`/`sellerVuid`/`ownerVuid`. Reason
  → HTTP mapping: not_found→404, not_active→409, seller_no_longer_owns→409, cannot_obtain_own→409,
  insufficient_funds→402. Success response uses application-level wording
  (`message:'application-level transfer completed'`), never "Tide ownership transferred"/"cryptographic".
- [Confirmed] **Layer A boundary held.** The transfer updates ONLY `item_instance.owner_vuid` and writes
  a `marketplace_transaction`; it does NOT read/write `tide_ownership_attestation`, does NOT call
  `OwnershipSpike`, and does NOT touch Tide policies / DPoP / TideCloak config / `lib/db/schema.sql`.
- [Confirmed] Validation (throwaway Node script, resolve-hook mapping `@/` + extensionless `.ts`, temp DB
  via `APP_DB_PATH`, removed after): 40/40 assertions passed. Covered: successful transfer (owner A→B,
  listing `sold`, exactly one `marketplace_transaction` with `transfer_kind='application-level-temporary'`
  and correct price/parties, buyer debited + seller credited by price, seller's equipped slot cleared);
  non-existent listing → not_found; sold → not_active; cancelled → not_active; seller no longer owns →
  seller_no_longer_owns (no transfer); buyer==seller → cannot_obtain_own; insufficient funds →
  insufficient_funds with NO state change (owner/balances/listing all unchanged, no txn row).
- [Confirmed] **Atomicity (fault injection):** spying on `db.prepare` to throw at the
  `marketplace_transaction` INSERT caused FULL rollback — owner_vuid unchanged, both balances unchanged,
  listing still `active`, zero transaction rows, and the error propagated (not swallowed).
- [Confirmed] **Replay/race:** two sequential `obtainListing` calls on the same listing — the first
  succeeds, the second fails `not_active`; owner stays the first buyer and the second buyer is never
  debited. No double transfer.
- [Confirmed] **Tide-boundary assertion:** after a successful obtain, `listAttestationsForInstance` is
  unchanged and the whole DB holds zero `tide_ownership_attestation` rows. Application-level ownership
  transfer demonstrated; Tide-backed exclusive ownership transfer remains outside this task.
- [Confirmed] `npm run typecheck` clean and `next build --webpack` compiled successfully off OneDrive
  (no EPERM); build route list includes `/api/marketplace/obtain`. No diff to `data/tidecloak.json`,
  `lib/db/schema.sql`, any Forseti `.cs`, `OwnershipSpike`, or Tide policies.
- Category 3 (Tide-backed transfer / supersession / revocation) unchanged and still out of beta scope:
  rebinding demonstrated (2026-10-01), supersession unresolved — untouched by this task.

---

# Task 11 — QEA-governed voucher-gate role grant (IGA governance demonstration) (2026-10-01)

Scope: BUILD the legitimate integration that INITIATES a governed grant of the private-note voucher-gate
role(s) through the EXISTING Tide IGA/QEA change-request mechanism, plus the validation that does not
require a live quorum. Status: **implemented — pending live QEA verification** (NOT fully confirmed) — SUPERSEDED: live QEA verified 2026-10-01, see the addendum at the end of this file.
This task demonstrates Tide **GOVERNANCE** (Layer B / IGA), NOT Layer C cryptographic item ownership —
the two are kept explicitly distinct and this grant is never described as proof of item ownership. The
Player B / supersession findings (above) are unchanged by this task.

- [Confirmed] **Protected role(s) / hard allowlist.** The grant target is server-side-restricted to
  EXACTLY `_tide_privatenote.selfencrypt` and `_tide_privatenote.selfdecrypt` (role names later corrected
  to `_tide_dob.*` against the live realm — see addendum) (the voucher-gate roles
  Task 12's self-encryption needs, per design.md §2 / tasks.md Task 11). The allowlist is a constant
  (`PRIVATE_NOTE_ROLE_ALLOWLIST` in `lib/tide/igaAdmin.ts`); the route rejects anything else with
  400/422 BEFORE any change-request is initiated, so a client can never grant an arbitrary role
  (e.g. `admin`, `realm-management`). (The constant lives in the lib module, not the route file, because
  Next.js route modules may only export HTTP handlers + framework config.)

- [Confirmed] **Governance is Tide IGA, not a custom system.** The only governance mechanism is the
  realm's existing IGA/QEA. The app creates NO approval table, NO quorum logic, NO application-level QEA
  state, and NO fake approval UI. `lib/tide/igaAdmin.ts` performs the standard Keycloak admin
  realm role-mapping write (`POST /admin/realms/{realm}/users/{userId}/role-mappings/realm`) against the
  IGA-enabled realm; on an IGA realm that write is CAPTURED into a change-request and returns
  **202 Accepted** + a `Location` header → the new CR (verified Tide IGA surface, canon
  `iga-change-requests-api`). Read helpers use `GET /iga/change-requests?status=PENDING` and
  `GET /iga/change-requests/{id}`.

- [Confirmed] **Pending-not-granted behaviour.** The route treats the 202/CR as PENDING, NOT applied:
  it returns `{ ok:true, status:'pending', message:'...NOT granted until the Tide QEA quorum approves
  and commits via the admin enclave', changeRequest:{id,status} }` and NEVER reports a role as effective.
  A non-202 2xx (an immediate apply with no CR) is treated as a governance failure and rejected (fail
  closed) — the realm must enforce governance for success to be reported. Design rule honoured: a 2xx
  from an admin write is "accepted, not applied"; state must be re-read before claiming success.

- [Confirmed] **Identity boundary + authorization (headless, server-side).** `withRole('admin')`:
  unauthenticated → 401, non-admin player → 403, admin → passes. A DPoP-downgrade token (no `cnf.jkt`)
  → 401. The requesting admin identity is taken from the verified JWT `vuid` ONLY; a body-supplied
  `requestedBy`/`admin` field is ignored. `targetVuid` must be 64-hex. These are the checks exercisable
  without a live quorum.

- [Confirmed] **Validation (throwaway Node `.mjs` + resolve-hook mapping `@/`/extensionless → `.ts`,
  fixture Ed25519 JWT, IGA HTTP stubbed at the `lib/tide/igaAdmin.ts` fetch seam `_setFetchForTests`,
  removed after):** 54/54 assertions passed — auth gates (401/403/401-no-cnf), allowlist rejects
  arbitrary roles with `initiate NEVER called`, allowlisted role → `initiate` called exactly once +
  `status:'pending'` + CR id surfaced + response never claims "granted", body requester ignored
  (requestedBy = JWT vuid), 202-CR → pending, immediate-apply (200 no CR) → 5xx, connection-refused →
  5xx + `ok:false` + "unavailable", missing admin credential → fail closed (governed write never
  attempted), GET status admin-only + read-only. Stubbing exercises app-side wiring ONLY — it is NOT a
  claim that live QEA ran.

- [Constraint] **Requester self-approval (four-eyes) — documented, NOT yet live-verified.** By the IGA
  model the requester does not count toward quorum and a self/conflicting approval returns 409; the app
  deliberately contains no approve/commit path, so this is an expectation carried from the IGA surface
  docs, not something this task exercised live.

- [Constraint] **Environment limits — what was NOT verified (requires TideCloak running + a human
  enclave signature):** TideCloak was NOT running (localhost:8080 refused), and the realm is in
  MultiAdmin (Tide) mode, so a governed CR can only be APPROVED+committed via a browser-enclave
  signature (`POST /iga/change-requests/{id}/approve`) — a headless process cannot complete it by design
  (that is the security property). Therefore the live change-request→approve→commit, the actual
  quorum/threshold value, the requester-self-approval refusal, and the role becoming effective only
  post-commit are all DEFERRED to a manual enclave step. No live QEA success is claimed.

- [Constraint] **Private-note dependency (Task 12) deferred.** The end-to-end "without role → denied /
  with QEA-approved role → private note available" check depends on Task 12 (not implemented) AND the
  live grant above; it is deferred. No plaintext fallback or fake success path was added. (RESOLVED 2026-10-03: Task 12 is implemented and the end-to-end demo is live-verified — see the Task 12 live-verification addendum below.)

- [Confirmed] **Boundaries held.** `npm run typecheck` clean; `next build --webpack` compiled
  successfully (after clearing `.next` for the known OneDrive EPERM finalisation lock); build route list
  includes `/api/admin/private-note-role`. `git diff` shows NO change to `data/tidecloak.json`,
  `lib/db/schema.sql`, any Forseti `.cs`, `OwnershipSpike`, Tide policies, DPoP/auth config, or the
  marketplace/ownership logic (`obtainListing` / `app/api/marketplace/obtain`). Only new files added:
  `lib/tide/igaAdmin.ts`, `app/api/admin/private-note-role/route.ts`.
---

# Task 11 — LIVE QEA verification (addendum, 2026-10-01)

Supersedes the "pending live QEA verification" status above. The governed voucher-gate role grant was
exercised end-to-end against the running realm and confirmed. Several build-time assumptions were
corrected against the live realm:

- [Confirmed] **Real voucher-gate role names.** The realm's self-encrypt/decrypt roles are
  `_tide_dob.selfencrypt` / `_tide_dob.selfdecrypt` — NOT the earlier-assumed `_tide_privatenote.*`
  (which do not exist in this realm). `PRIVATE_NOTE_ROLE_ALLOWLIST` and the verify tool were updated to
  `_tide_dob.*`. (role id of `_tide_dob.selfencrypt` = `bd04e894-38d3-4aa9-b5b9-6b75d0f4ff63`.)
- [Confirmed] **vuid is a user ATTRIBUTE, not the username.** User resolution must query
  `GET /admin/realms/{realm}/users?q=vuid:<value>&exact=true` (username fallback retained). The target
  user is `jaidyndinh06` (id `48763d41-dc1d-48d9-b7f8-f3602dce01c2`), vuid `88eae7da…bf5f0`.
- [Confirmed] **Admin credential path on a Tide realm.** `client_credentials` (service account) CANNOT
  mint a token on a Tide realm — it returns an empty-body **502** because the service account has no
  linked Tide identity. A **master-realm password grant** (`realms/master`, `admin-cli`) works and has
  cross-realm `manage-realm`. The IGA client gained a password-grant strategy
  (`TIDE_ADMIN_USERNAME`/`TIDE_ADMIN_PASSWORD`/`TIDE_ADMIN_REALM`, default realm `master`).
- [Confirmed] **Governed capture returns 204 here, not 202.** On this realm the role-mapping write
  returns **HTTP 204** and STILL captures a pending IGA change request (role NOT applied). The IGA
  client was corrected to accept any 2xx (202 or 204) as a governed capture and to resolve the CR by
  lookup (entityType=USER + entityId + actionType=GRANT_ROLES) when there is no Location header; it only
  reports an ungoverned-apply failure if the role actually landed with no CR.
- [Confirmed] **End-to-end QEA flow (the Task 11 point).** The verify tool initiated change request
  `1957ce7d-9874-4c83-bda2-39d795bce28a` (`GRANT_ROLES`, user `48763d41-…`, role `_tide_dob.selfencrypt`,
  `status=PENDING`, `threshold=1`, `authorizationCount=0`). While PENDING the role was NOT on the user —
  governance withheld the grant. The operator APPROVED + committed the CR in the TideCloak admin console
  enclave; the CR became APPROVED and `_tide_dob.selfencrypt` now appears in the user's realm role
  mapping. This confirms Requirement 13: a security-sensitive role change is captured as an IGA change
  request and only applied after QEA approval/commit — never a unilateral immediate write.
- [Constraint] **Four-eyes/quorum not fully exercised.** The entity threshold was `threshold=1`, so a
  single approver commits. The strict "requester cannot self-approve / a distinct second approver is
  required" property was therefore NOT exercised; demonstrating it would require raising the approver
  threshold on the realm/entity (a separate config change, intentionally not done here).
- [Confirmed] **Boundary preserved.** This demonstrates Tide GOVERNANCE (Layer B / IGA), not Layer C
  cryptographic item ownership; the two remain distinct. No change to OwnershipSpike, Forseti,
  `tide_ownership_attestation`, the marketplace/ownership logic, DPoP/auth, or `data/tidecloak.json`.
- [Note] The admin credential now lives in `.env` as a master-realm password grant (gitignored,
  local-dev only). Not for shared/production use.


## Task 12 — Tide-protected private note (self-encryption) — 2026-03-10

- [Confirmed] **Verified SDK encrypt/decrypt contract (array in, array out).** The installed
  `@tidecloak/js` (via `@tidecloak/nextjs`, v0.14.20) exposes `doEncrypt`/`doDecrypt` on the
  `useTideCloak()` context. The underlying class contract takes an ARRAY of items and returns an ARRAY:
  `encrypt([{ data, tags }]) => (string|Uint8Array)[]` and
  `decrypt([{ encrypted, tags }]) => (string|Uint8Array)[]`. For a single note:
  `const [ct] = await doEncrypt([{ data: plaintext, tags: [TAG] }])` and
  `const [pt] = await doDecrypt([{ encrypted: ct, tags: [TAG] }])`. No `decryption_policy` is passed —
  this is identity self-encryption, not a Forseti-policy decryption.
- [Confirmed] **Tag ↔ role coupling → the tag is `dob`, not `privatenote`.** Tide gates tag-based
  self-encryption on roles named `_tide_<tag>.selfencrypt` / `_tide_<tag>.selfdecrypt` (the SDK checks
  these on the client and the ORK voucher gate). This realm provisions `_tide_dob.selfencrypt` /
  `_tide_dob.selfdecrypt` (Task 11), so the tag MUST be `dob`. Using `privatenote` would reference
  `_tide_privatenote.*` roles that do not exist here and the voucher gate would deny the operation. The
  tag is a single named constant `PRIVATE_NOTE_TAG = "dob"` in `app/account/page.tsx` with a comment
  documenting the coupling.
- [Confirmed] **Server stores ciphertext only — no plaintext, no server-side decrypt, `withAuth` only.**
  `app/api/account/private-note/route.ts`: `GET` returns the caller's stored ciphertext (may be null);
  `PUT` stores a caller-supplied opaque string (or null). The server never decrypts, inspects, or
  validates the plaintext — it only persists/returns the opaque base64 via the existing
  `getPrivateNoteCiphertext`/`setPrivateNoteCiphertext` helpers. Identity is the verified JWT `vuid`
  ONLY; any `vuid`/`ownerVuid`/`targetVuid` in the body is ignored. There is deliberately NO application
  role check (no `withRole`, no "if role then decrypt") — Tide's voucher gate is the authorization.
  Input validation: `ciphertext` must be a string or null (else 400), max 100k chars (else 400), invalid
  JSON → 400.
- [Confirmed] **Both roles are needed to round-trip; `selfdecrypt` is currently absent.** The account
  holds `_tide_dob.selfencrypt` but NOT `_tide_dob.selfdecrypt` (only `selfencrypt` was granted via the
  Task 11 governed flow). So live encrypt-on-save is expected to SUCCEED while decrypt-on-read is
  expected to be Tide-DENIED until `_tide_dob.selfdecrypt` is also granted (governed). This is the
  intended WITHOUT-role→denied / WITH-role→succeeds demonstration — not worked around, not weakened, not
  auto-granted. The client surfaces the raw Tide error plus an explanation pointing to the Task 11 grant,
  with no fallback decryption.
- [Confirmed] **Headless vs live split.** Encrypt/decrypt are client-side, voucher-gated, and need live
  Fabric — they CANNOT run headlessly/server-side, and the Tide SDK does not load in Node. Headless
  validation therefore exercised the SERVER route logic ONLY (throwaway Node `.mjs`, fixture Ed25519
  DPoP-bound JWT via `CLIENT_ADAPTER`, temp DB via `APP_DB_PATH`, resolve hook for `@/` + extensionless
  `.ts`): 7/7 cases — 401 unauth GET/PUT; store→read same vuid; Player A cannot read Player B's note;
  body vuid/ownerVuid/targetVuid ignored (identity = JWT); ciphertext returned byte-identical (no
  transform); 400 on wrong type / >100k chars / invalid JSON (null allowed); and no
  governance/role-grant symbol or `withRole` present in the route code. `npm run typecheck` + `npm run
  build` clean; `/account` and `/api/account/private-note` both appear in the route list. The LIVE Tide
  encrypt/decrypt round-trip and the `_tide_dob.selfdecrypt` grant remain PENDING manual browser
  verification.
- [Note] Env tooling update: the project runs on Node v24, which strips TS types natively; TypeScript
  7.0.2 exposes no programmatic `transpileModule`, so the validation harness relied on Node's native
  `--experimental-strip-types` plus a resolve-only loader hook rather than an in-process transpile.
- [Confirmed] **Boundary preserved.** No change to OwnershipSpike, Forseti, `tide_ownership_attestation`,
  marketplace/ownership logic, DPoP/auth config, `data/tidecloak.json`, `lib/db/schema.sql`,
  `providers.tsx`, or any Task 11 code. Nothing committed.

### Live Tide browser verification — PASSED (2026-10-03)

The end-to-end demonstration was exercised in the browser and confirmed. This upgrades Task 12 from
"pending live verification" to COMPLETE.

- [Confirmed] **Round-trip succeeded with the real Tide capability.** The note
  `Task 12 Tide private note test - Jaidyn` was encrypted client-side via `doEncrypt`, stored and
  retrieved as opaque ciphertext through `GET/PUT /api/account/private-note`, and decrypted client-side
  via `doDecrypt` back to the original plaintext. The application performed NEITHER the authorization
  NOR the decryption — Tide did (client-side `doEncrypt`/`doDecrypt` + the `_tide_dob.*` voucher gate).
- [Confirmed] **Before `selfdecrypt`: decryption denied.** With only `_tide_dob.selfencrypt`, the player
  could encrypt and save the note, but Tide DENIED decryption because the required
  `_tide_dob.selfdecrypt` voucher capability was absent. The server still returned the ciphertext; the
  denial happened in the Tide client/voucher layer, not in the app.
- [Confirmed] **After the governed `selfdecrypt` grant: decryption succeeded.** `_tide_dob.selfdecrypt`
  was granted through the EXISTING Task 11 Tide IGA/QEA governed process (change request → approved →
  committed in the admin enclave), then the session was refreshed / re-logged-in. After that, Tide
  decrypted the protected note client-side and returned the plaintext. This connects Task 11 (governed
  capability grant) to Task 12 (Tide-gated data) end to end.
- [Confirmed] **Security boundary (as demonstrated).** Plaintext is handled only client-side;
  `doEncrypt` performs the Tide encryption; the server stores/returns ONLY opaque ciphertext and never
  decrypts the note; `doDecrypt` performs client-side Tide decryption; `_tide_dob.*` is the verified,
  realm-specific Tide role/tag coupling; Task 11's governed role-grant mechanism is SEPARATE from the
  private-note API; and NO custom application encryption, approval, quorum, or role-grant mechanism was
  introduced anywhere in Task 12.
- [Confirmed] **Validation status.** The 7/7 headless Task 12 route tests remain passed, AND the live
  Tide browser verification has now passed. No additional test results are claimed.

---

# Task 13 — player isolation / cross-player security checks (2026-10-03)

Scope: PROVE (by testing, not trust) that every player-scoped API derives identity ONLY from the
verified Tide JWT `vuid` and that no client-supplied identity field can read or mutate another player's
data. This task adds a throwaway cross-player test suite + these docs; it required **no production code
change** — no isolation gap was found. Headless only (the Tide SDK cannot load in Node); this is NOT a
live Tide result. The Player B / supersession findings and the Task 11 (IGA/QEA) + Task 12
(encrypt/decrypt) live addenda above are unchanged.

## Audit result — identity boundary holds on every route [Confirmed, headless]

- [Confirmed] Every API handler is wrapped by `withAuth` or `withRole` (grep over `app/api/**/route.ts`
  found 15 handlers across 11 route files; each binds its result to `withAuth(...)`/`withRole('admin', ...)`).
  There is NO bare/unwrapped handler and NO new route — `next build` lists exactly the 11 pre-existing
  API routes, all dynamic. No auth-bypassing route exists.
- [Confirmed] The acting identity is ALWAYS `auth.vuid` from the verified JWT. Client-supplied
  `vuid` / `owner` / `ownerVuid` / `sellerVuid` / `buyerVuid` / `targetVuid` fields in a body or query
  are ignored by every player-scoped route (`/api/me`, `/api/inventory`, `/api/inventory/equip`,
  `/api/shop/purchase`, `/api/marketplace/list` + `/[id]`, `/api/marketplace/obtain`,
  `/api/account/private-note`). `/api/marketplace` is an intentionally public active-listings feed
  (returns `sellerVuid` as an identifier only — no private profile/inventory/contact data).

## Cross-player test matrix (two VUIDs: A = `aaaa…`, B = `bbbb…`; spoof vuid = `cccc…`) — 64/64 PASS

Harness: throwaway Node `.mjs` under `test-artifacts-temp/task13-isolation/` (deleted after), run via
`--experimental-strip-types` + a resolve hook mapping `@/` and extensionless imports to `.ts` (the
established Task 8/10/12 pattern). Fixture Ed25519 keypair exported into `CLIENT_ADAPTER` as the local
JWKS; DPoP-bound JWTs minted for A and B (non-empty `vuid`, correct `azp`, `cnf.jkt`). Temp DB via
`APP_DB_PATH`. Route handler exports (`GET`/`POST`/`PUT`/`DELETE`) invoked directly with constructed
`Request`s carrying the fixture `Authorization: DPoP <jwt>` header. Did NOT import the Tide SDK (won't
load in Node). The operator's real production vuid (`88eae7da…`) was deliberately NOT used.

Seed: players A and B (balance 1000 each); B owns a cape instance (equipped), lists a second cape
instance (listing active, price 200), and stores a private-note ciphertext. For every negative/spoof
case the suite re-reads B's balance / equipped slot / note / instance owners / listing status and
asserts they are unchanged.

1. **Unauthenticated + unbound → 401.** All 12 protected endpoints (incl. `/api/marketplace`) return
   401 with no `Authorization` header; a token missing `cnf.jkt` also → 401 (DPoP binding enforced).
2. **Profile.** A's `GET /api/me` → 200, returns A's `vuid` only, exposes `hasPrivateNote` boolean and
   never the `private_note_ciphertext`; a spoof attempt does not change the result (GET ignores body).
3. **Inventory.** A's `GET /api/inventory` → 200, returns A's `vuid`, is empty (A owns nothing), and
   never contains B's equipped or listed instance ids.
4. **Equip.** A `POST /api/inventory/equip {instanceId:<B's item>, vuid:B, owner:B}` → 403; B's
   `equipped_instance_id` unchanged. A equip of a nonexistent id → 404. A's own slot stays null. The
   extra spoof `vuid`/`owner` fields are ignored.
5. **Private note.** A `GET` → 200 returns `null` (never B's ciphertext). A `PUT {ciphertext,
   vuid:B, ownerVuid:B, targetVuid:B}` → 200 writes ONLY A's row — B's ciphertext is **byte-identical**
   afterward; A's row holds A's ciphertext; a re-GET returns only A's ciphertext (Task 12 "server
   returns only the caller's row" property preserved).
6. **Marketplace list (create).** A `POST /api/marketplace/list {instanceId:<B's item>}` → 403
   (not_owner); no active listing created for B's instance; A has zero listings.
7. **Marketplace cancel.** A `DELETE /api/marketplace/list/{B's listingId}` → 403 (forbidden); B's
   listing remains `active`.
8. **Marketplace obtain spoof.** A `POST /api/marketplace/obtain {listingId:<B's>, buyerVuid:cccc,
   sellerVuid:B, ownerVuid:cccc}` → 200; new owner is **A** (`auth.vuid`), NOT the spoofed `buyerVuid`;
   response `newOwnerVuid === A`; the spoof vuid was never created as a player; B (the real seller) was
   credited +200 and A debited −200; listing → `sold`. The body `buyerVuid`/`sellerVuid` never
   determined the parties.
9. **Purchase identity.** A `POST /api/shop/purchase {offerId, buyerVuid:B}` → 200 mints to A and
   debits A by the price; B's balance and inventory are unchanged; the new instance is owned by A. Body
   `buyerVuid` ignored.
10. **Path-identity.** The only client-controlled path segment is the cancel listing id, authorized by
    `seller_vuid === auth.vuid` (not by the path). A 403s on B's listing id; B 200s (cancels) on the
    *same* listing id — authority is the verified vuid, never the path.
11. **Admin route role-gate.** Non-admin A → 403 on both `POST` and `GET /api/admin/private-note-role`
    (and 401 unauthenticated, from case 1). The admin surface stays `withRole('admin')`.

Plus a **Layer-separation guard**: the whole DB held **zero** `tide_ownership_attestation` rows before
AND after the suite — no code path under test writes Layer C. B's note stayed byte-identical and B's
equipped instance stayed owned by B end-to-end.

## Regression (re-exercised within the Task 13 suite) [Confirmed, headless]

- `withAuth`/JWT verification + DPoP `cnf.jkt` requirement (401 on unauth + on missing binding).
- Profile safe projection; inventory per-vuid scoping; equip owned-vs-not-owned (403/404).
- Marketplace list create (403 not_owner) / owner-scoped cancel (403 forbidden / 200 owner); obtain
  success (owner A→? forced to the authed buyer, listing `sold`, balances moved, listing re-check).
- Shop purchase mints to the authed buyer and debits them; offer materialisation via the repo.
- Task 11 route still 401 (unauth) / 403 (non-admin) / allowlist-gated (role constant unchanged); Task
  12 route still stores + returns ONLY the opaque ciphertext (no transform, caller-scoped).

## Outcome

- **No isolation gap found → no production code changed.** `git status` shows no Task-13 edit to any
  route/repo/auth file; the only writes are these docs (`docs/LEARNINGS.md`, `docs/PROGRESS.md`).
- `npm run typecheck` and `next build --webpack` both clean; route list unchanged (no new route).
- Throwaway harness deleted; `test-artifacts-temp/OwnershipSpike.signed-policy.bin` and
  `transfer-signatures.json` retained. Nothing committed.
- Layer A/B/C separation preserved; no `OwnershipSpike` / Tide policy / `data/tidecloak.json` / DPoP /
  schema change. Category 3 (Tide-backed transfer/supersession) untouched and still out of scope.
- Limitation: fixture-signed tokens, not live Tide-issued ones — this proves the server-side identity
  boundary logic against real Ed25519 signatures; live-token acceptance is observed at Task 15/16. The
  cross-player *decryption* refusal remains asserted-by-construction (self-encryption is identity-bound,
  Task 12) and is independent of this server-side query-scoping proof.

---

# Task 14 — admin / RBAC surface (2026-10-03) [Confirmed, headless]

**What was built.** A minimal admin-only endpoint `GET /api/admin/summary`, wrapped with
`withRole('admin')` from `@/lib/auth/protect`, plus a read-only aggregate repo helper
`getAdminSummaryCounts()` in a new `lib/db/admin.ts`. No second RBAC system was introduced — this reuses
the existing Task 3 auth boundary unchanged.

**Authorization derives from the verified Tide realm `admin` role — not app flags.**
`withRole('admin')` wraps `withAuth`: unauthenticated (or a token missing the DPoP `cnf.jkt` binding)
→ 401; a verified session WITHOUT the `admin` role → 403; a verified `admin` session → 200. The role is
read ONLY from the verified JWT (`realm_access.roles` / `resource_access`). A normal user is 403 on the
admin surface. Spoofing cannot elevate: a non-admin token plus body `{ role:'admin', isAdmin:true,
admin:true, targetVuid:<admin> }` and/or `?role=admin` still returns 403, because the role comes from
the signed token, never the request. `requestedByAdminVuid` in the response is `auth.vuid` (the verified
admin), never a client-supplied id.

**The summary exposes aggregate counts only — no private data.** Response shape:
`{ ok: true, requestedByAdminVuid, summary: { players, itemInstances, activeListings, soldListings,
cancelledListings, marketplaceTransactions, activeShopOffers, attestations } }`. Every `summary` value is
a number. `lib/db/admin.ts` runs only parameter-free `SELECT COUNT(*)` queries and selects NO private
columns — never `private_note_ciphertext` (or anything derived), balances, notes, or any per-row field.
The `tide_ownership_attestation` COUNT is included to show Layer C is observable as an aggregate while
remaining separate; attestation CONTENTS are never returned. A JSON scan of the admin response confirmed
no `ciphertext`/`private_note`/`balance`/`display_name`/`note` token appears. Seeded-state check: with 4
players, 2 item instances, 1 active + 1 sold listing and 1 transaction seeded, the admin counts matched
exactly (attestations = 0, never written by the beta) — proving it reads real aggregates.

**Sensitive role changes stay governed by Tide IGA/QEA — Task 14 adds no governance of its own.** The
security-sensitive admin change (granting a role, incl. the Task 11 `_tide_dob.selfencrypt` /
`_tide_dob.selfdecrypt` voucher-gate grant) is governed by the existing Tide IGA/QEA change-request
mechanism and is NOT applied while a change request is PENDING. Task 11 is the concrete live
demonstration of that. This endpoint performs NO governance and NO role changes; it creates no
application-side approval/quorum table, counter, or QEA state. Deny-by-default: a user whose governed
grant is still pending simply lacks the role in their token and is therefore treated as a non-admin
(403) — a pending/unapplied grant is never reflected as a role.

**Task 11 preserved exactly.** `app/api/admin/private-note-role/route.ts` and `lib/tide/igaAdmin.ts`
were not modified. Regression (IGA stubbed at the `_setFetchForTests` seam, no live call): unauth → 401;
non-admin → 403; admin + arbitrary role (`admin`, `realm-management`, `_tide_other.selfencrypt`) →
rejected 400/422 with `initiate` NEVER called; admin + `_tide_dob.selfencrypt` and admin +
`_tide_dob.selfdecrypt` → accepted path (initiate called exactly once, status `pending`). A
comments-stripped source scan of the route confirmed no approve/commit call, no POST to `.../approve` or
`.../commit`, and no approval/quorum-table identifier.

**Player/admin separation.** The admin gate did not leak onto player routes: a normal (non-admin)
authenticated token still gets 200 on `/api/me` and `GET /api/inventory`.

**Validation.** Throwaway Node harness (`--experimental-strip-types` + a resolve hook mapping `@/` and
extensionless imports to `.ts`; fixture Ed25519 JWKS injected via `CLIENT_ADAPTER`; DPoP-bound fixture
JWTs for no-auth / non-admin / admin; temp DB via `APP_DB_PATH`; route handler exports invoked directly
with constructed `Request`s): 39/39 assertions passed. `npm run typecheck` and `next build --webpack`
both clean. The route list now includes `/api/admin/summary` alongside `/api/admin/private-note-role` and
all prior routes; every `app/api/**/route.ts` handler still wraps `withAuth`/`withRole` (no
bare/auth-bypassing handler). Throwaway files deleted;
`test-artifacts-temp/OwnershipSpike.signed-policy.bin` + `transfer-signatures.json` retained. Nothing
committed.

**Limitation.** Headless only — fixture-signed tokens, not live Tide-issued ones; this proves the
server-side RBAC boundary logic against real Ed25519 signatures. No live QEA was exercised here (Task 11
remains the live governance demonstration). No forbidden file changed (OwnershipSpike / Forseti / Layer C
contents / DPoP / `data/tidecloak.json` / `lib/db/schema.sql` untouched). Task 15 is next.
