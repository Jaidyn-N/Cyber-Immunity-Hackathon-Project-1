# Implementation Plan

This plan fixes two defects in `Login-app-with-tidecloak` using the bug-condition methodology.
Tasks are ordered per the design: **exploration/preservation tests first**, then **DEFECT B (RBAC)
foundation** (the security fix), then **DEFECT A (onboarding)**, then cross-cutting verification.

- **F** = the app as it exists today (client-only guard, no onboarding, no RBAC).
- **F'** = the app after the fix.
- `C_A` / `isBugCondition_A(session)` — authenticated session missing `firstName`/`lastName`.
- `C_B` / `isBugCondition_B(request)` — admin-gated resource reached without a server-verified `admin`
  role in a valid, DPoP-bound Tide JWT.

> **PREREQUISITE (provisioning, not code):** Task 0 must be satisfied before the RBAC code can enforce
> anything end-to-end. It is a realm/provisioning step, not an application code change.

---

- [ ] 0. PREREQUISITE (provisioning, not code) — Realm roles `admin` and `user`
  - **This is a provisioning task, NOT a coding task.** Do not write app code for it.
  - Ensure the realm `login-app-with-tidecloak` defines **realm roles** `admin` and `user`.
  - Assign the roles to test users (at least one `admin` and one non-admin `user`).
  - When IGA is enabled, role assignment goes through draft → approve → commit; approval happens in the
    admin's enclave (AP-31, AP-37). A bare `2xx` may still be pending (AP-72) — confirm the assignment is
    actually committed, not just drafted.
  - Keep these application roles **distinct** from any `_tide_*` system role (AP-18).
  - The app code does **not** create roles; it only reads/verifies them.
  - _Requirements: 2.5, 2.6_

---

## Exploration & Preservation tests (write BEFORE any fix)

- [ ] 1. Write bug condition exploration tests (surface both defects on unfixed code)
  - **Property 1: Bug Condition** - RBAC bypass + onboarding leak on unfixed code
  - **CRITICAL**: These tests MUST FAIL on unfixed code — failure confirms the bugs exist.
  - **DO NOT attempt to fix the tests or the code when they fail.**
  - **NOTE**: These tests encode the expected behavior and will validate the fix once they pass after
    implementation.
  - **GOAL**: Surface counterexamples that demonstrate each defect.
  - **Scoped PBT Approach**: For the deterministic RBAC cases, scope the property to the concrete failing
    inputs (anonymous request; valid non-admin token) so they reproduce reliably.
  - **DEFECT B (`isBugCondition_B`)** — assert the admin-gated resource fails closed:
    - Anonymous request to the (to-be-added) `GET /api/admin/summary` with no token → expect 401, no
      admin data (example B1). On F this fails: there is no server gate at all.
    - Valid non-admin (`user`) token calling `GET /api/admin/summary` directly → expect 403, no admin
      data (example B2). On F this fails: nothing enforces roles server-side.
    - Valid admin token sent without `cnf.jkt` (downgrade) → expect 401 (example B3).
  - **DEFECT A (`isBugCondition_A`)** — assert onboarding is handled in-app:
    - A session with missing `given_name`/`family_name` → expect the Keycloak "Update Account
      Information" page is NOT shown and an in-app modal collecting first + last name IS shown (examples
      A1/A2). On F this fails: no in-app collection path exists.
  - Run tests on UNFIXED code.
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — it proves the bugs exist).
  - Document counterexamples found: admin data reachable without server verification; no modal for
    profile-incomplete users. Root cause: missing `lib/auth/` + client-only gate (B); Tide username-only
    assertion + no in-app onboarding (A).
  - Mark task complete when tests are written, run, and the failures are documented.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing login / DPoP / callback / non-admin dashboard / config source
  - **IMPORTANT**: Follow observation-first methodology — observe behavior on UNFIXED code for inputs
    where neither bug condition holds, then encode it.
  - Observe on F and capture as assertions:
    - Login/logout on `app/page.tsx` completes for unauthenticated visitors (requirement 3.5).
    - `/tide_dpop/...` still serves the relay with correct CSP headers (`curl -D -`) and the
      `/tide_dpop/:path*` rewrite is intact (requirement 3.2).
    - `/auth/redirect` (`useAuthCallback`) still processes the code (requirement 3.2).
    - An authenticated non-admin `user` sees the dashboard and `preferred_username` (requirement 3.3).
    - An existing user with a complete profile logs straight through — no modal, no Keycloak page
      (requirement 3.1; edge case A3).
    - Config is sourced from `data/tidecloak.json` only; no `NEXT_PUBLIC_*` duplication (requirement 3.4).
  - **Property-based**: over the token/role domain, assert `hasRealmRole('admin')` toggles only the
    `/admin` UI entry point and is never treated as authorization (requirement 2.4).
  - Run tests on UNFIXED code.
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve).
  - Mark task complete when tests are written, run, and passing on unfixed code.
  - _Requirements: 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_

