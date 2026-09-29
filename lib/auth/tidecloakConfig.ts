// lib/auth/tidecloakConfig.ts
// Server-side loader for the TideCloak adapter JSON. Provides the embedded JWKS + issuer/azp used by
// server-side JWT verification. Does NOT modify or replace the existing client TideCloak integration.
//
// Loading priority: CLIENT_ADAPTER env (JSON string) > data/tidecloak.json. Local JWKS only (I-04):
// the `jwk` field MUST be present; we never fetch remote JWKS.
import { readFileSync } from "node:fs";
import { join } from "node:path";

if (typeof window !== "undefined") {
  throw new Error("lib/auth/tidecloakConfig must not be imported from client-side code (server-only).");
}

export interface TidecloakConfig {
  realm: string;
  "auth-server-url": string;
  resource: string;
  "public-client"?: boolean;
  "confidential-port"?: number;
  jwk: { keys: Array<Record<string, unknown>> };
  vendorId?: string;
  homeOrkUrl?: string;
  [key: string]: unknown;
}

let _config: TidecloakConfig | null = null;

/** Load the adapter config once (memoised). Throws if the embedded `jwk` is missing (setup failure). */
export function loadTideConfig(): TidecloakConfig {
  if (_config) return _config;

  let raw: string;
  if (process.env.CLIENT_ADAPTER) {
    raw = process.env.CLIENT_ADAPTER;
  } else {
    raw = readFileSync(join(process.cwd(), "data", "tidecloak.json"), "utf-8");
  }
  const cfg = JSON.parse(raw) as TidecloakConfig;

  if (!cfg.jwk || !Array.isArray(cfg.jwk.keys) || cfg.jwk.keys.length === 0) {
    throw new Error(
      "Adapter JSON missing `jwk` — required for local Tide JWT verification (I-04). " +
        "Re-export the adapter from TideCloak; do not fall back to remote JWKS."
    );
  }

  _config = cfg;
  return _config;
}

/** The exact issuer string TideCloak signs into tokens: <auth-server-url (no trailing slash)>/realms/<realm>. */
export function expectedIssuer(cfg: TidecloakConfig = loadTideConfig()): string {
  return `${cfg["auth-server-url"].replace(/\/+$/, "")}/realms/${cfg.realm}`;
}

/** Test-only reset of the memoised config. */
export function _resetConfigForTests(): void {
  _config = null;
}
