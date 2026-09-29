// lib/db/items.ts — item template + item instance repository (Layer A).
// item_instance.owner_vuid is APPLICATION-LEVEL ownership ONLY (never cryptographic proof).
import { getDb, nowIso } from "./index";
import type { ItemTemplateRow, ItemInstanceRow } from "./types";
import { randomUUID } from "node:crypto";

// -------- item templates (catalogue) --------

export function getTemplate(id: string): ItemTemplateRow | undefined {
  return getDb().prepare("SELECT * FROM item_template WHERE id = ?").get(id) as ItemTemplateRow | undefined;
}

export function listTemplates(): ItemTemplateRow[] {
  return getDb().prepare("SELECT * FROM item_template ORDER BY name").all() as ItemTemplateRow[];
}

export function upsertTemplate(t: ItemTemplateRow): void {
  getDb()
    .prepare(
      `INSERT INTO item_template (id, name, category, rarity, base_price, tradable)
       VALUES (@id, @name, @category, @rarity, @base_price, @tradable)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, category=excluded.category, rarity=excluded.rarity,
         base_price=excluded.base_price, tradable=excluded.tradable`
    )
    .run(t);
}

// -------- item instances (owned units) --------

export function getInstance(id: string): ItemInstanceRow | undefined {
  return getDb().prepare("SELECT * FROM item_instance WHERE id = ?").get(id) as ItemInstanceRow | undefined;
}

/** List the instances a player owns (Layer A), joined to template details for display. */
export function listInstancesForOwner(
  vuid: string
): Array<ItemInstanceRow & { name: string; category: string; rarity: string; tradable: number }> {
  return getDb()
    .prepare(
      `SELECT ii.*, it.name, it.category, it.rarity, it.tradable
       FROM item_instance ii JOIN item_template it ON it.id = ii.template_id
       WHERE ii.owner_vuid = ?
       ORDER BY ii.acquired_at DESC`
    )
    .all(vuid) as Array<
    ItemInstanceRow & { name: string; category: string; rarity: string; tradable: number }
  >;
}

/** Create an owned instance. ownerVuid MUST be the server-derived owner. Returns the new instance id. */
export function createInstance(
  templateId: string,
  ownerVuid: string,
  acquiredVia: "shop" | "marketplace"
): string {
  const id = randomUUID();
  getDb()
    .prepare(
      "INSERT INTO item_instance (id, template_id, owner_vuid, acquired_via, acquired_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, templateId, ownerVuid, acquiredVia, nowIso());
  return id;
}

export function getOwner(instanceId: string): string | undefined {
  const row = getDb().prepare("SELECT owner_vuid FROM item_instance WHERE id = ?").get(instanceId) as
    | { owner_vuid: string }
    | undefined;
  return row?.owner_vuid;
}

export function isOwnedBy(instanceId: string, vuid: string): boolean {
  return getOwner(instanceId) === vuid;
}

/**
 * LAYER A ONLY: change the application-level owner of an instance.
 * This is used by shop purchase (mint) and the temporary marketplace transfer.
 * It MUST NOT be presented as Tide-backed transfer, and it does NOT touch Layer C
 * (tide_ownership_attestation). Callers perform this inside a transaction with related updates.
 */
export function setOwnerVuid(instanceId: string, newOwnerVuid: string): void {
  const info = getDb()
    .prepare("UPDATE item_instance SET owner_vuid = ? WHERE id = ?")
    .run(newOwnerVuid, instanceId);
  if (info.changes === 0) throw new Error("item instance not found");
}
