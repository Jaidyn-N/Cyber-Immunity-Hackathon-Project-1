"use client";

// app/(app)/admin/page.tsx
// Task 15 — minimal read-only admin summary. Consumes GET /api/admin/summary (Task 14), which is
// protected server-side by withRole('admin'). The nav only SHOWS the Admin link when the Tide context
// reports hasRealmRole('admin'); this page additionally handles a 403 gracefully. The server is the
// sole authority — a non-admin who navigates here directly gets "Admin access required."
//
// This is intentionally a tiny read-only counts view. It does NOT reproduce any approval/quorum/
// role-grant/QEA UI.

import { useCallback, useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";

const API = "http://localhost:3000/api";

type Summary = {
  players: number;
  itemInstances: number;
  activeListings: number;
  soldListings: number;
  cancelledListings: number;
  marketplaceTransactions: number;
  activeShopOffers: number;
  attestations: number;
};

export default function AdminPage() {
  const { authenticated, secureFetch } = useTideCloak();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await secureFetch(`${API}/admin/summary`, { method: "GET" });
      if (res.status === 403) {
        setError("Admin access required.");
        return;
      }
      if (!res.ok) throw new Error("Could not load the admin summary.");
      const data = (await res.json()) as { summary: Summary };
      setSummary(data.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the admin summary.");
    } finally {
      setLoading(false);
    }
  }, [secureFetch]);

  useEffect(() => {
    if (!authenticated) return;
    void load();
  }, [authenticated, load]);

  const rows: { label: string; key: keyof Summary }[] = [
    { label: "Players", key: "players" },
    { label: "Item instances", key: "itemInstances" },
    { label: "Active listings", key: "activeListings" },
    { label: "Sold listings", key: "soldListings" },
    { label: "Cancelled listings", key: "cancelledListings" },
    { label: "Marketplace transactions", key: "marketplaceTransactions" },
    { label: "Active shop offers", key: "activeShopOffers" },
    { label: "Attestations", key: "attestations" },
  ];

  return (
    <section className="panel">
      <h2>Admin summary</h2>
      <p className="hint">Read-only counts. Access is enforced server-side (admin role required).</p>

      {error && <div className="feedback feedback-err">{error}</div>}

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : summary === null ? (
        !error && <p className="empty-state">No data.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.key}>
              {r.label}: <strong>{summary[r.key]}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
