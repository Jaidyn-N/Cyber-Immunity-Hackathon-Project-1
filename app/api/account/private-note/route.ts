// app/api/account/private-note/route.ts
// Task 12 — Tide-protected private note (ciphertext-at-rest store, Layer A/B, server-side identity).
//
// This endpoint stores and returns ONLY the Tide self-encrypted ciphertext of a player's private note.
// The PLAINTEXT NEVER REACHES THE SERVER: encryption and decryption happen CLIENT-SIDE via the Tide
// SDK (doEncrypt/doDecrypt), gated by the `_tide_dob.selfencrypt` / `_tide_dob.selfdecrypt` voucher
// roles (Layer B / Tide). The server treats the value as an opaque base64 string — it never decrypts,
// inspects, or validates the plaintext, and performs NO application-level role check (no withRole):
// Tide's voucher gate IS the authorization. Identity is the VERIFIED JWT vuid ONLY (withAuth); any
// vuid/owner field in the body/query is ignored. This mirrors app/api/shop/purchase/route.ts and does
// NOT write Layer C (tide_ownership_attestation), touch OwnershipSpike/Tide policies/DPoP, or transfer
// ownership.
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { getOrCreateCurrentPlayer } from "@/lib/auth/currentPlayer";
import { getPrivateNoteCiphertext, setPrivateNoteCiphertext } from "@/lib/db/players";

// Guard against pathological payloads. A Tide self-encrypted envelope is small base64; 100k chars is a
// generous ceiling that still rejects abuse. The server never interprets the content beyond length.
const MAX_CIPHERTEXT_CHARS = 100_000;

// GET /api/account/private-note — return ONLY the caller's own stored ciphertext (may be null).
export const GET = withAuth(async (_req: NextRequest, auth) => {
  getOrCreateCurrentPlayer(auth); // ensure the caller's row exists (keyed to verified vuid)

  // Strictly scoped to the verified vuid — never another player's row.
  const ciphertext = getPrivateNoteCiphertext(auth.vuid);
  return Response.json({ ok: true, ciphertext });
});

// PUT /api/account/private-note — store the caller-supplied opaque ciphertext (string | null).
export const PUT = withAuth(async (req: NextRequest, auth) => {
  getOrCreateCurrentPlayer(auth); // ensure the caller's row exists (keyed to verified vuid)

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Only `ciphertext` is read. Any vuid/ownerVuid/targetVuid in the body is intentionally ignored —
  // identity comes from the verified JWT (auth.vuid), never the request body.
  const ciphertext = (body as { ciphertext?: unknown } | null)?.ciphertext;

  if (ciphertext !== null && typeof ciphertext !== "string") {
    return Response.json(
      { error: "ciphertext must be a string (Tide base64 envelope) or null" },
      { status: 400 }
    );
  }
  if (typeof ciphertext === "string" && ciphertext.length > MAX_CIPHERTEXT_CHARS) {
    return Response.json(
      { error: `ciphertext exceeds the ${MAX_CIPHERTEXT_CHARS} character limit` },
      { status: 400 }
    );
  }

  // Store the opaque string verbatim for the verified caller — no decryption, no plaintext inspection.
  setPrivateNoteCiphertext(auth.vuid, ciphertext);
  return Response.json({ ok: true });
});
