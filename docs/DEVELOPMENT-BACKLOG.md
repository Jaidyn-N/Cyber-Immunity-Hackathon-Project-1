# Development Backlog

Actionable backlog for the Tide-protected gaming marketplace PoC. Derived from `docs/LEARNINGS.md`
and `docs/SYSTEM-ARCHITECTURE.md`. Prioritised to **prove the core ownership flow before building
marketplace breadth**.

## Priority key

- **P0 — Critical path / Tide ownership proof.** Directly proves the PoC thesis. Do these first.
- **P1 — Essential PoC.** Required for a coherent end-to-end demo.
- **P2 — Supporting features.** Rounds out the marketplace.
- **P3 — Polish.** Nice-to-have.

Tasks marked **[TIDE-CRITICAL]** are the ones that specifically prove the Tide ownership concept
(tamper resistance + authority transfer). If only these succeed, the PoC has still answered its
research questions.

## Core ownership flow this backlog must prove

Player A authenticates -> A obtains an item -> item owned by A -> A lists it -> B obtains it ->
ownership/authority transfers -> A can no longer exercise ownership -> B can exercise ownership.

---

## Backlog

| ID | Task | Priority | Dependency | Purpose / Expected Outcome |
|----|------|----------|-----------|----------------------------|
| ENV-1 | Reconcile realm config drift: confirm `data/tidecloak.json` (`login-app-with-tidecloak`) is the live realm; mark/fix stale `tidecloak/realm.json` + `.env.example` (`nextjs-auth-demo`). | P0 | — | Single source of truth. Removes ambiguity before any provisioning. |
| ENV-2 | Verify Tide environment is provisioned for signing: realm licensed (`setUpTideRealm`), IGA enabled (`jwk` present is evidence), admin user with `tide-realm-admin` + linked Tide account. | P0 | ENV-1 | Confirms the realm can deploy a Forseti policy. Resolves LEARNINGS assumption. |
| ENV-3 | Verify the `vuid` protocol mapper is present and a real access token carries a non-empty `vuid`. | P0 | ENV-2 | The ownership contract binds to `vuid`; a missing mapper is a silent, total failure. |
| AUTH-1 | Implement server-side auth layer `lib/auth/` (`loadTideConfig`, `verifyTideJWT` with local JWKS, `withAuth`/`withRole`, assert `cnf.jkt`). Reuse the existing `onboarding-and-rbac` spec. | P0 | ENV-1 | Real server-side authorization (I-03/I-04/I-12). Foundation for every protected write. |
| AUTH-2 | Add `admin` + `user` (or `player`) realm roles; assign via IGA; gate an admin/API surface server-side; client `hasRealmRole` for UI only. | P0 | AUTH-1, ENV-2 | RBAC enforced server-side. Establishes identity->authority link. |
| DATA-1 | Introduce persistence + domain model: players (linked to `vuid`), characters, cosmetic items (template), item_instances, inventory. Choose DB engine. | P0 | AUTH-1 | Minimal domain the ownership flow needs. |
| BASE-1 | Insecure ownership baseline: item_instances have a plain DB `owner` column; equip/list/transfer act on that column only (no crypto). | P0 | DATA-1 | The deliberate "before" control case for the PoC comparison. |
| BASE-2 | **[TIDE-CRITICAL]** Demonstrate DB ownership tampering: editing the `owner` column alone transfers/steals the item. Document as a control result. | P0 | BASE-1 | Proves the problem exists. The baseline the Tide layer must defeat. |
| TIDE-1 | **[TIDE-CRITICAL]** Signing spike (isolated): confirm `@tidecloak/nextjs@0.14.20` can reach `IAMService._tc.createTideRequest`/`executeSignRequest` with `Models` from `@tideorg/js` and `PolicySignRequest` from `heimdall-tide` under current webpack config. | P0 | ENV-2 | De-risks the whole Tide layer before contract work. Resolves LEARNINGS assumption. |
| TIDE-2 | **[TIDE-CRITICAL]** Author + locally compile the ownership Forseti contract (binds item_instance -> owner `vuid`; capture-in-ValidateData, compare-in-ValidateExecutor, fail closed; role check). Deploy + sign the policy (one enclave approval). | P0 | TIDE-1, ENV-3 | The enforcement point. Contract lives on the ORKs, not the app. Compile locally first (edits are expensive). |
| TIDE-3 | **[TIDE-CRITICAL]** Mint an ownership attestation on item acquisition: browser builds request, ORKs threshold-sign, store the signed attestation with the item_instance. | P0 | TIDE-2, DATA-1 | Establishes cryptographic ownership authority for an item. |
| TIDE-4 | **[TIDE-CRITICAL]** Verify ownership proofs server-side: check the stored attestation against the realm VVK (from adapter `jwk`, not OIDC JWKS) and that bound `vuid` == acting user `vuid`; verify-on-read + DB cross-check. | P0 | TIDE-3 | Ownership authority is checkable and tamper-evident. |
| TIDE-5 | **[TIDE-CRITICAL]** Gate exercise (equip/list) on a valid ownership proof; re-run BASE-2 tamper test and confirm a tampered `owner` row now fails to grant authority. | P0 | TIDE-4 | **Answers research question 1:** DB tampering alone cannot steal/exercise ownership. |
| TIDE-6 | **[TIDE-CRITICAL]** Legitimate transfer: marketplace purchase mints a new attestation binding the item to the buyer''s `vuid`, superseding the prior one (app treats only the latest VVK-signed attestation as authoritative). | P0 | TIDE-5 | The authority-transfer mechanism. |
| TIDE-7 | **[TIDE-CRITICAL]** Verify previous owner loses authority: after transfer, seller''s `vuid` no longer matches; seller cannot equip/list. Negative test. | P0 | TIDE-6 | **Answers research question 2 (part 1):** previous owner can no longer exercise ownership. |
| TIDE-8 | **[TIDE-CRITICAL]** Verify new owner gains authority: buyer can equip/list; buyer''s proof verifies. | P0 | TIDE-6 | **Answers research question 2 (part 2):** new owner gains exercisable authority. |
| SHOP-1 | Official shop UI + API: list limited/time-boxed cosmetic items; purchase mints an item_instance (and, once TIDE-3 lands, an ownership attestation). | P1 | DATA-1, AUTH-2 | Entry point for a player to obtain items. Built around the proven model. |
| INV-1 | Inventory + equip UI: view owned instances, equip to a character; equip gated by ownership proof once TIDE-5 lands. | P1 | DATA-1, SHOP-1 | Players can hold and use items. |
| MKT-1 | Secondary marketplace UI + API: list an eligible owned instance, another player purchases; wires into TIDE-6 transfer. | P1 | INV-1, TIDE-6 | The player-to-player transfer surface. |
| ONB-1 | In-app onboarding: collect first/last name after registration; suppress the raw Keycloak "Update Account Information" page (existing `onboarding-and-rbac` spec). | P1 | AUTH-1 | Coherent first-run UX. Prerequisite work already spec''d. |
| TEST-1 | Negative / security test suite: tampered attestation denied; superseded owner refused; wrong-`vuid` proof refused; replay/expired proof refused; standalone VVK verifier. | P1 | TIDE-5, TIDE-7 | "A property that never failed when it should is not known to work." Proves the guarantees hold. |
| MKT-2 | Listing eligibility rules, price/currency, transaction history views. | P2 | MKT-1 | Marketplace completeness. |
| SHOP-2 | Limited-drop mechanics (time windows, stock caps, per-player limits). | P2 | SHOP-1 | Shop realism. |
| CHAR-1 | Character/avatar rendering of equipped cosmetics. | P2 | INV-1 | Visible payoff of equip. |
| POL-1 | UI polish, empty/loading/error states, branding of the Tide enclave. | P3 | SHOP-1, INV-1, MKT-1 | Presentation. |
| DOC-1 | Keep `docs/LEARNINGS.md` updated as TIDE-1..8 resolve assumptions/investigations into confirmed/refuted. | P1 (ongoing) | — | Living document requirement. |

