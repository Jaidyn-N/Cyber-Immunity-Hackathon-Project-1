// lib/auth/tideJWT.ts
// Server-side Tide JWT verification. Uses the embedded JWKS (local only — never remote, I-04),
// validates issuer + azp + exp/iat, and extracts the authenticated vuid. DPoP binding (cnf.jkt) is
// asserted in protect.ts (withAuth). Signature is ALWAYS verified — a token is never trusted decoded.
import { jwtVerify, createLocalJWKSet } from "jose";
import type { JSONWebKeySet } from "jose";
import type { JWTPayload } from "jose";
import { loadTideConfig, expectedIssuer } from "./tidecloakConfig";

if (typeof window !== "undefined") {
  throw new Error("lib/auth/tideJWT must not be imported from client-side code (server-only).");
}

let _jwks: ReturnType<typeof createLocalJWKSet> | null = null;

/** Build the local JWK set once from the adapter''s embedded keys. */
function getJwks(): ReturnType<typeof createLocalJWKSet> {
  if (!_jwks) {
    const cfg = loadTideConfig();
    _jwks = createLocalJWKSet(cfg.jwk as unknown as JSONWebKeySet);
  }
  return _jwks;
}

/** Shape we rely on from a verified Tide access token. */
export interface VerifiedTideToken extends JWTPayload {
  vuid?: string;
  azp?: string;
  cnf?: { jkt?: string };
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}

/**
 * Verify a Tide access token: signature (local JWKS) + issuer + azp + exp/iat, and require a
 * non-empty `vuid`. Returns the payload or throws. Does NOT check cnf.jkt (that is withAuth''s job so
 * the DPoP failure is a distinct, explicit gate).
 */
export async function verifyTideJWT(token: string): Promise<VerifiedTideToken> {
  const cfg = loadTideConfig();

  const { payload } = await jwtVerify(token, getJwks(), { issuer: expectedIssuer(cfg) });
  const p = payload as VerifiedTideToken;

  // TideCloak access tokens carry the client id in `azp` (aud is typically "account").
  if (p.azp !== cfg.resource) {
    throw new Error("Token azp does not match the configured client");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof p.exp === "number" && p.exp < now) throw new Error("Token expired");
  if (typeof p.iat === "number" && p.iat > now + 60) throw new Error("Token issued in the future");

  if (!p.vuid || String(p.vuid).trim().length === 0) {
    throw new Error("Token missing a non-empty vuid");
  }

  return p;
}

/** True if the verified token carries `role` in realm roles or any client''s resource roles. */
export function hasRole(payload: VerifiedTideToken, role: string): boolean {
  if (payload.realm_access?.roles?.includes(role)) return true;
  const ra = payload.resource_access;
  if (ra) {
    for (const client of Object.values(ra)) {
      if (client?.roles?.includes(role)) return true;
    }
  }
  return false;
}

/** Extract the token from an Authorization header. Accepts Bearer and DPoP schemes. */
export function extractToken(authHeader: string | null): string {
  if (!authHeader) throw new Error("Missing Authorization header");
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  if (authHeader.startsWith("DPoP ")) return authHeader.slice(5);
  throw new Error("Invalid Authorization header scheme");
}

/** Test-only reset of the memoised JWK set. */
export function _resetJwksForTests(): void {
  _jwks = null;
}

