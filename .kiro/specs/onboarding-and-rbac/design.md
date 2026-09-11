# Onboarding and RBAC Bugfix Design

## Overview

This design fixes two defects in the existing `Login-app-with-tidecloak` app (Next.js 16 App Router,
`@tidecloak/nextjs` 0.14.20, DPoP strict/ES256, adapter config in `data/tidecloak.json`, realm
`login-app-with-tidecloak`, client `login-app-with-tidecloak-client`, embedded EdDSA JWKS).

- **Defect A — onboarding leak.** Tide's IdP asserts only a username (the 64-hex `vuid`); it asserts
  no `email`, `firstName`, or `lastName`. A newly registered user can therefore be shown Keycloak's
  unstyled "Update Account Information" required-action page (64-hex username), and the app has no
  in-app way to collect a first/last name. The fix suppresses that server-rendered page and collects
  exactly `firstName` + `lastName` in an in-app modal after login, persisting them via the TideCloak
  **Account API** with the logged-in user's own access token. No email or placeholder field is
  synthesised (per AP-85).

- **Defect B — no server-side authorization.** The only access gate today is
  `app/dashboard/layout.tsx`, a client-side `useEffect` redirect — UI gating, not a security boundary
  (AP-02). There is no `lib/auth/` layer, `jose` is not installed, there are no API routes, and there
  is no `admin`/`user` role distinction. The fix adds a `lib/auth/` layer that verifies the DPoP-bound
  Tide JWT server-side with `jose` against the embedded JWKS, `withAuth`/`withRole` helpers that fail
  closed (401/403), at least one admin-gated API route, and an admin page whose data is fetched
  through that route. Client-side `hasRealmRole('admin')` is used only to show/hide the admin UI entry
  point.

The strategy is **additive and layered**: all currently-correct behaviour (login, the DPoP relay under
`/tide_dpop/`, the CSP/rewrite headers in `next.config.ts`, the `useAuthCallback` handler at
`app/auth/redirect/page.tsx`, and the existing dashboard) is preserved unchanged. The fix only adds new
files and adds server-side enforcement where none existed.

## Glossary

- **Bug_Condition (C)**: The condition that triggers a defect. `C_A` — an authenticated session whose
  Tide-asserted profile has no `firstName`/`lastName`. `C_B` — a request to an admin-gated resource
  that is not backed by a server-verified `admin` realm role in a valid, DPoP-bound Tide JWT.
- **Property (P)**: The desired behaviour. `P_A` — no Keycloak required-action page; an in-app modal
  collects and persists first/last name via the Account API, and stops appearing once complete. `P_B` —
  the server verifies the Tide JWT and enforces the `admin` role, failing closed with 401/403.
- **Preservation**: Existing login, DPoP relay, `/auth/redirect` callback, non-admin dashboard access,
  and `data/tidecloak.json` as the single config source — all unchanged.
- **vuid**: The 64-hex Tide user identifier; the only identity claim Tide's IdP asserts. It is the
  Keycloak username.
- **Account API**: TideCloak's per-user self-service REST API
  (`/realms/{realm}/account`), called with the logged-in user's own access token. Used to read and
  write the user's own `firstName`/`lastName`. Distinct from the Admin API (which needs admin
  credentials — AP-41 — and, on a governed realm, produces a change request rather than an immediate
  write).
- **Embedded JWKS (VVK)**: The `jwk` field in `data/tidecloak.json` — Tide's non-rotating
  vendor-verifiable key. JWT signatures are verified locally against it; `createRemoteJWKSet` is
  forbidden (AP-01, I-04).
- **azp**: The "authorized party" claim in Tide access tokens; it carries the client id
  (`login-app-with-tidecloak-client`). The `aud` claim typically contains `account`, not the client id,
  so the client check is against `azp`.
- **cnf.jkt**: The DPoP confirmation claim. Its presence proves TideCloak bound the token to the
  client's DPoP key at issuance. Asserting it fails closed against unbound/downgrade tokens (I-12,
  SG-03).
- **`_tide_*` roles**: Tide system/E2EE voucher-gate roles. They MUST NOT be used for application
  authorization; application roles (`admin`, `user`) are distinct (AP-18, requirement 2.6).
- **`getValueFromIdToken` / `getValueFromToken`**: The accessor functions exposed by
  `useTideCloak()`. There is no `tokenParsed` object on the context (AP-69).