---

## Critical path (dependency order)

The order below follows the requested critical path, adjusted where the technical investigation found a
better dependency order (changes explained after).

1. **ENV-1 -> ENV-2 -> ENV-3** — verify Tide environment/config and `vuid` mapper.
2. **AUTH-1 -> AUTH-2** — real server-side authentication/authorization.
3. **DATA-1** — minimal persistence/domain model.
4. **BASE-1** — insecure ownership baseline.
5. **BASE-2** — demonstrate DB ownership tampering (control result).
6. **TIDE-1 -> TIDE-2 -> TIDE-3** — prototype Tide-backed ownership authority (spike, contract, mint).
7. **TIDE-4** — verify ownership proofs.
8. **TIDE-5** — prevent DB tampering from granting ownership (**research question 1**).
9. **TIDE-6** — legitimate ownership transfer.
10. **TIDE-7** — previous owner loses authority (**research question 2a**).
11. **TIDE-8** — new owner gains authority (**research question 2b**).
12. **SHOP-1 -> INV-1 -> MKT-1** — build the shop/marketplace UI around the proven security model.
13. **TEST-1** — negative/security tests.
14. **MKT-2 / SHOP-2 / CHAR-1 / POL-1** — supporting features and polish.

### Deviations from the suggested order (explained)

- **Added ENV-3 (`vuid` mapper check) into step 1.** The Tide MCP flags a missing `vuid` mapper as a
  silent, total failure of the ownership contract. Verifying it up front is cheap and prevents a
  confusing failure deep in step 6.
- **Split "prototype Tide authority" into TIDE-1 (signing spike) before TIDE-2 (contract).** The
  browser-only signing path and the `@tideorg/js` / `heimdall-tide` import boundaries are the biggest
  technical unknowns, and Forseti contract edits are expensive (each change = new SHA-512 = fresh
  enclave approval). Proving the SDK plumbing in isolation first de-risks the costly contract work.
- **Everything else follows the requested critical path.**

---

## Mapping to user stories and success criteria

| PoC user story / success criterion | Backlog tasks |
|-----------------------------------|---------------|
| A player can authenticate | (existing auth) + AUTH-1 |
| A player can obtain a limited-shop item; it enters their inventory | SHOP-1, INV-1, TIDE-3 |
| A player can equip an owned item | INV-1, TIDE-5, CHAR-1 |
| A player can list an eligible owned item on the secondary market | MKT-1 |
| Another player can obtain a listed item; ownership transfers | MKT-1, TIDE-6 |
| The previous owner can no longer exercise ownership | TIDE-7, TEST-1 |
| The new owner can exercise ownership | TIDE-8 |
| **Tide protects ownership authority: editing the DB owner alone cannot steal/exercise ownership** | BASE-2, TIDE-2, TIDE-4, TIDE-5, TEST-1 |
| **A legitimate transaction transfers the authority to the new owner** | TIDE-6, TIDE-7, TIDE-8, TEST-1 |

---

## Related documents

- `docs/LEARNINGS.md` — what was discovered.
- `docs/SYSTEM-ARCHITECTURE.md` — what the proposed system looks like.
