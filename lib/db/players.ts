// lib/db/players.ts — player repository (Layer A). Server-side; parameterised SQL only.
import { getDb, nowIso } from "./index";
import type { PlayerRow } from "./types";

/** Get a player by vuid, or undefined. */
export function getPlayer(vuid: string): PlayerRow | undefined {
  return getDb().prepare("SELECT * FROM player WHERE vuid = ?").get(vuid) as PlayerRow | undefined;
}

/**
 * Get an existing player or create one keyed by the (server-derived) vuid.
 * The caller MUST pass the vuid from the verified JWT (Task 3), never client-supplied.
 */
export function getOrCreatePlayer(vuid: string, displayName: string, startingBalance = 0): PlayerRow {
  const existing = getPlayer(vuid);
  if (existing) return existing;
  getDb()
    .prepare(
      "INSERT INTO player (vuid, display_name, currency_balance, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(vuid, displayName, startingBalance, nowIso());
  return getPlayer(vuid)!;
}

export function getBalance(vuid: string): number {
  const row = getDb().prepare("SELECT currency_balance FROM player WHERE vuid = ?").get(vuid) as
    | { currency_balance: number }
    | undefined;
  if (!row) throw new Error("player not found");
  return row.currency_balance;
}

/**
 * Adjust a player''s balance by `delta` (may be negative). Returns the new balance.
 * The schema CHECK (currency_balance >= 0) rejects overdrafts; caller should guard first for a clean error.
 */
export function adjustBalance(vuid: string, delta: number): number {
  const db = getDb();
  const info = db
    .prepare("UPDATE player SET currency_balance = currency_balance + ? WHERE vuid = ?")
    .run(delta, vuid);
  if (info.changes === 0) throw new Error("player not found");
  return getBalance(vuid);
}

/** Raised when a debit would take a player''s balance below zero. Callers map this to a clean 4xx. */
export class InsufficientFundsError extends Error {
  readonly required: number;
  readonly available: number;
  constructor(required: number, available: number) {
    super("Insufficient funds");
    this.name = "InsufficientFundsError";
    this.required = required;
    this.available = available;
  }
}

/**
 * Credit a player (add non-negative `amount`). Returns the new balance.
 * Used by later tasks (e.g. marketplace sale proceeds to the seller).
 */
export function creditBalance(vuid: string, amount: number): number {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("credit amount must be a non-negative integer");
  return adjustBalance(vuid, amount);
}

/**
 * Debit a player (subtract non-negative `amount`), guarded server-side so the balance never goes
 * negative. Throws InsufficientFundsError before mutating if funds are short. The schema
 * CHECK (currency_balance >= 0) is the backstop. Returns the new balance.
 * Callers should run this inside the same DB transaction as the related change (Task 8/10).
 */
export function debitBalance(vuid: string, amount: number): number {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("debit amount must be a non-negative integer");
  const available = getBalance(vuid); // throws if player not found
  if (amount > available) throw new InsufficientFundsError(amount, available);
  return adjustBalance(vuid, -amount);
}

export function getEquipped(vuid: string): string | null {
  const row = getDb().prepare("SELECT equipped_instance_id FROM player WHERE vuid = ?").get(vuid) as
    | { equipped_instance_id: string | null }
    | undefined;
  if (!row) throw new Error("player not found");
  return row.equipped_instance_id;
}

export function setEquipped(vuid: string, instanceId: string | null): void {
  const info = getDb()
    .prepare("UPDATE player SET equipped_instance_id = ? WHERE vuid = ?")
    .run(instanceId, vuid);
  if (info.changes === 0) throw new Error("player not found");
}

/** Clear the equipped slot for any player who currently has this instance equipped. */
export function clearEquippedByInstance(instanceId: string): void {
  getDb()
    .prepare("UPDATE player SET equipped_instance_id = NULL WHERE equipped_instance_id = ?")
    .run(instanceId);
}

/** Read the stored Tide-self-encrypted private-note ciphertext (never plaintext). */
export function getPrivateNoteCiphertext(vuid: string): string | null {
  const row = getDb().prepare("SELECT private_note_ciphertext FROM player WHERE vuid = ?").get(vuid) as
    | { private_note_ciphertext: string | null }
    | undefined;
  if (!row) throw new Error("player not found");
  return row.private_note_ciphertext;
}

/** Store the Tide-self-encrypted private-note ciphertext. The server never handles plaintext. */
export function setPrivateNoteCiphertext(vuid: string, ciphertext: string | null): void {
  const info = getDb()
    .prepare("UPDATE player SET private_note_ciphertext = ? WHERE vuid = ?")
    .run(ciphertext, vuid);
  if (info.changes === 0) throw new Error("player not found");
}