---

## DEFECT B — Server-side RBAC (security foundation, implement first)

- [ ] 3. Fix DEFECT B — server-verified, DPoP-bound RBAC that fails closed

  - [ ] 3.1 Add the `jose` dependency
    - Add `jose` to `package.json` dependencies and install it.
    - No `createRemoteJWKSet` will be used anywhere (AP-01, I-04) — local verification only.
    - _Bug_Condition: isBugCondition_B — no verification layer exists (jose not installed)_
    - _Requirements: 2.5_

  - [ ] 3.2 Add `lib/auth/tidecloakConfig.ts` (single config source, no env duplication)
    - Lazy-load the adapter JSON: priority `process.env.CLIENT_ADAPTER` (full JSON) then
      `data/tidecloak.json`.
    - Expose a typed `TidecloakConfig`; throw a clear error if `jwk` is absent (AP-01, AP-13).
    - No `NEXT_PUBLIC_*`, no field-splitting (AP-38); do not rely on `tidecloak/realm.json`.
    - _Bug_Condition: isBugCondition_B_
    - _Expected_Behavior: config for verification loaded from data/tidecloak.json only_
    - _Preservation: data/tidecloak.json remains the single config source (3.4)_
    - _Requirements: 2.3, 2.5, 3.4_

  - [ ] 3.3 Add `lib/auth/tideJWT.ts` (verify with `jose` against embedded JWKS)
    - Use **lazy** init (AP-46): do not load config or build the JWKS at module scope (Next.js 16
      evaluates modules during `next build`).
    - `getConfig()` — memoized; builds `createLocalJWKSet(config.jwk)` on first use.
    - `verifyTideJWT(token)` — sequence: `jwtVerify(token, JWKS, { issuer })` where
      `issuer = trimTrailingSlash(auth-server-url) + "/realms/" + realm` (checks signature + issuer; `exp`
      by jose) → assert `payload.azp === config.resource` (`login-app-with-tidecloak-client`; `aud` is
      `account`) → assert `payload.iat <= now + 60`. Returns `JWTPayload` or throws.
    - `hasRole(payload, role)` — checks `realm_access.roles` and `resource_access[*].roles`; must NOT
      grant on `_tide_*` roles for app checks (AP-18).
    - `extractToken(authHeader)` — accepts both `Bearer ` and `DPoP ` schemes (AP-45); throws on
      missing/invalid header.
    - _Bug_Condition: isBugCondition_B — serverVerifiedTideJWT(request) must be true_
    - _Expected_Behavior: verifyTideJWT validates signature/issuer/azp/iat against embedded VVK_
    - _Preservation: application roles distinct from _tide_* (2.6)_
    - _Requirements: 2.3, 2.6_

  - [ ] 3.4 Add `lib/auth/protect.ts` (fail-closed `withAuth` / `withRole`)
    - `const REQUIRE_DPOP = true` — assert the DPoP binding (I-12).
    - `withAuth(handler)` — extract token → `verifyTideJWT` → if `REQUIRE_DPOP` and `cnf.jkt` absent →
      401 → else call handler. Any thrown error → 401 with a generic body (do not leak which check
      failed). Does not re-verify the DPoP proof itself (AP-43); `cnf.jkt` presence is the assertion.
    - `withRole(role, handler)` — wraps `withAuth`; if `hasRole(jwt, role)` is false → 403, else call
      handler.
    - Deny-by-default: no path proceeds unless every check passes.
    - _Bug_Condition: isBugCondition_B — fail closed 401/403, expose no admin data_
    - _Expected_Behavior: 401 missing/invalid/unbound; 403 valid but not admin; 200 only when all checks pass_
    - _Requirements: 2.3_

  - [ ] 3.5 Add `app/api/admin/summary/route.ts` (the sole server enforcement point)
    - `export const GET = withRole('admin', async (req, jwt) => …)` returning admin-only data (e.g. a
      small server-computed summary).
    - This route is the sole gate for that data.
    - _Bug_Condition: isBugCondition_B — targetsAdminResource(request)_
    - _Expected_Behavior: guarded by withRole('admin'); fails closed per protect.ts_
    - _Requirements: 2.3, 2.5_

  - [ ] 3.6 Add `app/admin/page.tsx` (data fetched through the guarded route)
    - Admin data is NOT embedded client-side; the page fetches it from `GET /api/admin/summary` via
      `secureFetch` with an **absolute** URL and a pre-set `Authorization: Bearer` header (AP-73, AP-74)
      so the SDK attaches the DPoP proof.
    - On 401/403 show an access-denied state rather than data.
    - _Bug_Condition: isBugCondition_B_
    - _Expected_Behavior: admin data only rendered when the guarded route returns 200_
    - _Requirements: 2.3, 2.5_

  - [ ] 3.7 Gate the admin UI entry point with `hasRealmRole('admin')` (UI only)
    - In `app/dashboard/page.tsx` (or shared nav), conditionally render a link/button to `/admin` using
      `useTideCloak().hasRealmRole('admin')`.
    - This is **UI gating only** (AP-02) — show/hide only, never treated as authorization. The server
      route remains the sole gate. `hasRealmRole` (not `hasClientRole`) is correct because `admin` is a
      realm role (AP-29).
    - _Bug_Condition: isBugCondition_B (UI affordance, not the gate)_
    - _Expected_Behavior: entry point visibility follows client role; enforcement stays server-side_
    - _Preservation: client check is not authorization (2.4)_
    - _Requirements: 2.4_

  - [ ] 3.8 Unit + property-based tests for `tideJWT` / `withRole` (per design testing strategy)
    - **Property 1: Expected Behavior** - Server-side RBAC, fail closed
    - Unit — `verifyTideJWT`: valid → payload; bad signature / wrong issuer / wrong `azp` / expired /
      future `iat` → throw (sign fixtures with a test Ed25519 key; loader points at a fixture adapter
      JSON).
    - Unit — `extractToken`: `Bearer`/`DPoP` accepted; missing/other → throw.
    - Unit — `hasRole`: realm-role hit; client-role hit; miss; ignores `_tide_*` for app checks (AP-18).
    - Unit — `withAuth`: missing header → 401; `cnf.jkt` absent → 401; valid+bound → handler runs.
    - Unit — `withRole('admin')`: valid+bound admin → 200; valid+bound non-admin → 403; invalid → 401.
    - **PBT** — generate arbitrary role sets: `withRole('admin')` returns 200 iff `admin` ∈ roles, else
      403. Generate tokens with/without `cnf.jkt`: present → proceeds, absent → 401.
    - _Requirements: 2.3, 2.5, 2.6_

