"use client";

// app/(app)/_components/AppNav.tsx
// Task 15 — persistent navigation for the authenticated app pages.
//
// Nav visibility (including the Admin link) is UI gating ONLY. The server remains authoritative:
// every API route re-derives identity from the verified Tide JWT and enforces RBAC server-side, so
// hiding/showing a link here can never grant access. The Admin link is shown only when the Tide
// context reports `hasRealmRole("admin")` — never a client-stored flag.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTideCloak } from "@tidecloak/nextjs";

const LINKS: { href: string; label: string }[] = [
  { href: "/shop", label: "Shop" },
  { href: "/inventory", label: "Inventory" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/account", label: "Account" },
];

export default function AppNav() {
  const { getValueFromIdToken, hasRealmRole, logout } = useTideCloak();
  const pathname = usePathname();

  const username =
    (getValueFromIdToken("preferred_username") as string | undefined) || "user";

  // Server authoritative: this only toggles the link, not access.
  const isAdmin = hasRealmRole("admin");

  return (
    <nav className="app-nav">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`nav-link${pathname === link.href ? " active" : ""}`}
        >
          {link.label}
        </Link>
      ))}
      {isAdmin && (
        <Link
          href="/admin"
          className={`nav-link${pathname === "/admin" ? " active" : ""}`}
        >
          Admin
        </Link>
      )}
      <span className="nav-spacer" />
      <span className="nav-user">Signed in as {username}</span>
      <button type="button" className="secondary" onClick={() => void logout()}>
        Log out
      </button>
    </nav>
  );
}
