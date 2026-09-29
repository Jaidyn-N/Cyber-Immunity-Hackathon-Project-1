# Requirements Document

## Introduction

This document defines the requirements for the working beta of the Tide-protected gaming marketplace.
It consolidates the **existing project scope** (original PoC functionality and original Tide security
requirements) with the newly-prioritised beta feature set. It does not remove or replace any previously
defined requirement; where a requirement cannot be implemented yet, it is retained and marked **Blocked**.

Source-of-truth documents: `docs/SYSTEM-ARCHITECTURE.md` (three-layer architecture — A: app/DB,
B: TideCloak auth, C: Tide ownership authority), `docs/DEVELOPMENT-BACKLOG.md`, `docs/LEARNINGS.md`
(confirmed Tide ownership-signing and deny-path results; current Player B / transfer blocker), and the
existing gaming-marketplace PoC user stories and success criteria.

Requirements are grouped into three clearly separated categories, indicated in each requirement title
and via a **Category** and **Status** line:

- **Category 1 — Core Beta Functionality (Implementing Now)** — Layer A + Layer B identity.
- **Category 2 — Tide Security Functionality (In Scope)** — Layer B + Tide-protected sensitive data.
- **Category 3 — Tide Ownership Authority (Blocked / Unproven)** — Layer C transfer/supersession.

**Status legend:** `[Implementing now]`, `[In scope — Tide security]`, `[Blocked]`.

### Confirmed Tide status carried in from `docs/LEARNINGS.md` (do not regress)

- [Confirmed] An authenticated `vuid` can be bound to an item via the existing `OwnershipSpike` policy;
  the ORKs produce a threshold-signed statement verifiable against the realm VVK (TEST 1 / spike).
- [Confirmed] An unauthorised VUID cannot sign for another VUID — all 20 ORKs reject at PreSign (deny-path).
- [Confirmed] TideCloak login → dashboard works; DPoP strict/ES256 is live; `vuid` present in token.
- [Blocked] Second-player (Player B) enrolment is blocked by an upstream ORK Fabric outage
  (`TidecloakSessionStartTokenSign` 500s); Tide-backed transfer/supersession cannot be exercised yet.
- [Constraint] The `OwnershipSpike` contract/policy MUST remain untouched. It provides owner-bound
  signing authority but NOT revocation/supersession by design.

### Architectural constraints (apply to every requirement)

- **Layer separation is mandatory.** Layer A (application/database ownership records) MUST be kept
  distinct from Layer C (Tide VVK-verifiable ownership authority). A Layer A DB ownership change MUST
  NOT be represented, labelled, logged, or reported as proof of Tide-backed ownership transfer.
- **Preserve existing Tide integration.** TideCloak authentication, DPoP (`strict`, `ES256`), the
  `/auth/redirect` callback, the SWE/CSP wiring in `next.config.ts`, and `data/tidecloak.json` as the
  single config source MUST continue to work unchanged.
- **No fabrication.** Blocked Tide ownership functionality MUST NOT be faked, stubbed as if working, or
  worked around by weakening the ownership model or creating fake Tide identities.

## Glossary

- **vuid** — the 64-hex Tide user identifier (`DokenDto.UserId`); the stable player key. Distinct from OIDC `sub`.
- **Layer A** — normal application/database functionality and application-level ownership records.
- **Layer B** — TideCloak authentication, DPoP, RBAC (identity).
- **Layer C** — Tide ownership authority: VVK-verifiable, threshold-signed ownership statements.
- **OwnershipSpike** — the existing, deployed Forseti policy binding an item to an owner `vuid`. Untouched.
- **Application-level (temporary) transfer** — a Layer A DB ownership change used so the beta flow can be
  demonstrated; explicitly NOT Tide-backed transfer.
- **Item instance** — a specific owned unit of a cosmetic item template.
- **Shop rotation** — the automatically/randomly changing set of currently purchasable items.
- **Simulated currency** — in-game currency only; no real money.

## Requirements

### Requirement 1: Player authentication and roles

**Category:** 1 — Core Beta. **Status:** [Implementing now]

**User Story:** As a player, I want to register and log in through TideCloak, so that I have an
authenticated identity and the appropriate role.

