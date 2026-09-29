-- Marketplace Beta — database schema (Layer A application state + Layer C Tide attestation store)
--
-- Source of truth: .kiro/specs/marketplace-beta/design.md (Data Models).
--
-- LAYER SEPARATION (non-negotiable):
--   * item_instance.owner_vuid   = LAYER A application-level ownership ONLY. NOT cryptographic proof.
--   * tide_ownership_attestation = LAYER C VVK-verifiable Tide ownership statement (storage/verify only).
-- The marketplace transfer updates ONLY Layer A (item_instance.owner_vuid) and MUST NEVER create,
-- modify, or fabricate a tide_ownership_attestation row. No Tide-backed transfer / supersession here.
--
-- Applied idempotently at startup by lib/db (Task 2). All statements use IF NOT EXISTS.
-- IDs are application-generated UUID strings (TEXT), not SQLite rowids, for clean future migration.
-- Timestamps are ISO-8601 UTC strings (TEXT).

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- LAYER A — application state
-- ---------------------------------------------------------------------------

-- Player: keyed by the Tide vuid (the identity boundary). display_name is PUBLIC (plaintext on
-- purpose, for contrast). private_note_ciphertext is SENSITIVE: a Tide self-encrypted blob, NEVER
-- plaintext (populated in Task 12; nullable until then).
CREATE TABLE IF NOT EXISTS player (
  vuid                    TEXT    PRIMARY KEY,
  display_name            TEXT    NOT NULL,
  currency_balance        INTEGER NOT NULL DEFAULT 0 CHECK (currency_balance >= 0),
  equipped_instance_id    TEXT    REFERENCES item_instance(id) ON DELETE SET NULL,
  private_note_ciphertext TEXT,   -- Tide self-encrypted; never plaintext
  created_at              TEXT    NOT NULL
);

-- Item template: the catalogue definition (PUBLIC). rarity is descriptive only (no economy mechanics).
-- tradable expresses marketplace eligibility criterion (b) from the design.
CREATE TABLE IF NOT EXISTS item_template (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  category    TEXT    NOT NULL,                       -- e.g. skin | accessory | cape
  rarity      TEXT    NOT NULL,                       -- descriptive label only
  base_price  INTEGER NOT NULL CHECK (base_price >= 0),
  tradable    INTEGER NOT NULL DEFAULT 1 CHECK (tradable IN (0, 1))
);

-- Item instance: a specific owned unit. owner_vuid is the LAYER A application ownership record ONLY.
CREATE TABLE IF NOT EXISTS item_instance (
  id           TEXT PRIMARY KEY,
  template_id  TEXT NOT NULL REFERENCES item_template(id) ON DELETE RESTRICT,
  owner_vuid   TEXT NOT NULL REFERENCES player(vuid)      ON DELETE RESTRICT, -- LAYER A ownership only
  acquired_via TEXT NOT NULL CHECK (acquired_via IN ('shop', 'marketplace')),
  acquired_at  TEXT NOT NULL
);

