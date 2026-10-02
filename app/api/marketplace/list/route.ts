// app/api/marketplace/list/route.ts
// Task 9 — create a marketplace listing (Layer A) and list the caller''s own listings.
//
// POST /api/marketplace/list  { instanceId: string, price: number }
//   - Seller identity = VERIFIED Tide JWT vuid ONLY (withAuth). A client-supplied owner is ignored.
//   - The client may supply instanceId + price; the SERVER determines ownership + eligibility and the
//     listing is created atomically with the eligibility checks (lib/db/marketplace).
//   - Eligibility: item exists, owned by the caller, template tradable, not equipped, not already listed.
//   - Creating a listing does NOT change item ownership, create a transaction, or touch Layer C
//     (tide_ownership_attestation) / OwnershipSpike. This is NOT a Tide-backed ownership transfer.
//
// GET /api/marketplace/list -> the caller''s own listings (all statuses).
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { getOrCreateCurrentPlayer } from "@/lib/auth/currentPlayer";
import { createListingWithEligibility, listListingsForSeller } from "@/lib/db/marketplace";

export const GET = withAuth(async (_req: NextRequest, auth) => {
  getOrCreateCurrentPlayer(auth);
  const rows = listListingsForSeller(auth.vuid);
  return Response.json({
    count: rows.length,
    listings: rows.map((l) => ({
      listingId: l.id,
      instanceId: l.instance_id,
      price: l.price,
      status: l.status,
      createdAt: l.created_at,
    })),
  });
});

export const POST = withAuth(async (req: NextRequest, auth) => {
  getOrCreateCurrentPlayer(auth);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const instanceId = (body as { instanceId?: unknown } | null)?.instanceId;
  const priceRaw = (body as { price?: unknown } | null)?.price;

  if (typeof instanceId !== "string" || instanceId.length === 0) {
    return Response.json({ error: "instanceId must be a non-empty string" }, { status: 400 });
  }
  // Price: a non-negative integer (simulated currency; schema stores INTEGER, CHECK >= 0).
  if (typeof priceRaw !== "number" || !Number.isInteger(priceRaw) || priceRaw < 0) {
    return Response.json(
      { error: "price must be a non-negative integer" },
      { status: 400 }
    );
  }

  // Seller is the verified vuid — never from the body.
  const result = createListingWithEligibility(auth.vuid, instanceId, priceRaw);

  if (!result.ok) {
    switch (result.reason) {
      case "item_not_found":
        return Response.json({ error: "Item instance not found" }, { status: 404 });
      case "not_owner":
        return Response.json({ error: "Forbidden: you do not own this item" }, { status: 403 });
      case "not_tradable":
        return Response.json({ error: "Item is not tradable" }, { status: 409 });
      case "equipped":
        return Response.json({ error: "Unequip the item before listing it" }, { status: 409 });
      case "already_listed":
        return Response.json({ error: "Item is already actively listed" }, { status: 409 });
    }
  }

  return Response.json({ ok: true, listingId: result.listingId, instanceId, price: priceRaw });
});
