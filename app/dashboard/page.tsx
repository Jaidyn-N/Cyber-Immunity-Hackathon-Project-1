"use client";

import Link from "next/link";
import { useTideCloak } from "@tidecloak/nextjs";

export default function DashboardPage() {
  const { getValueFromIdToken, logout } = useTideCloak();

  return (
    <main>
      <h1>Protected dashboard</h1>
      <p>Welcome, {getValueFromIdToken("preferred_username") || "user"}.</p>
      <p>This page is displayed only after TideCloak authentication.</p>
      <div className="actions">
        <Link className="button" href="/shop">Shop</Link>
        <Link className="button" href="/inventory">Inventory</Link>
        <Link className="button" href="/marketplace">Marketplace</Link>
        <Link className="button" href="/account">Account</Link>
      </div>
      <div className="actions">
        <Link className="button secondary" href="/">Home</Link>
        <button type="button" onClick={() => void logout()}>Log out</button>
      </div>
    </main>
  );
}