## Bug Details

### Bug Condition A — onboarding leak

The bug manifests when a newly registered (or otherwise profile-incomplete) user authenticates: Tide
asserts only the `vuid`, so either Keycloak renders the server-side "Update Account Information"
required-action page showing the 64-hex username, or the app silently leaves the profile incomplete
with no way to fix it.

**Formal Specification:**
```
FUNCTION isBugCondition_A(session)
  INPUT: session — an authenticated Tide session
  OUTPUT: boolean

  RETURN missingProfile(session.user.firstName)
      OR missingProfile(session.user.lastName)
END FUNCTION

// missingProfile(v) := (v == null) OR (trim(v) == "")
```

### Bug Condition B — missing server-side authorization

The bug manifests whenever an admin-gated resource (an admin API route or the admin page's data) is
reached without a server-verified `admin` realm role carried in a valid, DPoP-bound Tide JWT.

**Formal Specification:**
```
FUNCTION isBugCondition_B(request)
  INPUT: request — an HTTP request to an admin-gated route or API
  OUTPUT: boolean

  RETURN targetsAdminResource(request)
      AND NOT ( serverVerifiedTideJWT(request)      // signature+iss+azp+cnf.jkt all valid
                AND jwtHasRealmRole(request, 'admin') )
END FUNCTION
```

### Examples

- **A1** New user registers with Tide, is redirected back with a valid session; `firstName`/`lastName`
  are absent. Expected: no Keycloak form; in-app modal collects first + last name. Actual (today): the
  raw Keycloak "Update Account Information" page can appear, or the profile stays empty forever.
- **A2** User completes the in-app modal. Expected: names persisted via Account API with the user's own
  token; modal never reappears. Actual (today): no persistence path exists.
- **A3 (edge)** Existing user already has first + last name. Expected: no modal, straight to app.
- **B1** Anonymous `curl` to `GET /api/admin/*` with no token. Expected: 401, no admin data. Actual
  (today): no such route / no verification exists.
- **B2** Authenticated non-admin user (role `user`) calls the admin API directly. Expected: 403, no
  admin data. Actual (today): nothing enforces this.
- **B3** Valid admin token but sent as `Bearer` without `cnf.jkt` (downgrade attempt). Expected: 401.
- **B4 (edge)** Valid admin token with `admin` role and `cnf.jkt` present. Expected: 200 + admin data.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Login / logout via `useTideCloak()` on `app/page.tsx` behaves exactly as today for unauthenticated
  visitors (requirement 3.5).
- The DPoP strict/ES256 wiring, the `/tide_dpop/:path*` wildcard rewrite, and the CSP/`Allow-CSP-From`
  headers in `next.config.ts` are untouched (requirement 3.2; AP-70, AP-71). The shipped
  `public/tide_dpop_auth.html` already uses `window.opener || window.parent` (AP-62) and stays as-is.
- The `useAuthCallback` handler at `app/auth/redirect/page.tsx` is unchanged (requirement 3.2).
- An existing user with a complete profile logs straight through — no modal, no Keycloak page
  (requirement 3.1).
- The existing dashboard (`app/dashboard/page.tsx`) continues to grant access to any authenticated user
  and display `preferred_username` (requirement 3.3). Note: the client `useEffect` redirect in
  `app/dashboard/layout.tsx` remains a UX affordance; it is not removed, but it is explicitly not the
  security boundary.
- Config continues to be sourced from `data/tidecloak.json` only. No reliance on the stale
  `tidecloak/realm.json` template, and no `NEXT_PUBLIC_*` duplication (requirement 3.4; AP-38).

**Scope:**
All inputs that satisfy neither `C_A` nor `C_B` must be byte-for-byte unaffected. This includes: any
authenticated user with a complete profile; all non-admin protected pages; every existing login, DPoP,
and callback code path.

## Hypothesized Root Cause

### Defect A
1. **Tide asserts username-only by design.** The IdP sets only the `vuid` as username; `firstName`,
   `lastName`, `email` are never brokered (AP-85). There is nothing to fix server-side in Tide itself —
   the app must collect the profile.
2. **A Keycloak profile-gate mechanism may be active.** The unstyled page is produced by one of four
   distinct mechanisms, each with a different fix (AP-85):
   - `idp-review-profile` on the `first broker login` flow,
   - a `VERIFY_PROFILE` required action,
   - a default required action applied to new users,
   - a stale required action already attached to an existing user (a realm-level change will NOT clear
     this one).
   A correctly provisioned Tide realm has **none** of these active; the realm template here declares
   only `link-tide-account-action`. If the page still appears, the likely cause is the account console
   via a redirect-URI issue rather than a form.
3. **No in-app onboarding exists.** There is no component, no Account-API call, and no profile-complete
   detection anywhere in `app/`.

### Defect B
1. **Enforcement lives on the client.** `app/dashboard/layout.tsx` is a `useEffect` redirect — trivially
   bypassed by a direct HTTP call (AP-02).
2. **No verification layer.** `jose` is not installed; there is no `lib/auth/`, no API route, and no
   JWT verification against the embedded JWKS.
3. **No role model.** The realm has no `admin`/`user` application roles, and nothing distinguishes them
   from `_tide_*` system roles (AP-18).

## Correctness Properties

Property 1: Bug Condition A — In-app onboarding, no raw Keycloak form

_For any_ authenticated session where the bug condition holds (`isBugCondition_A` returns true — the
Tide-asserted profile is missing `firstName` or `lastName`), the fixed app SHALL NOT display Keycloak's
"Update Account Information" required-action page, SHALL display an in-app modal that collects exactly
`firstName` and `lastName`, and upon submit SHALL persist both via the TideCloak Account API using the
logged-in user's own access token (synthesising no email or other field). After a successful save,
`isBugCondition_A` SHALL be false and the modal SHALL NOT reappear on subsequent loads.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition B — Server-side RBAC, fail closed

_For any_ request where the bug condition holds (`isBugCondition_B` returns true — an admin-gated
resource reached without a server-verified `admin` role in a valid, DPoP-bound Tide JWT), the fixed app
SHALL respond with HTTP 401 when the token is missing/invalid/unbound and HTTP 403 when the token is
valid but lacks the `admin` role, and SHALL NOT expose admin data in either case.

**Validates: Requirements 2.3, 2.5**

Property 3: Preservation — Existing behaviour unchanged

_For any_ input where neither bug condition holds (`NOT (isBugCondition_A OR isBugCondition_B)`), the
fixed app SHALL produce the same result as the original app — preserving login/logout, the DPoP relay,
the `/auth/redirect` callback, non-admin dashboard access with `preferred_username`, and
`data/tidecloak.json` as the single config source. Client-side `hasRealmRole('admin')` SHALL affect only
the visibility of the admin UI entry point and SHALL NOT be treated as authorization.

**Validates: Requirements 2.4, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Realm prerequisite (documented, not code)

Before the RBAC code can enforce anything, the realm `login-app-with-tidecloak` must define the
application roles `admin` and `user` as **realm roles**, and they must be assigned to users. When IGA is
enabled, role assignment goes through the draft → approve → commit lifecycle (approval happens in the
admin's enclave; AP-31, AP-37) — a role that appears assigned via a bare `2xx` may still be pending
(AP-72). These roles are ordinary realm roles and are kept distinct from any `_tide_*` role (AP-18,
requirement 2.6). This is a provisioning prerequisite; the app code does not create roles.

### Defect A — onboarding

**Files to add:**
- `lib/account/profile.ts` — a small client-side helper that reads/writes the current user's profile via
  the Account API using `useTideCloak().token` (or `getToken()`), never the Admin API.
- `components/ProfileOnboarding.tsx` — a `"use client"` modal component.

**Files to change:**
- `app/providers.tsx` — mount `<ProfileOnboarding />` alongside `{children}` inside `TideCloakProvider`
  so it can observe auth state app-wide. (Provider `config` stays exactly as-is — `{ ...tideConfig,
  useDPoP: { mode: "strict", alg: "ES256" } }` — AP-52/AP-38 preserved.)

**Suppression of the Keycloak page (mechanism):** Suppression is a realm/provisioning concern, not app
code. Per AP-85, run the four-way diagnostic to identify which mechanism (if any) renders the page:
`idp-review-profile` on first-broker-login, a `VERIFY_PROFILE` required action, a default required
action, or a stale per-user required action. A correctly provisioned Tide realm has none active (this
realm declares only `link-tide-account-action`), so the primary action is to **verify none are enabled**
and document that as the suppression step. The in-app modal is what actually collects the data; the
suppression ensures Tide's username-only assertion never lands on the server-rendered form. The design
does not synthesise an email to "satisfy" the form (AP-85) — the correct fix is to not require the form.

**Profile-incomplete detection & modal lifecycle (data flow):**
1. On mount, `ProfileOnboarding` reads `authenticated` and `isInitializing` from `useTideCloak()`. It
   does nothing until `authenticated && !isInitializing`.
2. It reads the current names from the ID token via `getValueFromIdToken('given_name')` /
   `getValueFromIdToken('family_name')` (AP-69 — use the accessor functions, not `tokenParsed`). As a
   source of truth for the just-saved state, it also fetches the profile from the Account API
   (`GET /realms/{realm}/account`) with the user's token.
3. If either name is missing/blank → `isBugCondition_A` is true → render the modal (a focus-trapped,
   accessible dialog: labelled inputs for first and last name, required, submit disabled until both
   non-empty). No email field, no placeholder.
4. On submit → `POST`/`PUT` the profile to the Account API with `Authorization: Bearer <userToken>`
   sending `{ firstName, lastName }` only. On success, close the modal and set a local "complete" flag
   so it does not flash again this session; the persisted values also make `isBugCondition_A` false on
   the next load (names now present in the refreshed token/profile).
5. On error, surface the Account API's response body (do not discard it) and keep the modal open so the
   user can retry.

**Account API call (correct authority — AP-41/AP-85):**
```
GET  {auth-server-url}/realms/{realm}/account           Authorization: Bearer <user access token>
POST {auth-server-url}/realms/{realm}/account           Authorization: Bearer <user access token>
     Content-Type: application/json
     body: { "firstName": "<given>", "lastName": "<family>" }   // no email, no username
```
`{auth-server-url}` and `{realm}` come from `data/tidecloak.json` (imported, not env-duplicated —
AP-38). The call uses the logged-in user's own token; it never uses master/admin credentials and never
touches the Admin API (which on a governed realm would return `202` + a change request rather than an
immediate write — AP-72, AP-85).

### Defect B — server-side RBAC

**Dependency:** add `jose` to `package.json`.

**Files to add (the `lib/auth/` layer):**

1. `lib/auth/tidecloakConfig.ts` — loads the adapter JSON. Priority: `process.env.CLIENT_ADAPTER` (full
   JSON, for deployment) then `data/tidecloak.json`. Exposes a typed `TidecloakConfig` and throws a
   clear error if `jwk` is absent (AP-01/AP-13). No `NEXT_PUBLIC_*`, no field-splitting (AP-38).

2. `lib/auth/tideJWT.ts` — verification with `jose`, using **lazy** initialization (AP-46: do not load
   config or build the JWKS at module scope, since Next.js 16 evaluates modules during `next build`).
   - `getConfig()` — memoized; loads config and builds `createLocalJWKSet(config.jwk)` on first use.
     `createRemoteJWKSet` is never used (AP-01, I-04).
   - `verifyTideJWT(token)` — the verification sequence below; returns the `JWTPayload` or throws.
   - `hasRole(payload, role)` — checks `realm_access.roles` and `resource_access[*].roles`.
   - `extractToken(authHeader)` — accepts both `Bearer ` and `DPoP ` schemes (AP-45: `secureFetch`
     upgrades Bearer→DPoP when DPoP is enabled), throws on missing/invalid header.

3. `lib/auth/protect.ts` — the fail-closed middleware.
   - `const REQUIRE_DPOP = true` — the realm issues DPoP-bound tokens, so assert the binding (I-12).
   - `withAuth(handler)` — extract token → `verifyTideJWT` → if `REQUIRE_DPOP` and `cnf.jkt` absent →
     401 → else call handler. Any thrown error → 401 with a generic body (do not leak which check
     failed). It does **not** re-verify the DPoP proof itself, because the client uses `secureFetch`
     whose proofs are Tide-specific, not RFC 9449 (AP-43); `cnf.jkt` presence is the correct assertion.
   - `withRole(role, handler)` — wraps `withAuth`; if `hasRole(jwt, role)` is false → 403, else call
     handler.

**Files to add (admin-gated resources):**

4. `app/api/admin/summary/route.ts` — `export const GET = withRole('admin', async (req, jwt) => …)`.
   Returns admin-only data (e.g. a small server-computed summary). This is the sole enforcement point
   for that data.

5. `app/admin/page.tsx` — an admin page. Its admin data is **not** embedded client-side; the page (or a
   server component / client fetch through `secureFetch`) obtains it from `GET /api/admin/summary`,
   which is server-guarded by `withRole('admin')`. If the fetch returns 401/403 the page shows an
   access-denied state rather than data. Any client-side calls to the app's own API use `secureFetch`
   with an **absolute** URL and a pre-set `Authorization: Bearer` header (AP-73, AP-74) so the SDK
   attaches the DPoP proof.

**Files to change:**

6. `app/dashboard/page.tsx` (or a shared nav) — conditionally render a link/button to `/admin` using
   `useTideCloak().hasRealmRole('admin')`. This is **UI gating only** (AP-02, requirement 2.4): it
   shows/hides the entry point and is never treated as authorization. The server route remains the sole
   gate. `hasRealmRole` is correct here because `admin` is a realm role; `hasClientRole` is reserved for
   client roles such as `tide-realm-admin` (AP-29) which are not used for app authorization.

### JWT verification sequence (`verifyTideJWT`)

1. `extractToken` — read `Authorization`; accept `Bearer <t>` or `DPoP <t>`; throw if missing/other
   scheme.
2. `getConfig()` — lazily load `data/tidecloak.json` and build the local JWKS from the embedded `jwk`
   (EdDSA/Ed25519 key). Throw if `jwk` missing.
3. `jwtVerify(token, JWKS, { issuer })` where `issuer = auth-server-url (trailing-slash-trimmed) +
   "/realms/" + realm`. This checks the **signature** against the embedded VVK and the **issuer**. `exp`
   is validated by `jose`.
4. Assert `payload.azp === config.resource` (client id `login-app-with-tidecloak-client`). Reject
   otherwise. (`aud` is `account`, so the client identity is in `azp`.)
5. Assert `payload.iat <= now + 60` (reject future-dated tokens).
6. In `protect.ts`: assert `cnf.jkt` is present (DPoP binding). Absent → 401.
7. Role check happens in `withRole`: `hasRole(payload, 'admin')` over `realm_access.roles` (and, for
   completeness, `resource_access[*].roles`). Not admin → 403.

### Error / fail-closed handling

| Situation | Result |
|---|---|
| No `Authorization` header / unsupported scheme | 401 |
| Bad signature, wrong issuer, wrong `azp`, expired, future-dated | 401 |
| Valid token but `cnf.jkt` absent (unbound / downgrade) | 401 |
| Valid, bound token but missing `admin` role | 403 |
| Valid, bound admin token | 200 + data |
| Any unexpected exception in verification | 401 (generic body; log server-side) |

No path returns admin data unless every check passes — the middleware is deny-by-default.

### Regression prevention (how existing behaviour is preserved)

- `next.config.ts` is untouched: the `/tide_dpop/:path*` wildcard rewrite, `frame-src 'self' *`, the
  relay-path CSP + `Allow-CSP-From: *`, and the `@tidecloak/react` webpack alias all remain (AP-70,
  AP-71, AP-42).
- `public/tide_dpop_auth.html` is untouched and already correct (`window.opener || window.parent`,
  AP-62).
- `app/auth/redirect/page.tsx` (`useAuthCallback`) and `app/providers.tsx` DPoP config are unchanged in
  behaviour; the only provider edit is mounting the onboarding modal as a sibling of `{children}`.
- `app/dashboard/page.tsx`/`layout.tsx` keep their current behaviour for authenticated non-admin users;
  the client redirect stays as UX, not security.
- Config remains `data/tidecloak.json`-only; new server code imports/reads that file, adding no env
  duplication (AP-38, requirement 3.4).

## Testing Strategy

### Validation Approach

Two phases: first surface counterexamples that demonstrate each defect on the unfixed code, then verify
the fix satisfies the properties and preserves existing behaviour. Verification runs with `npm run
typecheck` and `npm run build --webpack`; unit tests target the pure verification/role logic (which is
deterministic and does not require a live TideCloak).

### Exploratory Bug Condition Checking

**Goal:** confirm the root-cause hypotheses on the unfixed code before implementing.

**Test cases (expected to fail / demonstrate the bug on F):**
1. **B — anonymous API call:** `curl` the (to-be-added) admin route with no token — today there is no
   server gate at all, demonstrating 1.3/1.5. (will fail on unfixed code)
2. **B — direct bypass:** show that dashboard/admin data can be reached without a server-verified role,
   because only the client `useEffect` guards it (1.4). (will fail on unfixed code)
3. **A — new user:** a session with no `given_name`/`family_name` has no in-app collection path and can
   hit the Keycloak page (1.1/1.2). (will fail on unfixed code)
4. **A (edge):** confirm a complete-profile user is unaffected (baseline for preservation).

**Expected counterexamples:** admin data reachable without server verification; no modal for
profile-incomplete users. Root cause confirmed: missing `lib/auth/` + client-only gate (B); Tide
username-only assertion + no in-app onboarding (A).

### Fix Checking

**Goal:** for all inputs where a bug condition holds, the fixed function produces the expected behaviour.
```
FOR ALL request WHERE isBugCondition_B(request) DO
  result := F'(request)
  ASSERT result.status IN {401, 403}
  ASSERT NOT result.exposesAdminData
END FOR

FOR ALL session WHERE isBugCondition_A(session) DO
  ASSERT NOT shown(keycloak_update_account_information_page)
  ASSERT shown(in_app_profile_modal collecting firstName AND lastName)
  AFTER submit: ASSERT persisted(firstName,lastName) VIA account_api WITH userToken
                ASSERT NOT isBugCondition_A(session)
END FOR
```

### Preservation Checking

**Goal:** for all inputs where neither bug condition holds, F and F' agree.
```
FOR ALL X WHERE NOT (isBugCondition_A(X) OR isBugCondition_B(X)) DO
  ASSERT F(X) = F'(X)
END FOR
```
**Approach:** property-based testing over the token/role domain for `verifyTideJWT`/`hasRole`/`withRole`
(it generates many token shapes and catches edge cases automatically), plus targeted checks that
login, DPoP relay, `/auth/redirect`, and non-admin dashboard access are unchanged. Observe the complete
-profile and non-admin behaviours on F first, then assert they still hold on F'.

**Test cases:**
1. **Preserve login/DPoP/callback:** login still completes; `/tide_dpop/...` still serves the relay with
   correct CSP (`curl -D -`); `/auth/redirect` still processes the code.
2. **Preserve non-admin dashboard:** an authenticated `user` still sees the dashboard and
   `preferred_username`.
3. **Preserve config source:** server code reads `data/tidecloak.json`; no `NEXT_PUBLIC_*` introduced.
4. **UI gating only:** `hasRealmRole('admin')` toggles the `/admin` link but a non-admin calling
   `/api/admin/summary` directly still gets 403.

### Unit Tests

- `tideJWT.verifyTideJWT`: valid token → payload; bad signature → throw; wrong issuer → throw; wrong
  `azp` → throw; expired → throw; future `iat` → throw. (Sign fixtures with a test Ed25519 key and point
  the loader at a fixture adapter JSON.)
- `tideJWT.extractToken`: `Bearer`/`DPoP` accepted; missing/other → throw.
- `tideJWT.hasRole`: realm role hit; client role hit; miss; ignores `_tide_*` roles for app checks
  (AP-18).
- `protect.withAuth`: missing header → 401; `cnf.jkt` absent → 401; valid+bound → handler runs.
- `protect.withRole('admin')`: valid+bound admin → 200; valid+bound non-admin → 403; invalid → 401.

### Property-Based Tests

- Generate arbitrary role sets and assert `withRole('admin')` returns 200 iff `admin ∈ realm_access.roles`
  (or client roles) and 403 otherwise — covering the fail-closed guarantee across the domain.
- Generate tokens with/without `cnf.jkt` and assert binding enforcement (present → allowed to proceed,
  absent → 401).

### Integration Tests

- End-to-end: anonymous → `/api/admin/summary` → 401; non-admin → 403; admin → 200 + data (tokens pulled
  from a real login in dev).
- Onboarding flow: new (profile-incomplete) user logs in → modal appears → submit → Account API persists
  → reload → no modal; complete-profile user → no modal, straight to app; no Keycloak "Update Account
  Information" page appears in either case.
