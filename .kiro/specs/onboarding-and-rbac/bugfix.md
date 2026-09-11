# Bugfix Requirements Document

## Introduction

The existing app (`Login-app-with-tidecloak`, Next.js 16 App Router + `@tidecloak/nextjs` v0.14.20)
authenticates users against the provisioned TideCloak realm `login-app-with-tidecloak` (client
`login-app-with-tidecloak-client`, DPoP strict/ES256, embedded JWKS at `data/tidecloak.json`). Login,
the DPoP relay, the OAuth callback, and the CSP/rewrite wiring all work correctly and are the source of
truth.

Two defects in the current behaviour are being fixed under this spec:

1. **Raw Keycloak onboarding leak.** Because Tide's IdP asserts only a username (the 64-hex `vuid`) and
   no profile fields, a newly registered user is presented with Keycloak's unstyled "Update Account
   Information" required-action page showing a 64-hex username, instead of collecting profile details
   in-app. The app has no in-app mechanism to capture a new user's first and last name.

2. **Authorization is not enforced.** There is no server-side authorization anywhere in the app. The
   only gate is `app/dashboard/layout.tsx`, a client-side `useEffect` redirect that is a UX affordance,
   not a security boundary (an attacker can call any endpoint directly). There is no `lib/auth/` layer,
   `jose` is not installed, there are no API routes, and there is no notion of `admin` vs `user` roles.
   Admin-only capability can therefore be reached by anyone, and no route or API verifies the
   DPoP-bound Tide JWT server-side.

The fix adds in-app onboarding (collect first name + last name after login via the TideCloak Account
API, and suppress the Keycloak required-action page) and role-based access control that is enforced
server-side by verifying the Tide JWT with `jose` against the embedded JWKS, with client-side
`hasRealmRole` used only to show/hide the admin entry point. Existing correct DPoP wiring, the callback
handler, and normal login must be preserved.

### Bug Condition and Property (bug-condition methodology)

**Defect A — onboarding leak**

```pascal
FUNCTION isBugCondition_A(session)
  INPUT: session — an authenticated Tide session
  OUTPUT: boolean
  // A user whose Tide-asserted profile has no firstName/lastName yet,
  // OR any brokered signup that reaches Keycloak's Update Account Information page.
  RETURN missingProfile(session.user.firstName) OR missingProfile(session.user.lastName)
END FUNCTION
```

```pascal
// Property: Fix Checking — in-app onboarding, no raw Keycloak form
FOR ALL session WHERE isBugCondition_A(session) DO
  ASSERT NOT shown(keycloak_update_account_information_page)
  ASSERT shown(in_app_profile_modal collecting firstName AND lastName)
  AFTER user submits:
    ASSERT persisted(firstName, lastName) VIA account_api WITH session.userToken
    ASSERT NOT isBugCondition_A(session)   // modal no longer appears on next load
END FOR
```

**Defect B — missing server-side authorization**

```pascal
FUNCTION isBugCondition_B(request)
  INPUT: request — an HTTP request to an admin-gated route or API
  OUTPUT: boolean
  // The bug triggers whenever an admin-gated resource is reached without a
  // server-verified 'admin' realm role in a valid, DPoP-bound Tide JWT.
  RETURN targetsAdminResource(request)
     AND NOT (serverVerifiedTideJWT(request) AND jwtHasRealmRole(request, 'admin'))
END FUNCTION
```

```pascal
// Property: Fix Checking — server-side RBAC, fail closed
FOR ALL request WHERE isBugCondition_B(request) DO
  result ← F'(request)
  ASSERT result.status IN {401, 403}      // 401 if unauthenticated/invalid JWT, 403 if authenticated but not admin
  ASSERT NOT result.exposesAdminData
END FOR
```

**Preservation goal (both defects)**

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT (isBugCondition_A(X) OR isBugCondition_B(X)) DO
  ASSERT F(X) = F'(X)
  // Existing login, DPoP relay, /auth/redirect callback, and access to
  // non-admin protected pages behave exactly as before.
