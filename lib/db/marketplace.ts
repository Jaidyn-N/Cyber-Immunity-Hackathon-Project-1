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
