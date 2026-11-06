/* RulesForge · battle/sync.js
 * Connects two players' apps with a 6-character code, then keeps them in step: each player's battle details
 * (username, army list, its faction's rules and units, Force Disposition, Battle Ready), and every shared choice.
 *
 * Phones connect directly to each other (WebRTC, through PeerJS's free public broker, which only introduces them).
 * When that isn't reachable, two copies of the app open in the same browser can still pair (handy for testing).
 * A heartbeat notices a lost connection; reconnecting reuses the same two codes, so either phone can find the other.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O or 1/I, so codes are easy to read out
const PEERJS = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
const newCode = () => Array.from(crypto.getRandomValues(new Uint32Array(6)), n => ALPHABET[n % ALPHABET.length]).join("");
const idFor = code => `rulesforge-${code.toUpperCase()}`;
const BEAT = 4000, LOST = 13000;

let peerjsLoading = null;
function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  return peerjsLoading ||= new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = PEERJS; s.async = true;
    s.onload = () => window.Peer ? res(window.Peer) : rej(new Error("PeerJS didn't load"));
    s.onerror = () => { peerjsLoading = null; rej(new Error("PeerJS couldn't be downloaded")); };
    document.head.append(s);
  });
}

/**
 * Opens a sync session under `code` (a new one if not given). `getPayload()` returns this player's details;
 * `onPeer(payload)` gets the other player's details on (re)connecting; `onUpdate(patch)` gets later changes;
 * `onStatus(s)`: waiting · connecting · connected · lost · not-found · offline.
 * Returns { code, peerCode, connect(theirCode), send(patch), connected(), close() }.
 */
function openSync({ code = newCode(), peerCode = "", getPayload, onPeer, onUpdate, onStatus }) {
  const api = { code, peerCode };
  let peer = null, conn = null, local = null, closed = false, lastSeen = 0, live = false, beat = null;
  const status = s => onStatus?.(s);
  const seen = () => { lastSeen = Date.now(); if (!live) { live = true; status("connected"); } };
  const deliver = msg => {
    if (!msg || typeof msg !== "object") return;
    seen();
    if (msg.type === "hello") { if (msg.from) api.peerCode = msg.from; onPeer?.(msg.payload); }
    else if (msg.type === "update") onUpdate?.(msg.payload);
  };
  const hello = () => ({ type: "hello", from: code, payload: getPayload() });
  const hookConn = c => {
    c.on("open", () => { conn = c; c.send(hello()); });
    c.on("data", deliver);
    c.on("close", () => { if (conn === c) conn = null; });
  };
  // Same-browser fallback: messages addressed by code on a BroadcastChannel.
  local = new BroadcastChannel("rulesforge-sync");
  local.onmessage = e => {
    const m = e.data || {};
    if (m.to !== code) return;
    if (m.type === "knock") { api.peerCode = m.from; local.postMessage({ ...hello(), to: m.from }); seen(); return; }
    // A hello is answered with one (marked as a reply, so it isn't answered again): both sides get each other's details.
    if (m.type === "hello") { api.peerCode = m.from; if (!m.reply) local.postMessage({ ...hello(), reply: true, to: m.from }); }
    deliver(m);
  };
  const post = m => { try { if (conn?.open) conn.send(m); } catch {} if (api.peerCode) local?.postMessage({ ...m, to: api.peerCode, from: code }); };
  // Heartbeat: both sides ping; if nothing arrives for a while, the connection is lost.
  beat = setInterval(() => {
    if (!api.peerCode) return;
    post({ type: "ping" });
    if (live && Date.now() - lastSeen > LOST) { live = false; status("lost"); }
  }, BEAT);
  const knock = t => { local?.postMessage({ to: t, from: code, type: "knock" }); if (peer && !peer.disconnected && peer.open) hookConn(peer.connect(idFor(t), { serialization: "binary", reliable: true })); };

  status(peerCode ? "connecting" : "waiting");
  loadPeerJS().then(Peer => {
    if (closed) return;
    peer = new Peer(idFor(code));
    peer.on("open", () => { if (api.peerCode && !live) knock(api.peerCode); });   // reconnecting: look for the other phone too
    peer.on("connection", c => hookConn(c));
    peer.on("disconnected", () => { try { peer.reconnect(); } catch {} });
    peer.on("error", e => { if (e?.type === "peer-unavailable") status(live ? "connected" : "not-found"); else if (e?.type === "network" || e?.type === "server-error" || e?.type === "unavailable-id") status(live ? "connected" : "offline"); });
  }).catch(() => status("offline"));
  if (peerCode) knock(peerCode);

  Object.assign(api, {
    connect(theirCode) {
      const t = String(theirCode || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(t) || t === code) return false;
      api.peerCode = t; status("connecting"); knock(t);
      return true;
    },
    send(patch) { post({ type: "update", payload: patch }); },
    connected: () => live,
    close() { closed = true; clearInterval(beat); try { conn?.close(); peer?.destroy(); } catch {} local?.close(); local = null; },
  });
  return api;
}

export { newCode, openSync };
