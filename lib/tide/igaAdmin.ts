// lib/tide/igaAdmin.ts
// Task 11 — server-side client for the EXISTING Tide IGA / QEA (Quorum Enforced Authorization)
// change-request REST surface. This is the ONLY governance mechanism: there is NO application-level
// approval table, quorum logic, or QEA state anywhere in this app. The app merely INITIATES a governed
// role grant and READS its change-request status; approval + commit happen in the Tide admin enclave.
//
// Governed admin writes on an IGA-enabled realm do NOT apply immediately: the Keycloak admin
// role-mapping call is CAPTURED into a change-request and responds 202 Accepted with a `Location`
// header pointing at the new CR. On this realm (MultiAdmin / Tide mode) the CR can only be
// APPROVED + committed by a human browser-enclave signature — a headless process cannot complete it by
// design (that is the security property). Accordingly this module exposes INITIATE + READ-ONLY status
// helpers only, and deliberately contains NO approve/commit automation.
//
// Config/realm name follow the lib/auth/tidecloakConfig.ts pattern (realm from data/tidecloak.json).
// Admin credentials + base URL come from env; if none are configured the functions FAIL CLOSED with a
// clear error (never a silent success). Reference: Tide canon iga-change-requests-api (verified surface
// at {base}/admin/realms/{realm}/iga/change-requests/...).
//
// SERVER-ONLY. Must never be imported from a client component.
import { loadTideConfig } from "../auth/tidecloakConfig";

if (typeof window !== "undefined") {
  throw new Error("lib/tide/igaAdmin must not be imported from client-side code (server-only).");
}

/**
 * HARD allowlist of grantable roles — the private-note voucher-gate roles from design.md / tasks.md.
 * The admin route restricts the grant target to EXACTLY these names; a client can never pass an
 * arbitrary role. Kept here (not in the route file) because Next.js route modules may only export HTTP
 * method handlers + a few framework config fields.
 */
export const PRIVATE_NOTE_ROLE_ALLOWLIST = [
  "_tide_privatenote.selfencrypt",
  "_tide_privatenote.selfdecrypt",
] as const;

/** Raised when the governance backend (TideCloak IGA) is not configured or not reachable. Fail closed. */
export class GovernanceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceUnavailableError";
  }
}

/** A minimal projection of an IGA change-request, for status display only (never approval state we own). */
export interface ChangeRequestRef {
  id: string;
  status: string; // PENDING | APPROVED | DENIED | CANCELLED (reported by TideCloak, not stored by us)
  entityType?: string;
  actionType?: string;
  requestedBy?: string;
  authorizationCount?: number;
  threshold?: number;
  readyToCommit?: boolean;
}

/**
 * Optional fetch injection seam. Validation scripts set this to a fake so the ROUTE's behaviour can be
 * asserted without a live TideCloak. In normal operation it is null and globalThis.fetch is used.
 * Using a stub here NEVER means live QEA was exercised — it only exercises app-side wiring.
 */
let _fetchImpl: typeof fetch | null = null;
export function _setFetchForTests(f: typeof fetch | null): void {
  _fetchImpl = f;
}
function doFetch(input: string, init?: RequestInit): Promise<Response> {
  const f = _fetchImpl ?? globalThis.fetch;
  if (typeof f !== "function") {
    throw new GovernanceUnavailableError("No fetch implementation available for the IGA client.");
  }
  return f(input, init);
}

interface IgaEnv {
  baseUrl: string;
  realm: string;
  token: string;
}

/** Base URL for TideCloak, trailing slash trimmed. Prefers env, falls back to the adapter JSON. */
function resolveBaseUrl(): string {
  const fromEnv = process.env.TIDECLOAK_BASE_URL ?? process.env.TIDECLOAK_URL;
  const raw = fromEnv ?? (loadTideConfig()["auth-server-url"] as string | undefined);
  if (!raw || raw.trim().length === 0) {
    throw new GovernanceUnavailableError(
      "TideCloak base URL is not configured (set TIDECLOAK_BASE_URL). Governance backend unavailable."
    );
  }
  return raw.replace(/\/+$/, "");
}

/** Realm name — reuse the single config source (data/tidecloak.json), never hard-coded. */
function resolveRealm(): string {
  const realm = loadTideConfig().realm;
  if (!realm || realm.trim().length === 0) {
    throw new GovernanceUnavailableError("Realm is not configured in the adapter JSON. Governance backend unavailable.");
  }
  return realm;
}

/**
 * Obtain an admin bearer token with `manage-realm`. Two supported strategies, both env-driven:
 *   1. TIDE_ADMIN_TOKEN — a ready-to-use bearer token (simplest; used by ops/scripts).
 *   2. client-credentials trio: TIDE_ADMIN_TOKEN_URL (or derived), TIDE_ADMIN_CLIENT_ID,
 *      TIDE_ADMIN_CLIENT_SECRET — exchanged for a token at call time.
 * If neither is configured, FAIL CLOSED. We never silently proceed without an admin credential.
 */
