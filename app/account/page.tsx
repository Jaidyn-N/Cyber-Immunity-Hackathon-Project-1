"use client";

// app/account/page.tsx
// Task 12 — Tide-protected private note (client-side encrypt-on-save / decrypt-on-view).
//
// Encryption and decryption happen HERE, in the browser, via the Tide SDK (doEncrypt/doDecrypt). The
// plaintext NEVER leaves the client: only the opaque self-encrypted ciphertext is sent to the server
// (PUT) and read back (GET). Authorization to encrypt/decrypt is Tide's VOUCHER GATE, not an app role
// check — the server route uses withAuth (identity) only.

import { useCallback, useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";

// PRIVATE_NOTE_TAG — the Tide self-encryption tag. This is COUPLED to the realm's voucher-gate roles:
// tag `X` requires the roles `_tide_X.selfencrypt` (to encrypt) and `_tide_X.selfdecrypt` (to decrypt).
// This realm provisions `_tide_dob.selfencrypt` / `_tide_dob.selfdecrypt` (see Task 11), so the tag
// MUST be "dob". Using any other tag (e.g. "privatenote") would reference roles that do not exist in
// this realm and Tide's voucher gate would deny the operation.
const PRIVATE_NOTE_TAG = "dob";

const PRIVATE_NOTE_URL = "http://localhost:3000/api/account/private-note";

export default function AccountPage() {
  const { authenticated, doEncrypt, doDecrypt, secureFetch } = useTideCloak();

  const [plaintext, setPlaintext] = useState("");
  const [storedCiphertext, setStoredCiphertext] = useState<string | null>(null);
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load the caller's stored ciphertext on mount. We do NOT auto-decrypt: decryption is an explicit
  // user action that may be denied by the voucher gate, and we want to surface that cleanly.
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await secureFetch(PRIVATE_NOTE_URL, { method: "GET" });
        if (!res.ok) throw new Error(`GET failed: ${res.status}`);
        const data = (await res.json()) as { ciphertext: string | null };
        if (!cancelled) setStoredCiphertext(data.ciphertext ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, secureFetch]);

  const handleSave = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      // Encrypt client-side. doEncrypt/doDecrypt take an ARRAY of items and RETURN an ARRAY; for a
      // single note we take the first element. The SDK types this as `any`; narrow to string.
      const encrypted = (await doEncrypt([
        { data: plaintext, tags: [PRIVATE_NOTE_TAG] },
      ])) as unknown[];
      const ct = encrypted[0] as string;

      // Only the ciphertext is sent to the server — never the plaintext.
      const res = await secureFetch(PRIVATE_NOTE_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ciphertext: ct }),
      });
      if (!res.ok) throw new Error(`PUT failed: ${res.status}`);

      setStoredCiphertext(ct);
      setDecrypted(null);
      setStatus("Note encrypted client-side and stored (ciphertext only).");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [plaintext, doEncrypt, secureFetch]);

  const handleDecrypt = useCallback(async () => {
    if (storedCiphertext === null) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    setDecrypted(null);
    try {
      const results = (await doDecrypt([
        { encrypted: storedCiphertext, tags: [PRIVATE_NOTE_TAG] },
      ])) as unknown[];
      const pt = results[0] as string;
      setDecrypted(pt);
      setStatus("Decrypted client-side via Tide.");
    } catch (e) {
      // If Tide denies (account lacks the `_tide_dob.selfdecrypt` voucher), surface the raw error and
      // explain how to complete the round-trip. We do NOT fall back to any other decryption.
      const raw = e instanceof Error ? e.message : String(e);
      setError(
        `${raw}\n\nTide denied decryption — this account lacks the \`_tide_dob.selfdecrypt\` ` +
          `voucher-gate role. Grant it via the governed Task 11 flow, then retry.`
      );
    } finally {
      setBusy(false);
    }
  }, [storedCiphertext, doDecrypt]);

  if (!authenticated) {
    return (
      <main>
        <h1>Private note</h1>
        <p>Sign in to manage your Tide-protected private note.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Private note</h1>
      <p>
        Your note is encrypted and decrypted <strong>client-side</strong> by Tide. The server only ever
        stores the opaque ciphertext — the plaintext never reaches it. Permission to encrypt/decrypt is
        granted by the Tide <code>_tide_dob.*</code> voucher roles, not by the application.
      </p>

      <section>
        <h2>Write &amp; encrypt</h2>
        <textarea
          value={plaintext}
          onChange={(e) => setPlaintext(e.target.value)}
          rows={4}
          placeholder="Type a private note…"
          disabled={busy}
        />
        <div className="actions">
          <button type="button" onClick={() => void handleSave()} disabled={busy}>
            Save note
          </button>
        </div>
      </section>

      <section>
        <h2>Stored ciphertext (at rest)</h2>
        <textarea
          value={storedCiphertext ?? "(no note stored yet)"}
          readOnly
          rows={4}
        />
        <div className="actions">
          <button
            type="button"
            onClick={() => void handleDecrypt()}
            disabled={busy || storedCiphertext === null}
          >
            Decrypt &amp; view
          </button>
        </div>
      </section>

      {decrypted !== null && (
        <section>
          <h2>Decrypted plaintext</h2>
          <pre>{decrypted}</pre>
        </section>
      )}

      {status && <p className="hint">{status}</p>}
      {error && <pre style={{ whiteSpace: "pre-wrap", color: "crimson" }}>{error}</pre>}
    </main>
  );
}
