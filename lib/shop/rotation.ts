// lib/shop/rotation.ts
// Deterministic-per-window, randomised-across-windows shop rotation (Layer A, server-side only).
//
// Design intent (design.md): "compute the active offer set from a time-window seed (deterministic
// within a window, randomised across windows); no admin hand-picking."
//
// Chosen parameters (the approved design left duration/capacity unspecified; smallest sensible values,
// reported in LEARNINGS):
//   - WINDOW: 1 hour. A rotation is identified by its window start (epoch ms floored to the hour).
//   - CAPACITY: up to 4 offers per rotation.
// Because the selection is seeded by the window start, EVERY request within the same window computes
// the SAME offers (refreshes do not reshuffle); a new window yields a new selection. The same item
// can reappear in a future window.
import { listTemplates } from "../db/items";
import type { ItemTemplateRow } from "../db/types";

export const WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const SHOP_CAPACITY = 4;

/** The start (epoch ms) of the rotation window containing `atMs`. */
export function windowStartMs(atMs: number = Date.now()): number {
  return Math.floor(atMs / WINDOW_MS) * WINDOW_MS;
}

export function windowEndMs(atMs: number = Date.now()): number {
  return windowStartMs(atMs) + WINDOW_MS;
}

// Small deterministic PRNG (mulberry32) — pure, no Math.random, so the selection is reproducible
// for a given seed on every process/request.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded Fisher-Yates shuffle (does not mutate the input). */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface RotationOffer {
  templateId: string;
  price: number;
  template: ItemTemplateRow;
}

/**
 * Compute the deterministic offer selection for the window containing `atMs`.
 * Seed = window start (in seconds) — stable within the window, changes each window.
 * Selection is capped at SHOP_CAPACITY and never exceeds the number of catalogue templates.
 * Price is the template''s base_price (no economy mechanics added).
 */
export function computeRotation(atMs: number = Date.now()): {
  windowStart: number;
  windowEnd: number;
  offers: RotationOffer[];
} {
  const start = windowStartMs(atMs);
  const templates = listTemplates(); // catalogue (PUBLIC)
  const seed = Math.floor(start / 1000);
  const picked = seededShuffle(templates, seed).slice(0, Math.min(SHOP_CAPACITY, templates.length));
  return {
    windowStart: start,
    windowEnd: start + WINDOW_MS,
    offers: picked.map((t) => ({ templateId: t.id, price: t.base_price, template: t })),
  };
}
