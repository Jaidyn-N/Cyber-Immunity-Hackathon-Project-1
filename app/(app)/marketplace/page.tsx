"use client";

// app/(app)/marketplace/page.tsx
// Task 15 — Marketplace UI (three sections: Browse / Create listing / My listings).
// Consumes GET /api/marketplace, GET/POST /api/marketplace/list, DELETE /api/marketplace/list/{id},
// POST /api/marketplace/obtain, plus GET /api/inventory and GET /api/me for eligibility + balance.
//
// IMPORTANT: "Obtain" performs a TEMPORARY APPLICATION-LEVEL ownership change (Layer A only). It is
// NOT a Tide-backed ownership transfer. The client sends ONLY listingId on obtain and ONLY
// {instanceId, price} on list — never buyer/seller/owner vuids. The server is authoritative.

import { useCallback, useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";

const API = "http://localhost:3000/api";

type BrowseListing = {
  listingId: string;
  instanceId: string;
  sellerVuid: string;
  price: number;
  name: string;
  category: string;
  rarity: string;
  createdAt: string;
};

type MyListing = {
  listingId: string;
  instanceId: string;
  price: number;
  status: string;
  createdAt: string;
};

type InventoryItem = {
  instanceId: string;
  name: string;
  tradable: boolean;
  equipped: boolean;
};

/** Short, non-sensitive display form of a vuid. */
function shortId(vuid: string): string {
  return vuid.length > 10 ? `${vuid.slice(0, 6)}…${vuid.slice(-4)}` : vuid;
}

export default function MarketplacePage() {
  const { authenticated, secureFetch } = useTideCloak();

  const [browse, setBrowse] = useState<BrowseListing[]>([]);
  const [mine, setMine] = useState<MyListing[]>([]);
  const [eligible, setEligible] = useState<InventoryItem[]>([]);
  const [balance, setBalance] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [selectedInstance, setSelectedInstance] = useState("");
  const [priceInput, setPriceInput] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mkRes, mineRes, invRes, meRes] = await Promise.all([
        secureFetch(`${API}/marketplace`, { method: "GET" }),
        secureFetch(`${API}/marketplace/list`, { method: "GET" }),
        secureFetch(`${API}/inventory`, { method: "GET" }),
        secureFetch(`${API}/me`, { method: "GET" }),
      ]);
      if (!mkRes.ok || !mineRes.ok || !invRes.ok || !meRes.ok) {
        throw new Error("Could not load the marketplace.");
      }
      const mk = (await mkRes.json()) as { listings: BrowseListing[] };
      const my = (await mineRes.json()) as { listings: MyListing[] };
      const inv = (await invRes.json()) as { items: InventoryItem[] };
      const me = (await meRes.json()) as { player: { currencyBalance: number } };

      setBrowse(mk.listings);
      setMine(my.listings);
      setEligible(inv.items.filter((i) => i.tradable && !i.equipped));
      setBalance(me.player.currencyBalance);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong loading the marketplace.");
    } finally {
      setLoading(false);
    }
  }, [secureFetch]);

  useEffect(() => {
    if (!authenticated) return;
    void loadAll();
  }, [authenticated, loadAll]);

  const handleObtain = useCallback(
    async (listingId: string) => {
      setBusy(true);
      setError(null);
      setFeedback(null);
      try {
        const res = await secureFetch(`${API}/marketplace/obtain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId }), // ONLY listingId
        });
        if (!res.ok) {
          if (res.status === 402) throw new Error("Insufficient funds.");
          if (res.status === 409) throw new Error("This listing is no longer available.");
          if (res.status === 404) throw new Error("Listing not found.");
          throw new Error("Could not complete the transfer.");
        }
        const data = (await res.json()) as { message: string; buyerNewBalance: number };
        setBalance(data.buyerNewBalance);
        // Use the API's own wording and make the Layer A nature explicit.
        setFeedback(
          `${data.message}. Note: this is a temporary application-level ownership change, ` +
            `NOT a Tide-backed ownership transfer.`
        );
        await loadAll();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not complete the transfer.");
      } finally {
        setBusy(false);
      }
    },
    [secureFetch, loadAll]
  );

  const handleCreateListing = useCallback(async () => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const price = Number.parseInt(priceInput, 10);
      if (!selectedInstance) throw new Error("Pick an item to list.");
      if (!Number.isInteger(price) || price <= 0) throw new Error("Enter a valid whole-number price.");

      const res = await secureFetch(`${API}/marketplace/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: selectedInstance, price }), // never sellerVuid
      });
      if (!res.ok) {
        if (res.status === 403) throw new Error("You do not own that item.");
        if (res.status === 409) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (body.error === "equipped") throw new Error("Unequip the item before listing it.");
          if (body.error === "already_listed") throw new Error("That item is already listed.");
          if (body.error === "not_tradable") throw new Error("That item is not tradable.");
          throw new Error("That item cannot be listed right now.");
        }
        if (res.status === 404) throw new Error("That item could not be found.");
        throw new Error("Could not create the listing.");
      }
      setFeedback("Listing created.");
      setSelectedInstance("");
      setPriceInput("");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the listing.");
    } finally {
      setBusy(false);
    }
  }, [secureFetch, selectedInstance, priceInput, loadAll]);

  const handleCancel = useCallback(
    async (listingId: string) => {
      setBusy(true);
      setError(null);
      setFeedback(null);
      try {
        const res = await secureFetch(`${API}/marketplace/list/${listingId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          if (res.status === 403) throw new Error("You can only cancel your own listings.");
          if (res.status === 404) throw new Error("Listing not found.");
          if (res.status === 409) throw new Error("This listing can no longer be cancelled.");
          throw new Error("Could not cancel the listing.");
        }
        setFeedback("Listing cancelled.");
        await loadAll();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not cancel the listing.");
      } finally {
        setBusy(false);
      }
    },
    [secureFetch, loadAll]
  );

  return (
    <>
      <section className="panel">
        <h2>Marketplace</h2>
        <p className="balance">Balance: {balance === null ? "…" : balance}</p>
        <p className="hint">
          Obtaining a listing performs a temporary application-level ownership change (Layer A only).
          This is NOT a Tide-backed ownership transfer.
        </p>
        {feedback && <div className="feedback feedback-ok">{feedback}</div>}
        {error && <div className="feedback feedback-err">{error}</div>}
      </section>

      <section className="panel">
        <h2>Browse listings</h2>
        {loading ? (
          <p className="empty-state">Loading listings…</p>
        ) : browse.length === 0 ? (
          <p className="empty-state">No active listings right now.</p>
        ) : (
          <div className="card-grid">
            {browse.map((l) => (
              <div className="card" key={l.listingId}>
                <span className="card-title">{l.name}</span>
                <span className="card-meta">{l.category}</span>
                <span className="badge badge-rarity">{l.rarity}</span>
                <span className="card-meta">Seller: {shortId(l.sellerVuid)}</span>
                <div className="card-foot">
                  <span className="price">{l.price}</span>
                  <button type="button" onClick={() => void handleObtain(l.listingId)} disabled={busy}>
                    Obtain
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Create a listing</h2>
        {eligible.length === 0 ? (
          <p className="empty-state">
            You have no eligible items to list (an item must be tradable and not equipped).
          </p>
        ) : (
          <div className="field-row">
            <label>
              Item
              <select
                value={selectedInstance}
                onChange={(e) => setSelectedInstance(e.target.value)}
                disabled={busy}
              >
                <option value="">Select an item…</option>
                {eligible.map((i) => (
                  <option key={i.instanceId} value={i.instanceId}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Price
              <input
                type="number"
                min={1}
                step={1}
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                disabled={busy}
                placeholder="e.g. 100"
              />
            </label>
            <button type="button" onClick={() => void handleCreateListing()} disabled={busy}>
              List item
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>My listings</h2>
        {loading ? (
          <p className="empty-state">Loading your listings…</p>
        ) : mine.length === 0 ? (
          <p className="empty-state">You have no listings.</p>
        ) : (
          <div className="card-grid">
            {mine.map((l) => (
              <div className="card" key={l.listingId}>
                <span className="card-title">Listing {shortId(l.listingId)}</span>
                <span className="card-meta">Status: {l.status}</span>
                <div className="card-foot">
                  <span className="price">{l.price}</span>
                  {l.status === "active" && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void handleCancel(l.listingId)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
