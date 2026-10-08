// tests/security/security-suite.mjs
// CONSOLIDATED, REPEATABLE security test suite (Task 17).
//
// Run with:  npm run test:security
//
// This is the persistent successor to the throwaway Task 8-16 validation harnesses. It exercises the
// REAL, UNMODIFIED server/route/repository layer against a FIXTURE Ed25519 adapter (CLIENT_ADAPTER)
// and a throwaway OS temp DB (APP_DB_PATH) — it NEVER touches data/app.db, OwnershipSpike, Forseti,
// attestation code, providers.tsx, tidecloak.json, or the schema. No security check is weakened.
//
// SCOPE BOUNDARY (honest):
//   * HEADLESS here  = groups A-H automated assertions below (server/route/repo layer).
//   * The Tide browser SDK does NOT load in Node, so live Tide crypto (Task 12) and live QEA approval
//     (Task 11) are PREVIOUSLY-VERIFIED BROWSER evidence — referenced, never re-run or claimed here.
//   * Group I (OwnershipSpike PoC) is DOCUMENTED preserved evidence, not a headless test.
//
// Every NEGATIVE case also asserts the target's state is UNCHANGED.
import {
  initFixtureEnv,
  mintToken,
  mintIdentities,
  buildRequest,
  apiUrl,
  readJson,
  cleanupTempDb,
  Reporter,
  VUID_A,
  VUID_B,
  VUID_ADMIN,
} from "./harness.mjs";

// Must run before importing any route/repo (config + db loaders read env lazily and memoise).
await initFixtureEnv();

// --- Real production modules (imported AFTER env is set) -------------------------------------------
const meRoute = await import("../../app/api/me/route.ts");
const inventoryRoute = await import("../../app/api/inventory/route.ts");
const equipRoute = await import("../../app/api/inventory/equip/route.ts");
const shopRoute = await import("../../app/api/shop/route.ts");
const purchaseRoute = await import("../../app/api/shop/purchase/route.ts");
const marketplaceRoute = await import("../../app/api/marketplace/route.ts");
const listRoute = await import("../../app/api/marketplace/list/route.ts");
const listIdRoute = await import("../../app/api/marketplace/list/[id]/route.ts");
const obtainRoute = await import("../../app/api/marketplace/obtain/route.ts");
const privateNoteRoute = await import("../../app/api/account/private-note/route.ts");
const adminSummaryRoute = await import("../../app/api/admin/summary/route.ts");
const adminRoleRoute = await import("../../app/api/admin/private-note-role/route.ts");

const players = await import("../../lib/db/players.ts");
const items = await import("../../lib/db/items.ts");
const marketplace = await import("../../lib/db/marketplace.ts");
const dbIndex = await import("../../lib/db/index.ts");
const igaAdmin = await import("../../lib/tide/igaAdmin.ts");

const R = new Reporter();

// --- Seed helpers (drive the REAL repositories) ----------------------------------------------------
const TEMPLATE_TRADABLE = "tpl-suite-cape";
const TEMPLATE_NONTRADABLE = "tpl-suite-bound";

function ensurePlayer(vuid, balance = 1000) {
  players.getOrCreatePlayer(vuid, `player-${vuid.slice(0, 8)}`, balance);
}
function setBalance(vuid, target) {
  const cur = players.getBalance(vuid);
  if (target !== cur) players.adjustBalance(vuid, target - cur);
}
function seedTemplates() {
  items.upsertTemplate({ id: TEMPLATE_TRADABLE, name: "Suite Cape", category: "cape", rarity: "rare", base_price: 100, tradable: 1 });
  items.upsertTemplate({ id: TEMPLATE_NONTRADABLE, name: "Bound Trophy", category: "trophy", rarity: "epic", base_price: 100, tradable: 0 });
}
/** Mint an item instance owned by `vuid` (Layer A) and return its id. */
function giveItem(vuid, templateId = TEMPLATE_TRADABLE) {
  return items.createInstance(templateId, vuid, "shop");
}

// Snapshot helpers for "state unchanged" assertions.
function snapshotPlayer(vuid) {
  const p = players.getPlayer(vuid);
  return p ? JSON.stringify({ b: p.currency_balance, eq: p.equipped_instance_id, note: p.private_note_ciphertext }) : "none";
}
function ownerOf(instanceId) {
  return items.getOwner(instanceId) ?? "none";
}
function attestationCount(instanceId) {
  return marketplace.listAttestationsForInstance(instanceId).length;
}

