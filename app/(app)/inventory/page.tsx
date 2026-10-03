"use client";

// app/(app)/inventory/page.tsx
// Task 15 — Inventory UI. Consumes GET /api/inventory and POST /api/inventory/equip.
// All authed calls go through secureFetch with absolute URLs. The client NEVER sends a vuid — the
// server derives ownership from the verified Tide JWT and enforces it server-side.

import { useCallback, useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";

const API = "http://localhost:3000/api";

type InventoryItem = {
  instanceId: string;
  templateId: string;
  name: string;
  category: string;
  rarity: string;
  tradable: boolean;
  acquiredVia: string;
  acquiredAt: string;
  owned: boolean;
  equipped: boolean;
};

type InventoryResponse = {
  vuid: string;
  equippedInstanceId: string | null;
  count: number;
  items: InventoryItem[];
};

export default function InventoryPage() {
  const { authenticated, secureFetch } = useTideCloak();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [equippedId, setEquippedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await secureFetch(`${API}/inventory`, { method: "GET" });
      if (!res.ok) throw new Error("Could not load your inventory.");
      const data = (await res.json()) as InventoryResponse;
      setItems(data.items);
      setEquippedId(data.equippedInstanceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong loading your inventory.");
    } finally {
      setLoading(false);
    }
  }, [secureFetch]);

  useEffect(() => {
    if (!authenticated) return;
    void load();
  }, [authenticated, load]);

  const sendEquip = useCallback(
    async (instanceId: string | null, markBusy: string) => {
      setBusyId(markBusy);
      setError(null);
      setFeedback(null);
      try {
        const res = await secureFetch(`${API}/inventory/equip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId }), // never a vuid
        });
        if (!res.ok) {
          if (res.status === 403) throw new Error("You do not own that item.");
          if (res.status === 404) throw new Error("That item could not be found.");
          throw new Error("Could not update your equipped item.");
        }
        setFeedback(instanceId === null ? "Item unequipped." : "Item equipped.");
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not update your equipped item.");
      } finally {
        setBusyId(null);
      }
    },
    [secureFetch, load]
  );

  const equippedItem = items.find((i) => i.instanceId === equippedId) ?? null;

  return (
    <section className="panel">
      <h2>Inventory</h2>

      <p>
        Currently equipped:{" "}
        <strong>{equippedItem ? equippedItem.name : "nothing equipped"}</strong>
      </p>

      {feedback && <div className="feedback feedback-ok">{feedback}</div>}
      {error && <div className="feedback feedback-err">{error}</div>}

      {loading ? (
        <p className="empty-state">Loading your items…</p>
      ) : items.length === 0 ? (
        <p className="empty-state">You own no items yet. Visit the shop to get started.</p>
      ) : (
        <div className="card-grid">
          {items.map((item) => {
            const isEquipped = item.instanceId === equippedId;
            return (
              <div className="card" key={item.instanceId}>
                <span className="card-title">
                  {item.name} {isEquipped && <span className="badge badge-equipped">Equipped</span>}
                </span>
                <span className="card-meta">{item.category}</span>
                <span className="badge badge-rarity">{item.rarity}</span>
                <span className="card-meta">
                  {item.tradable ? "Tradable" : "Not tradable"} · via {item.acquiredVia}
                </span>
                <div className="card-foot">
                  {isEquipped ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void sendEquip(null, item.instanceId)}
                      disabled={busyId !== null}
                    >
                      {busyId === item.instanceId ? "…" : "Unequip"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void sendEquip(item.instanceId, item.instanceId)}
                      disabled={busyId !== null}
                    >
                      {busyId === item.instanceId ? "…" : "Equip"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
