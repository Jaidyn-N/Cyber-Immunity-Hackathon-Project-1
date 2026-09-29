// lib/db/index.ts
// Server-side SQLite connection layer for the Marketplace Beta (Layer A + Layer C storage).
//
// - Opens/creates data/app.db via better-sqlite3.
// - Applies lib/db/schema.sql on first initialisation (idempotent; schema uses IF NOT EXISTS).
// - Enables PRAGMA foreign_keys = ON on the ACTUAL application connection.
// - Single shared connection (module-level singleton) — no unnecessary extra connections.
//
// SERVER-ONLY. Never import this from a client component. A runtime guard throws if this module is
// ever evaluated in a browser context. (No `server-only` dependency is added.)
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Fail fast if bundled into / evaluated in a client context.
if (typeof window !== "undefined") {
  throw new Error("lib/db must not be imported from client-side code (server-only).");
}

let _db: DB | null = null;

/**
 * Absolute path to the SQLite database file (data/app.db under the project root).
 * `APP_DB_PATH` env var overrides the location — used by validation/tests to point at a temp DB
 * without touching the real data/app.db. Not set in normal operation.
 */
export function getDbPath(): string {
  return process.env.APP_DB_PATH ?? join(process.cwd(), "data", "app.db");
}

/**
 * Return the shared application database connection, initialising it on first use.
 * Lazy: never opens the DB at module-evaluation time (safe for Next.js build).
 */
export function getDb(): DB {
  if (_db) return _db;

  const db = new Database(getDbPath());
  // Enforce FKs on the real application connection (per-connection pragma).
  db.pragma("foreign_keys = ON");
  // Reasonable durability/concurrency defaults for a local beta.
  db.pragma("journal_mode = WAL");

  // Apply the schema (idempotent — every statement is IF NOT EXISTS).
  const schema = readFileSync(join(process.cwd(), "lib", "db", "schema.sql"), "utf8");
  db.exec(schema);

  _db = db;
  return _db;
}

/** Testing/util helper: close the shared connection (used by validation scripts). */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/** ISO-8601 UTC timestamp helper used by repositories. */
export function nowIso(): string {
  return new Date().toISOString();
}