async function resolveAdminToken(baseUrl: string, realm: string): Promise<string> {
  const direct = process.env.TIDE_ADMIN_TOKEN;
  if (direct && direct.trim().length > 0) return direct.trim();

  const clientId = process.env.TIDE_ADMIN_CLIENT_ID;
  const clientSecret = process.env.TIDE_ADMIN_CLIENT_SECRET;
  if (clientId && clientSecret) {
    const tokenUrl =
      process.env.TIDE_ADMIN_TOKEN_URL ?? `${baseUrl}/realms/${realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    let res: Response;
    try {
      res = await doFetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } catch (e) {
      throw new GovernanceUnavailableError(
        `Could not reach the token endpoint to obtain an admin token: ${(e as Error).message}`
      );
    }
    if (!res.ok) {
      throw new GovernanceUnavailableError(
        `Admin token request failed (${res.status}). Governance backend unavailable.`
      );
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new GovernanceUnavailableError("Token endpoint returned no access_token. Governance backend unavailable.");
    }
    return json.access_token;
  }

  throw new GovernanceUnavailableError(
    "No admin credential configured for IGA governance. Set TIDE_ADMIN_TOKEN, or the " +
      "TIDE_ADMIN_CLIENT_ID + TIDE_ADMIN_CLIENT_SECRET client-credentials trio. Refusing to proceed."
  );
}

/** Resolve base URL + realm + admin token together (fail closed if anything is missing). */
async function resolveEnv(): Promise<IgaEnv> {
  const baseUrl = resolveBaseUrl();
  const realm = resolveRealm();
  const token = await resolveAdminToken(baseUrl, realm);
  return { baseUrl, realm, token };
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** Extract a change-request id from a `Location` header pointing at .../change-requests/{id}. */
function crIdFromLocation(location: string | null): string | undefined {
  if (!location) return undefined;
  const m = location.match(/change-requests\/([^/?#]+)/);
  return m?.[1];
}

/** Normalise a raw CR object from TideCloak into our display-only projection. */
function toRef(raw: Record<string, unknown>): ChangeRequestRef {
  return {
    id: String(raw.id ?? ""),
    status: String(raw.status ?? "PENDING"),
    entityType: raw.entityType != null ? String(raw.entityType) : undefined,
    actionType: raw.actionType != null ? String(raw.actionType) : undefined,
    requestedBy: raw.requestedBy != null ? String(raw.requestedBy) : undefined,
    authorizationCount: typeof raw.authorizationCount === "number" ? raw.authorizationCount : undefined,
    threshold: typeof raw.threshold === "number" ? raw.threshold : undefined,
    readyToCommit: typeof raw.readyToCommit === "boolean" ? raw.readyToCommit : undefined,
  };
}

/** Look up the TideCloak user id (uuid) for a given Tide `vuid`. */
async function findUserIdByVuid(env: IgaEnv, targetVuid: string): Promise<string> {
  // The vuid is stored as the username on Tide-linked accounts. Query by exact username.
  const url =
    `${env.baseUrl}/admin/realms/${env.realm}/users` +
    `?username=${encodeURIComponent(targetVuid)}&exact=true`;
  let res: Response;
  try {
    res = await doFetch(url, { method: "GET", headers: authHeaders(env.token) });
  } catch (e) {
    throw new GovernanceUnavailableError(`Could not reach TideCloak to resolve the target user: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new GovernanceUnavailableError(`User lookup failed (${res.status}). Governance backend unavailable.`);
  }
  const users = (await res.json()) as Array<{ id?: string }>;
  if (!Array.isArray(users) || users.length === 0 || !users[0]?.id) {
    throw new GovernanceUnavailableError(`No TideCloak user found for the target vuid.`);
  }
  return String(users[0].id);
}

