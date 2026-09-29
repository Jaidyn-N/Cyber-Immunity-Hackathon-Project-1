// app/api/inventory/route.ts
// Task 5 — persistent inventory retrieval for the authenticated player (Layer A).
//
// GET /api/inventory : returns the item instances whose Layer A owner_vuid matches the VERIFIED JWT
// vuid (never a client-supplied value). Includes template details and equipped state for the UI.
//
// Identity comes ONLY from Task 3 withAuth -> AuthContext.vuid. A player can never see another
// player''s inventory. Does not touch Layer C (Tide attestations), OwnershipSpike, or DPoP config.
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { getOrCreateCurrentPlayer } from "@/lib/auth/currentPlayer";
import { listInstancesForOwner } from "@/lib/db/items";

export const GET = withAuth(async (_req: NextRequest, auth) => {
  // Ensure the player row exists and read their equipped instance — all keyed to the verified vuid.
  const player = getOrCreateCurrentPlayer(auth);

  // Owned instances (Layer A ownership filter is inside the repository query: WHERE owner_vuid = ?).
  const rows = listInstancesForOwner(auth.vuid);

  const items = rows.map((r) => ({
    instanceId: r.id,
    templateId: r.template_id,
    name: r.name,
    category: r.category,
    rarity: r.rarity,
    tradable: r.tradable === 1,
    acquiredVia: r.acquired_via,
    acquiredAt: r.acquired_at,
    // Layer A ownership marker: always true for items returned here (they are the caller''s owned items).
    owned: true,
    equipped: player.equipped_instance_id === r.id,
  }));

  return Response.json({
    vuid: auth.vuid,
    equippedInstanceId: player.equipped_instance_id,
    count: items.length,
    items,
  });
});
