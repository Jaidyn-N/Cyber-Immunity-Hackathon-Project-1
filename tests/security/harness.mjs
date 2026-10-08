// tests/security/harness.mjs
// Shared, PERSISTENT test harness for the consolidated security suite (Task 17).
//
// WHAT THIS DOES (and deliberately does NOT do)
//   * Builds a FIXTURE Ed25519 (EdDSA/OKP) JWKS and installs it as the server adapter via the
//     CLIENT_ADAPTER env var, so the untouched production verifier (lib/auth/tideJWT.ts, I-04 local
//     JWKS) validates tokens WE mint. Fixture issuer/azp match the fixture adapter.
//   * Mints DPoP-BOUND fixture access tokens for deterministic roles: player A, player B, admin. Each
//     carries a non-empty `vuid`, the correct `azp`, and a `cnf.jkt` (DPoP binding) so withAuth passes.
//   * Points the app DB at an OS temp file via APP_DB_PATH (NEVER touches data/app.db) and provides a
//     seed helper that drives the REAL repositories.
//   * Prints a matrix row per case: name | setup | action | expected | actual | PASS/FAIL.
//
// It does NOT load the Tide browser SDK (it does not run in Node) and makes NO network calls. The live
// Tide crypto / live QEA results are previously-verified BROWSER evidence, referenced by the suite as
// such — never re-run or claimed headlessly here. Fixture vuids are synthetic — never a real operator
// vuid, never a real secret.
import { SignJWT, exportJWK, generateKeyPair, calculateJwkThumbprint } from "jose";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Fixture realm identity (synthetic — must be internally consistent, not the real realm)
// ---------------------------------------------------------------------------
export const FIXTURE_REALM = "security-suite-fixture-realm";
export const FIXTURE_AUTH_SERVER_URL = "http://localhost:8080/";
export const FIXTURE_RESOURCE = "security-suite-fixture-client";
export const FIXTURE_ISSUER = `${FIXTURE_AUTH_SERVER_URL.replace(/\/+$/, "")}/realms/${FIXTURE_REALM}`;

// Deterministic synthetic vuids (64-hex, as the real realm uses). NOT any operator's real vuid.
export const VUID_A = "a".repeat(64);
export const VUID_B = "b".repeat(64);
export const VUID_ADMIN = "c".repeat(64);

let _signingKey = null; // Ed25519 private key used to sign fixture tokens
let _dpopJkt = null; // a fixed DPoP thumbprint used for cnf.jkt on bound tokens
let _tempDbPath = null;

/**
 * Initialise the fixture crypto + adapter and the temp DB path. MUST be called before importing any
 * route/repository module, because the production config/db loaders read CLIENT_ADAPTER / APP_DB_PATH
 * lazily on first use and memoise. Returns nothing; sets process.env.
 */
export async function initFixtureEnv() {
  // 1) Generate an Ed25519 keypair (matches the real adapter's EdDSA/OKP signing alg).
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  _signingKey = privateKey;

  const publicJwk = await exportJWK(publicKey);
  publicJwk.alg = "EdDSA";
  publicJwk.use = "sig";
  publicJwk.kid = "security-suite-fixture-key";

  // 2) A DPoP proof public key thumbprint for cnf.jkt (a plausible, fixed JWK thumbprint). We only
  //    assert cnf.jkt is PRESENT server-side (I-12), so any stable thumbprint satisfies withAuth.
  const { publicKey: dpopPub } = await generateKeyPair("ES256", { extractable: true });
  _dpopJkt = await calculateJwkThumbprint(await exportJWK(dpopPub));

  // 3) Install the fixture adapter JSON for the server verifier (local JWKS only, I-04).
  const adapter = {
    realm: FIXTURE_REALM,
    "auth-server-url": FIXTURE_AUTH_SERVER_URL,
    resource: FIXTURE_RESOURCE,
    "public-client": true,
    jwk: { keys: [publicJwk] },
  };
  process.env.CLIENT_ADAPTER = JSON.stringify(adapter);

  // 4) Temp DB — NEVER the real data/app.db.
  _tempDbPath = join(mkdtempSync(join(tmpdir(), "sec-suite-")), "app.db");
  process.env.APP_DB_PATH = _tempDbPath;
}

export function tempDbPath() {
  return _tempDbPath;
}

