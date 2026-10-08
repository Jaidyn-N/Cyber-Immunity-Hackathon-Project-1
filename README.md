# Tide-Protected Gaming Marketplace (PoC — Marketplace Beta)

A university proof-of-concept: a Tide-protected web gaming marketplace built on **Next.js 16**
(App Router, React 19) with **TideCloak** for identity. Players log in with a Tide account, buy cosmetic
items from a rotating shop, equip them, and list/obtain items on a secondary marketplace. A private
"note" field demonstrates Tide self-encryption (the server only ever stores opaque ciphertext).

The project is organised in three deliberately separated layers:

- **Layer A — application / database.** Profile, currency, inventory, shop, marketplace, records, and
  the application-level ownership record (`item_instance.owner_vuid`). SQLite via `better-sqlite3`.
- **Layer B — TideCloak authentication + RBAC.** OIDC login (`tidebrowser` flow), DPoP-bound tokens,
  the `vuid` identity claim, server-side JWT verification, and the `admin` role gate.
- **Layer C — Tide ownership attestation (PoC only).** The existing `OwnershipSpike` Forseti contract
  can threshold-sign and VVK-verify an item→owner-`vuid` statement. **This is a proof-of-concept and is
  not wired into the beta marketplace.** The beta marketplace transfer is **Layer A only** and never
  writes a Tide attestation.

> **Known limitations (by design, not failures).** The live governed-approval threshold is 1, so
> **four-eyes / two-person approval is not demonstrated**. `OwnershipSpike` has **no
> supersession/revocation** — after a second owner is bound, the first owner's attestation still
> verifies. **Full exclusive Tide-backed ownership transfer is not demonstrated.** The marketplace
> "obtain" is a temporary application-level (Layer A) transfer, explicitly **not** Tide-backed.

## Prerequisites

- **Node.js v24** and **npm**.
- **Docker** (to run TideCloak locally).
- **.NET 8 SDK** — only for the Tide Forseti compile harness (Layer C research). **Not required** to
  run or demo the beta.

## Install

```bash
npm install
```

This builds the native `better-sqlite3` binary. If you moved the repo, re-run `npm install` so the
binary matches your platform.

## Environment variables

Secrets are **local-only, gitignored, and must be supplied separately — never commit them.** Copy the
template and fill in real values locally:

```bash
cp .env.example .env   # then edit .env with your own local values
```

Referenced by **name only** (do not paste real values into docs or commits):

- `TIDECLOAK_URL` — base URL of the TideCloak server (local Docker: `http://localhost:8080`).
- `TIDECLOAK_REALM`, `TIDECLOAK_CLIENT_ID` — realm/client identifiers.
- `KC_BOOTSTRAP_ADMIN_USERNAME`, `KC_BOOTSTRAP_ADMIN_PASSWORD` — bootstrap admin for first-run
  provisioning.
- `TIDE_OPERATOR_EMAIL` — operator email used during provisioning.
- **Task 11 governed role-grant admin credentials** (used by `lib/tide/igaAdmin.ts` to initiate the
  IGA change request): `TIDE_ADMIN_REALM`, `TIDE_ADMIN_USERNAME`, `TIDE_ADMIN_PASSWORD` (password
  grant), or alternatively `TIDE_ADMIN_TOKEN`, or `TIDE_ADMIN_CLIENT_ID` + `TIDE_ADMIN_CLIENT_SECRET`
  (client-credentials). Optional overrides: `TIDE_ADMIN_CLIENT_ID_PW`, `TIDE_ADMIN_TOKEN_URL`,
  `TIDECLOAK_BASE_URL`.

The runtime adapter config the app actually loads is `data/tidecloak.json` (gitignored); realm
`login-app-with-tidecloak`. `.env` is **not tracked by git** — keep real passwords/secrets there only.

## Run TideCloak (Docker)

Start TideCloak locally so it serves at `http://localhost:8080`, realm `login-app-with-tidecloak`. A
first-run provisioning script is provided:

```bash
# PowerShell
./scripts/init-tidecloak.ps1
```

Confirm readiness: `http://localhost:8080/health/ready` returns 200. (The script errors if a
`tidecloak` container already exists — check `docker ps -a` first.)

## Run the app

```bash
npm run dev     # Next.js dev server on http://localhost:3000
```

Open `http://localhost:3000`, click login, and complete the Tide enclave login.

### Database behaviour

The SQLite database at `data/app.db` is **auto-created and seeded on first use** (item catalogue,
starting currency). It is **gitignored** (along with its `-shm`/`-wal` sidecars). To reset local state,
stop the app and delete `data/app.db*`.

## Login flow

Login uses TideCloak OIDC via the `tidebrowser` flow with DPoP-bound (`strict`, `ES256`) tokens; the
callback is handled at `/auth/redirect`. Every protected API route re-verifies the JWT server-side
(local JWKS, issuer + `azp`, and asserts the DPoP `cnf.jkt` binding). Identity is the verified `vuid`
only — client-supplied `vuid`/owner/buyer/seller fields are ignored.

## The `_tide_dob.*` voucher roles (governed grant)

The private note (`/account`) uses Tide self-encryption with tag `dob`, which Tide gates on the roles
`_tide_dob.selfencrypt` / `_tide_dob.selfdecrypt`. Granting these is a **governed Tide IGA/QEA change**,
not a direct admin write: `POST /api/admin/private-note-role` initiates a change request (allowlisted to
exactly those two roles), which must then be **approved and committed in the admin browser enclave**
before the role appears in the user's token. This is the Task 11 demonstration. Encrypt-on-save works
with `selfencrypt`; decrypt-on-read requires `selfdecrypt`.

## Security test suite

A consolidated, repeatable server-side security suite lives in `tests/security/`:

```bash
npm run test:security   # expect 119/119 assertions, exit 0
```

It drives the real route handlers/repositories against a fixture Ed25519 adapter and a throwaway temp
DB (never `data/app.db`, never OwnershipSpike/Forseti/Tide config). The full matrix is in
`docs/SECURITY-TEST-PLAN.md`.

## Typecheck and build

```bash
npm run typecheck   # tsc --noEmit
npm run build       # next build --webpack
```

## Documentation

- `docs/LEARNINGS.md` — living technical record (dated, labelled `[Confirmed]/[Investigation]/…`).
- `docs/SYSTEM-ARCHITECTURE.md` — the three-layer architecture and implemented API surface.
- `docs/SECURITY-TEST-PLAN.md` — the security test matrix (groups A–I) and the live/headless/limitation
  boundaries.
- `docs/HANDOFF-TEST-PLAN.md` — step-by-step manual test plan for a new developer.
- `docs/PROGRESS.md` — resume-from-here checkpoint and per-task status.
- `docs/DEVELOPMENT-BACKLOG.md` — backlog and delivery status.
