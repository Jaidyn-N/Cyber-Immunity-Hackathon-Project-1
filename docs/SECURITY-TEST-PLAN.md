# Security Test Plan — Marketplace Beta (Task 17)

Consolidated, **repeatable** security/negative-case evidence for the Marketplace Beta. This replaces
the throwaway Task 8–16 validation harnesses with ONE persistent suite plus this documented matrix.

## How to run

```bash
npm run test:security
```

The suite lives at `tests/security/` and exercises the **real, unmodified** server/route/repository
layer against a fixture Ed25519 adapter (`CLIENT_ADAPTER`) and a throwaway OS temp DB (`APP_DB_PATH`).
It never touches `data/app.db`, `OwnershipSpike`, Forseti, the attestation code, `providers.tsx`,
`tidecloak.json`, or the schema, and no security check is weakened to make a test pass. The suite exits
non-zero if any assertion fails; it cleans up its temp DB on exit.

- `tests/security/harness.mjs` — fixture JWKS + `CLIENT_ADAPTER`; mints DPoP-bound fixture JWTs for
  player A / player B / admin (synthetic 64-hex vuids, never a real operator vuid or secret); temp-DB
  bootstrap + seed helpers; the `name | setup | action | expected | actual | PASS/FAIL` reporter.
- `tests/security/security-suite.mjs` — the consolidated suite (groups A–I) + the summary matrix.
- `tests/security/resolve-hook.mjs` — test-only module loader mapping the `@/` alias and extensionless
  TS imports so the production source runs under `node --experimental-strip-types` (the Tide SDK does
  not load in Node, so only the server layer is exercised headlessly).

---

## Evidence boundary (READ THIS FIRST)

Results fall into **three distinct categories** — do not conflate them:

### (1) AUTOMATED / HEADLESS — this suite
Groups **A–H** below. These run on every `npm run test:security` against the real server/route/repo
code. **Latest run: 119/119 assertions passed, exit 0.**

### (2) LIVE BROWSER evidence — previously verified, NOT re-run here
The Tide browser SDK does not load in Node, so these were verified in the running app and are
*referenced*, never re-executed or re-claimed headlessly:
- **Task 11 — live QEA change request** (CR `1957ce7d…`), approved + committed in the admin enclave on
  2026-10-01; `_tide_dob.selfencrypt` granted. (See group H for the headless app-wiring that backs it.)
- **Task 12 — live Tide self-encrypt/decrypt** of the private note: without `_tide_dob.selfdecrypt` the
  enclave denies; with it, decrypt succeeds — client-side only; the server only ever sees ciphertext.
- **Task 16 — live end-to-end flow** incl. a REAL two-player marketplace obtain (A→B), 2026-10-03.

### (3) DOCUMENTED ARCHITECTURAL LIMITATIONS — explicitly NOT demonstrated
- **Four-eyes / two-person approval: NOT demonstrated.** The live QEA threshold is **1**, so a single
  approver commits a change request. Multi-approver quorum was never exercised.
- **OwnershipSpike supersession / revocation: NOT demonstrated.** Rebinding to a second owner is shown,
  but A's prior signature still verifies after B's — there is no revocation of the old attestation.
- **Marketplace "obtain" is Layer A, NOT Tide-backed.** It moves only `item_instance.owner_vuid` and
  writes `transfer_kind='application-level-temporary'`; it never writes `tide_ownership_attestation`
  (asserted headlessly in group E: 0 Layer C rows after an obtain).

---

## Matrix

Legend: **exp** = expected, **act** = actual (from the latest run). Every negative case also asserts
the target's state is **unchanged**.

### A. Authentication — all protected routes fail closed (60 assertions, 60 PASS)
Every protected route (`me`, `inventory`, `inventory/equip`, `shop`, `shop/purchase`, `marketplace`,
`marketplace/list`, `marketplace/list/[id]`, `marketplace/obtain`, `account/private-note`,
`admin/summary`, `admin/private-note-role`) is called four ways:

| name | setup | action | expected | actual | result |
|---|---|---|---|---|---|
| each protected route | no Authorization header | call route | 401 | 401 | PASS |
| each protected route | token missing `cnf.jkt` (DPoP unbound) | call route | 401 | 401 | PASS |
| each protected route | expired token | call route | 401 | 401 | PASS |
| each protected route | invalid signature (untrusted key) | call route | 401 | 401 | PASS |

### B. Player isolation — identity from JWT only (8 assertions, 8 PASS) — Task 13 core subset
> Task 13 originally recorded **64/64** across a wider two-VUID matrix. This suite re-exercises the
> **core cross-player subset** (8 assertions); it does not reproduce the full 64 and does not claim to.

