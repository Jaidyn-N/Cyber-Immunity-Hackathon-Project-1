// app/api/marketplace/route.ts
// Task 9 — GET active marketplace listings (Layer A). Shows item + asking price for the marketplace UI.
//
// Auth via withAuth (verified Tide JWT, cnf.jkt required). Returns ONLY public listing/item info plus
// the seller vuid (the identifier the schema already stores and the UI needs to attribute a listing);
// no private player profile/inventory/contact data is exposed. Read-only — no ownership change,
// no Layer C (tide_ownership_attestation), no OwnershipSpike.
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { listActiveListingsWithDetails } from "@/lib/db/marketplace";

export const GET = withAuth(async (_req: NextRequest, _auth) => {
  const rows = listActiveListingsWithDetails();
  return Response.json({
    count: rows.length,
    listings: rows.map((l) => ({
      listingId: l.id,
      instanceId: l.instance_id,
      sellerVuid: l.seller_vuid, // identifier only; no private profile data
      price: l.price,
      name: l.name,
      category: l.category,
      rarity: l.rarity,
      createdAt: l.created_at,
    })),
  });
});
