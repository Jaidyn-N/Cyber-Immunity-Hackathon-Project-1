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
 * HARD allowlist of grantable roles — the realm's actual Tide self-encrypt/decrypt voucher-gate roles.
 * Confirmed against the live realm 2026-10: these `_tide_dob.*` roles exist; the earlier
 * `_tide_privatenote.*` names did NOT exist in this realm and have been corrected.
 * The admin route restricts the grant target to EXACTLY these names; a client can never pass an
 * arbitrary role. Kept here (not in the route file) because Next.js route modules may only export HTTP
 * method handlers + a few framework config fields.
 */
export const PRIVATE_NOTE_ROLE_ALLOWLIST = [
  "_tide_dob.selfencrypt",
  "_tide_dob.selfdecrypt",
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
  /** Target entity id (e.g. the TideCloak user uuid for a USER/GRANT_ROLES CR). Used to match a CR
   *  back to the grant we just initiated when the write responds 204/202 without a usable Location. */
  entityId?: string;
  /** Raw grant rows if TideCloak exposes them (each may carry a ROLE_ID). Match is a nice-to-have. */
  roleIds?: string[];
  /** Creation timestamp if available, so the most-recent CR can be selected when several match. */
  createdAt?: number;
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
 * Obtain an admin bearer token with `manage-realm`. Three supported strategies, all env-driven, tried
 * in priority order:
 *   1. TIDE_ADMIN_TOKEN — a ready-to-use bearer token (simplest; used by ops/scripts).
 *   2. password grant (preferred on a Tide realm) — if TIDE_ADMIN_USERNAME + TIDE_ADMIN_PASSWORD are
 *      set, exchange them with grant_type=password using client_id = TIDE_ADMIN_CLIENT_ID_PW
 *      (default `admin-cli`) against the TOKEN realm TIDE_ADMIN_REALM (default `master`). The
 *      master bootstrap admin mints normally and holds cross-realm manage-realm. NOTE: this changes
 *      ONLY the token-minting realm — the IGA/admin API calls still use `realm` (the Tide realm from
 *      data/tidecloak.json). A client_credentials service account canNOT mint on a Tide realm (it has
 *      no linked Tide identity → empty-body 502), hence the password grant.
 *   3. client-credentials trio: TIDE_ADMIN_TOKEN_URL (or derived), TIDE_ADMIN_CLIENT_ID,
 *      TIDE_ADMIN_CLIENT_SECRET — exchanged for a token at call time (later fallback).
 * If none is configured, FAIL CLOSED. We never silently proceed without an admin credential.
 */
async function resolveAdminToken(baseUrl: string, realm: string): Promise<string> {
  const direct = process.env.TIDE_ADMIN_TOKEN;
  if (direct && direct.trim().length > 0) return direct.trim();

  // Strategy 2: master-realm (or configured realm) password grant.
  const pwUsername = process.env.TIDE_ADMIN_USERNAME;
  const pwPassword = process.env.TIDE_ADMIN_PASSWORD;
  if (pwUsername && pwPassword) {
    const tokenRealm = process.env.TIDE_ADMIN_REALM ?? "master";
    const pwClientId = process.env.TIDE_ADMIN_CLIENT_ID_PW ?? "admin-cli";
    const tokenUrl = `${baseUrl}/realms/${tokenRealm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: "password",
      client_id: pwClientId,
      username: pwUsername,
      password: pwPassword,
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
        `Could not reach the token endpoint to obtain an admin token (password grant): ${(e as Error).message}`
      );
    }
    if (!res.ok) {
      throw new GovernanceUnavailableError(
        `Admin token request failed (${res.status}) via password grant. Governance backend unavailable.`
      );
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new GovernanceUnavailableError(
        "Token endpoint returned no access_token (password grant). Governance backend unavailable."
      );
    }
    return json.access_token;
  }

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
      "TIDE_ADMIN_USERNAME + TIDE_ADMIN_PASSWORD password grant (optional TIDE_ADMIN_REALM, default " +
      "master), or the TIDE_ADMIN_CLIENT_ID + TIDE_ADMIN_CLIENT_SECRET client-credentials trio. " +
      "Refusing to proceed."
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

/** Pull any role ids out of a raw CR's `rows` array (shape varies: ROLE_ID / roleId / role_id / id). */
function roleIdsFromRaw(raw: Record<string, unknown>): string[] | undefined {
  const rows = raw.rows;
  if (!Array.isArray(rows)) return undefined;
  const ids: string[] = [];
  for (const row of rows) {
    if (row && typeof row === "object") {
      const r = row as Record<string, unknown>;
      const candidate = r.ROLE_ID ?? r.roleId ?? r.role_id ?? r.id;
      if (candidate != null) ids.push(String(candidate));
    }
  }
  return ids.length > 0 ? ids : undefined;
}

/** Normalise a raw CR object from TideCloak into our display-only projection. */
function toRef(raw: Record<string, unknown>): ChangeRequestRef {
  const createdRaw = raw.createdAt ?? raw.createdTimestamp ?? raw.created;
  const createdAt =
    typeof createdRaw === "number"
      ? createdRaw
      : typeof createdRaw === "string" && createdRaw.trim() !== "" && !Number.isNaN(Number(createdRaw))
        ? Number(createdRaw)
        : undefined;
  return {
    id: String(raw.id ?? ""),
    status: String(raw.status ?? "PENDING"),
    entityType: raw.entityType != null ? String(raw.entityType) : undefined,
    actionType: raw.actionType != null ? String(raw.actionType) : undefined,
    requestedBy: raw.requestedBy != null ? String(raw.requestedBy) : undefined,
    authorizationCount: typeof raw.authorizationCount === "number" ? raw.authorizationCount : undefined,
    threshold: typeof raw.threshold === "number" ? raw.threshold : undefined,
    readyToCommit: typeof raw.readyToCommit === "boolean" ? raw.readyToCommit : undefined,
    entityId: raw.entityId != null ? String(raw.entityId) : undefined,
    roleIds: roleIdsFromRaw(raw),
    createdAt,
  };
}

/**
 * Look up the TideCloak user id (uuid) for a given Tide `vuid`.
 *
 * On this realm the vuid is NOT the Keycloak username — it is stored as a custom USER ATTRIBUTE named
 * `vuid` (verified live: `?username=<vuid>&exact=true` → 0 results, whereas `?q=vuid:<vuid>&exact=true`
 * → exactly the linked account). So we resolve by the attribute first, then fall back to the username
 * query to preserve behaviour on realms where the vuid IS the username (the spec's original assumption).
 */
async function findUserIdByVuid(env: IgaEnv, targetVuid: string): Promise<string> {
  // 1) Attribute query. Keycloak attribute search uses `q=<name>:<value>`; the colon between name and
  //    value must survive URL-encoding, so encode the value only and keep `vuid:` literal.
  const attrUrl =
    `${env.baseUrl}/admin/realms/${env.realm}/users` +
    `?q=vuid:${encodeURIComponent(targetVuid)}&exact=true`;
  let attrRes: Response;
  try {
    attrRes = await doFetch(attrUrl, { method: "GET", headers: authHeaders(env.token) });
  } catch (e) {
    throw new GovernanceUnavailableError(`Could not reach TideCloak to resolve the target user: ${(e as Error).message}`);
  }
  if (!attrRes.ok) {
    throw new GovernanceUnavailableError(`User lookup failed (${attrRes.status}). Governance backend unavailable.`);
  }
  const attrUsers = (await attrRes.json()) as Array<{ id?: string }>;
  if (Array.isArray(attrUsers) && attrUsers.length > 0 && attrUsers[0]?.id) {
    return String(attrUsers[0].id);
  }

  // 2) Fallback: exact username query (realms where the vuid IS the username).
  const nameUrl =
    `${env.baseUrl}/admin/realms/${env.realm}/users` +
    `?username=${encodeURIComponent(targetVuid)}&exact=true`;
  let nameRes: Response;
  try {
    nameRes = await doFetch(nameUrl, { method: "GET", headers: authHeaders(env.token) });
  } catch (e) {
    throw new GovernanceUnavailableError(`Could not reach TideCloak to resolve the target user: ${(e as Error).message}`);
  }
  if (!nameRes.ok) {
    throw new GovernanceUnavailableError(`User lookup failed (${nameRes.status}). Governance backend unavailable.`);
  }
  const nameUsers = (await nameRes.json()) as Array<{ id?: string }>;
  if (Array.isArray(nameUsers) && nameUsers.length > 0 && nameUsers[0]?.id) {
    return String(nameUsers[0].id);
  }

  // 3) Neither query matched → fail closed with the same message as before.
  throw new GovernanceUnavailableError(`No TideCloak user found for the target vuid.`);
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
 * NOT apply immediately — TideCloak captures it as a change-request and responds with a 2xx. Verified
 * live on this realm: the response is 204 (no body, often no Location) with a PENDING CR created;
 * 202 Accepted + Location → the CR is the other captured-write shape. We treat BOTH as PENDING, NOT
 * granted, resolve the real CR (by Location, else by matching USER/GRANT_ROLES/entityId lookup), and
 * return the CR reference.
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

  // Rejection (4xx/5xx) → fail closed, unchanged behaviour.
  if (!res.ok) {
    throw new GovernanceUnavailableError(
      `Governed role grant was rejected by TideCloak (${res.status}). Governance backend unavailable.`
    );
  }

  // Any 2xx on an IGA-enabled realm means the write was CAPTURED into a change-request, NOT applied.
  // Verified live on this realm: the role-mapping POST returns 204 (no body, often no Location) while a
  // PENDING change-request is created. 202 (with a Location) is the other captured-write shape. We must
  // treat BOTH as governed captures and resolve the real CR — never report a false 503.

  // 1) Prefer the Location header when present (the 202 shape).
  const locId = crIdFromLocation(res.headers.get("location"));
  if (locId) {
    try {
      const ref = await getChangeRequest(locId, env);
      return { pending: true, changeRequest: ref };
    } catch {
      return { pending: true, changeRequest: { id: locId, status: "PENDING" } };
    }
  }

  // 2) No usable Location (the 204 shape) → resolve the CR by LOOKUP, matching THIS grant.
  const pendings = await listPendingChangeRequests(env);
  const matches = pendings.filter(
    (cr) =>
      cr.entityType === "USER" &&
      cr.entityId === userId &&
      cr.actionType === "GRANT_ROLES" &&
      // role-id row match is a nice-to-have: only exclude when rows are present AND do not contain our role.
      (cr.roleIds === undefined || cr.roleIds.includes(role.id))
  );
  if (matches.length === 1) {
    return { pending: true, changeRequest: matches[0] };
  }
  if (matches.length > 1) {
    // Pick the most recent if we have timestamps, otherwise just the first — any correct match is fine.
    const sorted = [...matches].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return { pending: true, changeRequest: sorted[0] };
  }

  // 3) No matching CR found. Distinguish a genuine governance failure from an ungoverned immediate apply
  //    by checking whether the role actually landed on the user.
  const roleApplied = await userHasRealmRole(env, userId, role.id);
  if (roleApplied) {
    // Role applied immediately AND no CR captured → the realm is NOT enforcing governance. Fail closed.
    throw new GovernanceUnavailableError(
      `Role grant returned ${res.status} without an IGA change-request. The realm is not enforcing ` +
        `governance as expected; refusing to report success.`
    );
  }
  // Not applied and no CR found → accepted but we cannot locate the capture. Fail closed.
  throw new GovernanceUnavailableError(
    `Governed role grant accepted (${res.status}) but no matching change-request was found.`
  );
}

/** READ-ONLY: does the user currently hold the given realm role (by role id)? Used only to disambiguate
 *  a captured governed write from an ungoverned immediate apply when no CR could be located. */
async function userHasRealmRole(env: IgaEnv, userId: string, roleId: string): Promise<boolean> {
  const url = `${env.baseUrl}/admin/realms/${env.realm}/users/${encodeURIComponent(userId)}/role-mappings/realm`;
  let res: Response;
  try {
    res = await doFetch(url, { method: "GET", headers: authHeaders(env.token) });
  } catch (e) {
    throw new GovernanceUnavailableError(
      `Could not reach TideCloak to read the user's role mappings: ${(e as Error).message}`
    );
  }
  if (!res.ok) {
    throw new GovernanceUnavailableError(`User role-mapping read failed (${res.status}).`);
  }
  const arr = (await res.json()) as unknown;
  if (!Array.isArray(arr)) return false;
  return arr.some((r) => r && typeof r === "object" && String((r as Record<string, unknown>).id ?? "") === roleId);
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