| name | setup | action | expected | actual | result |
|---|---|---|---|---|---|
| me ignores query vuid | A authed, `?vuid=B` | GET /api/me | A's vuid | A's vuid | PASS |
| inventory excludes B's item | A authed; B owns item | GET /api/inventory | item absent | absent | PASS |
| private-note GET is self-only | A authed; B has a note | GET private-note | null (A's own) | null | PASS |
| private-note PUT can't target B | A PUT body `vuid=B` | PUT private-note | B ciphertext unchanged | unchanged | PASS |
| A can't equip B's item | A POST equip B's item | POST equip | 403 | 403 | PASS |
| A can't list B's item | A POST list B's item (+ body ownerVuid=B) | POST marketplace/list | 403 | 403 | PASS |
| B owner unchanged | after A's spoof attempts | read owner | B | B | PASS |
| B player row unchanged | after A's spoof attempts | snapshot B | identical | identical | PASS |

### C. Inventory / equip (6 assertions, 6 PASS)
| name | setup | action | expected | actual | result |
|---|---|---|---|---|---|
| equip owned item | A owns item | POST equip own | 200 | 200 | PASS |
| equipped persisted | after equip | read equipped | item id | item id | PASS |
| equip other's item | A targets B's item | POST equip not-owned | 403 | 403 | PASS |
| A equipped unchanged | after 403 | read A equipped | A's item | A's item | PASS |
| B equipped unchanged | after A's 403 | read B equipped | B's item | B's item | PASS |
| equip missing item | unknown instanceId | POST equip | 404 | 404 | PASS |

### D. Private note — opaque ciphertext, self-only, no server crypto (4 assertions, 4 PASS)
| name | setup | action | expected | actual | result |
|---|---|---|---|---|---|
| ciphertext stored verbatim | A PUTs opaque blob | GET returns same bytes | identical | identical | PASS |
| A cannot GET B's ciphertext | B has a distinct note | A GET private-note | A's own, not B's | A's own | PASS |
| PUT body vuid ignored | A PUT body `vuid=B` | B ciphertext unchanged | unchanged | unchanged | PASS |
| no server-side crypto/governance | scan route **code** (comments stripped) | grep forbidden symbols | none | none | PASS |

> **Referenced LIVE result (Task 12, browser — NOT headless):** without `_tide_dob.selfdecrypt` the
> Tide enclave denies decryption; with it, decryption succeeds — client-side only. Previously verified.

### E. Marketplace — Layer A application-level temporary transfer, NOT Tide-backed (22 assertions, 22 PASS)
| name | setup | action | expected | actual | result |
|---|---|---|---|---|---|
| B lists own item | B owns tradable item | POST list | 200 | 200 | PASS |
| A can't list B's item | A targets B's item | POST list | 403 | 403 | PASS |
| A can't cancel B's listing | A targets B's listing | DELETE list/[id] | 403 | 403 | PASS |
| B's listing still active | after A's cancel attempt | read listing status | active | active | PASS |
| A obtains B's listing | A authed; spoofed buyer/seller/owner in body | POST obtain | 200 | 200 | PASS |
| ownership moved to A (buyer=JWT) | spoofed buyer=B ignored | read owner | A | A | PASS |
| buyer debited (A) | price 100 | read A balance | −100 | −100 | PASS |
| seller credited (B) | price 100 | read B balance | +100 | +100 | PASS |
| obtain writes NO Layer C row | Layer A/C boundary | count attestations | 0 | 0 | PASS |
| replay obtain rejected | listing already sold | POST obtain again | 409 | 409 | PASS |
| no second transfer on replay | after replay 409 | read owner | unchanged | unchanged | PASS |
| insufficient funds rejected | buyer balance < price | POST obtain | 402 | 402 | PASS |
| no partial debit on 402 | after 402 | read buyer balance | unchanged | unchanged | PASS |
| no credit to seller on 402 | after 402 | read seller balance | unchanged | unchanged | PASS |
| ownership unchanged on 402 | after 402 | read owner | unchanged | unchanged | PASS |
| listing still active on 402 | after 402 | read listing status | active | active | PASS |
| obtain cancelled listing | listing cancelled | POST obtain | 409 | 409 | PASS |
| forced fault injected | db.prepare spy throws at tx INSERT | run obtain | throws | throws | PASS |
| rollback: owner unchanged | after injected fault | read owner | unchanged | unchanged | PASS |
| rollback: buyer balance unchanged | after injected fault | read buyer balance | unchanged | unchanged | PASS |
| rollback: seller balance unchanged | after injected fault | read seller balance | unchanged | unchanged | PASS |
| rollback: listing still active | after injected fault | read listing status | active | active | PASS |

### F. Shop / purchase — server authoritative (8 assertions, 8 PASS)
| name | setup | action | expected | actual | result |
|---|---|---|---|---|---|
| purchase unknown offer | bogus offerId | POST purchase | 404 | 404 | PASS |
| purchase out-of-rotation | stale/unknown offer id | POST purchase | 404 | 404 | PASS |
| purchase insufficient funds | buyer balance 0 | POST purchase | 402 | 402 | PASS |
| no partial deduction | after 402 | read balance | unchanged | unchanged | PASS |
| no item minted on 402 | after 402 | count inventory | unchanged | unchanged | PASS |
| purchase success | funded; spoofed price/buyer in body | POST purchase | 200 | 200 | PASS |
| server price authoritative | client sent price=1 | check pricePaid | offer price | offer price | PASS |
| buyer=JWT not body | client sent buyer=B | check item owner | A (JWT) | A | PASS |

### G. Admin / RBAC — role from JWT only (6 assertions, 6 PASS)
| name | setup | action | expected | actual | result |
|---|---|---|---|---|---|
| admin no auth | no token | GET admin/summary | 401 | 401 | PASS |
| admin non-admin forbidden | player A (no admin role) | GET admin/summary | 403 | 403 | PASS |
| admin allowed | token has admin realm role | GET admin/summary | 200 | 200 | PASS |
| summary is aggregate-only | admin response body | scan for private fields | none | none | PASS |
| ?role=admin does not elevate | non-admin + `?role=admin` | GET admin/summary | 403 | 403 | PASS |
| spoofed admin flags ignored | non-admin body `isAdmin/admin/role_claim` | POST admin role route | 403 | 403 | PASS |

### H. QEA boundary — allowlist enforced before any governance call (5 assertions, 5 PASS)
IGA fetch seam stubbed via `_setFetchForTests`; no live call is made.

| name | setup | action | expected | actual | result |
|---|---|---|---|---|---|
| arbitrary role rejected | admin requests `role=admin` | POST role route | 422 | 422 | PASS |
| no governance call on reject | allowlist blocks first | check IGA fetch seam | never called | never called | PASS |
| escalation role rejected | admin requests `realm-management` | POST role route | 422 | 422 | PASS |
| allowlist is exactly the two roles | read exported constant | compare | `_tide_dob.selfdecrypt,_tide_dob.selfencrypt` | same | PASS |
| no approve/commit automation | scan igaAdmin **code** (comments stripped) | grep approve/commit | none | none | PASS |

> **Referenced LIVE result (Task 11, browser — NOT headless):** CR `1957ce7d…` was approved + committed
> in the enclave on 2026-10-01. **Threshold = 1**, so **four-eyes / two-person approval was NOT
> demonstrated.** Documented limitation — explicitly not claimed as proven.

### I. Ownership PoC boundary — DOCUMENTED evidence (not a headless test)
Preserved `OwnershipSpike` evidence from `docs/LEARNINGS.md` (2026-10-01). This group runs no code and
does not touch OwnershipSpike/Forseti.

| property | status |
|---|---|
| A→A attestation verifies | Demonstrated |
| B→B attestation verifies | Demonstrated |
| cross-VUID verification rejected | Demonstrated |
| rebinding to a second owner (Player B) | Demonstrated |
| supersession / revocation (A's old signature invalid after B's) | **NOT demonstrated** |

---

## Summary (latest run)

| group | assertions | pass | fail |
|---|---|---|---|
| A. Authentication | 60 | 60 | 0 |
| B. Player isolation (Task 13 core subset) | 8 | 8 | 0 |
| C. Inventory / equip | 6 | 6 | 0 |
| D. Private note | 4 | 4 | 0 |
| E. Marketplace | 22 | 22 | 0 |
| F. Shop / purchase | 8 | 8 | 0 |
| G. Admin / RBAC | 6 | 6 | 0 |
| H. QEA boundary | 5 | 5 | 0 |
| I. Ownership PoC boundary (documented) | 0 (documented) | — | — |
| **TOTAL (headless)** | **119** | **119** | **0** |

Exit code: **0**. `npm run typecheck` and `npm run build` are clean (the `tests/` directory is outside
the Next build and is not type-checked by `tsc`, which only compiles `.ts`/`.tsx`).
