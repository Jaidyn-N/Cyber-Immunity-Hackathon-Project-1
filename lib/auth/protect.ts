// lib/auth/protect.ts
// Server-side authorization boundary for API routes: withAuth / withRole.
// The authenticated identity ALWAYS comes from the verified Tide JWT (never a client-supplied vuid).
// DPoP binding is asserted here via cnf.jkt (fail closed). We do NOT re-verify the secureFetch DPoP
// proof itself (Tide-specific, not RFC 9449 compact JWS) — asserting cnf.jkt is the correct check (I-12).
import type { NextRequest } from "next/server";
import { verifyTideJWT, hasRole, extractToken } from "./tideJWT";
import type { VerifiedTideToken } from "./tideJWT";

if (typeof window !== "undefined") {
  throw new Error("lib/auth/protect must not be imported from client-side code (server-only).");
}

// The realm issues DPoP-bound tokens (dpop.bound.access.tokens=true; useDPoP strict/ES256). A token
// without cnf.jkt is a downgrade/misconfig — reject it. Not a supported configuration to disable (I-12).
const REQUIRE_DPOP = true;

/** The verified auth context handed to protected handlers. `vuid` is the trusted identity. */
export interface AuthContext {
  vuid: string;
  token: VerifiedTideToken;
}

export type AuthedHandler = (req: NextRequest, auth: AuthContext) => Promise<Response> | Response;

function unauthorized(): Response {
  // Generic body — do not leak which check failed.
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Wrap a route handler so it only runs for a verified, DPoP-bound Tide session.
 * Provides the verified vuid via AuthContext. Rejects unauthenticated/invalid/unbound requests (401).
 */
export function withAuth(handler: AuthedHandler) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      const token = extractToken(req.headers.get("authorization"));
      const payload = await verifyTideJWT(token);

      if (REQUIRE_DPOP && !payload.cnf?.jkt) {
        return unauthorized(); // DPoP-bound token required; missing binding => reject
      }

      const auth: AuthContext = { vuid: String(payload.vuid), token: payload };
      return await handler(req, auth);
    } catch {
      return unauthorized();
    }
  };
}

/**
 * Wrap a route handler so it only runs for a verified session that also holds `role`.
 * Role comes from verified token claims only — never from body/query. 401 if unauth, 403 if wrong role.
 */
export function withRole(role: string, handler: AuthedHandler) {
  return withAuth(async (req, auth) => {
    if (!hasRole(auth.token, role)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(req, auth);
  });
}
