// app/api/admin/summary/route.ts
// Task 14 — minimal admin-only RBAC demonstration surface (Layer B authorization).
//
// GET /api/admin/summary
//   - This is a READ-ONLY admin RBAC demonstration. Admin access derives SOLELY from the verified Tide
//     `admin` realm role (read from the DPoP-bound JWT via withRole('admin')): 401 unauthenticated,
//     403 for a non-admin. The requesting admin identity is the VERIFIED JWT vuid ONLY — a
//     client-supplied requester/role/isAdmin field is ignored for authorization.
//   - It exposes ONLY safe AGGREGATE administrative counts — NO private player data. It MUST NOT return
//     private_note_ciphertext (or anything derived from it), per-player balances/notes, or any per-row
//     private field. Counts/aggregates only. The tide_ownership_attestation COUNT is included (a count,
//     not content) to show Layer C is observable but separate; attestation CONTENTS are never returned.
//
// Governance boundary (Task 14.2): a security-sensitive admin change — e.g. granting a role, including
// the Task 11 `_tide_dob.selfencrypt` / `_tide_dob.selfdecrypt` voucher-gate grant — is governed by the
// Tide IGA/QEA change-request mechanism and is NOT applied while the change request is PENDING. This
// endpoint performs NO governance and NO role changes: a user WITHOUT the `admin` role in their verified
// token is treated as a non-admin (403) regardless of any pending/unapplied governed grant
// (deny-by-default). It does NOT touch OwnershipSpike / Forseti / Layer C contents / DPoP /
// data/tidecloak.json, and introduces no application-side approval/quorum state of its own.
import type { NextRequest } from "next/server";
import { withRole } from "@/lib/auth/protect";
import { getAdminSummaryCounts } from "@/lib/db/admin";

export const GET = withRole("admin", async (_req: NextRequest, auth) => {
  // Aggregate counts only (no private player data). requestedByAdminVuid is the VERIFIED admin vuid.
  const summary = getAdminSummaryCounts();
  return Response.json({
    ok: true,
    requestedByAdminVuid: auth.vuid,
    summary,
  });
});
