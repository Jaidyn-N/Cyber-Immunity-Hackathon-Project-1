// lib/db/marketplace.ts — marketplace listings + transactions (Layer A) AND Tide attestations (Layer C).
//
// LAYER SEPARATION: the temporary marketplace transfer updates ONLY Layer A ownership
// (item_instance.owner_vuid, handled by items.setOwnerVuid inside a caller transaction) and writes a
// marketplace_transaction with transfer_kind = 'application-level-temporary'. It NEVER writes or reads
// tide_ownership_attestation. The Layer C helpers below are storage/verify only and are NOT called by
// the transfer flow.
import { getDb, nowIso } from "./index";
import type {
  MarketplaceListingRow,
  MarketplaceTransactionRow,
  TideOwnershipAttestationRow,
  ListingStatus,
} from "./types";
import { randomUUID } from "node:crypto";
import { getInstance, getTemplate, setOwnerVuid } from "./items";
import {
  getEquipped,
  debitBalance,
  creditBalance,
  clearEquippedByInstance,
  InsufficientFundsError,
} from "./players";

// -------- listings (Layer A) --------

export function getListing(id: string): MarketplaceListingRow | undefined {
  return getDb().prepare("SELECT * FROM marketplace_listing WHERE id = ?").get(id) as
    | MarketplaceListingRow
    | undefined;
}

export function listActiveListings(): MarketplaceListingRow[] {
  return getDb()
    .prepare("SELECT * FROM marketplace_listing WHERE status = 'active' ORDER BY created_at DESC")
    .all() as MarketplaceListingRow[];
}

export function getActiveListingForInstance(instanceId: string): MarketplaceListingRow | undefined {
  return getDb()
    .prepare("SELECT * FROM marketplace_listing WHERE instance_id = ? AND status = 'active'")
    .get(instanceId) as MarketplaceListingRow | undefined;
}

/**
 * Create an active listing. Eligibility (caller owns it, tradable, not equipped, not already listed)
 * is enforced by the caller (Task 9) plus the schema''s partial-unique index on active listings.
 * Returns the new listing id.
 */
export function createListing(instanceId: string, sellerVuid: string, price: number): string {
  const id = randomUUID();
  getDb()
    .prepare(
      "INSERT INTO marketplace_listing (id, instance_id, seller_vuid, price, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)"
    )
    .run(id, instanceId, sellerVuid, price, nowIso());
  return id;
}

export function setListingStatus(id: string, status: ListingStatus): void {
  const info = getDb().prepare("UPDATE marketplace_listing SET status = ? WHERE id = ?").run(status, id);
  if (info.changes === 0) throw new Error("listing not found");
}

/** Active listings joined to item/template details for the marketplace UI (no private player data). */
export function listActiveListingsWithDetails(): Array<
  MarketplaceListingRow & { name: string; category: string; rarity: string }
> {
  return getDb()
    .prepare(
      `SELECT ml.*, it.name, it.category, it.rarity
       FROM marketplace_listing ml
       JOIN item_instance ii ON ii.id = ml.instance_id
       JOIN item_template it ON it.id = ii.template_id
       WHERE ml.status = 'active'
       ORDER BY ml.created_at DESC`
    )
    .all() as Array<MarketplaceListingRow & { name: string; category: string; rarity: string }>;
}

/** A seller''s own listings (all statuses), newest first. Scoped to the verified seller vuid. */
export function listListingsForSeller(sellerVuid: string): MarketplaceListingRow[] {
  return getDb()
    .prepare("SELECT * FROM marketplace_listing WHERE seller_vuid = ? ORDER BY created_at DESC")
    .all(sellerVuid) as MarketplaceListingRow[];
}

/** Possible outcomes of an owner-scoped cancel (route maps these to HTTP status). */
export type CancelOutcome = "cancelled" | "not_found" | "forbidden" | "not_active";

/**
 * Cancel an ACTIVE listing, but ONLY if it belongs to `sellerVuid` (server-verified). Owner-scoped in
 * a single UPDATE so another player cannot cancel someone else''s listing. Returns a categorised outcome.
 * Does NOT transfer ownership, create a transaction, or touch Layer C (tide_ownership_attestation).
 */
