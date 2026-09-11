"use client";

import Link from "next/link";
import { useTideCloak } from "@tidecloak/nextjs";

export default function HomePage() {
  const { authenticated, getValueFromIdToken, isInitializing, login, logout } =
    useTideCloak();

  if (isInitializing) {
    return <main><p>Loading authentication…</p></main>;
  }

  return (
    <main>
      <h1>TideCloak authentication demo</h1>
      {authenticated ? (
        <>
          <p>Signed in as {getValueFromIdToken("preferred_username") || "user"}.</p>
          <div className="actions">
            <Link className="button" href="/dashboard">Dashboard</Link>
            <button type="button" onClick={() => void logout()}>Log out</button>
          </div>
        </>
      ) : (
        <>
          <p>Sign in or create an account through TideCloak.</p>
          <div className="actions">
            <button type="button" onClick={() => void login()}>Log in</button>
            <button type="button" onClick={() => void login()}>Create account</button>
          </div>
          <p className="hint">Use “Register” on the TideCloak screen to create a new account.</p>
        </>
      )}
    </main>
  );
}