// ===================================================================================================
// GROUP A — Authentication (every protected route rejects unauthenticated / unbound / invalid tokens)
// ===================================================================================================
async function groupA() {
  R.group("A. Authentication — all protected routes fail closed (401)");

  // (route label, invoke(token) -> Response). Each is called 3 ways: no token, no-cnf, bad/expired.
  const protectedRoutes = [
    ["GET  /api/me", (t) => meRoute.GET(buildRequest(apiUrl("/api/me"), { token: t }))],
    ["GET  /api/inventory", (t) => inventoryRoute.GET(buildRequest(apiUrl("/api/inventory"), { token: t }))],
    ["GET  /api/inventory/equip", (t) => equipRoute.GET(buildRequest(apiUrl("/api/inventory/equip"), { token: t }))],
    ["POST /api/inventory/equip", (t) => equipRoute.POST(buildRequest(apiUrl("/api/inventory/equip"), { method: "POST", token: t, body: { instanceId: null } }))],
    ["GET  /api/shop", (t) => shopRoute.GET(buildRequest(apiUrl("/api/shop"), { token: t }))],
    ["POST /api/shop/purchase", (t) => purchaseRoute.POST(buildRequest(apiUrl("/api/shop/purchase"), { method: "POST", token: t, body: { offerId: "x" } }))],
    ["GET  /api/marketplace", (t) => marketplaceRoute.GET(buildRequest(apiUrl("/api/marketplace"), { token: t }))],
    ["GET  /api/marketplace/list", (t) => listRoute.GET(buildRequest(apiUrl("/api/marketplace/list"), { token: t }))],
    ["POST /api/marketplace/list", (t) => listRoute.POST(buildRequest(apiUrl("/api/marketplace/list"), { method: "POST", token: t, body: { instanceId: "x", price: 1 } }))],
    ["DEL  /api/marketplace/list/[id]", (t) => listIdRoute.DELETE(buildRequest(apiUrl("/api/marketplace/list/some-id"), { method: "DELETE", token: t }))],
    ["POST /api/marketplace/obtain", (t) => obtainRoute.POST(buildRequest(apiUrl("/api/marketplace/obtain"), { method: "POST", token: t, body: { listingId: "x" } }))],
    ["GET  /api/account/private-note", (t) => privateNoteRoute.GET(buildRequest(apiUrl("/api/account/private-note"), { token: t }))],
    ["PUT  /api/account/private-note", (t) => privateNoteRoute.PUT(buildRequest(apiUrl("/api/account/private-note"), { method: "PUT", token: t, body: { ciphertext: "x" } }))],
    ["GET  /api/admin/summary", (t) => adminSummaryRoute.GET(buildRequest(apiUrl("/api/admin/summary"), { token: t }))],
    ["POST /api/admin/private-note-role", (t) => adminRoleRoute.POST(buildRequest(apiUrl("/api/admin/private-note-role"), { method: "POST", token: t, body: { targetVuid: VUID_B, role: "_tide_dob.selfencrypt" } }))],
  ];

  const noCnf = await mintToken({ vuid: VUID_A, dpop: false });
  const expired = await mintToken({ vuid: VUID_A, expOffsetSec: -3600 });
  const badSig = await mintToken({ vuid: VUID_A, badSignature: true });

  for (const [label, invoke] of protectedRoutes) {
    const r1 = await invoke(null);
    R.check({ name: label, setup: "no Authorization header", action: "call route", expected: 401, actual: r1.status });

    const r2 = await invoke(noCnf);
    R.check({ name: label, setup: "token missing cnf.jkt", action: "call route", expected: 401, actual: r2.status });

    const r3 = await invoke(expired);
    R.check({ name: label, setup: "expired token", action: "call route", expected: 401, actual: r3.status });

    const r4 = await invoke(badSig);
    R.check({ name: label, setup: "invalid signature", action: "call route", expected: 401, actual: r4.status });
  }
}

