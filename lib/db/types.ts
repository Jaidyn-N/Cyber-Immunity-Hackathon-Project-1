// lib/db/types.ts — row shapes for the Layer A + Layer C tables. Match schema.sql exactly.

export interface PlayerRow {
  vuid: string;
  display_name: string;
  currency_balance: number;
  equipped_instance_id: string | null;
  private_note_ciphertext: string | null;
  created_at: string;
}

export interface ItemTemplateRow {
  id: string;
  name: string;
  category: string;
  rarity: string;
  base_price: number;
  tradable: number; // 0 | 1
}

export interface ItemInstanceRow {
  id: string;
  template_id: string;
  owner_vuid: string; // LAYER A application ownership ONLY
  acquired_via: "shop" | "marketplace";
  acquired_at: string;
}

export interface ShopOfferRow {
  id: string;
  template_id: string;
  price: number;
  window_start: string;
  window_end: string;
  active: number; // 0 | 1
}

export interface PurchaseRecordRow {
  id: string;
  buyer_vuid: string;
  template_id: string;
  instance_id: string;
  price: number;
  created_at: string;
}

export type ListingStatus = "active" | "sold" | "cancelled";

export interface MarketplaceListingRow {
  id: string;
  instance_id: string;
  seller_vuid: string;
  price: number;
  status: ListingStatus;
  created_at: string;
}

export interface MarketplaceTransactionRow {
  id: string;
  listing_id: string;
  instance_id: string;
  seller_vuid: string;
  buyer_vuid: string;
  price: number;
  transfer_kind: "application-level-temporary";
  created_at: string;
}

// LAYER C — separate on purpose. owner_vuid here is the vuid bound INSIDE the signed statement,
// independent of item_instance.owner_vuid (Layer A).
export interface TideOwnershipAttestationRow {
  id: string;
  instance_id: string;
  owner_vuid: string;
  signature_hex: string;
  payload_item: string;
  created_at: string;
}