#### Acceptance Criteria
1. WHEN a visitor logs in via the existing TideCloak flow THEN the system SHALL authenticate them and establish a session with a non-empty `vuid`.
2. WHEN a player is authenticated THEN the system SHALL use their Tide `vuid` as the stable player identifier for all application data.
3. WHEN roles are evaluated THEN the system SHALL support at least a basic `player` role and an `admin` role, distinct from any `_tide_*` system roles.
4. WHEN an unauthenticated request reaches a protected API or page THEN the system SHALL deny access server-side, not merely hide UI.

### Requirement 2: Player profile / account

**Category:** 1 — Core Beta. **Status:** [Implementing now]

**User Story:** As a player, I want a basic profile/account, so that my identity, currency balance and
equipped state are associated with me.

#### Acceptance Criteria
1. WHEN a player first authenticates THEN the system SHALL create or load a player record keyed by `vuid`, including a display name and a simulated-currency balance.
2. WHEN a player views their account THEN the system SHALL show their basic profile info, currency balance, and currently equipped item.
3. WHEN profile fields are collected THEN the system SHALL NOT surface the raw Keycloak "Update Account Information" page; collection is in-app.

### Requirement 3: Persistent inventory

**Category:** 1 — Core Beta. **Status:** [Implementing now]

**User Story:** As a player, I want a persistent inventory, so that items I own remain mine across sessions.

#### Acceptance Criteria
1. WHEN a player owns one or more items THEN the system SHALL persist those item instances in a datastore keyed to the player''s `vuid`.
2. WHEN a player views their inventory THEN the system SHALL list only the item instances they currently own at the application level.
3. WHEN a player views an item THEN the system SHALL show basic item details: name, type/category, rarity, and whether it is equipped.
4. WHEN inventory is displayed THEN the system SHALL clearly distinguish items the player owns from items they do not own.
5. WHEN the session ends and the player logs in again THEN the system SHALL still show the same owned items (persistence, not session-only state).

### Requirement 4: Equipping and basic avatar customisation

**Category:** 1 — Core Beta. **Status:** [Implementing now]

**User Story:** As a player, I want to equip cosmetic items I own, so that my avatar reflects my choices.

#### Acceptance Criteria
1. WHEN a player equips an item THEN the system SHALL verify server-side that the player owns that item instance before applying the change.
2. WHEN a player equips an owned item THEN the system SHALL update the player''s equipped state and persist it.
3. WHEN a player views their avatar/character THEN the system SHALL display the currently equipped item; a simple representation is acceptable and detailed artwork is out of scope.
4. WHEN a player attempts to equip an item they do not own THEN the system SHALL reject the request server-side and make no change.
5. WHEN a player selects among owned items THEN the system SHALL allow changing the equipped item (basic avatar customisation).

### Requirement 5: Limited shop with automatic rotation

**Category:** 1 — Core Beta. **Status:** [Implementing now]

**User Story:** As a player, I want a limited-time shop that rotates automatically, so that only some
cosmetic items are available at any time.

#### Acceptance Criteria
1. WHEN the shop is viewed THEN the system SHALL present a limited selection of cosmetic items currently available for purchase.
2. WHEN shop availability is determined THEN the system SHALL rotate the available selection automatically on a time window and/or randomised basis, WITHOUT requiring an administrator to hand-pick each item.
3. WHEN an item is not part of the current shop rotation THEN the system SHALL NOT allow it to be purchased directly from the shop.
4. WHEN the shop rotation changes THEN items previously purchased by players SHALL remain owned by those players; leaving the shop does not remove ownership.

### Requirement 6: Simulated currency and purchasing

**Category:** 1 — Core Beta. **Status:** [Implementing now]

**User Story:** As a player, I want to buy available shop items with simulated currency, so that I can
acquire cosmetics without real payment.

#### Acceptance Criteria
1. WHEN a player purchases an available shop item AND has sufficient simulated currency THEN the system SHALL deduct the price, add an item instance to the player''s inventory, and mark it owned by that player at the application level.
2. WHEN a player has insufficient simulated currency THEN the system SHALL reject the purchase and make no change to inventory or balance.
3. WHEN a player attempts to purchase an item not in the current rotation THEN the system SHALL reject the purchase.
4. WHEN a purchase succeeds THEN the system SHALL record a purchase record with buyer `vuid`, item, price, and timestamp.
5. The system SHALL NOT process real payments or real currency; only simulated in-game currency is used.

### Requirement 7: Player-to-player marketplace

**Category:** 1 — Core Beta. **Status:** [Implementing now]