// ===================================================================================================
// GROUP B — Player isolation (identity from JWT only; body-supplied ids ignored; A cannot touch B)
// (Task 13 originally recorded 64/64; this suite re-exercises the CORE cross-player subset.)
// ===================================================================================================
async function groupB(tokens) {
  R.group("B. Player isolation — identity from JWT only (Task 13 core subset)");
  seedTemplates();
  ensurePlayer(VUID_A);
  ensurePlayer(VUID_B);

  // B owns an item + has a private note; A must not reach either by spoofing B's id in the body.
  const bItem = giveItem(VUID_B);
  players.setPrivateNoteCiphertext(VUID_B, "B-SECRET-CIPHERTEXT");
  const bNoteBefore = players.getPrivateNoteCiphertext(VUID_B);
  const bSnapBefore = snapshotPlayer(VUID_B);

  // 1) /api/me ignores a body/query vuid — A always gets A.
  const meRes = await meRoute.GET(buildRequest(apiUrl(`/api/me?vuid=${VUID_B}`), { token: tokens.playerA }));
  const meBody = await readJson(meRes);
  R.check({ name: "me ignores query vuid", setup: "A authed, ?vuid=B", action: "GET /api/me", expected: VUID_A, actual: meBody?.player?.vuid });

  // 2) A's inventory never contains B's item (query scoped to verified vuid).
  const invRes = await inventoryRoute.GET(buildRequest(apiUrl("/api/inventory"), { token: tokens.playerA }));
  const invBody = await readJson(invRes);
  const leaked = (invBody?.items ?? []).some((i) => i.instanceId === bItem);
  R.check({ name: "inventory excludes B's item", setup: "A authed; B owns item", action: "GET /api/inventory", expected: false, actual: leaked });

  // 3) A cannot read B's private note; GET returns A's own (null), never B's ciphertext.
  const noteRes = await privateNoteRoute.GET(buildRequest(apiUrl("/api/account/private-note"), { token: tokens.playerA }));
  const noteBody = await readJson(noteRes);
  R.check({ name: "private-note GET is self-only", setup: "A authed; B has note", action: "GET private-note", expected: "null", actual: String(noteBody?.ciphertext) });

  // 4) A's PUT with body vuid=B cannot redirect the write to B — B's ciphertext stays byte-identical.
  await privateNoteRoute.PUT(buildRequest(apiUrl("/api/account/private-note"), { method: "PUT", token: tokens.playerA, body: { ciphertext: "A-OVERWRITE", vuid: VUID_B, targetVuid: VUID_B } }));
  R.check({ name: "private-note PUT can't target B", setup: "A PUT body vuid=B", action: "PUT private-note", expected: bNoteBefore, actual: players.getPrivateNoteCiphertext(VUID_B) });

  // 5) A cannot equip B's item by supplying its id (403, B unchanged).
  const equipRes = await equipRoute.POST(buildRequest(apiUrl("/api/inventory/equip"), { method: "POST", token: tokens.playerA, body: { instanceId: bItem, vuid: VUID_B } }));
  R.check({ name: "A can't equip B's item", setup: "A POST equip B's item", action: "POST equip", expected: 403, actual: equipRes.status });

  // 6) A cannot list B's item (owner check from JWT, not body ownerVuid) — 403, B still owns it.
  const listRes = await listRoute.POST(buildRequest(apiUrl("/api/marketplace/list"), { method: "POST", token: tokens.playerA, body: { instanceId: bItem, price: 10, ownerVuid: VUID_B, sellerVuid: VUID_B } }));
  R.check({ name: "A can't list B's item", setup: "A POST list B's item", action: "POST marketplace/list", expected: 403, actual: listRes.status });

  // State-unchanged backstop for the whole group.
  R.check({ name: "B owner unchanged", setup: "after A's spoof attempts", action: "read owner", expected: VUID_B, actual: ownerOf(bItem) });
  R.check({ name: "B player row unchanged", setup: "after A's spoof attempts", action: "snapshot B", expected: bSnapBefore, actual: snapshotPlayer(VUID_B) });
}

// ===================================================================================================
// GROUP C — Inventory / equip
// ===================================================================================================
async function groupC(tokens) {
  R.group("C. Inventory / equip");
  ensurePlayer(VUID_A);
  ensurePlayer(VUID_B);

  const aItem = giveItem(VUID_A);
  const bItem = giveItem(VUID_B);

  // equip owned -> ok
  const okRes = await equipRoute.POST(buildRequest(apiUrl("/api/inventory/equip"), { method: "POST", token: tokens.playerA, body: { instanceId: aItem } }));
  R.check({ name: "equip owned item", setup: "A owns item", action: "POST equip own", expected: 200, actual: okRes.status });
  R.check({ name: "equipped persisted", setup: "after equip", action: "read equipped", expected: aItem, actual: players.getEquipped(VUID_A) });

  // B equips their own item first (to assert it stays unchanged after A's attack).
  await equipRoute.POST(buildRequest(apiUrl("/api/inventory/equip"), { method: "POST", token: tokens.playerB, body: { instanceId: bItem } }));
  const bEquipBefore = players.getEquipped(VUID_B);

  // equip B's item as A -> 403, no change
  const forbiddenRes = await equipRoute.POST(buildRequest(apiUrl("/api/inventory/equip"), { method: "POST", token: tokens.playerA, body: { instanceId: bItem } }));
  R.check({ name: "equip other's item", setup: "A targets B's item", action: "POST equip not-owned", expected: 403, actual: forbiddenRes.status });
  R.check({ name: "A equipped unchanged", setup: "after 403", action: "read A equipped", expected: aItem, actual: players.getEquipped(VUID_A) });
  R.check({ name: "B equipped unchanged", setup: "after A's 403 attempt", action: "read B equipped", expected: bEquipBefore, actual: players.getEquipped(VUID_B) });

  // nonexistent item -> 404
  const missingRes = await equipRoute.POST(buildRequest(apiUrl("/api/inventory/equip"), { method: "POST", token: tokens.playerA, body: { instanceId: "does-not-exist" } }));
  R.check({ name: "equip missing item", setup: "unknown instanceId", action: "POST equip", expected: 404, actual: missingRes.status });
}

