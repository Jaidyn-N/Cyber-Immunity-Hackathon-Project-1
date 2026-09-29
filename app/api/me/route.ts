// app/api/me/route.ts
// Task 4 — current player profile + simulated currency (Layer A).
//
// GET /api/me : returns the AUTHENTICATED player''s own profile/currency/equipped state.
// Identity comes ONLY from the verified Tide JWT (Task 3 withAuth -> AuthContext.vuid). The request
// body/query cannot influence which player is read. A player can only ever read their own record.
//
// Does not touch Layer C (Tide attestations), OwnershipSpike, DPoP config, or the client TideCloak flow.
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { getOrCreateCurrentPlayer } from "@/lib/auth/currentPlayer";

/** Safe, explicit projection of a player row — never leaks the private-note ciphertext blob. */
function toSafeProfile(p: {
  vuid: string;
  display_name: string;
  currency_balance: number;
  equipped_instance_id: string | null;
  private_note_ciphertext: string | null;
  created_at: string;
}) {
  return {
    vuid: p.vuid,
    displayName: p.display_name,
    currencyBalance: p.currency_balance,
    equippedInstanceId: p.equipped_instance_id,
    hasPrivateNote: p.private_note_ciphertext != null, // boolean flag only; ciphertext not exposed here
    createdAt: p.created_at,
  };
}

export const GET = withAuth(async (_req: NextRequest, auth) => {
  // getOrCreateCurrentPlayer uses ONLY the verified auth.vuid.
  const player = getOrCreateCurrentPlayer(auth);
  return Response.json({ player: toSafeProfile(player) });
});