-- Shop offer: the automatically-rotating limited selection. An offer is purchasable only while active
-- and now is within [window_start, window_end).
CREATE TABLE IF NOT EXISTS shop_offer (
  id            TEXT    PRIMARY KEY,
  template_id   TEXT    NOT NULL REFERENCES item_template(id) ON DELETE RESTRICT,
  price         INTEGER NOT NULL CHECK (price >= 0),
  window_start  TEXT    NOT NULL,
  window_end    TEXT    NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

-- Purchase record: audit of shop purchases (Layer A).
CREATE TABLE IF NOT EXISTS purchase_record (
  id          TEXT    PRIMARY KEY,
  buyer_vuid  TEXT    NOT NULL REFERENCES player(vuid)         ON DELETE RESTRICT,
  template_id TEXT    NOT NULL REFERENCES item_template(id)    ON DELETE RESTRICT,
  instance_id TEXT    NOT NULL REFERENCES item_instance(id)    ON DELETE RESTRICT,
  price       INTEGER NOT NULL CHECK (price >= 0),
  created_at  TEXT    NOT NULL
);

-- Marketplace listing: an owned, eligible instance offered for sale. status lifecycle:
-- 'active' -> 'sold' | 'cancelled'.
CREATE TABLE IF NOT EXISTS marketplace_listing (
  id          TEXT    PRIMARY KEY,
  instance_id TEXT    NOT NULL REFERENCES item_instance(id) ON DELETE RESTRICT,
  seller_vuid TEXT    NOT NULL REFERENCES player(vuid)      ON DELETE RESTRICT,
  price       INTEGER NOT NULL CHECK (price >= 0),
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
  created_at  TEXT    NOT NULL
);

-- Marketplace transaction: audit of a completed exchange. transfer_kind is ALWAYS
-- 'application-level-temporary' in this beta — the current marketplace transfer is a LAYER A change,
-- explicitly NOT Tide-backed ownership transfer.
CREATE TABLE IF NOT EXISTS marketplace_transaction (
  id            TEXT    PRIMARY KEY,
  listing_id    TEXT    NOT NULL REFERENCES marketplace_listing(id) ON DELETE RESTRICT,
  instance_id   TEXT    NOT NULL REFERENCES item_instance(id)       ON DELETE RESTRICT,
  seller_vuid   TEXT    NOT NULL REFERENCES player(vuid)            ON DELETE RESTRICT,
  buyer_vuid    TEXT    NOT NULL REFERENCES player(vuid)            ON DELETE RESTRICT,
  price         INTEGER NOT NULL CHECK (price >= 0),
  transfer_kind TEXT    NOT NULL DEFAULT 'application-level-temporary'
                        CHECK (transfer_kind = 'application-level-temporary'),
  created_at    TEXT    NOT NULL
);

-- ---------------------------------------------------------------------------
-- LAYER C — Tide ownership authority (SEPARATE on purpose)
-- ---------------------------------------------------------------------------

-- Tide ownership attestation: a VVK-verifiable, threshold-signed ownership statement.
-- Recorded when a Tide statement is available. NEVER written by the marketplace transfer, and its
-- owner_vuid is independent of item_instance.owner_vuid. This table does NOT substitute for the
-- Layer A record and MUST NOT be treated as proof by the application-level marketplace flow.
CREATE TABLE IF NOT EXISTS tide_ownership_attestation (
  id            TEXT PRIMARY KEY,
  instance_id   TEXT NOT NULL REFERENCES item_instance(id) ON DELETE RESTRICT,
  owner_vuid    TEXT NOT NULL,             -- the vuid bound INSIDE the signed statement (Layer C)
  signature_hex TEXT NOT NULL,             -- 64-byte Ed25519 threshold signature, hex
  payload_item  TEXT NOT NULL,             -- itemInstanceId used in the signed payload
  created_at    TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Indexes (support the read paths in the design)
-- ---------------------------------------------------------------------------

-- Inventory: list instances owned by a player (Layer A ownership lookups).
CREATE INDEX IF NOT EXISTS idx_item_instance_owner    ON item_instance(owner_vuid);
CREATE INDEX IF NOT EXISTS idx_item_instance_template ON item_instance(template_id);

-- Shop: fetch the currently active rotation.
CREATE INDEX IF NOT EXISTS idx_shop_offer_active      ON shop_offer(active);
CREATE INDEX IF NOT EXISTS idx_shop_offer_window      ON shop_offer(window_start, window_end);

-- Marketplace: list active listings; one active listing per instance is enforced below.
CREATE INDEX IF NOT EXISTS idx_listing_status         ON marketplace_listing(status);
CREATE INDEX IF NOT EXISTS idx_listing_instance       ON marketplace_listing(instance_id);

-- Records: query by participant.
CREATE INDEX IF NOT EXISTS idx_purchase_buyer         ON purchase_record(buyer_vuid);
CREATE INDEX IF NOT EXISTS idx_txn_seller             ON marketplace_transaction(seller_vuid);
CREATE INDEX IF NOT EXISTS idx_txn_buyer              ON marketplace_transaction(buyer_vuid);

-- Layer C lookups by instance (kept separate from Layer A).
CREATE INDEX IF NOT EXISTS idx_attestation_instance   ON tide_ownership_attestation(instance_id);

-- At most ONE active listing per item instance (design: an instance cannot be listed twice while
-- already actively listed). Partial unique index over active listings only.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_listing_per_instance
  ON marketplace_listing(instance_id) WHERE status = 'active';