/** Resolve a realm role representation (needs id + name for the role-mapping call). */
async function findRealmRole(env: IgaEnv, roleName: string): Promise<{ id: string; name: string }> {
  const url = `${env.baseUrl}/admin/realms/${env.realm}/roles/${encodeURIComponent(roleName)}`;
  let res: Response;
  try {
    res = await doFetch(url, { method: "GET", headers: authHeaders(env.token) });
  } catch (e) {
    throw new GovernanceUnavailableError(`Could not reach TideCloak to resolve the role: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new GovernanceUnavailableError(`Role lookup failed (${res.status}) for "${roleName}".`);
  }
  const role = (await res.json()) as { id?: string; name?: string };
  if (!role?.id || !role?.name) {
    throw new GovernanceUnavailableError(`Role "${roleName}" not found on the realm.`);
  }
  return { id: String(role.id), name: String(role.name) };
}

export interface InitiateResult {
  /** Always true here: an IGA realm captures the write into a PENDING change-request, not an applied grant. */
  pending: true;
  changeRequest: ChangeRequestRef;
}

/**
 * INITIATE a governed grant of `roleName` to `targetVuid` through the EXISTING Tide IGA/QEA mechanism.
 *
 * Performs the standard Keycloak admin realm role-mapping write
 * (`POST /admin/realms/{realm}/users/{userId}/role-mappings/realm`). On an IGA-enabled realm this does
 * NOT apply immediately — TideCloak responds 202 Accepted and captures it as a change-request
 * (Location → the CR). We treat the result as PENDING, NOT granted, and return the CR reference.
 *
 * This method intentionally performs NO approve/commit — on MultiAdmin that requires a human enclave
 * signature (POST /iga/change-requests/{id}/approve) which a headless process cannot complete.
 *
 * NOTE: the role allowlist is enforced by the ROUTE before this is called; this module does not invent
 * or widen targets.
 */
export async function initiateRoleGrantChangeRequest(args: {
  targetVuid: string;
  roleName: string;
}): Promise<InitiateResult> {
  const { targetVuid, roleName } = args;
  const env = await resolveEnv();

  const userId = await findUserIdByVuid(env, targetVuid);
  const role = await findRealmRole(env, roleName);

  const url = `${env.baseUrl}/admin/realms/${env.realm}/users/${encodeURIComponent(userId)}/role-mappings/realm`;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: authHeaders(env.token),
      body: JSON.stringify([{ id: role.id, name: role.name }]),
    });
  } catch (e) {
    throw new GovernanceUnavailableError(
      `Could not reach TideCloak to initiate the governed role grant: ${(e as Error).message}`
    );
  }

  // Expected on an IGA realm: 202 Accepted + Location → the pending change-request.
  if (res.status === 202) {
    const id = crIdFromLocation(res.headers.get("location"));
    if (id) {
      // Best-effort status read for display; if it fails we still report PENDING with the id.
      try {
        const ref = await getChangeRequest(id, env);
        return { pending: true, changeRequest: ref };
      } catch {
        return { pending: true, changeRequest: { id, status: "PENDING" } };
      }
    }
    // 202 but no Location — surface the newest pending CR as a best effort.
    const pendings = await listPendingChangeRequests(env);
    if (pendings.length > 0) return { pending: true, changeRequest: pendings[0] };
    return { pending: true, changeRequest: { id: "(unknown)", status: "PENDING" } };
  }

  // A 2xx that is NOT 202 would mean the write applied immediately — which must NOT happen on an IGA
  // realm. Treat anything other than a 202-captured CR as a governance backend problem (fail closed).
  if (res.ok) {
    throw new GovernanceUnavailableError(
      `Role grant returned ${res.status} without an IGA change-request. The realm is not enforcing ` +
        `governance as expected; refusing to report success.`
    );
  }

  throw new GovernanceUnavailableError(
    `Governed role grant was rejected by TideCloak (${res.status}). Governance backend unavailable.`
  );
}

/** READ-ONLY: fetch a single change-request by id (status display only). */
export async function getChangeRequest(id: string, injectedEnv?: IgaEnv): Promise<ChangeRequestRef> {
  const env = injectedEnv ?? (await resolveEnv());
  const url = `${env.baseUrl}/admin/realms/${env.realm}/iga/change-requests/${encodeURIComponent(id)}`;
  let res: Response;
  try {
    res = await doFetch(url, { method: "GET", headers: authHeaders(env.token) });
  } catch (e) {
    throw new GovernanceUnavailableError(`Could not reach TideCloak to read the change-request: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new GovernanceUnavailableError(`Change-request read failed (${res.status}).`);
  }
  return toRef((await res.json()) as Record<string, unknown>);
}

/** READ-ONLY: list PENDING change-requests (status display only). */
export async function listPendingChangeRequests(injectedEnv?: IgaEnv): Promise<ChangeRequestRef[]> {
  const env = injectedEnv ?? (await resolveEnv());
  const url = `${env.baseUrl}/admin/realms/${env.realm}/iga/change-requests?status=PENDING`;
  let res: Response;
  try {
    res = await doFetch(url, { method: "GET", headers: authHeaders(env.token) });
  } catch (e) {
    throw new GovernanceUnavailableError(`Could not reach TideCloak to list change-requests: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new GovernanceUnavailableError(`Change-request list failed (${res.status}).`);
  }
  const arr = (await res.json()) as unknown;
  if (!Array.isArray(arr)) return [];
  return arr.map((r) => toRef(r as Record<string, unknown>));
}