END FOR
```

- **F** = the app as it exists today (client-only guard, no onboarding, no RBAC).
- **F'** = the app after the fix (in-app onboarding + server-verified RBAC), with all previously
  correct behaviour unchanged.

## Bug Analysis

### Current Behavior (Defect)

Onboarding leak:

1.1 WHEN a new user completes Tide registration and their Tide-asserted profile has no first name or last name THEN the system presents Keycloak's raw, unstyled "Update Account Information" required-action page showing the 64-hex `vuid` as the username.

1.2 WHEN an authenticated user is missing first name / last name THEN the system provides no in-app way to collect and persist those details, so the profile stays incomplete.

Missing server-side authorization:

1.3 WHEN any client (including a direct HTTP call bypassing the browser UI) requests an admin-only capability THEN the system does not verify a Tide JWT server-side and does not check for an `admin` role, so access is not actually restricted.

1.4 WHEN the app decides whether to expose the dashboard/protected area THEN the system relies solely on the client-side `useEffect` redirect in `app/dashboard/layout.tsx`, which is UI gating and not a security boundary.

1.5 WHEN admin capability needs to be distinguished from regular users THEN the system has no `admin`/`user` roles, no `lib/auth/` verification layer, no installed `jose`, and no protected API route, so role-based authorization cannot be enforced.

### Expected Behavior (Correct)

Onboarding leak:

2.1 WHEN a new user completes Tide registration and is missing first name or last name THEN the system SHALL suppress the Keycloak "Update Account Information" required-action page (so the 64-hex username form is never shown) and SHALL, after login, present an in-app modal that collects exactly first name and last name.

2.2 WHEN the user submits the in-app onboarding modal THEN the system SHALL persist the first name and last name via the TideCloak Account API using the logged-in user's own token, SHALL NOT synthesise a placeholder email or any other field, and SHALL not show the modal again on subsequent loads once the profile is complete.

Server-side authorization:

2.3 WHEN any client requests an admin-only capability THEN the system SHALL verify the DPoP-bound Tide JWT server-side with `jose` using the embedded JWKS from `data/tidecloak.json` (validating issuer and `azp`/client, and asserting the `cnf.jkt` DPoP-binding claim is present), SHALL require the `admin` realm role, and SHALL fail closed — returning 401 when the token is missing/invalid and 403 when the token is valid but lacks the `admin` role.

2.4 WHEN the app renders the admin entry point in the UI THEN the system SHALL use the client-side `hasRealmRole('admin')` only to show or hide that entry point, and SHALL NOT treat that client-side check as authorization (the server-side check in 2.3 remains the sole enforcement).

2.5 WHEN the fix is delivered THEN the system SHALL provide a `lib/auth/` layer (`tidecloakConfig`, `tideJWT` verify with `jose`, and `withAuth`/`withRole` protect helpers) and at least one admin-gated resource (an admin API route and/or an admin page whose data access is guarded server-side), and SHALL document as a prerequisite that the `admin` and `user` realm roles exist in `login-app-with-tidecloak` and are assignable to users (via IGA approval when IGA is enabled).

2.6 WHEN authorization roles are evaluated THEN the system SHALL treat application roles (`admin`, `user`) as distinct from any Tide system roles, and SHALL NOT use `_tide_*` roles to grant application privileges.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN an existing user with a complete profile (first and last name already set) logs in THEN the system SHALL CONTINUE TO log them in without showing the onboarding modal or the Keycloak required-action page.

3.2 WHEN a user authenticates THEN the system SHALL CONTINUE TO use the existing DPoP strict/ES256 wiring, the `/tide_dpop/:path*` relay, the CSP/rewrite headers in `next.config.ts`, and the `useAuthCallback` handler at `app/auth/redirect/page.tsx`, all unchanged.

3.3 WHEN an authenticated non-admin user accesses the existing protected dashboard THEN the system SHALL CONTINUE TO grant access and display the `preferred_username`, exactly as it does today.

3.4 WHEN the app loads its TideCloak configuration THEN the system SHALL CONTINUE TO source it from `data/tidecloak.json` (realm `login-app-with-tidecloak`, client `login-app-with-tidecloak-client`) as the single source of truth, and SHALL NOT rely on the stale `tidecloak/realm.json` template or duplicate config into `NEXT_PUBLIC_*` env vars.

3.5 WHEN home, login, and create-account actions on `app/page.tsx` are used THEN the system SHALL CONTINUE TO behave as before for unauthenticated visitors.
