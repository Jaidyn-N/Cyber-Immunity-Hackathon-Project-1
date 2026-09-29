// lib/auth/currentPlayer.ts
// Seam between the verified auth identity and the Layer A player record. The vuid is ALWAYS the
// server-verified one from AuthContext — never client-supplied. Used by later API routes (Task 4+).
import type { AuthContext } from "./protect";
import { getOrCreatePlayer } from "../db/players";
import type { PlayerRow } from "../db/types";

if (typeof window !== "undefined") {
  throw new Error("lib/auth/currentPlayer must not be imported from client-side code (server-only).");
}

const STARTING_BALANCE = 1000; // simulated in-game currency granted to a new player (beta default)

/**
 * Resolve (or lazily create) the player row for the verified caller. The display name defaults to a
 * short form of the vuid until in-app onboarding sets a real one (Task 4/ONB). Identity = verified vuid.
 */
export function getOrCreateCurrentPlayer(auth: AuthContext): PlayerRow {
  const defaultName = `player-${auth.vuid.slice(0, 8)}`;
  return getOrCreatePlayer(auth.vuid, defaultName, STARTING_BALANCE);
}
