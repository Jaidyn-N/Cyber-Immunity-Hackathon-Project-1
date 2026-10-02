// app/api/admin/private-note-role/route.ts
// Task 11 — QEA-governed, admin-only role grant INITIATION (Layer B / Tide IGA governance).
//
// POST /api/admin/private-note-role  { targetVuid: string, role: string }
//   - Guarded by withRole('admin'): 401 unauthenticated, 403 for a non-admin. The requesting ADMIN
//     identity is the VERIFIED JWT vuid ONLY — a client-supplied admin/requester field is ignored.
//   - `role` is validated against a HARD server-side allowlist (the private-note voucher-gate roles).
//     Anything outside the allowlist is rejected (422) BEFORE any change-request is initiated — a client
//     can never grant an arbitrary role (e.g. admin, realm-management).
//   - `targetVuid` must be a 64-hex Tide vuid.
//   - On success the grant is submitted through the EXISTING Tide IGA/QEA change-request mechanism and
//     reported as PENDING, NOT granted. The role becomes effective only after the Tide QEA quorum
//     APPROVES + commits via the admin browser enclave (POST /iga/change-requests/{id}/approve) — a
//     human step a headless process cannot perform by design. We never report a 2xx as "granted".
//
// This demonstrates Tide GOVERNANCE (Layer B / IGA), NOT Layer C cryptographic item ownership. It does
// NOT create any application approval/quorum table or QEA state — Tide IGA is the sole governance
// mechanism. It does NOT touch OwnershipSpike, tide_ownership_attestation, the marketplace/ownership
// logic, DPoP/auth config, data/tidecloak.json, or lib/db/schema.sql.
import type { NextRequest } from "next/server";
import { withRole } from "@/lib/auth/protect";
import {
  initiateRoleGrantChangeRequest,
  getChangeRequest,
  listPendingChangeRequests,
  GovernanceUnavailableError,
  PRIVATE_NOTE_ROLE_ALLOWLIST,
} from "@/lib/tide/igaAdmin";

const VUID_RE = /^[0-9a-f]{64}$/i;

const PENDING_MESSAGE =
  "Role grant submitted as an IGA change request; it is NOT granted until the Tide QEA quorum " +
  "approves and commits via the admin enclave.";

/** Map a governance-backend failure to a clear 5xx (never a pretend success). */
function governanceUnavailable(e: unknown): Response {
  const message = e instanceof GovernanceUnavailableError ? e.message : "Governance backend unavailable.";
  return Response.json(
    { ok: false, error: "Governance backend unavailable", detail: message },
    { status: 503 }
  );
}

export const POST = withRole("admin", async (req: NextRequest, auth) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const targetVuid = (body as { targetVuid?: unknown } | null)?.targetVuid;
  const role = (body as { role?: unknown } | null)?.role;

  if (typeof targetVuid !== "string" || !VUID_RE.test(targetVuid)) {
    return Response.json({ error: "targetVuid must be a 64-hex Tide vuid" }, { status: 400 });
  }
  if (typeof role !== "string" || role.length === 0) {
    return Response.json({ error: "role must be a non-empty string" }, { status: 400 });
  }

  // HARD allowlist check — reject BEFORE any change-request is initiated.
  if (!(PRIVATE_NOTE_ROLE_ALLOWLIST as readonly string[]).includes(role)) {
    return Response.json(
      {
        error: "Role not permitted",
        detail: "Only the private-note voucher-gate roles may be granted through this endpoint.",
        allowed: PRIVATE_NOTE_ROLE_ALLOWLIST,
      },
      { status: 422 }
    );
  }

  // Requesting admin = verified JWT vuid ONLY (used for audit/logging; never taken from the body).
  const requestedByAdminVuid = auth.vuid;

  let result;
  try {
    result = await initiateRoleGrantChangeRequest({ targetVuid, roleName: role });
  } catch (e) {
    return governanceUnavailable(e);
  }

  return Response.json({
    ok: true,
    status: "pending", // PENDING governance approval — the role is NOT yet effective.
    message: PENDING_MESSAGE,
    requestedBy: requestedByAdminVuid,
    targetVuid,
    role,
    changeRequest: { id: result.changeRequest.id, status: result.changeRequest.status },
  });
});

/**
 * GET /api/admin/private-note-role  (optionally ?id=<changeRequestId>)
 * Read-only status of the relevant change-request(s) for display. Admin-only. No approval happens here.
 */
export const GET = withRole("admin", async (req: NextRequest) => {
  const id = new URL(req.url).searchParams.get("id");
  try {
    if (id) {
      const cr = await getChangeRequest(id);
      return Response.json({ ok: true, changeRequest: cr });
    }
    const pending = await listPendingChangeRequests();
    return Response.json({ ok: true, pending });
  } catch (e) {
    return governanceUnavailable(e);
  }
});