/**
 * Mint a fixture access token.
 * @param {object} opts
 * @param {string} opts.vuid         - subject identity claim (empty string => simulate a vuid-less token)
 * @param {string[]} [opts.realmRoles] - realm_access.roles
 * @param {boolean} [opts.dpop=true]  - include cnf.jkt (DPoP binding). false => simulate an unbound token.
 * @param {string}  [opts.azp]        - override azp (defaults to the fixture client)
 * @param {number}  [opts.expOffsetSec=3600] - exp relative to now (negative => already expired)
 * @param {boolean} [opts.badSignature=false] - sign with a throwaway key the server does NOT trust
 */
export async function mintToken(opts = {}) {
  const {
    vuid = VUID_A,
    realmRoles = [],
    dpop = true,
    azp = FIXTURE_RESOURCE,
    expOffsetSec = 3600,
    badSignature = false,
  } = opts;

  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    azp,
    realm_access: { roles: realmRoles },
  };
  if (vuid !== null) payload.vuid = vuid; // vuid:"" simulates an empty/invalid vuid; null omits it
  if (dpop) payload.cnf = { jkt: _dpopJkt };

  let key = _signingKey;
  if (badSignature) {
    // Sign with an UNTRUSTED key so signature verification fails against the fixture JWKS.
    const { privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    key = privateKey;
  }

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", kid: "security-suite-fixture-key", typ: "JWT" })
    .setIssuer(FIXTURE_ISSUER)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + expOffsetSec)
    .sign(key);
}

/** Convenience: the three canonical identities as ready-to-use Bearer tokens. */
export async function mintIdentities() {
  const [playerA, playerB, admin] = await Promise.all([
    mintToken({ vuid: VUID_A }),
    mintToken({ vuid: VUID_B }),
    mintToken({ vuid: VUID_ADMIN, realmRoles: ["admin"] }),
  ]);
  return { playerA, playerB, admin };
}

/** Build a plain Request for a route handler. Route handlers only use headers/json/url, so Request fits. */
export function buildRequest(url, { method = "GET", token = null, scheme = "Bearer", body } = {}) {
  const headers = new Headers();
  if (token) headers.set("authorization", `${scheme} ${token}`);
  const init = { method, headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request(url, init);
}

const BASE = "http://localhost/"; // only the path/query matters to the handlers

export function apiUrl(path) {
  return new URL(path, BASE).href;
}

/** Read a Response's JSON body safely (handlers always return JSON here). */
export async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
const PAD = { name: 46, setup: 30, action: 30, expected: 22, actual: 22 };
function clip(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s.padEnd(n);
}

export class Reporter {
  constructor() {
    this.rows = [];
    this.groups = new Map(); // group label -> {pass, fail}
    this._currentGroup = null;
  }

  group(label) {
    this._currentGroup = label;
    if (!this.groups.has(label)) this.groups.set(label, { pass: 0, fail: 0 });
    console.log(`\n=== ${label} ===`);
  }

  /**
   * Record and print a single assertion row.
   * @returns {boolean} pass
   */
  check({ name, setup, action, expected, actual }) {
    const pass = String(expected) === String(actual);
    const g = this._currentGroup ?? "(ungrouped)";
    if (!this.groups.has(g)) this.groups.set(g, { pass: 0, fail: 0 });
    this.groups.get(g)[pass ? "pass" : "fail"]++;
    this.rows.push({ group: g, name, setup, action, expected, actual, pass });
    const tag = pass ? "PASS" : "FAIL";
    console.log(
      `  [${tag}] ${clip(name, PAD.name)} | ${clip(setup, PAD.setup)} | ${clip(action, PAD.action)} | ` +
        `exp=${clip(expected, PAD.expected)} | act=${clip(actual, PAD.actual)}`
    );
    return pass;
  }

  get total() {
    return this.rows.length;
  }
  get passed() {
    return this.rows.filter((r) => r.pass).length;
  }
  get failed() {
    return this.rows.filter((r) => !r.pass).length;
  }

  summary() {
    console.log("\n============ SECURITY SUITE SUMMARY ============");
    for (const [label, { pass, fail }] of this.groups) {
      console.log(`  ${clip(label, 60)}  ${pass} pass / ${fail} fail`);
    }
    console.log("------------------------------------------------");
    console.log(`  TOTAL: ${this.passed}/${this.total} passed, ${this.failed} failed`);
    console.log("================================================\n");
  }
}

/** Remove the temp DB directory created by initFixtureEnv. Safe to call multiple times. */
export function cleanupTempDb() {
  if (_tempDbPath) {
    try {
      rmSync(join(_tempDbPath, ".."), { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
    _tempDbPath = null;
  }
}