**User Story:** As a player, I want to list items I own on a marketplace and obtain items others list,
so that limited items can be exchanged between players after they leave the shop.

#### Acceptance Criteria
1. WHEN a player lists an item THEN the system SHALL verify server-side that the player currently owns that item instance and that it is eligible to be listed, before creating the listing.
2. WHEN a player attempts to list an item they do not own THEN the system SHALL reject the listing and create nothing.
3. WHEN the marketplace is viewed THEN the system SHALL show active listings with basic item and price information.
4. WHEN a listed item is a limited item no longer available in the shop THEN the system SHALL still allow it to be exchanged between players via the marketplace, preserving the original user-story intent.
5. WHEN another player obtains a listed item AND has sufficient simulated currency THEN the system SHALL change the application-level Layer A ownership record to the buyer, settle the listing, and adjust balances.
6. WHEN a marketplace transaction succeeds THEN the system SHALL record a marketplace transaction record with seller `vuid`, buyer `vuid`, item, price, and timestamp.
7. WHEN the application-level ownership change in criterion 5 occurs THEN the system SHALL label it a temporary application-level transfer and SHALL NOT represent it as Tide-backed ownership transfer.

### Requirement 8: Ownership, purchase and transaction records

**Category:** 1 — Core Beta. **Status:** [Implementing now]

**User Story:** As the system, I need basic ownership, purchase and transaction records, so that the
application has an auditable history.

#### Acceptance Criteria
1. WHEN ownership changes via purchase or marketplace THEN the system SHALL maintain a basic application-level ownership record for each item instance.
2. WHEN a shop purchase completes THEN the system SHALL persist a purchase record.
3. WHEN a marketplace exchange completes THEN the system SHALL persist a marketplace transaction record.
4. WHERE an item instance was minted with a Tide ownership statement THEN the system SHALL store that statement alongside the item WITHOUT conflating it with the Layer A ownership record.

### Requirement 9: TideCloak identity, DPoP and RBAC preserved

**Category:** 2 — Tide Security. **Status:** [In scope — Tide security]

**User Story:** As the system, I want to keep TideCloak as the identity layer with the existing DPoP and
RBAC, so that authentication and authorization remain Tide-backed and unchanged.

#### Acceptance Criteria
1. The system SHALL continue to use TideCloak authentication as the sole identity layer, with no other auth provider.
2. The system SHALL preserve the existing DPoP configuration (`strict`, `ES256`) and the SWE/relay/CSP wiring unchanged.
3. WHEN a protected API is called THEN the system SHALL verify the Tide JWT server-side against the embedded JWKS (local, never remote), assert the `cnf.jkt` DPoP binding, and enforce roles server-side.
4. WHEN client-side role checks are used THEN the system SHALL treat them as UI gating only, never as the authorization boundary.

### Requirement 10: Data classification — public vs sensitive

**Category:** 2 — Tide Security. **Status:** [In scope — Tide security]

**User Story:** As the system, I want to classify which application data is public versus sensitive, so
that protection is applied deliberately.

#### Acceptance Criteria
1. The system SHALL define and document a classification of application data as public (e.g. item catalogue, shop rotation, public listings) versus sensitive (selected private player/transaction information).
2. The classification SHALL identify at least one concrete sensitive field to protect for the beta; the exact field(s) are finalised in design.

### Requirement 11: Tide-protected sensitive data

**Category:** 2 — Tide Security. **Status:** [In scope — Tide security]

**User Story:** As a player, I want my selected sensitive information protected by Tide, so that it is not
exposed as plaintext in the backend.

#### Acceptance Criteria
1. WHEN a selected sensitive field is stored THEN the system SHALL protect it using Tide self-encryption (`doEncrypt`/`doDecrypt`) so it is not stored as readable plaintext.
2. WHEN application storage/backend data is inspected directly THEN the protected field SHALL NOT be readable plaintext.
3. WHEN the owning player accesses the field through their authorised Tide session THEN the system SHALL return the decrypted plaintext to that player.

### Requirement 12: Authorised access and player isolation

**Category:** 2 — Tide Security. **Status:** [In scope — Tide security]

**User Story:** As a player, I want only myself to read my protected private information, so that other
players cannot access it.