export function cancelListing(id: string, sellerVuid: string): CancelOutcome {
  const listing = getListing(id);
  if (!listing) return "not_found";
  if (listing.seller_vuid !== sellerVuid) return "forbidden";
  if (listing.status !== "active") return "not_active";
  // Owner + active re-checked in the WHERE clause to avoid a race between read and write.
  const info = getDb()
    .prepare("UPDATE marketplace_listing SET status = 'cancelled' WHERE id = ? AND seller_vuid = ? AND status = 'active'")
    .run(id, sellerVuid);
  return info.changes === 1 ? "cancelled" : "not_active";
}

/** Categorised eligibility outcome for creating a listing (route maps to HTTP status). */
export type CreateListingResult =
  | { ok: true; listingId: string }
  | { ok: false; reason: "item_not_found" | "not_owner" | "not_tradable" | "equipped" | "already_listed" };

/**
 * Create a listing for `instanceId` on behalf of the SERVER-VERIFIED `sellerVuid`, enforcing full
 * eligibility atomically (one transaction) so the "not already listed" check and the insert cannot
 * race; the schema partial-unique index on active listings is the backstop. Price is validated by the
 * caller/route and by the schema CHECK (price >= 0). Ownership is checked against the verified vuid —
 * a client-supplied owner is never trusted. Does NOT change ownership or touch Layer C.
 */
export function createListingWithEligibility(
  sellerVuid: string,
  instanceId: string,
  price: number
): CreateListingResult {
  const db = getDb();
  const tx = db.transaction((): CreateListingResult => {
    const inst = getInstance(instanceId);
    if (!inst) return { ok: false, reason: "item_not_found" };
    if (inst.owner_vuid !== sellerVuid) return { ok: false, reason: "not_owner" };

    const tpl = getTemplate(inst.template_id);
    if (!tpl || tpl.tradable !== 1) return { ok: false, reason: "not_tradable" };

    if (getEquipped(sellerVuid) === instanceId) return { ok: false, reason: "equipped" };

    if (getActiveListingForInstance(instanceId)) return { ok: false, reason: "already_listed" };

    try {
      const listingId = createListing(instanceId, sellerVuid, price);
      return { ok: true, listingId };
    } catch (e) {
      // Backstop: the partial-unique index rejects a concurrent duplicate active listing.
      if (e instanceof Error && /UNIQUE/i.test(e.message)) return { ok: false, reason: "already_listed" };
      throw e;
    }
  });
  return tx();
}

// -------- transactions (Layer A audit) --------

/**
 * Record a completed marketplace exchange. transfer_kind is fixed to the temporary application-level
 * value (also enforced by the schema CHECK). This records the Layer A transfer only.
 */
