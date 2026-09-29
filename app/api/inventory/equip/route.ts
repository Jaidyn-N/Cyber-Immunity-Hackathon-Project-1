// app/api/inventory/equip/route.ts
// Task 6 — equipping + basic avatar state (Layer A).
//
// POST /api/inventory/equip  { instanceId: string | null }
//   - instanceId = <id> : equip that item, ONLY if the verified player owns it (server-checked).
//   - instanceId = null  : unequip (clear the player''s equipped slot).
// GET  /api/inventory/equip : return the caller''s currently equipped instance id.
//
// Identity comes ONLY from the verified Tide JWT (withAuth -> AuthContext.vuid). Ownership is verified
// server-side against Layer A (item_instance.owner_vuid) before mutating player.equipped_instance_id.
// A player can never equip another player''s item. No client-supplied vuid/owner is trusted.
// Does not touch Layer C (Tide attestations), OwnershipSpike, or DPoP config.
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { getOrCreateCurrentPlayer } from "@/lib/auth/currentPlayer";
import { getEquipped, setEquipped } from "@/lib/db/players";
import { getInstance, isOwnedBy } from "@/lib/db/items";

export const GET = withAuth(async (_req: NextRequest, auth) => {
  getOrCreateCurrentPlayer(auth); // ensure the row exists (keyed to verified vuid)
  return Response.json({ equippedInstanceId: getEquipped(auth.vuid) });
});

export const POST = withAuth(async (req: NextRequest, auth) => {
  getOrCreateCurrentPlayer(auth);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Only the instanceId field is read; any client-supplied vuid/owner in the body is ignored.
  const instanceId = (body as { instanceId?: unknown } | null)?.instanceId ?? null;

  // Unequip: clear the slot.
  if (instanceId === null) {
    setEquipped(auth.vuid, null);
    return Response.json({ equippedInstanceId: null, unequipped: true });
  }

  if (typeof instanceId !== "string" || instanceId.length === 0) {
    return Response.json({ error: "instanceId must be a non-empty string or null" }, { status: 400 });
  }

  // Item must exist ...
  const instance = getInstance(instanceId);
  if (!instance) {
    return Response.json({ error: "Item instance not found" }, { status: 404 });
  }

  // ... and be owned by the VERIFIED player (server-side ownership check — Layer A).
  if (!isOwnedBy(instanceId, auth.vuid)) {
    return Response.json({ error: "Forbidden: you do not own this item" }, { status: 403 });
  }

  setEquipped(auth.vuid, instanceId);
  return Response.json({ equippedInstanceId: instanceId, equipped: true });
});
