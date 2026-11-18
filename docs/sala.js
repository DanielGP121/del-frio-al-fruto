// Rooms: one device hosts a game and the others join it with a five-character code.
// The host runs the whole game and publishes its state; every other device only shows that
// state and sends back what its player does (name, token, answers). Nothing else is shared.
//
// Messages travel through a Firebase Realtime Database, used over its plain REST interface:
// fetch for writes and EventSource for the live stream, so no library is loaded.
//   salas/CODE/p/e   state of the game, written by the host (a JSON string)
//   salas/CODE/p/h   heartbeat of the host
//   salas/CODE/c/ID  one node per joined device: n name, k token, i inputs (JSON string), t heartbeat
// Without a database address the page offers no rooms; on a development host a stand-in keeps the
// "database" in localStorage, so several tabs of one browser can play a room for testing.
window.Sala = (function () {
  "use strict";

  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0 or 1: easy to read aloud
  function random(n, chars) {
    const a = new Uint32Array(n);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a, (v) => chars[v % chars.length]).join("");
  }
  const newCode = () => random(5, CODE_CHARS);
  const newId = () => random(8, "abcdefghijklmnopqrstuvwxyz0123456789");
  const cleanCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  const validCode = (s) => /^[A-Z2-9]{5}$/.test(s);

  // § 1 — A copy of a subtree kept up to date from the "put" and "patch" events of the stream
  function setAt(tree, path, data, merge) {
    const keys = path.split("/").filter(Boolean);
    const mergeInto = (old) => {
      const out = Object.assign({}, old && typeof old === "object" ? old : {}, data);
      Object.keys(out).forEach((k) => { if (out[k] === null) delete out[k]; });
      return out;
    };
    if (!keys.length) return merge ? mergeInto(tree) : data;
    const root = tree && typeof tree === "object" ? tree : {};
    let node = root;
    keys.slice(0, -1).forEach((k) => { if (!node[k] || typeof node[k] !== "object") node[k] = {}; node = node[k]; });
    const last = keys[keys.length - 1];
    if (merge) node[last] = mergeInto(node[last]);
    else if (data === null) delete node[last];
    else node[last] = data;
    return root;
  }

  // § 2 — Firebase over REST. Reads and writes need no key: the database rules only open
  // salas/CODE, and a room cannot be listed, so the code is what gives access to it.
  function firebase(dbUrl) {
    const url = (path) => `${dbUrl.replace(/\/$/, "")}/${path}.json`;
    const req = (method, path, body) => fetch(url(path), { method, body: body === undefined ? undefined : JSON.stringify(body), keepalive: method === "DELETE" })
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    return {
      kind: "firebase",
      get: (path) => req("GET", path),
      put: (path, value) => req("PUT", path, value),
      patch: (path, value) => req("PATCH", path, value),
      del: (path) => req("DELETE", path),
      listen(path, onValue, onStatus) {
        let tree = null;
        const es = new EventSource(url(path));
        const apply = (e) => {
          let msg;
          try { msg = JSON.parse(e.data); } catch (err) { return; }
          if (!msg) return;
          tree = setAt(tree, msg.path || "/", msg.data, e.type === "patch");
          onValue(tree);
        };
        es.addEventListener("put", apply);
        es.addEventListener("patch", apply);
        es.onopen = () => onStatus && onStatus(true);
        es.onerror = () => onStatus && onStatus(false); // EventSource reconnects by itself
        return () => es.close();
      },
    };
  }

  // § 3 — Stand-in for development: the same interface over localStorage, shared by the tabs of
  // one browser. Every value is kept under its own key (its full path), so two tabs writing
  // different things at the same moment never overwrite each other, as in the real database.
  // BroadcastChannel tells the other tabs that something changed.
  function local() {
    const PRE = "sala-local:";
    const chan = "BroadcastChannel" in window ? new BroadcastChannel("sala-local") : null;
    const listeners = [];
    const notify = () => listeners.forEach((l) => l());
    if (chan) chan.onmessage = notify;
    const keysUnder = (path) => {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k === PRE + path || k.startsWith(PRE + path + "/")) out.push(k); }
      return out;
    };
    const read = (path) => {
      let tree = null;
      keysUnder(path).forEach((k) => { try { tree = setAt(tree, k.slice(PRE.length + path.length), JSON.parse(localStorage.getItem(k)), false); } catch (e) { /* unreadable value */ } });
      return tree;
    };
    // New values are written first and leftovers removed afterwards, so another tab never
    // finds the place empty in the middle of a write
    const put = (path, value) => {
      const fresh = new Set();
      const walk = (p, v) => {
        if (v === null || v === undefined) return;
        if (typeof v === "object") Object.keys(v).forEach((k) => walk(p + "/" + k, v[k]));
        else { fresh.add(PRE + p); localStorage.setItem(PRE + p, JSON.stringify(v)); }
      };
      walk(path, value);
      keysUnder(path).forEach((k) => { if (!fresh.has(k)) localStorage.removeItem(k); });
    };
    const changed = (value) => { if (chan) chan.postMessage(1); setTimeout(notify, 0); return Promise.resolve(value); };
    return {
      kind: "local",
      get: (path) => Promise.resolve(read(path)),
      put: (path, value) => { put(path, value); return changed(value); },
      patch: (path, value) => { Object.keys(value).forEach((k) => put(path + "/" + k, value[k])); return changed(value); },
      del: (path) => { put(path, null); return changed(null); },
      listen(path, onValue, onStatus) {
        let last;
        const l = () => { const v = read(path), s = JSON.stringify(v); if (s !== last) { last = s; onValue(v); } };
        listeners.push(l);
        setTimeout(() => { if (onStatus) onStatus(true); l(); }, 0);
        return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
      },
    };
  }

  // § 4 — Writes go out one at a time and only the latest value waits, so a slow connection
  // never delivers an old state after a newer one. stop() drops what is still waiting and
  // resolves once the write already on its way has landed.
  function writer(send) {
    let pending, has = false, busy = null, fails = 0, stopped = false;
    const flush = () => {
      if (busy || !has || stopped) return;
      const value = pending;
      has = false;
      busy = send(value).then(() => { fails = 0; }, () => { fails++; if (!has) { pending = value; has = true; } })
        .then(() => { busy = null; if (has) setTimeout(flush, fails ? Math.min(4000, 400 * fails) : 0); });
    };
    const push = (value, merge) => {
      pending = merge && has && pending && typeof pending === "object" ? Object.assign({}, pending, value) : value;
      has = true;
      flush();
    };
    push.stop = () => { stopped = true; has = false; return busy || Promise.resolve(); };
    return push;
  }

  // § 5 — The two ends of a room
  function host(t, code, handlers) {
    const base = `salas/${code}`;
    let beat = 0, last = null, closed = false, beating = Promise.resolve();
    const pushState = writer((s) => t.put(`${base}/p/e`, s));
    const pulse = () => { if (!closed) beating = t.put(`${base}/p/h`, ++beat).catch(() => {}); };
    pulse();
    const timer = setInterval(pulse, 20000);
    const stop = t.listen(`${base}/c`, (tree) => handlers.onClients(tree || {}), handlers.onStatus);
    return {
      code,
      publish(state) { if (closed) return; const s = JSON.stringify(state); if (s !== last) { last = s; pushState(s); } },
      // Removing the room waits for the writes already on their way, otherwise one landing after
      // the delete would bring the room back; a second delete a moment later catches any straggler
      close(remove) {
        closed = true; clearInterval(timer); stop();
        if (!remove) { pushState.stop(); return; }
        const del = () => t.del(base).catch(() => {});
        Promise.all([pushState.stop(), beating]).then(del).then(() => setTimeout(del, 2500));
      },
    };
  }

  function join(t, code, id, handlers) {
    const base = `salas/${code}`, mine = `${base}/c/${id}`;
    let beat = 0, heard = Date.now();
    const pushMine = writer((obj) => t.patch(mine, obj));
    const stop = t.listen(`${base}/p`, (p) => {
      heard = Date.now();
      let state = null;
      if (p && typeof p.e === "string") { try { state = JSON.parse(p.e); } catch (e) { state = null; } }
      handlers.onState(state, !!p);
    }, handlers.onStatus);
    const timer = setInterval(() => pushMine({ t: ++beat }, true), 25000);
    return {
      code, id,
      send(obj) { pushMine(Object.assign({}, obj, { t: ++beat }), true); },
      silence: () => Date.now() - heard, // time since the host was last heard
      leave() { clearInterval(timer); stop(); t.put(mine, null).catch(() => {}); },
    };
  }

  const exists = (t, code) => t.get(`salas/${code}/p/h`).then((v) => v != null);

  // The transport for this page: Firebase when the build has a database address, the local
  // stand-in on a development host or with ?salas=local, and none otherwise
  function transport(dbUrl) {
    if (dbUrl) return firebase(dbUrl);
    const dev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /[?&]salas=local\b/.test(location.search);
    return dev ? local() : null;
  }

  return { newCode, newId, cleanCode, validCode, transport, host, join, exists };
})();