export function recordTransaction(args: {
  listingId: string;
  instanceId: string;
  sellerVuid: string;
  buyerVuid: string;
  price: number;
}): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO marketplace_transaction
        (id, listing_id, instance_id, seller_vuid, buyer_vuid, price, transfer_kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'application-level-temporary', ?)`
    )
    .run(id, args.listingId, args.instanceId, args.sellerVuid, args.buyerVuid, args.price, nowIso());
  return id;
}

export function listTransactionsForParty(vuid: string): MarketplaceTransactionRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM marketplace_transaction WHERE seller_vuid = ? OR buyer_vuid = ? ORDER BY created_at DESC"
    )
    .all(vuid, vuid) as MarketplaceTransactionRow[];
}

// -------- temporary application-level transfer / "obtain" (Task 10, LAYER A ONLY) --------
//
// This is the TEMPORARY, APPLICATION-LEVEL marketplace transfer. It moves ONLY Layer A ownership
// (item_instance.owner_vuid) seller -> buyer and records a marketplace_transaction with
// transfer_kind='application-level-temporary'. It is NOT a Tide-backed ownership transfer: it does NOT
// read/write tide_ownership_attestation (Layer C), does NOT call OwnershipSpike, and makes no
// cryptographic ownership claim. Supersession/revocation is out of scope here.

/** Categorised, non-leaky reasons an obtain can fail (route maps these to HTTP status). */
export type ObtainFailure =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_active" }
  | { ok: false; reason: "seller_no_longer_owns" }
  | { ok: false; reason: "cannot_obtain_own" }
  | { ok: false; reason: "insufficient_funds" };

export interface ObtainSuccess {
  ok: true;
  instanceId: string;
  newOwnerVuid: string;
  price: number;
  buyerNewBalance: number;
  sellerNewBalance: number;
}

/**
 * Atomically obtain an ACTIVE marketplace listing for the SERVER-VERIFIED buyer vuid. All steps succeed
 * or fail together in a single better-sqlite3 transaction (mirrors Task 8 purchaseOffer):
 *   1. resolve the listing server-side (not_found if absent),
 *   2. require it to be active (not_active otherwise),
 *   3. resolve the item instance (not_found if absent),
 *   4. consistency guard: the seller must still own the instance (seller_no_longer_owns otherwise),
 *   5. the buyer may not obtain their own listing (cannot_obtain_own),
 *   6. debit the buyer by the AUTHORITATIVE listing price (insufficient_funds if short — no state change),
 *      then credit the seller the same amount,
 *   7. move Layer A ownership (item_instance.owner_vuid = buyer),
 *   8. clear the instance from whoever had it equipped (the seller may have),
 *   9. write a marketplace_transaction (transfer_kind='application-level-temporary'),
 *  10. mark the listing 'sold'.
 * The client controls NONE of: price, buyer, seller, acquisition method — all derived server-side. On
 * any failure the transaction rolls back, leaving currency/ownership/listing/records unchanged. This
 * does NOT touch Layer C (tide_ownership_attestation).
 */
export function obtainListing(
  buyerVuid: string,
  listingId: string
): ObtainSuccess | ObtainFailure {
  const db = getDb();
  const tx = db.transaction((): ObtainSuccess | ObtainFailure => {
    const listing = getListing(listingId);
    if (!listing) return { ok: false, reason: "not_found" };
    if (listing.status !== "active") return { ok: false, reason: "not_active" };

    const instance = getInstance(listing.instance_id);
    if (!instance) return { ok: false, reason: "not_found" };

    // Seller must still hold the item at Layer A, otherwise refuse (do NOT transfer).
    if (instance.owner_vuid !== listing.seller_vuid) {
      return { ok: false, reason: "seller_no_longer_owns" };
    }

    // A seller cannot obtain their own listing.
    if (buyerVuid === listing.seller_vuid) {
      return { ok: false, reason: "cannot_obtain_own" };
    }

    const price = listing.price;

    // Guarded debit: throws InsufficientFundsError (caught below) BEFORE any ownership/listing change.
    let buyerNewBalance: number;
    try {
      buyerNewBalance = debitBalance(buyerVuid, price);
    } catch (e) {
      if (e instanceof InsufficientFundsError) return { ok: false, reason: "insufficient_funds" };
      throw e; // unexpected -> abort the transaction (rollback)
    }
    const sellerNewBalance = creditBalance(listing.seller_vuid, price);

    // LAYER A ONLY: application-level ownership moves seller -> buyer.
    setOwnerVuid(listing.instance_id, buyerVuid);
    // The seller (or anyone) who had this instance equipped loses it.
    clearEquippedByInstance(listing.instance_id);

    recordTransaction({
      listingId,
      instanceId: listing.instance_id,
      sellerVuid: listing.seller_vuid,
      buyerVuid,
      price,
    });
    setListingStatus(listingId, "sold");

    return {
      ok: true,
      instanceId: listing.instance_id,
      newOwnerVuid: buyerVuid,
      price,
      buyerNewBalance,
      sellerNewBalance,
    };
  });

  return tx();
}

// -------- Tide ownership attestations (LAYER C — separate, storage/verify only) --------
// NOT written by the marketplace transfer. owner_vuid here is the vuid bound inside the signed
// statement, independent of item_instance.owner_vuid.

export function insertAttestation(a: Omit<TideOwnershipAttestationRow, "id" | "created_at">): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO tide_ownership_attestation (id, instance_id, owner_vuid, signature_hex, payload_item, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, a.instance_id, a.owner_vuid, a.signature_hex, a.payload_item, nowIso());
  return id;
}

export function listAttestationsForInstance(instanceId: string): TideOwnershipAttestationRow[] {
  return getDb()
    .prepare("SELECT * FROM tide_ownership_attestation WHERE instance_id = ? ORDER BY created_at DESC")
    .all(instanceId) as TideOwnershipAttestationRow[];
}
