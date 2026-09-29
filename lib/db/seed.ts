// lib/db/seed.ts — idempotent catalogue seed of cosmetic item templates (Layer A, PUBLIC data).
// The shop rotation (lib/shop/rotation.ts) draws its selection from these templates. This is NOT
// admin hand-picking of the current stock — it is the fixed catalogue of items that CAN appear.
// Rarity is a descriptive label only (no economy mechanics). All beta cosmetics are tradable.
import { upsertTemplate, listTemplates } from "./items";
import type { ItemTemplateRow } from "./types";

const CATALOGUE: ItemTemplateRow[] = [
  { id: "tpl-cape-legendary",   name: "Legendary Cape",     category: "cape",      rarity: "legendary", base_price: 500, tradable: 1 },
  { id: "tpl-skin-azure",       name: "Azure Skin",         category: "skin",      rarity: "rare",      base_price: 150, tradable: 1 },
  { id: "tpl-skin-crimson",     name: "Crimson Skin",       category: "skin",      rarity: "rare",      base_price: 150, tradable: 1 },
  { id: "tpl-hat-explorer",     name: "Explorer Hat",       category: "accessory", rarity: "common",    base_price: 60,  tradable: 1 },
  { id: "tpl-wings-aurora",     name: "Aurora Wings",       category: "accessory", rarity: "epic",      base_price: 300, tradable: 1 },
  { id: "tpl-trail-comet",      name: "Comet Trail",        category: "accessory", rarity: "epic",      base_price: 280, tradable: 1 },
  { id: "tpl-mask-shadow",      name: "Shadow Mask",        category: "accessory", rarity: "rare",      base_price: 120, tradable: 1 },
  { id: "tpl-skin-emerald",     name: "Emerald Skin",       category: "skin",      rarity: "common",    base_price: 80,  tradable: 1 },
];

/** Insert/refresh the catalogue templates. Idempotent (upsert). Returns the number of templates. */
export function seedCatalogue(): number {
  for (const t of CATALOGUE) upsertTemplate(t);
  return CATALOGUE.length;
}

/** Ensure the catalogue exists; seeds only if empty. Safe to call on read paths. */
export function ensureCatalogueSeeded(): void {
  if (listTemplates().length === 0) seedCatalogue();
}