#### Acceptance Criteria
1. WHEN player X''s protected field is requested by player X''s authorised Tide session THEN the system SHALL allow decryption/access.
2. WHEN player Y attempts to read player X''s protected private information THEN the system SHALL prevent access, because self-encryption is identity-bound and another player''s session cannot decrypt.
3. WHEN player isolation is validated THEN the system SHALL make it demonstrable that X can read and Y cannot; the full two-player demonstration depends on Player B availability (see Requirement 16).

### Requirement 13: Tide / QEA governance for sensitive admin changes

**Category:** 2 — Tide Security. **Status:** [In scope — Tide security]

**User Story:** As the system, I want selected security-sensitive administrative changes to be protected
by Tide governance, so that no single admin can make them unilaterally.

#### Acceptance Criteria
1. The system SHALL identify at least one class of security-sensitive administrative change (e.g. role assignment or policy change) that is governed by Tide IGA/QEA.
2. WHEN such a governed admin change is made on the IGA-enabled realm THEN it SHALL require the IGA change-request → approval → commit flow, not an immediate unilateral write.
3. The system SHALL document which admin changes are governed and rely on the existing realm IGA configuration rather than introducing a new governed policy.

### Requirement 14: Player B receives Tide-backed ownership authority

**Category:** 3 — Tide Ownership Authority. **Status:** [Blocked]

**User Story:** As a second player (B), I want to obtain Tide-backed ownership authority for an item, so
that ownership is cryptographically bound to me.

#### Acceptance Criteria
1. WHEN Player B is enrolled with a Tide-linked `vuid` THEN B SHALL be able to obtain a VVK-verifiable ownership statement for an item bound to B. **[Blocked — Player B enrolment fails: ORK `TidecloakSessionStartTokenSign` 500s. MUST NOT be faked.]**

### Requirement 15: Tide-backed ownership transfer

**Category:** 3 — Tide Ownership Authority. **Status:** [Blocked]

**User Story:** As a player, I want ownership to transfer to another player through Tide, so that the new
owner holds cryptographic authority.

#### Acceptance Criteria
1. WHEN an item is transferred from A to B THEN a new VVK-verifiable ownership statement SHALL bind the item to B''s `vuid`. **[Blocked — depends on Requirement 14; no new Forseti contract to be created now.]**

### Requirement 16: Supersession / revocation of previous owner authority

**Category:** 3 — Tide Ownership Authority. **Status:** [Blocked]

**User Story:** As the system, I want a previous owner''s Tide authority to become non-current after
transfer, so that "latest ownership statement wins".

#### Acceptance Criteria
1. WHEN ownership transfers to B THEN A''s previous Tide ownership authority SHALL no longer be exercisable. **[Blocked AND design-limited — the existing `OwnershipSpike` contract signs standalone statements with no version/nonce/revocation, so A''s prior signature stays cryptographically valid. Supersession would require app-side current-owner state and/or a sequence-aware contract, deliberately NOT built now.]**

### Requirement 17: Category 3 boundary and non-fabrication guard

**Category:** 3 — Tide Ownership Authority. **Status:** [Implementing now — labelling/guard only]

**User Story:** As the project owner, I want the beta''s ownership movements clearly bounded, so that no
Layer A change is mistaken for Tide-backed transfer.

#### Acceptance Criteria
1. WHEN the beta performs the marketplace ownership change (Requirement 7, criterion 5) THEN that Layer A change SHALL be the ONLY ownership movement in the beta and SHALL be labelled temporary/application-level.
2. The system SHALL NOT describe or report the Layer A change as satisfying Requirements 14, 15, or 16.
3. The system SHALL NOT modify the existing `OwnershipSpike` policy; if an implementation dependency appears to require it, work SHALL stop and seek approval first.

## Non-Goals (out of scope for this beta)

- Real payment processing, real currency, cryptocurrency, wallets, seed phrases, user-managed private keys.
- Detailed item artwork/design; complex character customisation.
- Admin-managed hand-picked shop selection (rotation is automatic/randomised).
- Ownership transfer via a new Forseti contract; supersession/revocation; a new Tide ownership contract.
- Any change to the existing `OwnershipSpike` policy unless technically unavoidable (if unavoidable: stop and get approval first).
- Working around the second-player authentication blocker.

## Success Condition (beta demo flow)

Login → View available limited items → Purchase an item with simulated currency → Item appears in
inventory → Equip the item → List an eligible owned item on the marketplace → View marketplace listing.
A second-player marketplace transaction MAY remain incomplete (Category 3 blocked) and MUST NOT be faked.
