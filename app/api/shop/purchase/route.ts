// app/api/shop/purchase/route.ts
// Task 8 — shop purchasing + purchase records (Layer A, server-side, atomic).
//
// POST /api/shop/purchase  { offerId: string }
//   - Buyer identity = VERIFIED Tide JWT vuid ONLY (withAuth). Body/query vuid/owner/price/etc ignored.
//   - Offer, price, ownership and acquisition method are resolved SERVER-SIDE from shop_offer.
//   - The whole purchase (validate active offer -> check+deduct funds -> create item -> record) runs in
//     ONE better-sqlite3 transaction (lib/db/shop.purchaseOffer): all-or-nothing.
//   - An offer that is not in the CURRENT active rotation cannot be bought even if its id is known.
//
// Does NOT write Layer C (tide_ownership_attestation), does NOT touch OwnershipSpike/Tide policies/DPoP,
// and is NOT a Tide-backed ownership transfer.
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { getOrCreateCurrentPlayer } from "@/lib/auth/currentPlayer";
import { purchaseOffer } from "@/lib/db/shop";

export const POST = withAuth(async (req: NextRequest, auth) => {
  getOrCreateCurrentPlayer(auth); // ensure the buyer row exists (keyed to verified vuid)

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const offerId = (body as { offerId?: unknown } | null)?.offerId;
  if (typeof offerId !== "string" || offerId.length === 0) {
    return Response.json({ error: "offerId must be a non-empty string" }, { status: 400 });
  }

  // Buyer is the verified vuid — never anything from the body.
  const result = purchaseOffer(auth.vuid, offerId);

  if (!result.ok) {
    switch (result.reason) {
      case "offer_not_found":
        return Response.json({ error: "Offer not found" }, { status: 404 });
      case "offer_unavailable":
        return Response.json({ error: "Offer is not currently available" }, { status: 409 });
      case "insufficient_funds":
        return Response.json({ error: "Insufficient funds" }, { status: 402 });
    }
  }

  return Response.json({
    ok: true,
    instanceId: result.instanceId,
    purchaseId: result.purchaseId,
    templateId: result.templateId,
    pricePaid: result.price,
    newBalance: result.newBalance,
  });
});
