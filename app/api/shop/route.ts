// app/api/shop/route.ts
// Task 7 — the limited shop with automatic/randomised rotation (Layer A, server-side only).
//
// GET /api/shop : returns the CURRENT rotation''s offers (item/template details, price, availability).
//
// Availability and purchasability are determined SERVER-SIDE:
//   1. ensure the catalogue is seeded,
//   2. compute the deterministic rotation for the current time window (lib/shop/rotation),
//   3. materialise it into shop_offer rows idempotently + deactivate expired offers (repo, one tx),
//   4. return only the active offers whose window currently contains `now`.
// A client cannot mark an off-rotation item as available: the client sends nothing that influences
// selection; the server derives it from the clock + catalogue. Purchasing is NOT implemented here (Task 8).
//
// Auth: existing withAuth (verified Tide JWT -> vuid, cnf.jkt required). The shop is player-agnostic
// (same rotation for everyone) and never reads/writes any player''s inventory.
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { ensureCatalogueSeeded } from "@/lib/db/seed";
import { computeRotation } from "@/lib/shop/rotation";
import { materialiseRotation, listActiveOffers } from "@/lib/db/shop";

export const GET = withAuth(async (_req: NextRequest, _auth) => {
  ensureCatalogueSeeded();

  const nowMs = Date.now();
  const rot = computeRotation(nowMs);
  const windowStartIso = new Date(rot.windowStart).toISOString();
  const windowEndIso = new Date(rot.windowEnd).toISOString();
  const nowIsoStr = new Date(nowMs).toISOString();

  // Idempotent: only materialises once per window; also deactivates expired offers.
  materialiseRotation(
    windowStartIso,
    windowEndIso,
    rot.offers.map((o) => ({ templateId: o.templateId, price: o.price })),
    nowIsoStr
  );

  // Read the current active offers (repo filters active=1 AND window_start<=now<window_end).
  const active = listActiveOffers(nowIsoStr);

  return Response.json({
    window: { start: windowStartIso, end: windowEndIso },
    capacity: rot.offers.length,
    count: active.length,
    offers: active.map((o) => ({
      offerId: o.id,
      templateId: o.template_id,
      name: o.template.name,
      category: o.template.category,
      rarity: o.template.rarity,
      price: o.price,
      available: true, // returned set is, by construction, the currently-available rotation
      windowEnd: o.window_end,
    })),
  });
});
