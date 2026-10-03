// lib/db/admin.ts
// Task 14 — read-only AGGREGATE counts for the admin RBAC demonstration surface.
//
// SERVER-ONLY. This module runs ONLY parameter-free `SELECT COUNT(*)` queries over the Layer A tables
// plus a COUNT of the Layer C tide_ownership_attestation rows. It selects NO private columns (never
// private_note_ciphertext, balances, notes, or any per-row/per-player field) — only row counts. The
// attestation count proves Layer C is observable as an aggregate without exposing any statement
// contents. It performs NO writes and does NOT touch OwnershipSpike / Forseti / Layer C contents /
// DPoP / data/tidecloak.json / the schema.
import { getDb } from "./index";

/** Typed object of aggregate counts (all numbers). No per-row or private data. */
export interface AdminSummaryCounts {
  players: number;
  itemInstances: number;
  activeListings: number;
  soldListings: number;
  cancelledListings: number;
  marketplaceTransactions: number;
  activeShopOffers: number;
  attestations: number;
}

/** Run one parameter-free COUNT(*) and return the integer. */
function count(sql: string): number {
  const row = getDb().prepare(sql).get() as { n: number } | undefined;
  return row ? Number(row.n) : 0;
}

/**
 * Compute the aggregate administrative counts. Standard parameter-free SQL; no private columns are
 * selected. Marketplace listings are split by status. Shop offers are counted only where active = 1.
 */
export function getAdminSummaryCounts(): AdminSummaryCounts {
  return {
    players: count("SELECT COUNT(*) AS n FROM player"),
    itemInstances: count("SELECT COUNT(*) AS n FROM item_instance"),
    activeListings: count("SELECT COUNT(*) AS n FROM marketplace_listing WHERE status = 'active'"),
    soldListings: count("SELECT COUNT(*) AS n FROM marketplace_listing WHERE status = 'sold'"),
    cancelledListings: count("SELECT COUNT(*) AS n FROM marketplace_listing WHERE status = 'cancelled'"),
    marketplaceTransactions: count("SELECT COUNT(*) AS n FROM marketplace_transaction"),
    activeShopOffers: count("SELECT COUNT(*) AS n FROM shop_offer WHERE active = 1"),
    attestations: count("SELECT COUNT(*) AS n FROM tide_ownership_attestation"),
  };
}
