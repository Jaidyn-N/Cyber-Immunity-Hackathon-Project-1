"use client";

import { TideCloakProvider } from "@tidecloak/nextjs";
import type { ReactNode } from "react";
import tideConfig from "../data/tidecloak.json";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TideCloakProvider
      config={{ ...tideConfig, useDPoP: { mode: "strict", alg: "ES256" } }}
    >
      {children}
    </TideCloakProvider>
  );
}
