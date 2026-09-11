"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import type { ReactNode } from "react";
import { useEffect } from "react";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { authenticated, isInitializing, login } = useTideCloak();

  useEffect(() => {
    if (!isInitializing && !authenticated) void login();
  }, [authenticated, isInitializing, login]);

  if (isInitializing || !authenticated) {
    return <main><p>Checking authentication…</p></main>;
  }

  return <>{children}</>;
}
