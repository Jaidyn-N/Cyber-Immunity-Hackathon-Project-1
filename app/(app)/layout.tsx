"use client";

// app/(app)/layout.tsx
// Task 15 — shared auth-gated layout for the authenticated app pages (shop, inventory, marketplace,
// account, admin). A route group `(app)` keeps these URLs flat (/shop, /inventory, ...) while sharing
// one auth gate + persistent nav. This is UI gating only — the server re-verifies the Tide JWT on
// every API call and is the sole authority. Mirrors the dashboard auth pattern.

import { useTideCloak } from "@tidecloak/nextjs";
import type { ReactNode } from "react";
import { useEffect } from "react";
import AppNav from "./_components/AppNav";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { authenticated, isInitializing, login } = useTideCloak();

  useEffect(() => {
    if (!isInitializing && !authenticated) void login();
  }, [authenticated, isInitializing, login]);

  if (isInitializing || !authenticated) {
    return (
      <main>
        <p>Checking authentication…</p>
      </main>
    );
  }

  return (
    <div className="app-main">
      <AppNav />
      {children}
    </div>
  );
}
