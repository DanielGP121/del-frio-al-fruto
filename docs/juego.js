// Browser version of the quiz board game about the year of a fruit tree (name in datos.js).
// It follows the printed kit: right answers move 2, 3 or 4 stones, special stones and challenges
// work as on the board, and the first token round the year wins. Two things differ from paper:
// every token answers a question from the deck of the season it stands in, and the game can be
// played on one shared device (whoever holds it referees) or in a room, with one device per
// player. In a room one device hosts: it runs the game below and publishes its state through
// sala.js; the other devices show that state and send back what their player does.
// Cards and board layout come from datos.js, generated from the sources of the printed kit.
(function () {
  "use strict";

  const D = window.GAME_DATA, CFG = window.GAME_CONFIG || {};
  const N = D.board.n;
  const KIT_URL = D.game.repoUrl;
  // Every GitHub Pages site of an account shares one origin, so what is saved is keyed by repository
  const key = (name) => `${D.game.slug}/${name}`;
  const STORE_KEY = key("partida"), SETUP_KEY = key("equipos"), PREFS_KEY = key("ajustes"), SEAT_KEY = key("sala");
  const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const Q = Object.fromEntries(D.questions.map((q) => [q.id, q]));
  const X = Object.fromEntries(D.retos.map((r) => [r.id, r]));
  const DECK = Object.fromEntries(D.decks.map((d) => [d.key, d]));
  const DECK_WORD = { L: "azul", F: "rosa", H: "verde", R: "naranja" };
  // Rooms need a way to pass messages between devices; without one the page plays on one device only
  const NET = window.Sala ? Sala.transport((CFG.db || "").trim()) : null;

  // § 1 — Small helpers: DOM access, escaping, icons, random order and local storage.
  // Storage can be missing or blocked (private windows, previews), so every access is guarded
  // and the game works without it; it only lets a reloaded page resume the game in progress.
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const hex = (c) => "#" + c;
  const icon = (name, cls = "") => `<svg class="gi ${cls}" viewBox="0 0 512 512" aria-hidden="true">${D.icons[name] || ""}</svg>`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shuffle = (list) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, value) { try { localStorage.setItem(k, JSON.stringify(value)); } catch (e) { /* storage unavailable */ } },
    drop(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
  };
  const disc = (t, size = "") => `<span class="disc ${size}" style="--tc:${hex(t.color)};--ti:${hex(t.ink)}">${icon(t.icon)}</span>`;
  const zoneOf = (pos) => Math.floor((pos % N) / 8);
  const seasonOf = (k) => D.board.zones[zoneOf(k)].key;
  const where = (t) => (t.pos >= N ? "¡en la meta!" : t.pos === 0 ? "en la salida" : `casilla ${t.pos}`);
  const joinList = (n) => (n.length < 2 ? n.join("") : n.slice(0, -1).join(", ") + " y " + n[n.length - 1]);
  const joinNames = (teams) => joinList(teams.map((t) => t.name));
  const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 16);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // § 2 — What each device remembers for itself: how fast the tokens move and which board to show.
  // Speed 0 means "skip": tokens go straight to their stone. Messages on screen shorten with it.
  // The board is the 3D valley unless the player picks another view (or the device cannot draw it).
  const prefs = Object.assign({ speed: 1, board: "mundo" }, store.get(PREFS_KEY) || {});
  const SPEEDS = [1, 1.5, 2, 0];
  const SPEED_LABEL = { 1: "×1", 1.5: "×1,5", 2: "×2", 0: "⏭" };
  const SPEED_NAME = { 1: "normal", 1.5: "una vez y media más rápido", 2: "el doble de rápido", 0: "sin animación: las fichas saltan a su casilla" };
  if (!SPEEDS.includes(prefs.speed)) prefs.speed = 1;
  const stepMs = () => (prefs.speed === 0 ? 0 : (REDUCED ? 70 : 240) / prefs.speed);
  const pace = (ms) => Math.max(700, prefs.speed === 0 ? ms * 0.55 : ms / prefs.speed);

  // § 3 — Game counter. Each game counts as one outreach activity: GoatCounter records an event
  // when a game starts (how it is played, number of tokens and of players) and when it ends.
  // No cookies and no personal data; without a site code in index.html nothing leaves the browser.
  const counter = {
    code: (CFG.counter || "").trim(),
    queue: [],
    init() {
      if (!this.code) return;
      $("#privacy").hidden = false;
      const s = document.createElement("script");
      s.async = true;
      s.src = "https://gc.zgo.at/count.js";
      s.dataset.goatcounter = `https://${this.code}.goatcounter.com/count`;
      s.onload = () => this.flush();
      document.head.appendChild(s);
    },
    event(path, title) {
      if (!this.code) { console.info("[counter off]", path); return; }
      this.queue.push({ path, title });
      this.flush();
    },
    flush() {
      const gc = window.goatcounter;
      if (!gc || typeof gc.count !== "function") return;
      while (this.queue.length) { const e = this.queue.shift(); gc.count({ path: e.path, title: e.title, event: true }); }
    },
  };

  // § 4 — Short sounds for the end of the clock and of a challenge countdown (Web Audio, no files)
  let audio = null;
  function beep(times = 3) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < times; i++) {
        const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + i * 0.28;
        o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        o.start(t0); o.stop(t0 + 0.24);
      }
    } catch (e) { /* no audio available */ }
  }

  // § 5 — Board geometry, ported from the printed board (build_board.js): 32 stones evenly spaced
  // clockwise along a rounded rectangle, from the start at the top centre. The flat board turns to
  // portrait on narrow, upright screens; the track keeps the same length and stone spacing.
  const INSET = 27, R = 48, STONE = 14.5, BAND = 37;
  function geometry(portrait) {
    const W = portrait ? 297 : 420, H = portrait ? 420 : 297, CX = W / 2, CY = H / 2;
    const A = CX - INSET, B = CY - INSET, HT = A - R, VS = 2 * (B - R), ARC = Math.PI * R / 2;
    const arc = (cx, cy, start, d) => { const a = (start + d / R * 180 / Math.PI) * Math.PI / 180; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; };
    const pieces = [
      [HT, (d) => [CX + d, CY - B]],
      [ARC, (d) => arc(CX + A - R, CY - B + R, -90, d)],
      [VS, (d) => [CX + A, CY - B + R + d]],
      [ARC, (d) => arc(CX + A - R, CY + B - R, 0, d)],
      [2 * HT, (d) => [CX + A - R - d, CY + B]],
      [ARC, (d) => arc(CX - A + R, CY + B - R, 90, d)],
      [VS, (d) => [CX - A, CY + B - R - d]],
      [ARC, (d) => arc(CX - A + R, CY - B + R, 180, d)],
      [HT, (d) => [CX - A + R + d, CY - B]],
    ];
    const perim = pieces.reduce((s, p) => s + p[0], 0);
    const at = (s) => { for (const [len, f] of pieces) { if (s <= len) return f(s); s -= len; } return pieces[0][1](0); };
    const stones = Array.from({ length: N }, (_, k) => at(k * perim / N));
    return { W, H, CX, CY, A, B, portrait, stones };
  }

  // § 6 — Flat board (SVG). Same visual language as the print: season quadrants with faint
  // motifs, numbered stones in the season colour, flowers for luck, diamonds for bad luck,
  // yellow challenge stones and the painted tree in the middle.
  const f1 = (n) => Number(n).toFixed(2);
  const FONT_B = "Arial Black, Segoe UI Black, Helvetica Neue, Arial, sans-serif";
  const FONT = "Segoe UI, system-ui, -apple-system, Roboto, Arial, sans-serif";
  const C = D.colors;
  function T(x, y, s, o = {}) {
    return `<text x="${f1(x)}" y="${f1(y)}" font-family="${o.black ? FONT_B : FONT}" font-size="${o.size || 5}" font-weight="${o.black ? 900 : (o.weight || 400)}"${o.italic ? ' font-style="italic"' : ""} fill="${o.fill ? hex(o.fill) : hex(C.navy)}" text-anchor="${o.anchor || "start"}" dominant-baseline="central"${o.extra ? " " + o.extra : ""}>${esc(s)}</text>`;
  }
  const svgIcon = (name, cx, cy, size, color, extra = "") => `<svg x="${f1(cx - size / 2)}" y="${f1(cy - size / 2)}" width="${size}" height="${size}" viewBox="0 0 512 512" fill="${hex(color)}" ${extra}>${D.icons[name]}</svg>`;
  // Special stones and their shapes are drawn by the printed board builder and arrive as SVG
  // centred on (0, 0): here they are only moved into place and, for the legends, scaled down.
  // "Flor con suerte" when the board builder names its shapes, plain "con suerte" otherwise.
  const stoneName = (good, cap) => {
    const tail = good ? "con suerte" : "de mala pata", name = D.board.shapeNames && D.board.shapeNames[good ? "good" : "bad"];
    const text = name ? `${name.toLowerCase()} ${tail}` : tail;
    return cap ? text[0].toUpperCase() + text.slice(1) : text;
  };
  const glyph = (good, cx, cy, s) => `<g transform="translate(${f1(cx)} ${f1(cy)}) scale(${f1(s)})">${D.board.shapes[good ? "good" : "bad"]}</g>`;
  // Game title on two lines, small then big, sized to fit its plaque whatever the name
  function titleSvg(cx, y1, y2, width, s1, s2, stroke) {
    const [l1, l2] = D.game.lines;
    const fit = (text, max, k) => Math.min(max, width / Math.max(1, text.length * k));
    const big = T(cx, l1 ? y2 : (y1 + y2) / 2, l2, { black: true, size: fit(l2, s2, 0.78), fill: C.fruit, anchor: "middle", extra: `stroke="${hex(C.navy)}" stroke-width="${stroke}" paint-order="stroke"` });
    return (l1 ? T(cx, y1, l1, { black: true, size: fit(l1, s1, 0.7), anchor: "middle" }) : "") + big;
  }
  function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const MOTIF = {
    winter: `<g stroke="#B5D0E8" stroke-width="0.6" stroke-linecap="round"><line x1="-3" y1="0" x2="3" y2="0"/><line x1="-1.5" y1="-2.6" x2="1.5" y2="2.6"/><line x1="-1.5" y1="2.6" x2="1.5" y2="-2.6"/></g>`,
    spring: [0, 1, 2, 3, 4].map((k) => { const a = k * 72 * Math.PI / 180; return `<circle cx="${f1(1.7 * Math.cos(a))}" cy="${f1(1.7 * Math.sin(a))}" r="1.5" fill="#F5BFD2"/>`; }).join("") + `<circle r="0.9" fill="#F9E08A"/>`,
    summer: `<path d="M0 -3.4 C2.6 -1.6 2.6 1.6 0 3.4 C-2.6 1.6 -2.6 -1.6 0 -3.4 Z" fill="#BFE0C4"/>`,
    fruit: `<circle r="2.2" fill="#F8CD97"/><path d="M0 -2.2 q1.4 -1.6 2.6 -0.6 q-1.2 1.2 -2.6 0.6Z" fill="#CFE3B4"/>`,
  };
  // Quadrant of each season: winter top right, spring bottom right, summer bottom left, fruit top left
  const QUAD = { winter: [1, -1], spring: [1, 1], summer: [-1, 1], fruit: [-1, -1] };

  function boardSvg(g) {
    const { W, H, CX, CY, A, B } = g;
    const rng = mulberry32(7);
    let out = "";
    // Season quadrants and the white band under the track
    for (const z of D.board.zones) {
      const [sx, sy] = QUAD[z.key], x0 = sx > 0 ? CX : 0, y0 = sy > 0 ? CY : 0;
      out += `<rect x="${x0}" y="${y0}" width="${CX}" height="${CY}" fill="${hex(C.tint[z.key])}"/>`;
      let m = "";
      for (let i = 0; i < 40; i++) m += `<g transform="translate(${f1(x0 + rng() * CX)} ${f1(y0 + rng() * CY)}) rotate(${(rng() * 360).toFixed(0)}) scale(${f1(0.8 + rng() * 0.7)})">${MOTIF[z.key]}</g>`;
      out += `<g opacity="0.6">${m}</g>`;
    }
    const rr = `x="${CX - A}" y="${CY - B}" width="${2 * A}" height="${2 * B}" rx="${R}" fill="none"`;
    out += `<rect ${rr} stroke="${hex(C.navy)}" stroke-opacity="0.13" stroke-width="${BAND + 2}"/><rect ${rr} stroke="#FFFFFF" stroke-opacity="0.85" stroke-width="${BAND}"/>`;

    // Paper-cut corner vignettes, each ringed with the colour of its season
    const corner = (slot, season, cx, cy) => `<clipPath id="cl-${slot}"><circle cx="${cx}" cy="${cy}" r="13.6"/></clipPath>
      <circle cx="${cx + 0.6}" cy="${cy + 0.9}" r="15.5" fill="${hex(C.navy)}" fill-opacity="0.25"/><circle cx="${cx}" cy="${cy}" r="15.5" fill="${hex(C[season])}"/>
      <image href="img/esquina_${slot}.jpg" x="${cx - 13.6}" y="${cy - 13.6}" width="27.2" height="27.2" clip-path="url(#cl-${slot})" preserveAspectRatio="xMidYMid slice"/>`;
    out += corner("invierno", "winter", W - 19.5, 19.5) + corner("primavera", "spring", W - 19.5, H - 19.5) + corner("verano", "summer", 19.5, H - 19.5) + corner("fruto", "fruit", 19.5, 19.5);

    out += g.portrait ? innerPortrait(g) : innerLandscape(g);

    // Centre medallion: the paper-cut tree in four seasons, with the EEAD symbol where they meet.
    // The picture already splits the seasons along the axes, so no cross is drawn over it (the
    // trunk runs down the vertical axis), as on the printed board.
    out += `<g transform="translate(${CX} ${CY})"><clipPath id="cl-med"><circle r="53"/></clipPath>
      <circle cx="0.9" cy="1.3" r="57" fill="${hex(C.navy)}" fill-opacity="0.22"/><circle r="57" fill="#FFFFFF"/>
      <g clip-path="url(#cl-med)"><image href="img/centro.jpg" x="-53" y="-53" width="106" height="106" preserveAspectRatio="xMidYMid slice"/></g>
      <circle r="53" fill="none" stroke="${hex(C.navy)}" stroke-width="0.7"/><circle r="57" fill="none" stroke="${hex(C.navy)}" stroke-width="0.5"/>
      <circle cx="0.4" cy="0.6" r="10.4" fill="${hex(C.navy)}" fill-opacity="0.25"/><circle r="10.2" fill="#FFFFFF"/>
      <image href="img/eead_simbolo.png" x="-8.8" y="-8.8" width="17.6" height="17.6"/><circle r="10.2" fill="none" stroke="${hex(C.navy)}" stroke-width="0.5"/></g>`;

    out += stonesSvg(g) + `<g id="tokens"></g>`;
    return out;
  }

  // Title plaque, one label per season and the key to the special stones (landscape layout, as printed)
  function innerLandscape(g) {
    const { W, CX } = g;
    let out = `<rect x="151" y="49.5" width="118" height="40" rx="8" fill="#FFFFFF" fill-opacity="0.86"/>`;
    out += titleSvg(CX, 59.5, 74, 108, 8.6, 16.5, 0.55);
    out += T(CX, 84.5, "Da la vuelta al año de un frutal sin perder la fruta", { size: 4.3, italic: true, anchor: "middle" });
    for (const z of D.board.zones) {
      const [sx, sy] = QUAD[z.key], c = C[z.key];
      const x = sx > 0 ? 276 : W - 276 - 92, yHead = sy < 0 ? 58 : 162;
      out += `<circle cx="${x + 5}" cy="${yHead}" r="5" fill="${hex(c)}"/>` + svgIcon(z.icon, x + 5, yHead, 7, "FFFFFF");
      out += T(x + 12.5, yHead, z.name, { black: true, size: 6.2, fill: c });
      out += T(x + 12.5, yHead + 7.5, z.sub, { size: 5, italic: true });
      out += svgIcon(z.icon, x + 46, yHead + 33, 34, c, 'fill-opacity="0.16"');
      const deck = D.decks[D.board.zones.indexOf(z)];
      out += T(x + 46, yHead + 33, `Preguntas de ${deck.name.toLowerCase()}`, { size: 4.6, weight: 700, fill: c, anchor: "middle" });
      const evs = Object.entries(D.board.events).filter(([k]) => seasonOf(+k) === z.key);
      evs.forEach(([, ev], i) => {
        const y = (sy < 0 ? 122 : 226) + i * 9;
        out += svgIcon(ev.icon, x + 3.5, y, 6.5, c);
        out += T(x + 9, y, ev.text.split(": ")[0], { size: 4.5, weight: 600 });
        out += `<rect x="${x + 79}" y="${f1(y - 3)}" width="13" height="6" rx="3" fill="${hex(ev.delta > 0 ? C.good : C.bad)}"/>`;
        out += T(x + 85.5, y + 0.2, (ev.delta > 0 ? "+" : "−") + Math.abs(ev.delta), { black: true, size: 4.2, fill: "FFFFFF", anchor: "middle" });
      });
    }
    out += legendPlaque(151, 209.5, 118, 41, 4.6, true);
    return out;
  }

  // Portrait layout: the same pieces, stacked, with larger text so it reads on a phone
  function innerPortrait(g) {
    const { CX } = g;
    let out = `<rect x="58" y="51" width="181" height="44" rx="9" fill="#FFFFFF" fill-opacity="0.86"/>`;
    out += titleSvg(CX, 62, 81, 170, 9.5, 19, 0.6);
    for (const z of D.board.zones) {
      const [sx, sy] = QUAD[z.key], c = C[z.key], y = sy < 0 ? 110 : 290;
      const xi = sx > 0 ? 242 : 55, anchor = sx > 0 ? "end" : "start", xt = sx > 0 ? xi - 12 : xi + 12;
      out += `<circle cx="${xi}" cy="${y}" r="6.5" fill="${hex(c)}"/>` + svgIcon(z.icon, xi, y, 9, "FFFFFF");
      out += T(xt, y - 1, z.name, { black: true, size: z.name.length > 10 ? 7 : 8, fill: c, anchor });
      out += T(xt, y + 8.5, z.sub, { size: 6.6, italic: true, anchor });
    }
    out += legendPlaque(52, 318, 193, 50, 7.2, false);
    return out;
  }

  function legendPlaque(x, y, w, h, size, credits) {
    const rows = [
      [(cx, cy) => `<circle cx="${cx}" cy="${cy}" r="${size * 0.8}" fill="${hex(C.reto)}"/>` + svgIcon("GiStarMedal", cx, cy, size * 1.15, C.navy), "Reto: supera la prueba y avanza 3"],
      [(cx, cy) => glyph(true, cx, cy, size * 0.055), `${stoneName(true, true)}: avanza`],
      [(cx, cy) => glyph(false, cx, cy, size * 0.055), `${stoneName(false, true)}: retrocede`],
    ];
    const step = size * 1.75, top = y + size * 1.35;
    let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#FFFFFF" fill-opacity="0.88"/>`;
    rows.forEach(([shape, text], i) => {
      const cy = top + i * step;
      out += shape(x + 9, cy) + T(x + 9 + size * 1.4, cy, text, { size, weight: 600 });
    });
    if (credits) {
      const yl = y + h - 9.5;
      out += `<line x1="${x + 6}" y1="${yl - 3.5}" x2="${x + w - 6}" y2="${yl - 3.5}" stroke="${hex(C.navy)}" stroke-opacity="0.18" stroke-width="0.3"/>`;
      out += `<image href="img/eead_horizontal.png" x="${x + 5.5}" y="${yl - 1.5}" width="${(9 * 2.386).toFixed(2)}" height="9"/>`;
      out += T(x + 31, yl + 1.6, "Juego de Daniel González Palazón", { size: 3.4, weight: 700 }) + T(x + 31, yl + 6, "Semana de la Ciencia 2026 · EEAD-CSIC", { size: 3 });
    }
    return out;
  }

  function stonesSvg(g) {
    const P = g.stones;
    let out = "";
    for (let k = 1; k < N - 1; k++) {
      const [ax, ay] = P[k], [bx, by] = P[k + 1], ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
      out += `<polygon points="-1.5,-2 1.9,0 -1.5,2" fill="${hex(C.navy)}" fill-opacity="0.45" transform="translate(${f1((ax + bx) / 2)} ${f1((ay + by) / 2)}) rotate(${f1(ang)})"/>`;
    }
    for (let k = 0; k < N; k++) {
      const [x, y] = P[k], ev = D.board.events[k], reto = D.board.retos.includes(k), z = seasonOf(k);
      const r = k === 0 ? 19 : STONE;
      let s = ev ? "" : `<circle cx="${f1(x + 0.7)}" cy="${f1(y + 1)}" r="${r}" fill="${hex(C.navy)}" fill-opacity="0.22"/>`;
      if (k === 0) {
        s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" fill="${hex(C.navy)}" stroke="${hex(C.reto)}" stroke-width="1.8"/>` + svgIcon("GiFruitBowl", x, y - 0.3, 15, C.reto);
        s += T(x, y - 11.2, "SALIDA", { black: true, size: 3.9, fill: "FFFFFF", anchor: "middle" }) + T(x, y + 12, "META", { black: true, size: 4.4, fill: "FFFFFF", anchor: "middle" });
      } else if (reto) {
        s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" fill="${hex(C.reto)}" stroke="#FFFFFF" stroke-width="1.6"/>` + svgIcon("GiStarMedal", x, y - 2.4, 13.5, C.navy);
        s += T(x, y + 8.6, "RETO", { black: true, size: 4.3, anchor: "middle" });
      } else if (ev) {
        s += `<g transform="translate(${f1(x)} ${f1(y)})">${ev.svg}</g>`;
      } else {
        s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" fill="${hex(C[z])}" stroke="#FFFFFF" stroke-width="1.6"/>` + T(x, y + 0.6, String(k), { black: true, size: 11, fill: "FFFFFF", anchor: "middle" });
      }
      const tap = ev || reto ? ` data-stone="${k}"` : "";
      out += `<g class="stone"${tap}>${s}</g>`;
    }
    return out;
  }

  // § 7 — Tokens and the three boards. The game only says on which stone each token stands; a
  // small animator walks every token there one stone at a time and tells the board on screen
  // where to draw it. Tokens sharing a stone sit in a small ring so all stay visible.
  // The board can be seen three ways: "mundo", the 3D valley (default); "basico", the printed
  // board on a table in 3D; and "2d", the flat SVG board. The 3D ones are loaded on demand and
  // keep the layout of the printed track; one that cannot run on a device is marked as failed
  // and the next simpler one takes its place.
  let S = null;
  let G = null;
  const LAND = geometry(false);
  const BOARDS = ["mundo", "basico", "2d"];
  const VIEW3D = {
    mundo: { file: "./tablero3d.js", host: "#board3d", v: null, st: "idle" },   // st: idle, loading, ready or failed
    basico: { file: "./tablero3d_basico.js", host: "#boardBasic", v: null, st: "idle" },
  };
  if (!BOARDS.includes(prefs.board)) prefs.board = "mundo";
  // Graphics quality of the valley: "auto" measures the device; ?calidad=alta|media|baja forces one
  const QUALITY = (location.search.match(/[?&]calidad=(alta|media|baja)\b/) || [])[1] || "auto";
  const anim = { shown: {}, timer: null, waiters: [] };

  const upright = () => window.innerWidth <= 860 && window.innerHeight > window.innerWidth;
  // The board in use: the chosen one, or the next simpler one if that cannot run here
  function boardMode() {
    if (REDUCED) return "2d";
    for (const m of BOARDS.slice(BOARDS.indexOf(prefs.board))) if (m === "2d" || VIEW3D[m].st !== "failed") return m;
    return "2d";
  }
  // The 3D view on screen right now, if any (a view still loading leaves the flat board showing)
  const live3d = () => { const m = boardMode(); return m !== "2d" && VIEW3D[m].v ? VIEW3D[m].v : null; };
  const visibleTeams = () => (S.phase === "lobby" ? S.teams.filter((t) => t.members.length) : S.teams);
  function spots() {
    const groups = {};
    visibleTeams().forEach((t) => {
      const p = anim.shown[t.i] == null ? t.pos : anim.shown[t.i], k = Math.min(p, N) % N;
      (groups[k] = groups[k] || []).push(t);
    });
    const out = [];
    for (const [k, list] of Object.entries(groups)) {
      const c = list.length, ring = c === 1 ? 0 : c <= 3 ? 7 : 9.5, r = c >= 4 ? 6 : 7.2;
      list.forEach((t, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / c; out.push({ t, k: +k, dx: ring * Math.cos(a), dy: ring * Math.sin(a), r }); });
    }
    return out;
  }

  function drawBoard() {
    const mode = boardMode(), V = live3d();
    for (const m of ["mundo", "basico"]) $(VIEW3D[m].host).hidden = !(V && m === mode);
    $("#board").style.display = V ? "none" : "";
    $("#viewSeg").hidden = REDUCED;
    document.querySelectorAll("#viewSeg [data-board]").forEach((b) => {
      const m = b.dataset.board;
      b.setAttribute("aria-pressed", String(m === mode));
      b.hidden = m !== "2d" && VIEW3D[m].st === "failed";
    });
    const camBtn = $("#camToggle");
    camBtn.hidden = !(V && mode === "mundo");
    if (!camBtn.hidden) camBtn.textContent = V.getView() === "whole" ? "Seguir a las fichas" : "Ver el valle entero";
    if (mode !== "2d" && !VIEW3D[mode].v) load3d(mode); // the flat board stays on screen while a 3D view loads
    if (V) V.resize();
    else {
      const svg = $("#board");
      const portrait = upright();
      if (!G || G.portrait !== portrait || !svg.childNodes.length) {
        G = geometry(portrait);
        svg.setAttribute("viewBox", `0 0 ${G.W} ${G.H}`);
        svg.innerHTML = boardSvg(G);
      }
    }
    drawTokens(0);
  }
  function load3d(mode) {
    const view = VIEW3D[mode];
    if (view.st !== "idle") return;
    view.st = "loading";
    const fail = (why) => { console.info(`[3D ${mode} off]`, why); view.st = "failed"; view.v = null; if (S) drawBoard(); };
    const common = { stones: LAND.stones, colors: C, icons: D.icons, reduced: REDUCED, onStone: explainStone, onFail: () => fail("lost") };
    const opts = mode === "mundo"
      ? { ...common, zones: D.board.zones, events: D.board.events, retos: D.board.retos, quality: QUALITY }
      : { ...common, texture: D.board.texture, slots: D.board.slots, decks: D.decks, reto: D.reto };
    import(view.file + (CFG.v ? "?v=" + CFG.v : "")).then((m) => m.create($(view.host), opts))
      .then((v) => { view.v = v; view.st = "ready"; if (S) drawBoard(); })
      .catch((e) => fail(e && e.message));
  }

  // The tokens that matter at this moment, most important first: the team doing a challenge,
  // this player's own token, the tokens answering the question on screen, or whoever leads
  function focusTokens() {
    if (S.phase === "reto" && S.reto) return [S.reto.team];
    const mine = myTeam();
    if (mine) return [mine.i];
    if (["question", "solution"].includes(S.phase) && S.qs.length) return (ROLE === "local" ? S.qs[S.qi] : S.qs[0]).tokens.slice();
    return visibleTeams().slice().sort((a, b) => b.pos - a.pos).slice(0, 1).map((t) => t.i);
  }
  function drawTokens(ms = 0) {
    if (!S) return;
    const list = spots(), active = S.phase === "reto" && S.reto ? S.reto.team : -1, mine = myTeam();
    const V = live3d();
    if (V) {
      // The valley also wants to know which tokens matter now (its camera and its weather
      // follow the first of them) and in which season each one is; the basic view ignores both
      const focus = focusTokens();
      V.setTokens(list.map((s) => ({
        id: s.t.i, x: LAND.stones[s.k][0] + s.dx, y: LAND.stones[s.k][1] + s.dy, r: s.r,
        color: s.t.color, ink: s.t.ink, icon: s.t.icon, active: s.t.i === active, mine: !!mine && mine.i === s.t.i,
        zone: zoneOf(s.k), focus: focus.includes(s.t.i),
      })).sort((a, b) => focus.indexOf(a.id) - focus.indexOf(b.id)), ms);
      return;
    }
    const layer = $("#tokens");
    if (!layer || !G) return;
    const keep = new Set();
    list.forEach((s) => {
      const t = s.t, [sx, sy] = G.stones[s.k], tr = s.r, on = t.i === active, own = !!mine && mine.i === t.i;
      keep.add(String(t.i));
      let el = layer.querySelector(`[data-team="${t.i}"]`);
      if (!el) {
        el = document.createElementNS("http://www.w3.org/2000/svg", "g");
        el.setAttribute("class", "token");
        el.dataset.team = t.i;
        layer.appendChild(el);
      }
      const sig = `${tr}|${on}|${own}|${t.color}|${t.icon}`;
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        el.innerHTML = (on ? `<circle class="ring" r="${tr + 3.2}" fill="none" stroke="${hex(C.reto)}" stroke-width="2.2"/>` : "")
          + (own ? `<circle r="${tr + 1.9}" fill="none" stroke="${hex(C.navy)}" stroke-width="1.3"/>` : "")
          + `<ellipse cx="0.6" cy="${f1(tr * 0.42)}" rx="${f1(tr * 1.02)}" ry="${f1(tr * 0.8)}" fill="#000" fill-opacity="0.22"/>`
          + `<circle r="${tr}" fill="${hex(t.color)}" stroke="#FFFFFF" stroke-width="1.4"/><circle r="${f1(tr - 1.7)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.4" stroke-width="0.6"/>`
          + svgIcon(t.icon, 0, 0, tr * 1.3, t.ink);
      }
      el.style.transitionDuration = `${Math.round(ms * 0.9)}ms`;
      el.style.transform = `translate(${f1(sx + s.dx)}px, ${f1(sy + s.dy)}px)`;
    });
    layer.querySelectorAll("[data-team]").forEach((el) => { if (!keep.has(el.dataset.team)) el.remove(); });
  }

  function resetAnim() {
    clearTimeout(anim.timer);
    anim.timer = null; anim.shown = {};
    const w = anim.waiters; anim.waiters = []; w.forEach((r) => r());
  }
  // Starts walking every token towards the stone the game says it is on
  function animSync() {
    if (!S) return;
    S.teams.forEach((t) => { if (anim.shown[t.i] == null) anim.shown[t.i] = t.pos; });
    if (!anim.timer) animStep();
  }
  function animStep() {
    anim.timer = null;
    if (!S) return;
    const ms = stepMs();
    let moved = false;
    S.teams.forEach((t) => {
      const s = anim.shown[t.i];
      if (s === t.pos) return;
      anim.shown[t.i] = ms === 0 ? t.pos : s + Math.sign(t.pos - s);
      moved = true;
    });
    if (!moved) { const w = anim.waiters; anim.waiters = []; w.forEach((r) => r()); return; }
    drawTokens(ms);
    anim.timer = setTimeout(animStep, Math.max(ms, 40));
  }
  // Resolves when every token has reached its stone on this screen
  const settled = () => new Promise((res) => {
    if (!anim.timer && S && S.teams.every((t) => anim.shown[t.i] == null || anim.shown[t.i] === t.pos)) res();
    else anim.waiters.push(res);
  });

  // § 8 — Who is who. ROLE says what this device does: "local" (one device for everybody),
  // "host" (it runs a room) or "client" (it joined one). In a room each token has members, the
  // devices that picked it; "me" is this device's player.
  let ROLE = "local", room = null;
  const me = { id: null, name: "", k: -1, vote: null, rx: null, watch: false };
  let resolver = null; // pending challenge outcome while the referee decides
  let clients = {}, seen = {}, gotClients = false, voteSeq = 0, closeTimer = null, joinTimer = null, goneTimer = null, beats = 0, drawing = null, rxTimer = null;
  const canDrive = () => ROLE !== "client"; // this device moves the game on: the referee or the host
  const myTeam = () => (S && ROLE !== "local" ? S.teams.find((t) => (t.members || []).some((m) => m.id === me.id)) || null : null);
  const hostLabel = () => (S && S.hostName) || "quien creó la sala";
  const activeTeams = () => (S.tie ? S.tie.map((i) => S.teams[i]) : S.teams);
  const tokenName = (t) => (t.members.length === 1 ? t.members[0].name.toUpperCase() : t.key);
  const joinUrl = (code) => `${location.href.split(/[?#]/)[0]}?sala=${code}`;

  // § 9 — Game state. A game is a plain object so it can be saved, resumed and sent to a room
  const freshDecks = () => {
    const ids = (k) => shuffle(D.questions.filter((q) => q.id[0] === k).map((q) => q.id));
    return { L: ids("L"), F: ids("F"), H: ids("H"), R: ids("R"), X: shuffle(D.retos.map((r) => r.id)) };
  };
  const baseState = (extra) => Object.assign({
    v: 2, phase: "between", epoch: Math.floor(Math.random() * 1e9), round: 0, qs: [], qi: 0, answers: {}, votes: {}, voted: {}, qleft: null,
    tie: null, log: [], winner: null, reason: null, reto: null, retoQueue: [], toast: null, clock: null, people: null, secs: 0, counted: false, decks: freshDecks(),
  }, extra);
  function countStart() {
    counter.event("partida-empezada", "Partida empezada");
    counter.event(`equipos-${S.teams.length}`, `Partida con ${S.teams.length} fichas`);
    counter.event(`modo-${S.mode.place}`, `Partida ${S.mode.place === "juntos" ? "en el mismo sitio" : "a distancia"}`);
    counter.event(`dispositivos-${ROLE === "host" ? "sala" : "uno"}`, ROLE === "host" ? "Partida en sala" : "Partida en un dispositivo");
    if (S.people) counter.event(`personas-${S.people}`, `Partida con ${S.people} personas`);
  }
  function newGame(cfg) {
    ROLE = "local"; room = null; resetAnim();
    S = baseState({
      mode: cfg.mode, teams: cfg.teams.map((t, i) => ({ ...t, i, pos: 0 })),
      clock: cfg.minutes ? { left: cfg.minutes * 60, paused: false, expired: false } : null, people: cfg.people || null,
    });
    countStart();
    showGame();
    startRound();
  }
  function save() {
    if (S && canDrive() && ["lobby", "question", "solution", "between"].includes(S.phase)) store.set(STORE_KEY, S);
  }
  function drawCard(deck) {
    if (!S.decks[deck].length) S.decks[deck] = shuffle(D.questions.filter((q) => q.id[0] === deck).map((q) => q.id));
    return S.decks[deck].shift();
  }

  // § 10 — Round flow. A round asks one question per season that has tokens in it: each token
  // answers the card of the deck of its own season (at the start, winter). On one device the
  // questions of a round are read one after another and the referee marks every paddle; in a
  // room every player answers on a personal device at the same time. Then the tokens that got
  // it right move, and what they land on is resolved.
  function startRound() {
    S.round++;
    if (S.tie) S.qs = [{ deck: D.decks[S.round % D.decks.length].key, tokens: S.tie.slice() }];
    else S.qs = D.decks.map((d, z) => ({ deck: d.key, tokens: S.teams.filter((t) => zoneOf(t.pos) === z).map((t) => t.i) })).filter((q) => q.tokens.length);
    S.qs.forEach((q) => { q.card = drawCard(q.deck); });
    S.qi = 0; S.answers = {}; S.votes = {}; S.voted = {}; S.log = []; S.phase = "question";
    S.qleft = ROLE === "host" && S.mode.qsecs ? S.mode.qsecs : null;
    me.vote = null;
    save(); setView("card"); render();
  }

  // Room: how many members of each token have answered; the question closes when all have
  function tally() {
    if (ROLE !== "host" || S.phase !== "question") return;
    let all = Object.keys(S.votes).length > 0;
    S.qs.forEach((q) => q.tokens.forEach((i) => {
      const m = S.teams[i].members;
      S.voted[i] = m.filter((p) => S.votes[p.id]).length;
      if (m.some((p) => p.on && !S.votes[p.id])) all = false;
    }));
    clearTimeout(closeTimer); closeTimer = null;
    if (all) closeTimer = setTimeout(closeQuestion, 900); // a moment to change one's mind
  }
  // The answer of a token is the letter most voted by its members; a tie goes to the letter voted first
  function teamAnswer(t) {
    const count = {};
    t.members.forEach((m) => { const v = S.votes[m.id]; if (!v) return; const c = (count[v.l] = count[v.l] || { n: 0, s: v.s }); c.n++; c.s = Math.min(c.s, v.s); });
    const best = Object.entries(count).sort((a, b) => b[1].n - a[1].n || a[1].s - b[1].s)[0];
    return best ? best[0] : null;
  }
  function closeQuestion() {
    clearTimeout(closeTimer); closeTimer = null;
    if (!S || ROLE !== "host" || S.phase !== "question") return;
    S.qs.forEach((q) => q.tokens.forEach((i) => { S.answers[i] = teamAnswer(S.teams[i]); }));
    S.phase = "solution"; S.qleft = null;
    save(); render();
  }

  // Every await below re-checks that the same game is still running: leaving or restarting while
  // tokens move must stop the old sequence instead of letting it act on the new game.
  async function resolveRound() {
    const g = S, winners = [];
    S.qs.forEach((sq) => { const q = Q[sq.card]; sq.tokens.forEach((i) => { if (S.answers[i] === q.ans) winners.push({ t: S.teams[i], dif: q.dif }); }); });
    if (S.tie) return resolveTie(winners.map((w) => w.t));
    S.phase = "moving"; S.retoQueue = []; S.log = [];
    if (!winners.length) S.log.push({ icon: "GiCardRandom", text: "Nadie ha acertado esta vez." });
    winners.forEach((w) => S.log.push({ team: w.t.i, text: `${w.t.name} acierta y avanza ${w.dif}.` }));
    render();
    if (winners.length) {
      setView("board");
      await sleep(250);
      if (S !== g) return;
      winners.forEach((w) => { w.t.pos = Math.min(N, w.t.pos + w.dif); });
      animSync(); publish();
      await settled();
      for (const w of winners) { if (S !== g) return; await land(w.t); }
      if (S !== g) return;
      await runRetos();
      if (S !== g) return;
    }
    endRound();
  }
  function logPush(entry) {
    S.log.push(entry);
    if (S.phase === "moving") render();
  }
  async function moveBy(t, delta) {
    t.pos = Math.max(0, Math.min(N, t.pos + delta));
    animSync(); publish();
    await settled();
  }

  // What a token finds where it stops. The board layout guarantees that a bonus, a penalty or a
  // challenge reward never ends on another special stone, so effects never chain.
  async function land(t) {
    const g = S;
    if (t.pos >= N) { logPush({ icon: "GiFruitBowl", team: t.i, text: `¡${t.name} llega a la meta!` }); return; }
    const ev = D.board.events[t.pos];
    if (ev) {
      const [title, detail] = ev.text.split(": ");
      const verb = ev.delta > 0 ? `avanza ${ev.delta}` : `retrocede ${-ev.delta}`;
      logPush({ team: t.i, text: `${t.name} cae en «${title}» y ${verb}.` });
      await toast(ev.icon, ev.delta > 0 ? C.good : C.bad, title, `${detail[0].toUpperCase() + detail.slice(1)}. ${t.name} ${verb}.`, 2000);
      if (S !== g) return;
      await moveBy(t, ev.delta);
      return;
    }
    if (D.board.retos.includes(t.pos)) S.retoQueue.push(t.i);
  }

  async function runRetos() {
    const g = S;
    while (S === g && S.retoQueue.length) {
      const t = S.teams[S.retoQueue.shift()];
      await toast("GiStarMedal", C.reto, "¡Reto!", `${t.name} cae en un reto.`, 1300);
      if (S !== g) return;
      const out = await playReto(t);
      if (S !== g) return;
      setView("board");
      await sleep(200);
      if (S !== g) return;
      if (out.passed) {
        logPush({ team: t.i, text: `${t.name} supera el reto «${out.title}» y avanza ${D.board.retoReward}.` });
        await moveBy(t, D.board.retoReward);
        if (S !== g) return;
        await land(t);
      } else {
        logPush({ team: t.i, text: `${t.name} no supera el reto «${out.title}».` });
      }
      if (out.guesser != null && S === g) {
        const gt = S.teams[out.guesser];
        logPush({ team: gt.i, text: `${gt.name} adivina la palabra y avanza 1.` });
        await moveBy(gt, 1);
        if (S !== g) return;
        await land(gt);
      }
    }
  }

  // After every round: a single token past the finish wins, several go to a tie-break, and a
  // rung clock hands the win to the token furthest along
  function endRound() {
    const done = S.teams.filter((t) => t.pos >= N);
    if (done.length === 1) return finish(done[0], "meta");
    if (done.length > 1) return startTie(done, "meta");
    if (S.clock && S.clock.expired) return finishByTime();
    S.phase = "between";
    save(); render();
  }
  function finishByTime() {
    const best = Math.max(...S.teams.map((t) => t.pos)), top = S.teams.filter((t) => t.pos === best);
    if (top.length === 1) return finish(top[0], "tiempo");
    startTie(top, "tiempo");
  }
  function startTie(teams, why) {
    S.tie = teams.map((t) => t.i);
    S.log.push({ icon: "GiTrophyCup", text: why === "meta" ? `${joinNames(teams)} llegan a la meta en la misma ronda: desempatan con una pregunta más, solo para ellos.` : `Se acabó el tiempo y ${joinNames(teams)} van empatados en cabeza: desempatan con una pregunta más.` });
    S.phase = "between";
    save(); setView("card"); render();
  }
  function resolveTie(right) {
    if (right.length === 1) return finish(right[0], "desempate");
    if (right.length > 1) S.tie = right.map((t) => t.i);
    S.log = [{ icon: "GiTrophyCup", text: right.length ? `Siguen empatados ${joinNames(right)}. Otra pregunta.` : "Nadie del desempate ha acertado. Otra pregunta." }];
    S.phase = "between";
    save(); render();
  }
  function finish(team, reason) {
    S.phase = "end"; S.winner = team.i; S.reason = reason; S.tie = null;
    if (!S.counted) { S.counted = true; counter.event("partida-terminada", "Partida terminada"); }
    store.drop(STORE_KEY);
    setView("card"); render(); drawTokens();
    rain(team);
  }

  // § 11 — Challenges. Three ways to play one, decided by how the game is being played:
  //   referee  the printed card; whoever referees or hosts says whether the team made it
  //   camera   the same, worded for one screen shared in a video call (S.mode.place "distancia")
  //   remote   a room at a distance: the team plays on its own devices (retos.js)
  const retoDef = (R0) => { const r = X[R0.id]; return R0.net ? r.sala : (S.mode.place === "distancia" && r.camara ? r.camara : null); };
  const retoText = (R0) => { const def = retoDef(R0); return def ? Retos.askText(def, R0.extra) : X[R0.id].q; };
  const retoSol = (R0) => { const def = retoDef(R0); return (def && def.sol) || X[R0.id].sol; };
  const retoSeconds = (text) => { const m = text.match(/(\d+)\s*segundos/); return m ? +m[1] : null; };
  // A secret card cannot be played on a single screen that everybody is watching in a call
  const playable = (id) => !(ROLE === "local" && S.mode.place === "distancia" && X[id].camara === false);
  function drawReto() {
    for (let i = 0; i < 2 * D.retos.length; i++) {
      if (!S.decks.X.length) S.decks.X = shuffle(D.retos.map((r) => r.id));
      const id = S.decks.X.shift();
      if (playable(id)) return id;
    }
    return D.retos[0].id;
  }
  function newReto(team, id) {
    const r = X[id], net = ROLE === "host" && S.mode.place === "distancia";
    const R0 = { n: ((S.reto && S.reto.n) || S.retoN || 0) + 1, team, id, net, stage: net ? "ready" : (r.secret && ROLE === "local" ? "cover" : "play"), left: null, run: false, extra: {}, inputs: {}, clue: "", sub: null, ok: null, guess: null };
    const def = net ? r.sala : (S.mode.place === "distancia" ? r.camara : null);
    if (def && def.kind === "yemas") R0.extra.ask = Math.random() < 0.5 ? "flor" : "hoja";
    S.retoN = R0.n;
    return R0;
  }
  // A challenge waits for people: the panel shows the card and the promise resolves when the
  // referee says whether the team passed it, or when the remote version ends by itself
  function playReto(team) {
    S.phase = "reto";
    S.reto = newReto(team.i, drawReto());
    setView("card"); render(); drawTokens();
    return new Promise((res) => { resolver = res; });
  }
  function finishReto(passed, guesser = null) {
    const title = X[S.reto.id].title, r = resolver;
    S.reto = null; resolver = null; S.phase = "moving";
    render(); drawTokens();
    if (r) r({ passed, guesser, title });
  }

  // Remote challenges, on the host: start the countdown, read what the players send, close the card
  function retoStart() {
    const R0 = S.reto;
    if (!R0 || !R0.net || R0.stage !== "ready") return;
    R0.stage = "run"; R0.left = X[R0.id].sala.secs;
    render();
  }
  function retoInputs() {
    const R0 = S.reto;
    if (ROLE !== "host" || !R0 || !R0.net) return;
    const def = X[R0.id].sala, team = S.teams[R0.team];
    const mine = team.members.map((m) => R0.inputs[m.id]).filter(Boolean);
    if (R0.stage === "ready" && mine.some((x) => x.go)) return retoStart();
    if (R0.stage !== "run") return;
    if (def.kind === "pistas") {
      R0.clue = Retos.maskClue(def, Retos.teamValue(def, mine));
      // The first right guess from a player of another token ends the card
      for (const t of S.teams) {
        if (t.i === team.i) continue;
        for (const m of t.members) { const x = R0.inputs[m.id]; if (x && x.g && Retos.guessOk(def, x.g)) return retoEnd(true, t.i, m.name); }
      }
      return;
    }
    if (mine.some((x) => x.done)) retoSubmit();
  }
  // Time is up or the team pressed "Enviar": what can be checked is checked, the rest is judged by the host
  function retoSubmit() {
    const R0 = S.reto;
    if (!R0 || !R0.net || R0.stage !== "run") return;
    const def = X[R0.id].sala, team = S.teams[R0.team];
    if (def.kind === "pistas") return retoEnd(false);
    R0.sub = Retos.teamValue(def, team.members.map((m) => R0.inputs[m.id]).filter(Boolean));
    const ok = Retos.check(def, R0.sub, R0.extra);
    if (ok === null) { R0.stage = "review"; R0.left = null; render(); return; }
    retoEnd(ok);
  }
  async function retoEnd(ok, guesser = null, who = null) {
    const R0 = S.reto, g = S;
    R0.stage = "done"; R0.ok = ok; R0.left = null;
    R0.guess = guesser != null ? { team: guesser, name: who } : null;
    render();
    await sleep(pace(3000));
    if (S !== g || S.reto !== R0) return;
    finishReto(ok, guesser);
  }

  // § 12 — Rooms. The host keeps the list of joined devices up to date from what they write
  // (name, token, answers) and publishes the state of the game; a client replaces its state
  // with every publication and only animates the difference.
  function snapshot() {
    const pub = Object.assign({}, S);
    delete pub.decks; delete pub.votes;
    if (S.phase === "question") pub.answers = {}; // nobody sees the others' letters before the question closes
    if (S.reto) { pub.reto = Object.assign({}, S.reto); delete pub.reto.inputs; }
    return pub;
  }
  function publish() { if (ROLE === "host" && room && S) room.publish(snapshot()); }
  function netStatus(ok) { const w = $("#netwarn"); w.hidden = !!ok; if (!ok) w.textContent = "Sin conexión. Reintentando…"; }

  function openHost(code) {
    clients = {}; seen = {}; gotClients = false;
    room = Sala.host(NET, code, { onClients, onStatus: netStatus });
  }
  function onClients(tree) {
    const now = Date.now();
    Object.entries(tree).forEach(([id, c]) => {
      const p = clients[id];
      if (c && (!p || p.t !== c.t || p.i !== c.i || p.k !== c.k || p.n !== c.n)) seen[id] = now;
    });
    clients = tree; gotClients = true;
    reconcile();
  }
  function reconcile() {
    if (!S || ROLE !== "host" || !gotClients) return;
    const now = Date.now();
    const list = Object.entries(clients).filter(([, c]) => c && cleanName(c.n)).map(([id, c]) => ({ id, name: cleanName(c.n), k: typeof c.k === "number" ? c.k : -1, on: now - (seen[id] || 0) < 70000, i: c.i }));
    if (S.hostPlays) list.push({ id: me.id, name: me.name, k: me.k, on: true });
    S.teams.forEach((t) => {
      t.members = list.filter((p) => p.k === t.slot).map((p) => ({ id: p.id, name: p.name, on: p.on }));
      if (S.phase === "lobby") t.name = tokenName(t);
    });
    S.waiting = list.filter((p) => !S.teams.some((t) => t.slot === p.k)).map((p) => p.name);
    list.forEach((p) => {
      if (!p.i) return;
      let inp;
      try { inp = JSON.parse(p.i); } catch (e) { return; }
      if (S.phase === "question" && inp.r === S.round && typeof inp.l === "string" && "ABC".includes(inp.l) && inp.l.length === 1) {
        const old = S.votes[p.id];
        if (!old || old.l !== inp.l) S.votes[p.id] = { l: inp.l, s: ++voteSeq };
      }
      if (S.reto && S.reto.net && inp.x && inp.x.n === S.reto.n) S.reto.inputs[p.id] = inp.x;
    });
    afterInputs();
    if (S.phase === "lobby") { save(); drawTokens(); }
    render();
  }
  function afterInputs() {
    if (S.phase === "question") tally();
    if (S.phase === "reto") retoInputs();
  }
  // What this device's player did, sent to the host (or applied directly when this device is the host)
  function pushInputs() {
    if (ROLE === "client" && room) room.send({ i: JSON.stringify({ r: S.round, l: me.vote, x: me.rx }) });
    else if (ROLE === "host") {
      if (S.reto && S.reto.net && me.rx && me.rx.n === S.reto.n) S.reto.inputs[me.id] = clone(me.rx);
      afterInputs(); render();
    }
  }

  function createRoom(cfg) {
    const old = store.get(SEAT_KEY);
    resetAnim();
    ROLE = "host";
    me.id = (old && old.id) || Sala.newId(); me.name = cfg.hostName; me.k = -1; me.vote = null; me.rx = null;
    S = baseState({
      phase: "lobby", code: Sala.newCode(), mode: cfg.mode, minutes: cfg.minutes, hostName: cfg.hostName, hostPlays: cfg.hostPlays, hostSlot: -1, waiting: [],
      teams: D.teams.map((t, i) => ({ key: t.name, name: t.name, color: t.color, ink: t.ink, icon: t.icon, i, slot: i, pos: 0, members: [] })),
    });
    openHost(S.code);
    gotClients = true; // a new room has nobody in it yet
    store.set(SEAT_KEY, { code: S.code, id: me.id, name: me.name, host: true });
    counter.event("sala-creada", "Sala creada");
    if (!window.qrcode) { const s = document.createElement("script"); s.src = "vendor/qrcode.js"; s.onload = () => { if (S && S.phase === "lobby") render(); }; document.head.appendChild(s); }
    save();
    showGame(); setView("card"); render();
  }
  function startRoomGame() {
    const playing = S.teams.filter((t) => t.members.length);
    if (playing.length < 2) return;
    resetAnim();
    S.teams = playing.map((t, i) => ({ ...t, i, pos: 0, name: tokenName(t) }));
    S.epoch++;
    S.clock = S.minutes ? { left: S.minutes * 60, paused: false, expired: false } : null;
    S.people = S.teams.reduce((n, t) => n + t.members.length, 0);
    S.waiting = [];
    countStart();
    drawBoard();
    startRound();
  }

  function joinRoom(code, name, id) {
    resetAnim();
    ROLE = "client"; S = null;
    me.id = id || Sala.newId(); me.name = name; me.k = -1; me.vote = null; me.rx = null; me.watch = false;
    room = Sala.join(NET, code, me.id, { onState, onStatus: netStatus });
    room.send({ n: name });
    store.set(SEAT_KEY, { code, id: me.id, name, host: false });
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => { if (ROLE === "client" && !S) { leaveRoom(); joinMsg("No encuentro esa sala. Revisa el código."); } }, 9000);
    joinMsg("Entrando en la sala…");
  }
  function onState(state) {
    if (ROLE !== "client") return;
    // No state means the host closed the room. It is believed only if it stays that way for a
    // moment, so a hiccup of the connection does not throw a player out of a game.
    clearTimeout(goneTimer);
    if (!state) { if (S) goneTimer = setTimeout(() => { if (ROLE === "client" && S) roomClosed(); }, 3000); return; }
    const prev = S;
    S = state;
    if (!prev) { clearTimeout(joinTimer); joinMsg(""); showGame(); }
    if (!prev || prev.epoch !== S.epoch) resetAnim();
    if (!prev || prev.round !== S.round) me.vote = null;
    if (!prev || prev.phase !== S.phase || prev.round !== S.round) setView(S.phase === "moving" ? "board" : "card");
    if (S.toast && (!prev || !prev.toast || prev.toast.n !== S.toast.n)) showToast(S.toast);
    animSync();
    render(); drawTokens(stepMs());
    if (S.phase === "end" && (!prev || prev.phase !== "end")) rain(S.teams[S.winner]);
  }
  function leaveRoom() {
    clearTimeout(joinTimer); clearTimeout(closeTimer); clearTimeout(goneTimer);
    if (room) { if (ROLE === "host") room.close(true); else room.leave(); }
    room = null; ROLE = "local"; resolver = null;
    store.drop(SEAT_KEY);
    $("#netwarn").hidden = true;
  }
  function roomClosed() {
    leaveRoom();
    showSetup();
    showToast({ icon: "GiHourglass", color: C.navy, title: "La sala se ha cerrado", text: "Quien la creó ha terminado la partida.", ms: 3200 });
  }

  // § 13 — Clocks, once a second: the game clock, the time to answer a question in a room and
  // the countdown of a challenge. Clients count down by themselves between two publications.
  setInterval(() => {
    if (!S) return;
    if (["question", "solution", "moving", "reto", "between"].includes(S.phase)) {
      S.secs++;
      const c = S.clock;
      if (c && !c.paused && !c.expired && !S.tie && c.left > 0) {
        c.left--;
        if (c.left === 0 && canDrive()) {
          c.expired = true;
          beep(4);
          toast("GiHourglass", C.bad, "¡Se acabó el tiempo!", S.phase === "between" ? "Gana quien vaya más lejos." : "Terminad esta ronda: después gana quien vaya más lejos.", 3200);
          if (S.phase === "between") finishByTime();
        }
        if (canDrive() && c.left % 15 === 0) save();
      }
    }
    if (S.phase === "question" && S.qleft > 0) {
      S.qleft--;
      if (S.qleft === 0 && ROLE === "host") closeQuestion();
    }
    const R0 = S.reto;
    if (S.phase === "reto" && R0 && R0.left > 0 && (R0.net ? R0.stage === "run" : R0.run)) {
      R0.left--;
      if (R0.left === 0) {
        beep(2);
        if (R0.net) { if (ROLE === "host") retoSubmit(); } else if (canDrive()) { R0.run = false; publish(); }
      }
    }
    beats++;
    if (ROLE === "host") { if (beats % 5 === 0) reconcile(); else if (beats % 10 === 3) publish(); }
    if (ROLE === "client" && room && room.silence() > 65000) { const w = $("#netwarn"); w.hidden = false; w.textContent = `Esperando a ${hostLabel()}…`; }
    drawClock(); drawCounts();
  }, 1000);
  function drawClock() {
    const el = $("#clock");
    if (!S || !S.clock || S.phase === "end" || S.phase === "lobby") { el.hidden = true; return; }
    const c = S.clock, m = Math.floor(c.left / 60), s = String(c.left % 60).padStart(2, "0");
    el.hidden = false;
    el.textContent = c.expired ? "¡Tiempo!" : (c.paused ? "⏸ " : "") + `${m}:${s}`;
    el.classList.toggle("paused", c.paused);
    el.classList.toggle("low", c.expired || c.left <= 60);
  }
  // Countdowns on screen are patched in place, so a ticking second never redraws a card being used
  function drawCounts() {
    if (!S) return;
    const q = $('[data-count="q"]');
    if (q && S.qleft != null) { q.textContent = S.qleft; const bar = q.parentNode.querySelector("i"); if (bar) bar.style.width = `${Math.max(0, S.qleft / (S.mode.qsecs || 1) * 100)}%`; }
    const r = $('[data-count="reto"]');
    if (r && S.reto && S.reto.left != null) { r.textContent = S.reto.left > 0 ? S.reto.left : "¡Tiempo!"; r.classList.toggle("done", S.reto.left <= 0); }
  }

  // § 14 — Panel rendering: one function per phase writes the side panel and the action bar.
  // A view may give a key: while the key stays the same only its "dyn" part is rewritten, so
  // text boxes and drawings a player is using are left alone.
  const panel = () => $("#panel");
  function render() {
    if (!S) return;
    const mine = myTeam();
    let view;
    if (S.phase === "lobby") view = viewLobby;
    else if (ROLE === "client" && !mine && !me.watch && S.phase !== "end") view = viewPick;
    else view = { question: viewQuestion, solution: viewQuestion, moving: viewMoving, reto: viewReto, between: viewBetween, end: viewEnd }[S.phase];
    const out = view();
    $("#roundInfo").innerHTML = roundInfo();
    const p = panel();
    if (out.key && p.dataset.key === out.key) { const d = $("#rxDyn"); if (d) d.innerHTML = out.dyn || ""; }
    else { p.innerHTML = out.html; p.dataset.key = out.key || ""; drawing = null; if (out.mount) out.mount(); }
    $("#actions").innerHTML = out.actions || "";
    const sp = $("#speed");
    sp.textContent = SPEED_LABEL[prefs.speed];
    sp.setAttribute("aria-label", `Velocidad de las fichas: ${SPEED_NAME[prefs.speed]}`);
    drawClock(); drawCounts();
    if (live3d()) drawTokens(0); // the 3D camera and weather follow whoever matters in this phase
    publish();
  }
  function roundInfo() {
    if (S.phase === "end") return "Fin de la partida";
    if (S.phase === "lobby") return `Sala ${esc(S.code)}`;
    const room0 = S.code ? `<span class="deckname"> · sala ${esc(S.code)}</span>` : "";
    if (S.tie) return "Desempate" + room0;
    const sq = ROLE === "local" && ["question", "solution"].includes(S.phase) ? S.qs[S.qi] : null;
    return `Ronda ${S.round}` + (sq ? `<span class="deckname"> · mazo ${DECK_WORD[sq.deck]}</span>` : room0);
  }

  // A question card. o.teams are the tokens it is for, o.tap makes the options buttons (room),
  // o.picked is the letter this player chose
  function cardHtml(q, o) {
    const deck = DECK[q.id[0]], solved = o.solved;
    const dots = [1, 2, 3].map((d) => `<i class="${d <= q.dif - 1 ? "on" : ""}"></i>`).join("");
    const opts = ["A", "B", "C"].map((l, i) => {
      const who = o.teams.filter((t) => S.answers[t.i] === l).map((t) => disc(t, "xs")).join("");
      const cls = [solved ? (l === q.ans ? "right" : "wrong") : "", o.picked === l ? "picked" : ""].join(" ").trim();
      const tick = solved && l === q.ans ? ` <span class="tick" aria-label="correcta">✓</span>` : "";
      const inner = `<b>${l}</b><span class="txt">${esc(q.opts[i])}${tick}${who ? `<span class="who">${who}</span>` : ""}</span>`;
      return o.tap ? `<li class="${cls}"><button type="button" class="optbtn" data-act="vote" data-l="${l}" aria-pressed="${o.picked === l}">${inner}</button></li>` : `<li class="${cls}">${inner}</li>`;
    }).join("");
    const anyWrong = o.teams.some((t) => S.answers[t.i] !== q.ans);
    const sol = solved ? `<div class="sol"><details${anyWrong ? " open" : ""}><summary>Solución: ${q.ans}. ${anyWrong ? "Por qué:" : "Ver la explicación"}</summary><p>${esc(q.sol)}</p></details></div>` : "";
    const forWho = o.forWho ? `<div class="forteam">${o.teams.map((t) => disc(t, "sm")).join("")}<span>Para <b>${esc(joinNames(o.teams))}</b></span></div>` : "";
    return `<article class="card${o.tap ? " tap" : ""}" style="--c:${hex(deck.color)};--t:${hex(deck.tint)}">
      <header><span class="ic">${icon(deck.icon)}</span><span class="cat">${esc(deck.name)}</span><span class="code">${esc(q.id)}</span></header>${forWho}
      <p class="q">${esc(q.q)}</p><ol class="opts">${opts}</ol>
      <footer><span class="dots" aria-hidden="true">${dots}</span><span class="pill">AVANZA ${q.dif}</span></footer>${sol}</article>`;
  }
  const resultHtml = (a, q) => (a === q.ans ? `<span class="result ok"><span class="lt">${a}</span>✓ ${S.tie ? "" : "+" + q.dif}</span>` : `<span class="result ko"><span class="lt">${a || "–"}</span>✗</span>`);
  const anyRight = () => S.qs.some((sq) => sq.tokens.some((i) => S.answers[i] === Q[sq.card].ans));
  const resolveLabel = () => (S.tie ? "Seguir" : anyRight() ? "Mover fichas" : "Seguir");

  function viewQuestion() { return ROLE === "local" ? viewQuestionLocal() : viewQuestionRoom(); }

  // One device: the questions of the round one after another, the referee marks every paddle
  function viewQuestionLocal() {
    const sq = S.qs[S.qi], q = Q[sq.card], solved = S.phase === "solution", teams = sq.tokens.map((i) => S.teams[i]);
    let banner = "";
    if (S.tie) banner = `<div class="banner">Desempate entre ${esc(joinNames(teams))}</div>`;
    else if (S.qs.length > 1) banner = `<div class="banner zone" style="--c:${hex(DECK[sq.deck].color)}">Pregunta ${S.qi + 1} de ${S.qs.length} de esta ronda · para ${esc(joinNames(teams))}</div>`;
    const rows = teams.map((t) => {
      const a = S.answers[t.i];
      const right = solved ? resultHtml(a, q)
        : `<div class="paddles" role="group" aria-label="Respuesta de ${esc(t.name)}">${["A", "B", "C"].map((l) => `<button type="button" data-act="answer" data-team="${t.i}" data-l="${l}" aria-pressed="${a === l}">${l}</button>`).join("")}</div>`;
      return `<div class="arow" style="--tc:${hex(t.color)};--ti:${hex(t.ink)}">${disc(t, "sm")}<span class="tn">${esc(t.name)}<small>${where(t)}</small></span>${right}</div>`;
    }).join("");
    const how = S.mode.place === "distancia" ? "Cada equipo dice su letra a la de tres. Marca la de cada uno." : "A la de tres, cada equipo levanta su paleta. Marca la letra de cada uno.";
    const hint = solved ? "" : `<p class="hint">${S.qs.length > 1 ? `Contesta${teams.length > 1 ? "n" : ""} solo ${esc(joinNames(teams))}, que ${teams.length > 1 ? "están" : "está"} en esta zona. ` : ""}${how}</p>`;
    let actions;
    if (!solved) {
      const missing = teams.filter((t) => !S.answers[t.i]).length;
      actions = (missing ? `<p class="note">${missing === 1 ? "Falta 1 equipo" : `Faltan ${missing} equipos`} por marcar</p>` : "") + `<button class="primary" type="button" data-act="reveal"${missing ? " disabled" : ""}>Ver solución</button>`;
    } else if (S.qi < S.qs.length - 1) {
      const next = S.qs[S.qi + 1];
      actions = `<button class="primary" type="button" data-act="subnext" style="--dc:${hex(DECK[next.deck].color)}"><span class="dot"></span>Pregunta para ${esc(joinNames(next.tokens.map((i) => S.teams[i])))}</button>`;
    } else actions = `<button class="primary" type="button" data-act="resolve">${resolveLabel()}</button>`;
    return { html: banner + cardHtml(q, { solved, teams }) + `<div class="answers">${hint}${rows}</div>`, actions };
  }

  // Room: every player sees the card of the season of their token and answers on their own device
  function viewQuestionRoom() {
    const solved = S.phase === "solution", mine = myTeam();
    const sq = mine ? S.qs.find((q) => q.tokens.includes(mine.i)) : null;
    let html = S.tie ? `<div class="banner">Desempate entre ${esc(joinNames(S.tie.map((i) => S.teams[i])))}</div>` : "";
    if (!solved && S.qleft != null) html += `<div class="qtimer"><i style="width:${S.qleft / S.mode.qsecs * 100}%"></i><span data-count="q">${S.qleft}</span></div>`;
    if (sq) html += cardHtml(Q[sq.card], { solved, teams: sq.tokens.map((i) => S.teams[i]), tap: !solved, picked: solved ? null : me.vote });
    else html += (mine ? `<p class="hint">En esta ronda no te toca: es un desempate.</p>` : "") + S.qs.map((x) => cardHtml(Q[x.card], { solved, teams: x.tokens.map((i) => S.teams[i]), forWho: true })).join("");
    const rows = S.qs.map((x) => x.tokens.map((i) => {
      const t = S.teams[i], n = S.voted[i] || 0, all = n >= t.members.length;
      const right = solved ? resultHtml(S.answers[i], Q[x.card]) : `<span class="vstat${n ? " on" : ""}">${t.members.length > 1 ? `${n} de ${t.members.length}` : n ? "✓" : "…"}${all && t.members.length > 1 ? " ✓" : ""}</span>`;
      return `<div class="arow" style="--tc:${hex(t.color)};--ti:${hex(t.ink)}">${disc(t, "sm")}<span class="tn">${esc(t.name)}<small>${where(t)}</small></span>${right}</div>`;
    }).join("")).join("");
    html += `<div class="answers">${solved ? "" : `<p class="hint">${sq ? "Toca tu respuesta. Puedes cambiarla hasta que se cierre la pregunta." : "Cada jugador contesta en su dispositivo."}</p>`}${rows}</div>`;
    let actions;
    if (canDrive()) {
      const tokens = S.qs.reduce((n, x) => n + x.tokens.length, 0), done = S.qs.reduce((n, x) => n + x.tokens.filter((i) => S.voted[i]).length, 0);
      actions = solved ? `<button class="primary" type="button" data-act="resolve">${resolveLabel()}</button>`
        : `<p class="note">Han contestado ${done} de ${tokens} fichas</p><button class="primary" type="button" data-act="close-q">Cerrar respuestas</button>`;
    } else if (solved) actions = `<p class="note">Esperando a que ${esc(hostLabel())} mueva las fichas…</p>`;
    else actions = sq && me.vote ? `<p class="note">Respuesta enviada: <b>${me.vote}</b></p>` : "";
    return { html, actions };
  }

  function viewMoving() {
    return { html: logHtml() + standingsHtml(), actions: canDrive() ? `<button class="primary" type="button" disabled>Moviendo fichas…</button>` : "" };
  }

  // Challenge judged by a person: the printed card (or its camera wording)
  function viewRetoRef() {
    const R0 = S.reto, r = X[R0.id], t = S.teams[R0.team], deck = D.reto, mine = myTeam();
    const text = retoText(R0), secs = retoSeconds(text), others = S.teams.filter((o) => o.i !== t.i), def = retoDef(R0);
    const sees = ROLE !== "local" && !!mine && mine.i === t.i; // in a room a secret card shows only on the team's devices
    const picture = def && def.kind === "yemas" ? Retos.budsSvg({ labels: true }) : "";
    let body;
    if (R0.stage === "cover") {
      body = `<div class="cover"><p>Esta tarjeta solo la puede ver el equipo <b>${esc(t.name)}</b>. Los demás, mirad hacia otro lado.</p><button class="btn good" type="button" data-act="reto-peek">Somos ${esc(t.name)}: enseñar la tarjeta</button></div>`;
    } else if (R0.stage === "peek") {
      body = `<p class="q">${esc(text)}</p><div class="cover"><p>¿Ya la habéis leído? Ocultadla antes de enseñar la pantalla a los demás.</p><button class="btn good" type="button" data-act="reto-hide">Ocultar la tarjeta</button></div>`;
    } else {
      const shown = r.secret && !sees ? `<p class="q">Tarjeta secreta: solo ${esc(t.name)} sabe qué hay que adivinar.</p>` : `<p class="q">${esc(text)}</p>${picture}`;
      const timer = !secs ? "" : R0.left != null ? `<div class="timerbox"><div class="count${R0.left <= 0 ? " done" : ""}" data-count="reto">${R0.left > 0 ? R0.left : "¡Tiempo!"}</div></div>`
        : canDrive() ? `<div class="timerbox"><button class="btn" type="button" data-act="reto-timer" style="width:100%">${icon("GiHourglass")} Empezar la cuenta atrás: ${secs} segundos</button></div>` : "";
      const sol = r.secret || !canDrive() ? "" : `<div class="sol"><details><summary>Solución, solo para quien arbitra</summary><p>${esc(retoSol(R0)[0].toUpperCase() + retoSol(R0).slice(1))}</p></details></div>`;
      body = shown + timer + sol;
    }
    let choices = "";
    if (R0.stage === "play" && canDrive()) {
      choices = r.secret
        ? `<p class="askwho">¿Qué equipo ha adivinado la palabra? Si alguno la adivina, ${esc(t.name)} supera el reto y avanza ${r.adv}, y quien la adivina avanza 1.</p>
           <div class="whobtns">${others.map((o) => `<button class="btn" type="button" data-act="reto-guess" data-team="${o.i}">${disc(o, "sm")}${esc(o.name)}</button>`).join("")}<button class="btn bad" type="button" data-act="reto-fail">Nadie</button></div>`
        : `<div class="choices"><div class="row"><button class="btn good" type="button" data-act="reto-pass">¡Superado! Avanza ${r.adv}</button><button class="btn bad" type="button" data-act="reto-fail">No superado</button></div>
           <button class="linkbtn" type="button" data-act="reto-swap">No podemos hacer este reto: otra tarjeta</button></div>`;
    } else if (R0.stage === "play") choices = `<p class="askwho">${esc(hostLabel())} decide si ${esc(t.name)} supera el reto.</p>`;
    const html = `<article class="card reto" style="--c:${hex(deck.color)};--t:${hex(deck.tint)};--ink2:${hex(C.navy)}">
      <header><span class="ic">${icon(deck.icon)}</span><span class="cat">RETO</span><span class="code">${esc(r.id)}</span></header>
      <div class="forteam">${disc(t, "sm")}<span>Reto para <b>${esc(t.name)}</b></span></div>
      <h3 class="rt">${esc(r.title)}</h3>${body}
      <footer><span></span><span class="pill">SI LO CONSEGUÍS, AVANZAD ${r.adv}</span></footer></article>${choices}`;
    return { html, actions: "" };
  }

  // Challenge at a distance: the team plays it on its own devices and everybody follows it
  function viewRetoNet() {
    const R0 = S.reto, r = X[R0.id], def = r.sala, t = S.teams[R0.team], deck = D.reto, mine = myTeam();
    const inTeam = !!mine && mine.i === t.i, word = def.kind === "pistas";
    if (!me.rx || me.rx.n !== R0.n) me.rx = { n: R0.n, v: Retos.blank(def), done: false, go: false, g: "" };
    const text = inTeam || !word ? Retos.askText(def, R0.extra) : def.others;
    const swap = canDrive() ? `<button class="linkbtn" type="button" data-act="reto-swap">Otra tarjeta</button>` : "";
    let dyn = "", fixed = "";
    if (R0.stage === "ready") {
      dyn = inTeam ? "" : `<p class="askwho">Esperando a que ${esc(t.name)} empiece…</p>`;
      if (inTeam || canDrive()) fixed = `<div class="choices"><button class="btn good" type="button" data-act="rx-go">${inTeam ? "Empezar" : "Empezar ya"}: ${def.secs} segundos</button>${swap}</div>`;
    } else if (R0.stage === "run") {
      dyn = `<div class="timerbox"><div class="count" data-count="reto">${R0.left}</div></div>`
        + (word && !inTeam ? `<div class="rx-clue"><small>Pistas de ${esc(t.name)}</small><p>${esc(R0.clue) || "…"}</p></div>` : !inTeam ? `<p class="askwho">${esc(t.name)} está con el reto.</p>` : "");
      if (inTeam) fixed = `<div id="rxWidget">${Retos.widget(def, me.rx.v)}</div>` + (word ? `<p class="help">Lo que escribís lo ven los demás al momento.</p>` : def.kind === "yemas" ? "" : `<button class="btn good rx-send" type="button" data-act="rx-send">Enviar</button>`);
      else if (word && mine) fixed = `<div class="rx-guessbox"><input id="rxGuess" class="rx-num wide" type="text" maxlength="30" placeholder="Escribid la palabra" autocomplete="off" aria-label="La palabra"><button class="btn good" type="button" data-act="rx-guess">Probar</button></div><p class="rx-warn" id="rxMiss" hidden>No es esa. Probad otra.</p>`;
    } else if (R0.stage === "review") {
      dyn = `<div class="rx-sub">${Retos.show(def, R0.sub, R0.extra, false)}</div>` + (canDrive() ? "" : `<p class="askwho">${esc(hostLabel())} decide si vale.</p>`);
      if (canDrive()) {
        const sol = (def.sol || r.sol);
        fixed = `<div class="sol plain"><b>Para decidir:</b> ${esc(sol[0].toUpperCase() + sol.slice(1))}</div>
          <div class="choices"><div class="row"><button class="btn good" type="button" data-act="reto-pass">¡Superado! Avanza ${r.adv}</button><button class="btn bad" type="button" data-act="reto-fail">No superado</button></div></div>`;
      }
    } else {
      dyn = word
        ? (R0.guess ? `<p class="rx-result ok">✓ ${esc(R0.guess.name)}, de ${esc(S.teams[R0.guess.team].name)}, ha adivinado la palabra: ${esc(def.word)}.</p>` : `<p class="rx-result ko">✗ Nadie ha adivinado la palabra: ${esc(def.word)}.</p>`)
        : `<div class="rx-sub">${Retos.show(def, R0.sub, R0.extra, true)}</div><p class="rx-result ${R0.ok ? "ok" : "ko"}">${R0.ok ? "✓ ¡Reto superado!" : "✗ Reto no superado"}</p>`;
    }
    const html = `<article class="card reto" style="--c:${hex(deck.color)};--t:${hex(deck.tint)};--ink2:${hex(C.navy)}">
      <header><span class="ic">${icon(deck.icon)}</span><span class="cat">RETO</span><span class="code">${esc(r.id)}</span></header>
      <div class="forteam">${disc(t, "sm")}<span>Reto para <b>${esc(t.name)}</b></span></div>
      <h3 class="rt">${esc(r.title)}</h3><p class="q">${esc(text)}</p>
      <footer><span></span><span class="pill">SI LO CONSEGUÍS, AVANZAD ${r.adv}</span></footer></article>
      <div id="rxDyn">${dyn}</div>${fixed}`;
    const mount = () => {
      const cv = $("#rxCanvas");
      if (cv) drawing = Retos.mountDraw(cv, me.rx.v, () => pushInputs());
    };
    return { html, actions: "", key: `rx:${R0.n}:${R0.stage}:${inTeam ? "t" : "o"}:${canDrive() ? "h" : "c"}`, dyn, mount };
  }
  function viewReto() { return S.reto.net ? viewRetoNet() : viewRetoRef(); }

  function logHtml() {
    if (!S.log.length) return "";
    return `<h2>${S.tie ? "Desempate" : "Lo que ha pasado"}</h2><ul class="log">${S.log.map((e) => `<li>${e.team != null ? disc(S.teams[e.team], "sm") : icon(e.icon)}<span>${esc(e.text)}</span></li>`).join("")}</ul>`;
  }
  function standingsHtml(title = "Así va la cosecha") {
    const sorted = S.teams.slice().sort((a, b) => b.pos - a.pos || a.i - b.i);
    return `<h2>${title}</h2><ol class="standings">${sorted.map((t) => {
      const who = t.members && t.members.length > 1 ? `<small>${esc(joinList(t.members.map((m) => m.name)))}</small>` : "";
      return `<li style="--tc:${hex(t.color)}">${disc(t, "sm")}<span class="nm">${esc(t.name)}${who}</span><span class="where">${where(t)}</span><span class="track"><i style="width:${(Math.min(t.pos, N) / N * 100).toFixed(1)}%"></i></span></li>`;
    }).join("")}</ol>`;
  }

  function viewBetween() {
    const best = Math.max(...S.teams.map((t) => t.pos)), lead = S.teams.filter((t) => t.pos === best);
    const label = S.tie ? "Pregunta de desempate" : "Siguiente ronda";
    const note = S.tie || best === 0 ? "" : `<p class="note">${lead.length === 1 ? "Va" : "Van"} en cabeza ${esc(joinNames(lead))}, ${where(lead[0])}</p>`;
    const actions = canDrive() ? `${note}<button class="primary" type="button" data-act="next">${label}</button>` : `<p class="note">Esperando a que ${esc(hostLabel())} siga…</p>`;
    return { html: logHtml() + standingsHtml(), actions };
  }

  function viewEnd() {
    const t = S.teams[S.winner];
    const why = {
      meta: `${t.name} ha dado la vuelta al año y ha llegado antes que nadie a la meta.`,
      tiempo: `Se acabó el tiempo y ${t.name} es quien más lejos ha llegado.`,
      desempate: `${t.name} ha ganado el desempate.`,
    }[S.reason];
    const names = t.members && t.members.length > 1 ? joinList(t.members.map((m) => m.name)) : t.name;
    const diploma = t.pos >= N ? `<div class="diploma"><div class="d1">DIPLOMA</div><div class="d2">DE LA BUENA COSECHA</div><div class="d3">Se concede a</div><div class="d4">${esc(names)}</div>
      <div class="d5">por dar la vuelta al año de un frutal: pasar el invierno en reposo, florecer a tiempo y llegar a la cosecha con toda la fruta.</div></div>` : "";
    const mins = Math.max(1, Math.round(S.secs / 60));
    const html = `<div class="win" style="--tc:${hex(t.color)};--ti:${hex(t.ink)}"><div class="cup">${icon("GiFruitBowl")}</div>
      <h2>¡${esc(t.name)} recoge la cosecha!</h2><p class="why">${esc(why)}</p>${diploma}
      ${standingsHtml("Clasificación")}<p class="stats">${S.round} ${S.round === 1 ? "ronda" : "rondas"} · ${mins} ${mins === 1 ? "minuto" : "minutos"}</p>
      <a class="kit" href="${KIT_URL}">Descarga el juego para imprimirlo y jugar con tablero y tarjetas</a></div>`;
    return { html, actions: `<button class="primary" type="button" data-act="again">${ROLE === "client" ? "Volver al inicio" : "Jugar otra vez"}</button>` };
  }

  // Room, before the game: the code to join and the six tokens. Picking a token somebody
  // already has makes a team: its answer will be the one most of its members vote.
  function tokenGrid(pickable) {
    const mine = myTeam();
    return `<div class="tokgrid">${S.teams.map((t) => {
      const names = t.members.map((m) => `<span class="${m.on ? "" : "off"}">${esc(m.name)}</span>`).join(", ");
      const inner = `${disc(t)}<span class="tk"><b>${esc(t.key)}</b><small>${names || "libre"}</small></span>`;
      const cls = `tokbtn${mine && mine.i === t.i ? " mine" : ""}${t.members.length ? " taken" : ""}`;
      return pickable ? `<button type="button" class="${cls}" data-act="pick" data-slot="${t.slot}" style="--tc:${hex(t.color)};--ti:${hex(t.ink)}">${inner}</button>`
        : `<div class="${cls}" style="--tc:${hex(t.color)};--ti:${hex(t.ink)}">${inner}</div>`;
    }).join("")}</div>`;
  }
  function qrHtml(url) {
    if (!window.qrcode) return "";
    try { const qr = window.qrcode(0, "M"); qr.addData(url); qr.make(); return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { return ""; }
  }
  function viewLobby() {
    const mine = myTeam(), taken = S.teams.filter((t) => t.members.length).length;
    const waiting = S.waiting && S.waiting.length ? `<p class="help">Han entrado y aún no han elegido ficha: ${esc(joinList(S.waiting))}.</p>` : "";
    const team = `<p class="help">Si dos personas eligen la misma ficha, juegan en equipo: cuenta la respuesta más votada.</p>`;
    if (ROLE === "host") {
      const url = joinUrl(S.code);
      const html = `<div class="lobby"><p class="lead">Decid a los demás que entren en la web del juego y escriban este código:</p>
        <div class="roomcode" aria-label="Código de la sala">${esc(S.code)}</div>
        <div class="joinrow"><div class="qr">${qrHtml(url)}</div><div><p>También pueden escanear este QR o abrir el enlace.</p><button class="btn" type="button" data-act="copy-link">Copiar el enlace</button></div></div>
        <h2>${S.hostPlays ? "Elegid ficha" : "Fichas"}</h2>${tokenGrid(S.hostPlays)}${team}${waiting}</div>`;
      const note = taken < 2 ? `<p class="note">Hacen falta al menos 2 fichas con jugadores</p>` : `<p class="note">${taken} fichas listas</p>`;
      return { html, actions: `${note}<button class="primary" type="button" data-act="start-room"${taken < 2 ? " disabled" : ""}>Empezar la partida</button>` };
    }
    const html = `<div class="lobby"><p class="lead">Hola, <b>${esc(me.name)}</b>. Estás en la sala <b>${esc(S.code)}</b>. Elige tu ficha.</p>${tokenGrid(true)}${team}${waiting}</div>`;
    return { html, actions: `<p class="note">${mine ? `Esperando a que ${esc(hostLabel())} empiece la partida…` : "Toca una ficha para elegirla"}</p>` };
  }
  // Somebody who joins once the game has started picks one of the tokens in play, or just watches
  function viewPick() {
    const html = `<div class="lobby"><p class="lead">Hola, <b>${esc(me.name)}</b>. La partida ya ha empezado: únete a una ficha o quédate mirando.</p>${tokenGrid(true)}
      <button class="linkbtn" type="button" data-act="watch">Solo quiero mirar</button></div>`;
    return { html, actions: "" };
  }

  // § 15 — Toasts and the falling fruit that celebrates the winner
  // A new toast replaces the one on screen; the replaced one still resolves, so a move waiting on it never stalls
  let toastTimer = null, toastDone = null;
  function showToast(o) {
    const el = $("#toast");
    el.style.setProperty("--tc", hex(o.color));
    el.innerHTML = `${icon(o.icon)}<div><b>${esc(o.title)}</b><span>${esc(o.text)}</span></div>`;
    el.classList.add("show");
    clearTimeout(toastTimer);
    if (toastDone) toastDone();
    return new Promise((res) => {
      toastDone = res;
      toastTimer = setTimeout(() => { el.classList.remove("show"); toastDone = null; res(); }, o.ms || 1800);
    });
  }
  // A toast of the game itself: in a room it travels to every device
  function toast(iconName, color, title, text, ms = 1800) {
    const o = { icon: iconName, color, title, text, ms: pace(ms) };
    if (S && ROLE === "host") { S.toast = Object.assign({ n: ((S.toast && S.toast.n) || 0) + 1 }, o); publish(); }
    return showToast(o);
  }
  function rain(team) {
    if (REDUCED) return;
    const box = document.createElement("div");
    box.className = "rain";
    const names = ["GiPeach", "GiFlowers", "GiOakLeaf", team.icon, "GiBee"], cols = [C.fruit, C.spring, C.summer, team.color, C.reto];
    for (let i = 0; i < 36; i++) {
      const k = i % names.length, el = document.createElement("div");
      el.innerHTML = icon(names[k]);
      const s = el.firstChild;
      s.style.cssText = `left:${Math.random() * 100}vw;font-size:${18 + Math.random() * 22}px;color:${hex(cols[k])};animation-duration:${2.6 + Math.random() * 2.4}s;animation-delay:${Math.random() * 1.2}s;--rot:${Math.round(Math.random() * 720 - 360)}deg`;
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 6500);
  }

  // § 16 — Screens and views. Narrow screens show either the card or the board (tabs), and the
  // game switches between them by itself: card to answer, board while the tokens move.
  function setView(v) {
    const game = $("#game");
    game.dataset.view = v;
    document.querySelectorAll(".tabs [data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
    if (v === "board") drawBoard();
  }
  function showGame() {
    $("#setup").hidden = true;
    $("#game").hidden = false;
    panel().dataset.key = "";
    G = null;
    drawBoard();
  }
  function showSetup() {
    S = null;
    resetAnim();
    for (const m of ["mundo", "basico"]) if (VIEW3D[m].v) VIEW3D[m].v.setTokens([], 0);
    $("#game").hidden = true;
    $("#setup").hidden = false;
    renderSetup();
    window.scrollTo(0, 0);
  }

  // § 17 — Setup screen: how the game is played (together or at a distance, one device or a
  // room), the teams or the room options, the clock, and the box to join somebody else's room
  const setup = Object.assign({ count: 4, names: D.teams.map((t) => t.name), minutes: 15, place: "juntos", devices: "uno", qsecs: 45, hostName: "", hostPlays: true }, store.get(SETUP_KEY) || {});
  if (!NET) setup.devices = "uno";
  const press = (sel, attr, value) => document.querySelectorAll(sel).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[attr] === String(value))));
  function renderSetup() {
    const roomMode = setup.devices === "sala";
    $("#segTeams").innerHTML = [2, 3, 4, 5, 6].map((n) => `<button type="button" data-n="${n}" aria-pressed="${n === setup.count}">${n}</button>`).join("");
    $("#teamList").innerHTML = D.teams.slice(0, setup.count).map((t, i) => `<label class="teamrow">${disc(t)}<input type="text" maxlength="16" data-i="${i}" value="${esc(setup.names[i] || t.name)}" aria-label="Nombre del equipo ${i + 1}"></label>`).join("");
    press("#segClock button", "min", setup.minutes);
    press("#segPlace button", "place", setup.place);
    press("#segDevices button", "devices", setup.devices);
    press("#segQsecs button", "secs", setup.qsecs);
    $("#devicesWrap").hidden = !NET;
    $("#joinBox").hidden = !NET;
    $("#blockTeams").hidden = roomMode;
    $("#blockRoom").hidden = !roomMode;
    $("#blockPeople").hidden = roomMode;
    $("#hostPlays").checked = !!setup.hostPlays;
    if (!$("#hostName").value) $("#hostName").value = setup.hostName || "";
    $("#goBtn").textContent = roomMode ? "Crear la sala" : "¡A jugar!";
    $("#placeHelp").textContent = setup.place === "juntos" ? "Los retos se hacen en persona, como en el juego de mesa." : roomMode ? "Los retos se hacen en la pantalla de cada uno." : "Para jugar por videollamada compartiendo esta pantalla: los retos se adaptan a la cámara.";
    const saved = store.get(STORE_KEY), seat = store.get(SEAT_KEY), resume = $("#resume");
    const hostable = saved && saved.v === 2 && saved.teams && saved.phase !== "end" && (!saved.code || NET);
    if (hostable) {
      resume.hidden = false;
      resume.innerHTML = `<p>${saved.code ? `Tenéis una sala abierta (${esc(saved.code)})` : "Tenéis una partida a medias"}${saved.round ? `: ${saved.teams.length} fichas, ronda ${saved.round}` : ""}.</p><div class="seg"><button type="button" class="btn good" data-act="resume">Seguir la partida</button><button type="button" class="btn" data-act="discard">Empezar otra</button></div>`;
    } else if (seat && !seat.host && NET) {
      resume.hidden = false;
      resume.innerHTML = `<p>Estabas en la sala ${esc(seat.code)} como ${esc(seat.name)}.</p><div class="seg"><button type="button" class="btn good" data-act="rejoin">Volver a la sala</button><button type="button" class="btn" data-act="forget">Olvidarla</button></div>`;
    } else resume.hidden = true;
  }
  function readSetup() {
    document.querySelectorAll("#teamList input").forEach((inp) => { setup.names[+inp.dataset.i] = inp.value; });
    setup.hostName = cleanName($("#hostName").value);
    setup.hostPlays = $("#hostPlays").checked;
  }
  function startFromSetup() {
    readSetup();
    store.set(SETUP_KEY, setup);
    const mode = { place: setup.place, qsecs: setup.qsecs };
    store.drop(STORE_KEY);
    if (setup.devices === "sala" && NET) {
      if (!setup.hostName) { $("#hostName").focus(); return showToast({ icon: "GiCardRandom", color: C.navy, title: "Falta tu nombre", text: "Escribe cómo te llamas para crear la sala.", ms: 2400 }); }
      return createRoom({ mode, minutes: setup.minutes, hostName: setup.hostName, hostPlays: setup.hostPlays });
    }
    const raw = parseInt($("#people").value, 10);
    const people = raw >= 1 && raw <= 200 ? raw : null;
    const teams = D.teams.slice(0, setup.count).map((t, i) => ({ key: t.name, name: (setup.names[i] || "").trim().toUpperCase() || t.name, color: t.color, ink: t.ink, icon: t.icon }));
    newGame({ mode, teams, minutes: setup.minutes, people });
  }
  function resumeGame() {
    const saved = store.get(STORE_KEY);
    if (!saved || saved.v !== 2) return renderSetup();
    resetAnim();
    S = saved;
    if (S.phase === "solution" && !S.code) S.phase = "question";
    if (S.code) {
      const seat = store.get(SEAT_KEY) || {};
      ROLE = "host";
      me.id = seat.id || Sala.newId(); me.name = S.hostName; me.k = S.hostSlot; me.vote = null; me.rx = null;
      openHost(S.code);
      if (!window.qrcode) { const s = document.createElement("script"); s.src = "vendor/qrcode.js"; s.onload = () => { if (S && S.phase === "lobby") render(); }; document.head.appendChild(s); }
    } else ROLE = "local";
    showGame();
    setView(["question", "solution", "lobby"].includes(S.phase) ? "card" : "board");
    render();
  }
  function joinMsg(text) { const el = $("#joinMsg"); el.textContent = text; el.hidden = !text; }
  function joinFromSetup() {
    const code = Sala.cleanCode($("#joinCode").value), name = cleanName($("#joinName").value);
    if (!Sala.validCode(code)) return joinMsg("El código tiene 5 letras o números.");
    if (!name) { $("#joinName").focus(); return joinMsg("Escribe tu nombre."); }
    joinRoom(code, name);
  }

  // § 18 — One click handler for the whole page (buttons carry a data-act name)
  document.addEventListener("click", (e) => {
    const rx = e.target.closest("[data-rx]");
    if (rx) return tapWidget(rx);
    const b = e.target.closest("[data-act]");
    if (b) return act(b.dataset.act, b, e);
    const stone = e.target.closest(".stone[data-stone]");
    if (stone) explainStone(+stone.dataset.stone);
  });
  // Text typed into a challenge box: sent a moment after the last key, not on every key
  document.addEventListener("input", (e) => {
    const el = e.target.closest("[data-rxi]");
    if (!el || !me.rx || !S || !S.reto) return;
    me.rx.v = el.value;
    clearTimeout(rxTimer);
    rxTimer = setTimeout(pushInputs, 350);
  });
  function tapWidget(el) {
    const R0 = S && S.reto;
    if (!R0 || !R0.net || R0.stage !== "run" || !me.rx) return;
    const def = X[R0.id].sala;
    if (el.dataset.rx === "clear") { if (drawing) drawing.clear(); return; }
    me.rx.v = Retos.click(def, me.rx.v, el);
    if (def.kind === "yemas") me.rx.done = true; // one tap is the answer
    const w = $("#rxWidget");
    if (w) w.innerHTML = Retos.widget(def, me.rx.v);
    pushInputs();
  }
  function act(name, b) {
    switch (name) {
      case "answer":
        if (S.phase !== "question") return;
        S.answers[b.dataset.team] = b.dataset.l;
        save(); render();
        return;
      case "vote":
        if (S.phase !== "question" || !myTeam()) return;
        me.vote = b.dataset.l;
        if (ROLE === "host") { S.votes[me.id] = { l: me.vote, s: ++voteSeq }; tally(); render(); } else { pushInputs(); render(); }
        return;
      case "reveal": S.phase = "solution"; save(); render(); panel().scrollTop = 0; return;
      case "subnext": S.qi++; S.phase = "question"; save(); render(); panel().scrollTop = 0; return;
      case "close-q": closeQuestion(); return;
      case "resolve": if (canDrive() && S.phase === "solution") resolveRound(); return;
      case "next": if (canDrive() && S.phase === "between") { startRound(); panel().scrollTop = 0; } return;
      case "reto-peek": S.reto.stage = "peek"; render(); return;
      case "reto-hide": S.reto.stage = "play"; render(); return;
      case "reto-timer": S.reto.left = retoSeconds(retoText(S.reto)); S.reto.run = true; render(); return;
      case "reto-pass": if (canDrive()) finishReto(true); return;
      case "reto-fail": if (canDrive()) finishReto(false); return;
      case "reto-guess": if (canDrive()) finishReto(true, +b.dataset.team); return;
      case "reto-swap":
        if (!canDrive()) return;
        S.reto = newReto(S.reto.team, drawReto());
        render();
        return;
      case "rx-go":
        if (ROLE === "host") return retoStart();
        me.rx.go = true; pushInputs();
        return;
      case "rx-send": me.rx.done = true; b.disabled = true; b.textContent = "Enviado"; pushInputs(); return;
      case "rx-guess": {
        const inp = $("#rxGuess"), def = X[S.reto.id].sala;
        me.rx.g = inp.value; pushInputs();
        if (!Retos.guessOk(def, inp.value)) { $("#rxMiss").hidden = false; inp.select(); }
        return;
      }
      case "pick": {
        const slot = +b.dataset.slot;
        me.k = slot; me.watch = false;
        if (ROLE === "host") { S.hostSlot = slot; reconcile(); } else if (room) room.send({ k: slot });
        return;
      }
      case "watch": me.watch = true; render(); return;
      case "start-room": startRoomGame(); return;
      case "copy-link":
        if (navigator.clipboard) navigator.clipboard.writeText(joinUrl(S.code)).then(() => showToast({ icon: "GiCardRandom", color: C.good, title: "Enlace copiado", text: "Pégalo en un mensaje para los demás.", ms: 2200 }), () => {});
        return;
      case "speed":
        prefs.speed = SPEEDS[(SPEEDS.indexOf(prefs.speed) + 1) % SPEEDS.length];
        store.set(PREFS_KEY, prefs);
        b.textContent = SPEED_LABEL[prefs.speed];
        showToast({ icon: "GiHourglass", color: C.navy, title: `Velocidad ${SPEED_LABEL[prefs.speed]}`, text: `Fichas: ${SPEED_NAME[prefs.speed]}.`, ms: 1500 });
        return;
      case "board":
        prefs.board = b.dataset.board;
        store.set(PREFS_KEY, prefs);
        drawBoard();
        return;
      case "cam-view":
        { const V = live3d(); if (V && V.setView) { V.setView(V.getView() === "whole" ? "path" : "whole"); drawBoard(); } }
        return;
      case "view": setView(b.dataset.view); return;
      case "clock":
        if (S && S.clock && !S.clock.expired && canDrive()) { S.clock.paused = !S.clock.paused; drawClock(); save(); publish(); }
        return;
      case "rules": $("#rulesDlg").showModal(); return;
      case "quit":
        $("#quitText").textContent = ROLE === "host" ? "La sala se cierra para todos y volvéis a la pantalla de inicio." : ROLE === "client" ? "Sales de la sala. La partida sigue para los demás." : "La partida se pierde y volvéis a la pantalla de inicio.";
        $("#quitDlg").showModal();
        return;
      case "quit-yes":
      case "again":
        if ($("#quitDlg").open) $("#quitDlg").close();
        leaveRoom();
        store.drop(STORE_KEY);
        showSetup();
        return;
      case "close": b.closest("dialog").close(); return;
      case "resume": resumeGame(); return;
      case "discard": { const s = store.get(STORE_KEY); if (s && s.code && NET) Sala.host(NET, s.code, { onClients() {} }).close(true); store.drop(STORE_KEY); store.drop(SEAT_KEY); renderSetup(); return; }
      case "rejoin": { const seat = store.get(SEAT_KEY); if (seat) joinRoom(seat.code, seat.name, seat.id); return; }
      case "forget": store.drop(SEAT_KEY); renderSetup(); return;
      case "join": joinFromSetup(); return;
    }
  }
  function explainStone(k) {
    const ev = D.board.events[k];
    if (ev) {
      const [title, detail] = ev.text.split(": ");
      showToast({ icon: ev.icon, color: ev.delta > 0 ? C.good : C.bad, title, text: `${detail[0].toUpperCase() + detail.slice(1)}: ${ev.delta > 0 ? "avanza" : "retrocede"} ${Math.abs(ev.delta)}.`, ms: 2400 });
    } else if (D.board.retos.includes(k)) showToast({ icon: "GiStarMedal", color: C.reto, title: "Reto", text: `Quien cae aquí hace una prueba. Si la supera, avanza ${D.board.retoReward}.`, ms: 2400 });
  }

  const seg = (id, attr, apply) => document.getElementById(id).addEventListener("click", (e) => {
    const b = e.target.closest(`[data-${attr}]`);
    if (!b) return;
    readSetup(); apply(b.dataset[attr]); renderSetup();
  });
  seg("segTeams", "n", (v) => { setup.count = +v; });
  seg("segClock", "min", (v) => { setup.minutes = +v; });
  seg("segPlace", "place", (v) => { setup.place = v; });
  seg("segDevices", "devices", (v) => { setup.devices = v; });
  seg("segQsecs", "secs", (v) => { setup.qsecs = +v; });
  document.querySelector(".stepper").addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]");
    if (!b) return;
    const inp = $("#people"), v = parseInt(inp.value, 10) || 0;
    inp.value = Math.min(200, Math.max(1, v + +b.dataset.step));
  });
  document.getElementById("setupForm").addEventListener("submit", (e) => { e.preventDefault(); startFromSetup(); });
  document.getElementById("joinForm").addEventListener("submit", (e) => { e.preventDefault(); joinFromSetup(); });
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

  let resizeTimer = null;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (S) drawBoard(); }, 150); });

  // § 19 — Start: the key to the special stones in the rules, the counter, then the setup screen.
  // A link with ?sala=CODE opens the box to join that room.
  // Each line shows the stone as the board draws it, so the key follows any change of shape
  const mini = (inner) => `<svg class="mini" viewBox="-19 -19 39 39" aria-hidden="true">${inner}</svg>`;
  const retoMini = `<circle r="14.5" fill="${hex(C.reto)}" stroke="#FFFFFF" stroke-width="1.6"/>` + svgIcon("GiStarMedal", 0, -2.4, 13.5, C.navy);
  $("#legend").innerHTML = [
    `<li>${mini(retoMini)}<span><b>Reto</b> (casilla amarilla con medalla): quien cae hace una prueba en el momento.</span><span class="d" style="background:#B8860B">+${D.board.retoReward}</span></li>`,
    ...Object.entries(D.board.events).map(([k, ev]) => `<li>${mini(ev.svg)}<span><b>Casilla ${k}</b>, ${stoneName(ev.delta > 0)}: ${esc(ev.text)}.</span><span class="d" style="background:${hex(ev.delta > 0 ? C.good : C.bad)}">${ev.delta > 0 ? "+" : "−"}${Math.abs(ev.delta)}</span></li>`),
  ].join("");
  counter.init();
  showSetup();
  const asked = Sala.cleanCode((location.search.match(/[?&]sala=([^&]+)/) || [])[1]);
  if (NET && asked) {
    $("#joinCode").value = asked;
    $("#joinBox").scrollIntoView();
    $("#joinName").focus();
  }
})();
