// lib/db/shop.ts — shop offers + purchase records repository (Layer A).
import { getDb, nowIso } from "./index";
import type { ShopOfferRow, PurchaseRecordRow, ItemTemplateRow } from "./types";
import { randomUUID } from "node:crypto";

/** Active offers whose window currently contains `at` (ISO string). Joined to template for display. */
export function listActiveOffers(at: string = nowIso()): Array<ShopOfferRow & { template: ItemTemplateRow }> {
  const rows = getDb()
    .prepare(
      `SELECT so.*, it.name AS t_name, it.category AS t_category, it.rarity AS t_rarity,
              it.base_price AS t_base_price, it.tradable AS t_tradable
       FROM shop_offer so JOIN item_template it ON it.id = so.template_id
       WHERE so.active = 1 AND so.window_start <= ? AND so.window_end > ?
       ORDER BY it.name`
    )
    .all(at, at) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as string,
    template_id: r.template_id as string,
    price: r.price as number,
    window_start: r.window_start as string,
    window_end: r.window_end as string,
    active: r.active as number,
    template: {
      id: r.template_id as string,
      name: r.t_name as string,
      category: r.t_category as string,
      rarity: r.t_rarity as string,
      base_price: r.t_base_price as number,
      tradable: r.t_tradable as number,
    },
  }));
}

export function getOffer(id: string): ShopOfferRow | undefined {
  return getDb().prepare("SELECT * FROM shop_offer WHERE id = ?").get(id) as ShopOfferRow | undefined;
}

/** True if the offer exists, is active, and `at` falls within its window (purchasable). */
export function isOfferPurchasable(id: string, at: string = nowIso()): boolean {
  const o = getOffer(id);
  return !!o && o.active === 1 && o.window_start <= at && o.window_end > at;
}

export function insertOffer(o: ShopOfferRow): void {
  getDb()
    .prepare(
      `INSERT INTO shop_offer (id, template_id, price, window_start, window_end, active)
       VALUES (@id, @template_id, @price, @window_start, @window_end, @active)`
    )
    .run(o);
}

/** Deactivate offers whose window has ended (used by rotation refresh in Task 7). */
export function deactivateExpiredOffers(at: string = nowIso()): number {
  const info = getDb().prepare("UPDATE shop_offer SET active = 0 WHERE active = 1 AND window_end <= ?").run(at);
  return info.changes;
}

export function recordPurchase(
  buyerVuid: string,
  templateId: string,
  instanceId: string,
  price: number
): string {
  const id = randomUUID();
  getDb()
    .prepare(
      "INSERT INTO purchase_record (id, buyer_vuid, template_id, instance_id, price, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, buyerVuid, templateId, instanceId, price, nowIso());
  return id;
}

export function listPurchasesForBuyer(vuid: string): PurchaseRecordRow[] {
  return getDb()
    .prepare("SELECT * FROM purchase_record WHERE buyer_vuid = ? ORDER BY created_at DESC")
    .all(vuid) as PurchaseRecordRow[];
}

/** True if any active offer row already exists for the given window start (ISO). */
export function hasOffersForWindow(windowStartIso: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM shop_offer WHERE window_start = ? AND active = 1 LIMIT 1")
    .get(windowStartIso) as { 1: number } | undefined;
  return !!row;
}

/**
 * Materialise a window''s rotation into shop_offer rows idempotently, inside one transaction:
 * deactivate expired offers (window_end <= now), then insert the given offers for this window ONLY if
 * none exist yet. Deterministic offer id = `<windowStartIso>::<templateId>` so repeated calls in the
 * same window never duplicate rows and always yield stable ids (needed by Task 8 purchase validation).
 * Returns nothing; callers then read via listActiveOffers().
 */
export function materialiseRotation(
  windowStartIso: string,
  windowEndIso: string,
  offers: Array<{ templateId: string; price: number }>,
  nowIsoStr: string = nowIso()
): void {
  const db = getDb();
  const tx = db.transaction(() => {
    deactivateExpiredOffers(nowIsoStr);
    if (hasOffersForWindow(windowStartIso)) return; // already materialised for this window
    const insert = db.prepare(
      `INSERT OR IGNORE INTO shop_offer (id, template_id, price, window_start, window_end, active)
       VALUES (?, ?, ?, ?, ?, 1)`
    );
    for (const o of offers) {
      insert.run(`${windowStartIso}::${o.templateId}`, o.templateId, o.price, windowStartIso, windowEndIso);
    }
  });
  tx();
}

