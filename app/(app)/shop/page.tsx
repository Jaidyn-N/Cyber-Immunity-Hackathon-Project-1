"use client";

// app/(app)/shop/page.tsx
// Task 15 — Shop UI. Consumes GET /api/shop + GET /api/me, and POST /api/shop/purchase.
// All authed calls go through secureFetch (DPoP-bound) with absolute URLs. The client sends ONLY
// `offerId` on purchase — never buyer/owner/price. The server is authoritative.

import { useCallback, useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";

const API = "http://localhost:3000/api";

type Offer = {
  offerId: string;
  templateId: string;
  name: string;
  category: string;
  rarity: string;
  price: number;
  available: boolean;
  windowEnd: string;
};

type ShopResponse = {
  window: { start: string; end: string };
  capacity: number;
  count: number;
  offers: Offer[];
};

export default function ShopPage() {
  const { authenticated, secureFetch } = useTideCloak();

  const [offers, setOffers] = useState<Offer[]>([]);
  const [windowInfo, setWindowInfo] = useState<ShopResponse["window"] | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);

  const loadBalance = useCallback(async () => {
    const res = await secureFetch(`${API}/me`, { method: "GET" });
    if (!res.ok) throw new Error("Could not load your balance.");
    const data = (await res.json()) as { player: { currencyBalance: number } };
    setBalance(data.player.currencyBalance);
  }, [secureFetch]);

  const loadShop = useCallback(async () => {
    const res = await secureFetch(`${API}/shop`, { method: "GET" });
    if (!res.ok) throw new Error("Could not load the shop.");
    const data = (await res.json()) as ShopResponse;
    setOffers(data.offers);
    setWindowInfo(data.window);
  }, [secureFetch]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadShop(), loadBalance()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong loading the shop.");
    } finally {
      setLoading(false);
    }
  }, [loadShop, loadBalance]);

  useEffect(() => {
    if (!authenticated) return;
    void refresh();
  }, [authenticated, refresh]);

  const handleBuy = useCallback(
    async (offerId: string) => {
      setBuyingId(offerId);
      setError(null);
      setFeedback(null);
      try {
        const res = await secureFetch(`${API}/shop/purchase`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offerId }), // ONLY offerId — never price/owner
        });
        if (!res.ok) {
          if (res.status === 402) throw new Error("Insufficient funds.");
          if (res.status === 409) throw new Error("Offer is not currently available.");
          if (res.status === 404) throw new Error("Offer not found.");
          throw new Error("Purchase could not be completed.");
        }
        const data = (await res.json()) as { newBalance: number; pricePaid: number };
        setBalance(data.newBalance);
        setFeedback(`Purchase complete. You spent ${data.pricePaid}. New balance: ${data.newBalance}.`);
        await Promise.all([loadShop(), loadBalance()]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Purchase could not be completed.");
      } finally {
        setBuyingId(null);
      }
    },
    [secureFetch, loadShop, loadBalance]
  );

  return (
    <section className="panel">
      <h2>Shop</h2>
      <p className="balance">Balance: {balance === null ? "…" : balance}</p>
      {windowInfo && (
        <p className="hint">
          Rotation window: {new Date(windowInfo.start).toLocaleString()} –{" "}
          {new Date(windowInfo.end).toLocaleString()}
        </p>
      )}

      {feedback && <div className="feedback feedback-ok">{feedback}</div>}
      {error && <div className="feedback feedback-err">{error}</div>}

      {loading ? (
        <p className="empty-state">Loading offers…</p>
      ) : offers.length === 0 ? (
        <p className="empty-state">No offers in the current rotation. Check back next window.</p>
      ) : (
        <div className="card-grid">
          {offers.map((offer) => (
            <div className="card" key={offer.offerId}>
              <span className="card-title">{offer.name}</span>
              <span className="card-meta">{offer.category}</span>
              <span className="badge badge-rarity">{offer.rarity}</span>
              <div className="card-foot">
                <span className="price">{offer.price}</span>
                <button
                  type="button"
                  onClick={() => void handleBuy(offer.offerId)}
                  disabled={!offer.available || buyingId !== null}
                >
                  {buyingId === offer.offerId ? "Buying…" : "Buy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