## DEFECT A — In-app onboarding (no raw Keycloak form)

- [ ] 4. Fix DEFECT A — collect first/last name in-app via the Account API

  - [ ] 4.1 Add `lib/account/profile.ts` (Account API read/write with the user's own token)
    - Client-side helper using `useTideCloak().token` / `getToken()`:
      `GET {auth-server-url}/realms/{realm}/account` and `POST` the same with
      `Authorization: Bearer <user token>`, `Content-Type: application/json`, body
      `{ firstName, lastName }` only — no email, no username, no placeholder (AP-85).
    - `{auth-server-url}` and `{realm}` come from `data/tidecloak.json` (imported, not env-duplicated —
      AP-38). Never uses master/admin credentials and never touches the Admin API (AP-41, AP-72).
    - Surface the Account API response body on error (do not discard it).
    - _Bug_Condition: isBugCondition_A — no in-app persistence path exists_
    - _Expected_Behavior: persist firstName+lastName via Account API with the user's own token_
    - _Preservation: config sourced from data/tidecloak.json (3.4)_
    - _Requirements: 2.1, 2.2, 3.4_

  - [ ] 4.2 Add `components/ProfileOnboarding.tsx` (accessible modal, first + last name only)
    - `"use client"` focus-trapped, accessible dialog: labelled inputs for first and last name, both
      required, submit disabled until both non-empty. **No email field, no placeholder.**
    - Reads `authenticated` / `isInitializing` from `useTideCloak()`; does nothing until
      `authenticated && !isInitializing`.
    - Profile-incomplete detection: read names via `getValueFromIdToken('given_name')` /
      `getValueFromIdToken('family_name')` (AP-69 — accessor functions, not `tokenParsed`), and fetch the
      profile from the Account API as source of truth for just-saved state.
    - If either name missing/blank → `isBugCondition_A` true → render modal.
    - On submit → persist via `lib/account/profile.ts`; on success close modal and set a local "complete"
      flag so it does not flash again this session (persisted names also make `isBugCondition_A` false
      next load). On error keep modal open and show the response body for retry.
    - _Bug_Condition: isBugCondition_A — missingProfile(firstName) OR missingProfile(lastName)_
    - _Expected_Behavior: in-app modal collects exactly firstName+lastName; stops appearing once complete_
    - _Requirements: 2.1, 2.2_

  - [ ] 4.3 Mount `<ProfileOnboarding />` in `app/providers.tsx`
    - Mount as a **sibling of `{children}`** inside `TideCloakProvider` so it observes auth state
      app-wide.
    - Provider `config` stays exactly as-is: `{ ...tideConfig, useDPoP: { mode: "strict", alg: "ES256" } }`
      (AP-52, AP-38 preserved).
    - _Bug_Condition: isBugCondition_A_
    - _Expected_Behavior: modal available app-wide after login without altering provider config_
    - _Preservation: DPoP strict/ES256 provider config unchanged (3.2)_
    - _Requirements: 2.1, 3.2_

  - [ ] 4.4 Verify/document Keycloak required-action suppression (AP-85 four-mechanism check)
    - **Provisioning/verification, not app code.** Run the AP-85 four-way diagnostic to confirm NONE of
      the following renders the "Update Account Information" page:
      `idp-review-profile` on first-broker-login; a `VERIFY_PROFILE` required action; a default required
      action on new users; a stale per-user required action (a realm-level change will NOT clear this
      one).
    - Confirm the realm declares only `link-tide-account-action` and that no profile-gate mechanism is
      active. If the page still appears, suspect the account console via a redirect-URI issue rather than
      a form. Do NOT synthesise an email to "satisfy" the form (AP-85) — the fix is to not require it.
    - Document the outcome as the suppression step.
    - _Bug_Condition: isBugCondition_A — the raw Keycloak page must never be shown_
    - _Expected_Behavior: Keycloak "Update Account Information" page suppressed (2.1)_
    - _Requirements: 2.1_

  - [ ] 4.5 Verify bug condition exploration test now passes (onboarding)
    - **Property 1: Expected Behavior** - In-app onboarding, no raw Keycloak form
    - **IMPORTANT**: Re-run the SAME onboarding test(s) from task 1 — do NOT write new tests.
    - **EXPECTED OUTCOME**: Test PASSES — for a profile-incomplete session the Keycloak page is not shown,
      the in-app modal collects first + last name, submit persists via the Account API with the user's
      own token, and `isBugCondition_A` is false afterward (modal does not reappear).
    - _Requirements: 2.1, 2.2_

## Verify the fix and preservation

- [ ] 5. Verify exploration & preservation tests against the fixed app

  - [ ] 5.1 Verify bug condition exploration tests now pass (RBAC)
    - **Property 1: Expected Behavior** - Server-side RBAC, fail closed
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests.
    - **EXPECTED OUTCOME**: anonymous `/api/admin/summary` → 401; non-admin token → 403; admin token
      without `cnf.jkt` → 401; valid+bound admin token → 200 + data. No admin data exposed on 401/403.
    - _Requirements: 2.3, 2.5_

  - [ ] 5.2 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing behaviour unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests.
    - **EXPECTED OUTCOME**: login/logout, `/tide_dpop/...` relay + CSP, `/auth/redirect`, non-admin
      dashboard with `preferred_username`, complete-profile users (no modal), and
      `data/tidecloak.json`-only config all still behave as on F. `hasRealmRole('admin')` still toggles
      only the `/admin` link while a non-admin calling `/api/admin/summary` directly still gets 403.
    - Confirm no regressions after the fix.
    - _Requirements: 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 6. Checkpoint — Ensure all tests pass and the build is clean
  - Run `npm run typecheck` and `npm run build --webpack`; resolve any errors.
  - Run the unit + property-based suites (tasks 3.8) — all green.
  - Manual/integration checks:
    - RBAC: anonymous → `/api/admin/summary` → 401; non-admin → 403; admin → 200 + data.
    - Onboarding: profile-incomplete user → modal appears → submit → Account API persists → reload → no
      modal; complete-profile user → no modal; no Keycloak "Update Account Information" page in either
      case.
    - Preservation: existing login, DPoP relay, `/auth/redirect` callback, and non-admin dashboard
      unchanged.
  - Ensure all tests pass; ask the user if questions arise.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5_