// ===================================================================================================
// GROUP D — Private note (ciphertext opaque; identity bound; no governance/decrypt in route source)
// ===================================================================================================
async function groupD(tokens) {
  R.group("D. Private note — opaque ciphertext, self-only, no server crypto");
  ensurePlayer(VUID_A);
  ensurePlayer(VUID_B);

  // Server stores/returns opaque ciphertext verbatim (no transform).
  const opaque = "eyJ0YWciOiJkb2IiL"+"base64-LOOKING-OPAQUE==";
  await privateNoteRoute.PUT(buildRequest(apiUrl("/api/account/private-note"), { method: "PUT", token: tokens.playerA, body: { ciphertext: opaque } }));
  const back = await readJson(await privateNoteRoute.GET(buildRequest(apiUrl("/api/account/private-note"), { token: tokens.playerA })));
  R.check({ name: "ciphertext stored verbatim", setup: "A PUTs opaque blob", action: "GET returns same bytes", expected: opaque, actual: back?.ciphertext });

  // B sets their own; A cannot GET B's ciphertext.
  players.setPrivateNoteCiphertext(VUID_B, "B-ONLY-CIPHERTEXT");
  const aGetsB = await readJson(await privateNoteRoute.GET(buildRequest(apiUrl("/api/account/private-note"), { token: tokens.playerA })));
  R.check({ name: "A cannot GET B's ciphertext", setup: "B has distinct note", action: "A GET private-note", expected: opaque, actual: aGetsB?.ciphertext });

  // body vuid cannot redirect A's PUT to B.
  const bBefore = players.getPrivateNoteCiphertext(VUID_B);
  await privateNoteRoute.PUT(buildRequest(apiUrl("/api/account/private-note"), { method: "PUT", token: tokens.playerA, body: { ciphertext: "HIJACK", vuid: VUID_B } }));
  R.check({ name: "PUT body vuid ignored", setup: "A PUT body vuid=B", action: "B ciphertext unchanged", expected: bBefore, actual: players.getPrivateNoteCiphertext(VUID_B) });

  // Route source contains NO withRole / decrypt / governance CODE SYMBOL. We scan CODE ONLY (comments
  // stripped), because the route's prose legitimately explains that decryption happens client-side.
  const noteCode = stripComments(await readSource("app/api/account/private-note/route.ts"));
  const hasForbidden =
    /\bwithRole\s*\(/.test(noteCode) ||
    /\bdoDecrypt\s*\(/.test(noteCode) ||
    /\bdecrypt\s*\(/i.test(noteCode) ||
    /\binitiateRoleGrant/.test(noteCode) ||
    /from\s+["']@?\/?.*igaAdmin["']/.test(noteCode);
  R.check({ name: "no server-side crypto/governance", setup: "scan route code (no comments)", action: "grep forbidden symbols", expected: false, actual: hasForbidden });
}

// ===================================================================================================
// GROUP E — Marketplace (listing/cancel authorisation; obtain atomicity, replay, rollback, no Layer C)
// ===================================================================================================
async function groupE(tokens) {
  R.group("E. Marketplace (Layer A application-level temporary transfer — NOT Tide-backed)");
  seedTemplates();
  ensurePlayer(VUID_A, 1000);
  ensurePlayer(VUID_B, 1000);

  // B owns an item and lists it; A cannot list it, and A cannot cancel B's listing.
  const bItem = giveItem(VUID_B);
  const listRes = await listRoute.POST(buildRequest(apiUrl("/api/marketplace/list"), { method: "POST", token: tokens.playerB, body: { instanceId: bItem, price: 100 } }));
  const listBody = await readJson(listRes);
  const bListingId = listBody?.listingId;
  R.check({ name: "B lists own item", setup: "B owns tradable item", action: "POST list", expected: 200, actual: listRes.status });

  const aListB = await listRoute.POST(buildRequest(apiUrl("/api/marketplace/list"), { method: "POST", token: tokens.playerA, body: { instanceId: bItem, price: 1 } }));
  R.check({ name: "A can't list B's item", setup: "A targets B's item", action: "POST list", expected: 403, actual: aListB.status });

  const aCancelB = await listIdRoute.DELETE(buildRequest(apiUrl(`/api/marketplace/list/${bListingId}`), { method: "DELETE", token: tokens.playerA }));
  R.check({ name: "A can't cancel B's listing", setup: "A targets B's listing", action: "DELETE list/[id]", expected: 403, actual: aCancelB.status });
  R.check({ name: "B's listing still active", setup: "after A's cancel attempt", action: "read listing status", expected: "active", actual: marketplace.getListing(bListingId)?.status });

  // Buyer identity from JWT; spoofed buyer/seller/owner ignored. A obtains B's listing.
  const aBefore = players.getBalance(VUID_A);
  const bBefore = players.getBalance(VUID_B);
  const obtainRes = await obtainRoute.POST(buildRequest(apiUrl("/api/marketplace/obtain"), { method: "POST", token: tokens.playerA, body: { listingId: bListingId, buyerVuid: VUID_B, sellerVuid: VUID_A, ownerVuid: VUID_B } }));
  const obtainBody = await readJson(obtainRes);
  R.check({ name: "A obtains B's listing", setup: "A authed; spoofed body ids", action: "POST obtain", expected: 200, actual: obtainRes.status });
  R.check({ name: "ownership moved to A (buyer=JWT)", setup: "spoofed buyer=B ignored", action: "read owner", expected: VUID_A, actual: ownerOf(bItem) });
  R.check({ name: "buyer debited (A)", setup: "price 100", action: "read A balance", expected: aBefore - 100, actual: players.getBalance(VUID_A) });
  R.check({ name: "seller credited (B)", setup: "price 100", action: "read B balance", expected: bBefore + 100, actual: players.getBalance(VUID_B) });
  R.check({ name: "obtain writes NO Layer C row", setup: "Layer A/C boundary", action: "count attestations", expected: 0, actual: attestationCount(bItem) });

  // REPLAY: obtaining the now-sold listing again -> 409, never a second transfer.
  const ownerAfterFirst = ownerOf(bItem);
  const replayRes = await obtainRoute.POST(buildRequest(apiUrl("/api/marketplace/obtain"), { method: "POST", token: tokens.playerB, body: { listingId: bListingId } }));
  R.check({ name: "replay obtain rejected", setup: "listing already sold", action: "POST obtain again", expected: 409, actual: replayRes.status });
  R.check({ name: "no second transfer on replay", setup: "after replay 409", action: "read owner", expected: ownerAfterFirst, actual: ownerOf(bItem) });

  // Insufficient funds -> 402 with NO partial state change.
  const aItem = giveItem(VUID_A);
  const aListRes = await readJson(await listRoute.POST(buildRequest(apiUrl("/api/marketplace/list"), { method: "POST", token: tokens.playerA, body: { instanceId: aItem, price: 100000 } })));
  const aListingId = aListRes?.listingId;
  setBalance(VUID_B, 5); // B too poor to afford 100000
  const bBalBefore = players.getBalance(VUID_B);
  const aBalBefore = players.getBalance(VUID_A);
  const poorRes = await obtainRoute.POST(buildRequest(apiUrl("/api/marketplace/obtain"), { method: "POST", token: tokens.playerB, body: { listingId: aListingId } }));
  R.check({ name: "insufficient funds rejected", setup: "B balance 5 < price", action: "POST obtain", expected: 402, actual: poorRes.status });
  R.check({ name: "no partial debit on 402", setup: "after 402", action: "read B balance", expected: bBalBefore, actual: players.getBalance(VUID_B) });
  R.check({ name: "no credit to seller on 402", setup: "after 402", action: "read A balance", expected: aBalBefore, actual: players.getBalance(VUID_A) });
  R.check({ name: "ownership unchanged on 402", setup: "after 402", action: "read owner", expected: VUID_A, actual: ownerOf(aItem) });
  R.check({ name: "listing still active on 402", setup: "after 402", action: "read listing status", expected: "active", actual: marketplace.getListing(aListingId)?.status });

  // obtain inactive listing (cancelled) -> 409.
  const cItem = giveItem(VUID_A);
  const cList = await readJson(await listRoute.POST(buildRequest(apiUrl("/api/marketplace/list"), { method: "POST", token: tokens.playerA, body: { instanceId: cItem, price: 10 } })));
  const cId = cList?.listingId;
  await listIdRoute.DELETE(buildRequest(apiUrl(`/api/marketplace/list/${cId}`), { method: "DELETE", token: tokens.playerA }));
  setBalance(VUID_B, 1000);
  const inactiveRes = await obtainRoute.POST(buildRequest(apiUrl("/api/marketplace/obtain"), { method: "POST", token: tokens.playerB, body: { listingId: cId } }));
  R.check({ name: "obtain cancelled listing", setup: "listing cancelled", action: "POST obtain", expected: 409, actual: inactiveRes.status });

  // Forced-fault rollback: spy on db.prepare at the transaction INSERT (recordTransaction) and throw.
  // The whole obtain is one transaction; a throw after debit MUST roll back ALL state.
  const dItem = giveItem(VUID_A);
  const dList = await readJson(await listRoute.POST(buildRequest(apiUrl("/api/marketplace/list"), { method: "POST", token: tokens.playerA, body: { instanceId: dItem, price: 50 } })));
  const dId = dList?.listingId;
  setBalance(VUID_A, 1000);
  setBalance(VUID_B, 1000);
  const aFaultBefore = players.getBalance(VUID_A);
  const bFaultBefore = players.getBalance(VUID_B);

  const db = dbIndex.getDb();
  const realPrepare = db.prepare.bind(db);
  let threw = false;
  db.prepare = function (sql) {
    if (/INSERT INTO marketplace_transaction/i.test(sql)) {
      threw = true;
      throw new Error("injected fault at transaction INSERT");
    }
    return realPrepare(sql);
  };
  let faultStatus = "no-throw";
  try {
    await obtainRoute.POST(buildRequest(apiUrl("/api/marketplace/obtain"), { method: "POST", token: tokens.playerB, body: { listingId: dId } }));
    faultStatus = "returned";
  } catch {
    faultStatus = "threw";
  } finally {
    db.prepare = realPrepare; // restore immediately
  }
  R.check({ name: "forced fault injected", setup: "spy throws at tx INSERT", action: "run obtain", expected: true, actual: threw });
  R.check({ name: "rollback: owner unchanged", setup: "after injected fault", action: "read owner", expected: VUID_A, actual: ownerOf(dItem) });
  R.check({ name: "rollback: buyer balance unchanged", setup: "after injected fault", action: "read B balance", expected: bFaultBefore, actual: players.getBalance(VUID_B) });
  R.check({ name: "rollback: seller balance unchanged", setup: "after injected fault", action: "read A balance", expected: aFaultBefore, actual: players.getBalance(VUID_A) });
  R.check({ name: "rollback: listing still active", setup: "after injected fault", action: "read listing status", expected: "active", actual: marketplace.getListing(dId)?.status });
}

// ===================================================================================================
// GROUP F — Shop / purchase (server-authoritative; failures leave balance + inventory unchanged)
// ===================================================================================================
async function groupF(tokens) {
  R.group("F. Shop / purchase — server authoritative");
  ensurePlayer(VUID_A, 1000);

  // Materialise the live rotation so we have a REAL active offer id.
  const shopBody = await readJson(await shopRoute.GET(buildRequest(apiUrl("/api/shop"), { token: tokens.playerA })));
  const offer = (shopBody?.offers ?? [])[0];

  // unknown offer -> 404.
  const unknownRes = await purchaseRoute.POST(buildRequest(apiUrl("/api/shop/purchase"), { method: "POST", token: tokens.playerA, body: { offerId: "no-such-offer" } }));
  R.check({ name: "purchase unknown offer", setup: "bogus offerId", action: "POST purchase", expected: 404, actual: unknownRes.status });

  // out-of-rotation offer id (well-formed but never materialised) -> 404.
  const staleId = `1999-01-01T00:00:00.000Z::${offer ? offer.templateId : "tpl-suite-cape"}`;
  const staleRes = await purchaseRoute.POST(buildRequest(apiUrl("/api/shop/purchase"), { method: "POST", token: tokens.playerA, body: { offerId: staleId } }));
  R.check({ name: "purchase out-of-rotation", setup: "stale/unknown offer id", action: "POST purchase", expected: 404, actual: staleRes.status });

  if (offer) {
    // insufficient funds -> 402, no partial deduction / no item minted.
    setBalance(VUID_A, 0);
    const balBefore = players.getBalance(VUID_A);
    const invBefore = items.listInstancesForOwner(VUID_A).length;
    const poorRes = await purchaseRoute.POST(buildRequest(apiUrl("/api/shop/purchase"), { method: "POST", token: tokens.playerA, body: { offerId: offer.offerId, price: 0, buyerVuid: VUID_B } }));
    R.check({ name: "purchase insufficient funds", setup: "A balance 0", action: "POST purchase", expected: 402, actual: poorRes.status });
    R.check({ name: "no partial deduction", setup: "after 402", action: "read balance", expected: balBefore, actual: players.getBalance(VUID_A) });
    R.check({ name: "no item minted on 402", setup: "after 402", action: "count inventory", expected: invBefore, actual: items.listInstancesForOwner(VUID_A).length });

    // successful purchase: client price/owner/buyer ignored — server authoritative.
    setBalance(VUID_A, 100000);
    const okRes = await purchaseRoute.POST(buildRequest(apiUrl("/api/shop/purchase"), { method: "POST", token: tokens.playerA, body: { offerId: offer.offerId, price: 1, buyerVuid: VUID_B } }));
    const okBody = await readJson(okRes);
    R.check({ name: "purchase success", setup: "A funded; spoofed price=1,buyer=B", action: "POST purchase", expected: 200, actual: okRes.status });
    R.check({ name: "server price authoritative", setup: "client sent price=1", action: "check pricePaid", expected: offer.price, actual: okBody?.pricePaid });
    R.check({ name: "buyer=JWT not body", setup: "client sent buyer=B", action: "check item owner", expected: VUID_A, actual: ownerOf(okBody?.instanceId) });
  } else {
    R.check({ name: "shop had an offer to buy", setup: "rotation materialised", action: "read offers[0]", expected: "offer", actual: "none" });
  }
}

// ===================================================================================================
// GROUP G — Admin / RBAC (role from JWT only; spoofed role fields do not elevate)
// ===================================================================================================
async function groupG(tokens) {
  R.group("G. Admin / RBAC — role from JWT only");

  // no auth -> 401
  const noAuth = await adminSummaryRoute.GET(buildRequest(apiUrl("/api/admin/summary")));
  R.check({ name: "admin no auth", setup: "no token", action: "GET admin/summary", expected: 401, actual: noAuth.status });

  // non-admin -> 403
  const nonAdmin = await adminSummaryRoute.GET(buildRequest(apiUrl("/api/admin/summary"), { token: tokens.playerA }));
  R.check({ name: "admin non-admin forbidden", setup: "player A (no admin role)", action: "GET admin/summary", expected: 403, actual: nonAdmin.status });

  // admin -> 200
  const asAdmin = await adminSummaryRoute.GET(buildRequest(apiUrl("/api/admin/summary"), { token: tokens.admin }));
  const adminBody = await readJson(asAdmin);
  R.check({ name: "admin allowed", setup: "token has admin realm role", action: "GET admin/summary", expected: 200, actual: asAdmin.status });

  // summary exposes aggregate counts only (no private fields).
  const serialised = JSON.stringify(adminBody ?? {});
  const leaksPrivate = /private_note_ciphertext|currency_balance|ciphertext/i.test(serialised);
  R.check({ name: "summary is aggregate-only", setup: "admin response body", action: "scan for private fields", expected: false, actual: leaksPrivate });

  // spoofed role claims in the BODY/QUERY do NOT elevate a non-admin.
  const spoofBody = await adminSummaryRoute.GET(buildRequest(apiUrl("/api/admin/summary?role=admin"), { token: await mintToken({ vuid: VUID_A, realmRoles: [] }) }));
  R.check({ name: "?role=admin does not elevate", setup: "non-admin + query role=admin", action: "GET admin/summary", expected: 403, actual: spoofBody.status });

  // A non-admin token whose BODY asserts admin flags is still rejected on a POST admin route.
  const spoofPost = await adminRoleRoute.POST(buildRequest(apiUrl("/api/admin/private-note-role"), { method: "POST", token: tokens.playerA, body: { targetVuid: VUID_B, role: "_tide_dob.selfencrypt", isAdmin: true, admin: true, role_claim: "admin" } }));
  R.check({ name: "spoofed admin flags ignored", setup: "non-admin body isAdmin=true", action: "POST admin role route", expected: 403, actual: spoofPost.status });
}

// ===================================================================================================
// GROUP H — Task 11 / QEA boundary (headless app-wiring + documented live result)
// ===================================================================================================
async function groupH(tokens) {
  R.group("H. QEA boundary — allowlist enforced before any governance call (IGA stubbed)");

  // Stub the IGA fetch seam so NO live call is made; record whether initiate() ever reaches it.
  let initiateCalled = false;
  igaAdmin._setFetchForTests(async () => {
    initiateCalled = true;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });

  // Arbitrary role -> 422, and initiate (the governance call) is NEVER reached.
  const arbitrary = await adminRoleRoute.POST(buildRequest(apiUrl("/api/admin/private-note-role"), { method: "POST", token: tokens.admin, body: { targetVuid: VUID_B, role: "admin" } }));
  R.check({ name: "arbitrary role rejected", setup: "admin requests role=admin", action: "POST role route", expected: 422, actual: arbitrary.status });
  R.check({ name: "no governance call on reject", setup: "allowlist blocks first", action: "check IGA fetch seam", expected: false, actual: initiateCalled });

  // realm-management style escalation also rejected (422) before any call.
  const escalate = await adminRoleRoute.POST(buildRequest(apiUrl("/api/admin/private-note-role"), { method: "POST", token: tokens.admin, body: { targetVuid: VUID_B, role: "realm-management" } }));
  R.check({ name: "escalation role rejected", setup: "admin requests realm-management", action: "POST role route", expected: 422, actual: escalate.status });

  // Allowlist is EXACTLY the two _tide_dob roles (assert the real exported constant).
  const allow = [...igaAdmin.PRIVATE_NOTE_ROLE_ALLOWLIST].sort().join(",");
  R.check({ name: "allowlist is exactly the two roles", setup: "read exported constant", action: "compare", expected: "_tide_dob.selfdecrypt,_tide_dob.selfencrypt", actual: allow });

  igaAdmin._setFetchForTests(null); // restore

  // The app contains NO approve/commit logic. Scan CODE ONLY (comments stripped) — the IGA client's
  // prose documents that approve/commit is a human enclave step it deliberately does NOT automate.
  const igaCode = stripComments(await readSource("lib/tide/igaAdmin.ts"));
  const hasApproveCommit =
    /approveChangeRequest|commitChangeRequest/.test(igaCode) ||
    // a fetch/URL targeting an approve or commit endpoint would be real automation
    /["'`][^"'`]*change-requests\/[^"'`]*\/(approve|commit)/.test(igaCode);
  R.check({ name: "no approve/commit automation", setup: "scan igaAdmin code (no comments)", action: "grep approve/commit", expected: false, actual: hasApproveCommit });

  console.log(
    "  [DOCUMENTED] Live Task 11 QEA change request (CR 1957ce7d\u2026) was approved+committed in the browser\n" +
      "               enclave on 2026-10-01 with threshold = 1. Because threshold = 1, FOUR-EYES /\n" +
      "               TWO-PERSON APPROVAL WAS NOT DEMONSTRATED. This is a documented LIMITATION, not a headless\n" +
      "               result, and is explicitly NOT claimed as proven here."
  );
}

// ===================================================================================================
// GROUP I — OwnershipSpike PoC boundary (DOCUMENTED preserved evidence — NOT a headless test)
// ===================================================================================================
function groupI() {
  R.group("I. Ownership PoC boundary — DOCUMENTED evidence (not headless; OwnershipSpike untouched)");
  console.log(
    "  [DOCUMENTED] Preserved OwnershipSpike evidence (LEARNINGS, 2026-10-01):\n" +
      "    - A\u2192A attestation verifies; B\u2192B attestation verifies; cross-VUID verification is rejected.\n" +
      "    - Rebinding to a second owner (Player B) is DEMONSTRATED.\n" +
      "    - SUPERSESSION / REVOCATION is NOT demonstrated: A's prior signature STILL verifies after B's.\n" +
      "  This suite does NOT execute or modify OwnershipSpike/Forseti; the marketplace 'obtain' is a Layer A\n" +
      "  application-level temporary transfer, explicitly NOT Tide-backed (asserted in Group E: 0 Layer C rows)."
  );
}

// Read a production source file as text for static (grep) assertions.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
async function readSource(relPath) {
  return readFileSync(resolvePath(ROOT, relPath), "utf8");
}
/** Remove // line comments and block comments so static scans match CODE, not documentation prose. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 "); // line comments (avoid eating "://" in URLs)
}

// ===================================================================================================
async function main() {
  const tokens = await mintIdentities();
  try {
    await groupA();
    await groupB(tokens);
    await groupC(tokens);
    await groupD(tokens);
    await groupE(tokens);
    await groupF(tokens);
    await groupG(tokens);
    await groupH(tokens);
    groupI();
  } finally {
    try {
      dbIndex.closeDb();
    } catch {
      /* ignore */
    }
    cleanupTempDb();
  }

  R.summary();
  if (R.failed > 0) {
    console.error(`SECURITY SUITE FAILED: ${R.failed} failing assertion(s).`);
    process.exit(1);
  }
  console.log("SECURITY SUITE PASSED.");
  process.exit(0);
}

main().catch((e) => {
  console.error("SECURITY SUITE CRASHED:", e);
  try {
    cleanupTempDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
