// app/api/marketplace/list/[id]/route.ts
// Task 9 — cancel the caller''s OWN active marketplace listing (Layer A).
//
// DELETE /api/marketplace/list/{id}
//   - Seller identity = VERIFIED Tide JWT vuid (withAuth). The cancel is owner-scoped server-side:
//     a player can only cancel a listing whose seller_vuid matches their verified vuid (403 otherwise).
//   - Cancelling ONLY changes the listing status to 'cancelled'. It does NOT transfer ownership, create
//     a transaction, create/modify a tide_ownership_attestation, or interact with OwnershipSpike.
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { getOrCreateCurrentPlayer } from "@/lib/auth/currentPlayer";
import { cancelListing } from "@/lib/db/marketplace";

export const DELETE = withAuth(async (req: NextRequest, auth) => {
  getOrCreateCurrentPlayer(auth);

  // Extract the listing id from the path (…/api/marketplace/list/{id}).
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = parts[parts.length - 1];
  if (!id || id === "list") {
    return Response.json({ error: "listing id required" }, { status: 400 });
  }

  const outcome = cancelListing(id, auth.vuid);
  switch (outcome) {
    case "cancelled":
      return Response.json({ ok: true, listingId: id, status: "cancelled" });
    case "not_found":
      return Response.json({ error: "Listing not found" }, { status: 404 });
    case "forbidden":
      return Response.json({ error: "Forbidden: not your listing" }, { status: 403 });
    case "not_active":
      return Response.json({ error: "Listing is not active" }, { status: 409 });
  }
});
