// app/api/marketplace/obtain/route.ts
// Task 10 — temporary, APPLICATION-LEVEL marketplace transfer ("obtain") + transaction record
// (Layer A, server-side, atomic).
//
// POST /api/marketplace/obtain  { listingId: string }
//   - Buyer identity = VERIFIED Tide JWT vuid ONLY (withAuth). Any buyerVuid/sellerVuid/ownerVuid in the
//     body is IGNORED — the only client input honoured is listingId.
//   - Listing, price, parties and ownership are resolved SERVER-SIDE from the DB.
//   - The whole obtain (validate active listing -> check+deduct buyer funds -> credit seller -> move
//     Layer A ownership -> clear equipped -> record transaction -> mark listing sold) runs in ONE
//     better-sqlite3 transaction (lib/db/marketplace.obtainListing): all-or-nothing.
//
// This is NOT a Tide-backed ownership transfer. It updates ONLY Layer A (item_instance.owner_vuid),
// does NOT write/read Layer C (tide_ownership_attestation), does NOT touch OwnershipSpike / Tide
// policies / DPoP, and makes no cryptographic ownership claim. Supersession/revocation is out of scope.
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { getOrCreateCurrentPlayer } from "@/lib/auth/currentPlayer";
import { obtainListing } from "@/lib/db/marketplace";

export const POST = withAuth(async (req: NextRequest, auth) => {
  getOrCreateCurrentPlayer(auth); // ensure the buyer row exists (keyed to verified vuid)

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const listingId = (body as { listingId?: unknown } | null)?.listingId;
  if (typeof listingId !== "string" || listingId.length === 0) {
    return Response.json({ error: "listingId must be a non-empty string" }, { status: 400 });
  }

  // Buyer is the verified vuid — never anything from the body. Any body buyerVuid/sellerVuid/ownerVuid
  // is deliberately ignored (the identity boundary); only listingId above is read from the client.
  const result = obtainListing(auth.vuid, listingId);

  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return Response.json({ error: "Listing not found" }, { status: 404 });
      case "not_active":
        return Response.json({ error: "Listing is not currently available" }, { status: 409 });
      case "seller_no_longer_owns":
        return Response.json({ error: "Listing is no longer available" }, { status: 409 });
      case "cannot_obtain_own":
        return Response.json({ error: "You cannot obtain your own listing" }, { status: 409 });
      case "insufficient_funds":
        return Response.json({ error: "Insufficient funds" }, { status: 402 });
    }
  }

  return Response.json({
    ok: true,
    message: "application-level transfer completed",
    instanceId: result.instanceId,
    newOwnerVuid: result.newOwnerVuid,
    pricePaid: result.price,
    buyerNewBalance: result.buyerNewBalance,
    sellerNewBalance: result.sellerNewBalance,
  });
});
