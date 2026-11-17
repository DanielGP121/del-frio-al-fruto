// Browser version of the quiz board game about the year of a fruit tree (name in datos.js).
// One device plays the referee for 2 to 6 teams with the rules of the printed kit: every team
// answers each question at once, the decks go in a fixed order, right answers move 2, 3 or 4
// stones, special stones and challenges work as on the board, and the first team round the
// year wins. Cards and board layout come from datos.js, generated from the printed kit sources.
(function () {
  "use strict";

  const D = window.GAME_DATA;
  const N = D.board.n;
  const KIT_URL = D.game.repoUrl;
  // Every GitHub Pages site of an account shares one origin, so the saved game is keyed by repository
  const STORE_KEY = `${D.game.slug}/partida`;
  const SETUP_KEY = `${D.game.slug}/equipos`;
  const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const STEP_MS = REDUCED ? 70 : 240;
  const Q = Object.fromEntries(D.questions.map((q) => [q.id, q]));
  const X = Object.fromEntries(D.retos.map((r) => [r.id, r]));
  const DECK = Object.fromEntries(D.decks.map((d) => [d.key, d]));
  const DECK_WORD = { L: "azul", F: "rosa", H: "verde", R: "naranja" };

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
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ } },
    drop(key) { try { localStorage.removeItem(key); } catch (e) { /* storage unavailable */ } },
  };
  const disc = (t, size = "") => `<span class="disc ${size}" style="--tc:${hex(t.color)};--ti:${hex(t.ink)}">${icon(t.icon)}</span>`;
  const seasonOf = (k) => D.board.zones[Math.floor((k % N) / 8)].key;
  const where = (t) => (t.pos >= N ? "¡en la meta!" : t.pos === 0 ? "en la salida" : `casilla ${t.pos}`);
  const joinNames = (teams) => { const n = teams.map((t) => t.name); return n.length < 2 ? n.join("") : n.slice(0, -1).join(", ") + " y " + n[n.length - 1]; };

  // § 2 — Game counter. Each game counts as one outreach activity: GoatCounter records an event
  // when a game starts (with the number of teams and, if given, of players) and when it ends.
  // No cookies and no personal data; without a site code in index.html nothing leaves the browser.
  const counter = {
    code: (window.COUNTER_CODE || "").trim(),
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

  // § 3 — Short sounds for the end of the clock and of a challenge countdown (Web Audio, no files)
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

  // § 4 — Board geometry, ported from the printed board (build_board.js): 32 stones evenly spaced
  // clockwise along a rounded rectangle, from the start at the top centre. The board turns to
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

  // § 5 — Board drawing (SVG). Same visual language as the print: season quadrants with faint
  // motifs, numbered stones in the season colour, green stars for luck, red octagons for bad
  // luck, yellow challenge stones and the painted tree in the middle.
  const f1 = (n) => Number(n).toFixed(2);
  const FONT_B = "Arial Black, Segoe UI Black, Helvetica Neue, Arial, sans-serif";
  const FONT = "Segoe UI, system-ui, -apple-system, Roboto, Arial, sans-serif";
  const C = D.colors;
  function T(x, y, s, o = {}) {
    return `<text x="${f1(x)}" y="${f1(y)}" font-family="${o.black ? FONT_B : FONT}" font-size="${o.size || 5}" font-weight="${o.black ? 900 : (o.weight || 400)}"${o.italic ? ' font-style="italic"' : ""} fill="${o.fill ? hex(o.fill) : hex(C.navy)}" text-anchor="${o.anchor || "start"}" dominant-baseline="central"${o.extra ? " " + o.extra : ""}>${esc(s)}</text>`;
  }
  const svgIcon = (name, cx, cy, size, color, extra = "") => `<svg x="${f1(cx - size / 2)}" y="${f1(cy - size / 2)}" width="${size}" height="${size}" viewBox="0 0 512 512" fill="${hex(color)}" ${extra}>${D.icons[name]}</svg>`;
  // Special stones and their shapes are drawn by the printed board builder and arrive as SVG
  // centred on (0, 0): here they are only moved into place and, for the legends, scaled down
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

    // Painted corner vignettes, each ringed with the colour of its season
    const corner = (slot, season, cx, cy) => `<clipPath id="cl-${slot}"><circle cx="${cx}" cy="${cy}" r="13.6"/></clipPath>
      <circle cx="${cx + 0.6}" cy="${cy + 0.9}" r="15.5" fill="${hex(C.navy)}" fill-opacity="0.25"/><circle cx="${cx}" cy="${cy}" r="15.5" fill="${hex(C[season])}"/>
      <image href="img/esquina_${slot}.jpg" x="${cx - 13.6}" y="${cy - 13.6}" width="27.2" height="27.2" clip-path="url(#cl-${slot})" preserveAspectRatio="xMidYMid slice"/>`;
    out += corner("invierno", "winter", W - 19.5, 19.5) + corner("primavera", "spring", W - 19.5, H - 19.5) + corner("verano", "summer", 19.5, H - 19.5) + corner("fruto", "fruit", 19.5, 19.5);

    out += g.portrait ? innerPortrait(g) : innerLandscape(g);

    // Centre medallion: the painted tree in four seasons, with the EEAD symbol where they meet
    out += `<g transform="translate(${CX} ${CY})"><clipPath id="cl-med"><circle r="53"/></clipPath>
      <circle cx="0.9" cy="1.3" r="57" fill="${hex(C.navy)}" fill-opacity="0.22"/><circle r="57" fill="#FFFFFF"/>
      <g clip-path="url(#cl-med)"><image href="img/centro.jpg" x="-53" y="-53" width="106" height="106" preserveAspectRatio="xMidYMid slice"/>
      <line x1="-60" y1="0" x2="60" y2="0" stroke="#FFFFFF" stroke-width="1.4"/><line x1="0" y1="-60" x2="0" y2="60" stroke="#FFFFFF" stroke-width="1.4"/></g>
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
      [(cx, cy) => glyph(true, cx, cy, size * 0.055), "Con suerte: avanza"],
      [(cx, cy) => glyph(false, cx, cy, size * 0.055), "Mala pata: retrocede"],
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

  // § 6 — Tokens. Teams sharing a stone sit in a small ring so every token stays visible.
  // Moving a token only changes its CSS transform, so each step glides to the next stone.
  let G = null;
  function drawBoard() {
    const svg = $("#board");
    const portrait = window.innerWidth <= 860 && window.innerHeight > window.innerWidth;
    if (G && G.portrait === portrait && svg.childNodes.length) return drawTokens();
    G = geometry(portrait);
    svg.setAttribute("viewBox", `0 0 ${G.W} ${G.H}`);
    svg.innerHTML = boardSvg(G);
    drawTokens();
  }
  function drawTokens() {
    const layer = $("#tokens");
    if (!layer || !S) return;
    const groups = {};
    S.teams.forEach((t) => { const k = Math.min(t.pos, N) % N; (groups[k] = groups[k] || []).push(t); });
    const active = S.phase === "reto" && S.reto ? S.reto.team : -1;
    for (const [k, list] of Object.entries(groups)) {
      const c = list.length, ring = c === 1 ? 0 : c <= 3 ? 7 : 9.5, tr = c >= 4 ? 6 : 7.2;
      list.forEach((t, i) => {
        const a = -Math.PI / 2 + 2 * Math.PI * i / c, [sx, sy] = G.stones[k];
        const x = sx + ring * Math.cos(a), y = sy + ring * Math.sin(a);
        let el = layer.querySelector(`[data-team="${t.i}"]`);
        if (!el) {
          el = document.createElementNS("http://www.w3.org/2000/svg", "g");
          el.setAttribute("class", "token");
          el.dataset.team = t.i;
          layer.appendChild(el);
        }
        if (el.dataset.r !== String(tr) || el.dataset.active !== String(t.i === active)) {
          el.dataset.r = tr; el.dataset.active = t.i === active;
          el.innerHTML = (t.i === active ? `<circle class="ring" r="${tr + 3.2}" fill="none" stroke="${hex(C.reto)}" stroke-width="2.2"/>` : "")
            + `<circle cx="0.5" cy="0.8" r="${tr}" fill="#000" fill-opacity="0.25"/><circle r="${tr}" fill="${hex(t.color)}" stroke="#FFFFFF" stroke-width="1.4"/>`
            + svgIcon(t.icon, 0, 0, tr * 1.35, t.ink);
        }
        el.style.transform = `translate(${f1(x)}px, ${f1(y)}px)`;
      });
    }
  }

  // § 7 — Game state. A game is a plain object so it can be saved after every question and resumed
  let S = null;
  let resolver = null; // pending challenge outcome while the referee decides
  const activeTeams = () => (S.tie ? S.tie.map((i) => S.teams[i]) : S.teams);

  function newGame(cfg) {
    const ids = (k) => D.questions.filter((q) => q.id[0] === k).map((q) => q.id);
    S = {
      v: 1, phase: "between", turn: 0, card: null, answers: {}, tie: null, log: [], winner: null, reason: null,
      teams: cfg.teams.map((t, i) => ({ ...t, i, pos: 0 })),
      decks: { L: shuffle(ids("L")), F: shuffle(ids("F")), H: shuffle(ids("H")), R: shuffle(ids("R")), X: shuffle(D.retos.map((r) => r.id)) },
      clock: cfg.minutes ? { left: cfg.minutes * 60, paused: false, expired: false } : null,
      people: cfg.people || null, secs: 0, counted: false,
    };
    counter.event("partida-empezada", "Partida empezada");
    counter.event(`equipos-${S.teams.length}`, `Partida con ${S.teams.length} equipos`);
    if (S.people) counter.event(`personas-${S.people}`, `Partida con ${S.people} personas`);
    showGame();
    askQuestion();
  }
  function save() {
    if (S && ["question", "solution", "between"].includes(S.phase)) store.set(STORE_KEY, S);
  }

  // § 8 — Round flow: draw a card from the next deck, mark every team's paddle, reveal the
  // answer, move the teams that got it right and resolve what they land on.
  function askQuestion() {
    const deck = D.decks[S.turn % D.decks.length];
    S.turn++;
    if (!S.decks[deck.key].length) S.decks[deck.key] = shuffle(D.questions.filter((q) => q.id[0] === deck.key).map((q) => q.id));
    S.card = S.decks[deck.key].shift();
    S.answers = {}; S.log = []; S.phase = "question";
    save(); setView("card"); render();
  }

  // Every await below re-checks that the same game is still running: leaving or restarting while
  // tokens move must stop the old sequence instead of letting it act on the new game.
  async function resolveQuestion() {
    const g = S, q = Q[S.card], playing = activeTeams();
    const right = playing.filter((t) => S.answers[t.i] === q.ans);
    if (S.tie) return resolveTie(right);
    S.phase = "moving"; S.retoQueue = []; S.log = [];
    if (!right.length) logPush({ icon: "GiCardRandom", text: "Nadie ha acertado esta vez." });
    right.forEach((t) => logPush({ team: t, text: `${t.name} acierta y avanza ${q.dif}.` }));
    if (right.length) {
      setView("board");
      await sleep(250);
      for (let s = 0; s < q.dif; s++) {
        if (S !== g) return;
        right.forEach((t) => { if (t.pos < N) t.pos++; });
        drawTokens();
        await sleep(STEP_MS);
      }
      for (const t of right) { if (S !== g) return; await land(t); }
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
    const g = S, dir = Math.sign(delta);
    for (let s = 0; s < Math.abs(delta) && !(dir > 0 && t.pos >= N); s++) {
      if (S !== g) return;
      t.pos = Math.max(0, t.pos + dir);
      drawTokens();
      await sleep(STEP_MS);
    }
  }

  // What a token finds where it stops. The board layout guarantees that a bonus, a penalty or a
  // challenge reward never ends on another special stone, so effects never chain.
  async function land(t) {
    const g = S;
    if (t.pos >= N) { logPush({ icon: "GiFruitBowl", team: t, text: `¡${t.name} llega a la meta!` }); return; }
    const ev = D.board.events[t.pos];
    if (ev) {
      const [title, detail] = ev.text.split(": ");
      const verb = ev.delta > 0 ? `avanza ${ev.delta}` : `retrocede ${-ev.delta}`;
      logPush({ team: t, text: `${t.name} cae en «${title}» y ${verb}.` });
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
      if (out.passed) {
        logPush({ team: t, text: `${t.name} supera el reto «${out.title}» y avanza ${D.board.retoReward}.` });
        await moveBy(t, D.board.retoReward);
        if (S !== g) return;
        await land(t);
      } else {
        logPush({ team: t, text: `${t.name} no supera el reto «${out.title}».` });
      }
      if (out.guesser != null && S === g) {
        const gt = S.teams[out.guesser];
        logPush({ team: gt, text: `${gt.name} adivina la palabra y avanza 1.` });
        await moveBy(gt, 1);
        if (S !== g) return;
        await land(gt);
      }
    }
  }

  // A challenge waits for the referee: the panel shows the card and the promise resolves when
  // someone taps whether the team passed it (or, for the mime, which team guessed the word)
  function playReto(team) {
    const id = drawReto();
    S.phase = "reto";
    S.reto = { team: team.i, id, stage: X[id].secret ? "cover" : "play", timer: null };
    setView("card"); render(); drawTokens();
    return new Promise((res) => { resolver = res; });
  }
  function drawReto() {
    if (!S.decks.X.length) S.decks.X = shuffle(D.retos.map((r) => r.id));
    return S.decks.X.shift();
  }
  function finishReto(passed, guesser = null) {
    stopRetoTimer();
    const title = X[S.reto.id].title, r = resolver;
    S.reto = null; resolver = null; S.phase = "moving";
    render(); drawTokens();
    if (r) r({ passed, guesser, title });
  }

  // After every question: a single team past the finish wins, several go to a tie-break, and a
  // rung clock hands the win to the team furthest along
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
    S.log.push({ icon: "GiTrophyCup", text: why === "meta" ? `${joinNames(teams)} llegan a la meta con la misma pregunta: desempatan con una más, solo para ellos.` : `Se acabó el tiempo y ${joinNames(teams)} van empatados en cabeza: desempatan con una pregunta más.` });
    S.phase = "between";
    save(); render(); setView("card");
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

  // § 9 — Clocks: the 15 or 10 minute game clock, and the short countdown some challenges ask for
  setInterval(() => {
    if (!S || !["question", "solution", "moving", "reto", "between"].includes(S.phase)) return;
    S.secs++;
    const c = S.clock;
    if (!c || c.paused || c.expired || S.tie) return;
    c.left = Math.max(0, c.left - 1);
    if (c.left === 0) {
      c.expired = true;
      beep(4);
      toast("GiHourglass", C.bad, "¡Se acabó el tiempo!", S.phase === "between" ? "Gana quien vaya más lejos." : "Terminad esta pregunta: después gana quien vaya más lejos.", 3200);
      if (S.phase === "between") finishByTime();
    }
    drawClock();
    if (c.left % 15 === 0) save();
  }, 1000);
  function drawClock() {
    const el = $("#clock");
    if (!S || !S.clock || S.phase === "end") { el.hidden = true; return; }
    const c = S.clock, m = Math.floor(c.left / 60), s = String(c.left % 60).padStart(2, "0");
    el.hidden = false;
    el.textContent = c.expired ? "¡Tiempo!" : (c.paused ? "⏸ " : "") + `${m}:${s}`;
    el.classList.toggle("paused", c.paused);
    el.classList.toggle("low", c.expired || c.left <= 60);
  }
  const retoSeconds = (r) => { const m = r.q.match(/(\d+)\s*segundos/); return m ? +m[1] : null; };
  function startRetoTimer() {
    const r = X[S.reto.id], total = retoSeconds(r);
    S.reto.timer = { left: total, id: setInterval(() => {
      const t = S.reto && S.reto.timer;
      if (!t) return;
      t.left--;
      if (t.left <= 0) { clearInterval(t.id); t.id = null; t.left = 0; beep(2); }
      const el = $("#retoCount");
      if (el) { el.textContent = t.left > 0 ? t.left : "¡Tiempo!"; el.classList.toggle("done", t.left <= 0); }
    }, 1000) };
    render();
  }
  function stopRetoTimer() { if (S.reto && S.reto.timer && S.reto.timer.id) clearInterval(S.reto.timer.id); }

  // § 10 — Panel rendering: one function per phase writes the side panel and the action bar
  const panel = () => $("#panel");
  function render() {
    if (!S) return;
    const deck = S.card ? DECK[S.card[0]] : null;
    $("#roundInfo").innerHTML = S.phase === "end" ? "Fin de la partida" : S.tie ? "Desempate" : `Pregunta ${S.turn}` + (deck ? `<span class="deckname"> · mazo ${DECK_WORD[deck.key]}</span>` : "");
    const view = { question: viewQuestion, solution: viewQuestion, moving: viewMoving, reto: viewReto, between: viewBetween, end: viewEnd }[S.phase];
    const [html, actions] = view();
    panel().innerHTML = html;
    $("#actions").innerHTML = actions || "";
    drawClock();
  }

  function cardHtml(q, solved) {
    const deck = DECK[q.id[0]], teams = activeTeams();
    const dots = [1, 2, 3].map((d) => `<i class="${d <= q.dif - 1 ? "on" : ""}"></i>`).join("");
    const opts = ["A", "B", "C"].map((l, i) => {
      const who = teams.filter((t) => S.answers[t.i] === l).map((t) => disc(t, "xs")).join("");
      const cls = solved ? (l === q.ans ? "right" : "wrong") : "";
      const tick = solved && l === q.ans ? ` <span class="tick" aria-label="correcta">✓</span>` : "";
      return `<li class="${cls}"><b>${l}</b><span class="txt">${esc(q.opts[i])}${tick}${who ? `<span class="who">${who}</span>` : ""}</span></li>`;
    }).join("");
    const anyWrong = teams.some((t) => S.answers[t.i] !== q.ans);
    const sol = solved ? `<div class="sol"><details${anyWrong ? " open" : ""}><summary>Solución: ${q.ans}. ${anyWrong ? "Por qué:" : "Ver la explicación"}</summary><p>${esc(q.sol)}</p></details></div>` : "";
    return `<article class="card" style="--c:${hex(deck.color)};--t:${hex(deck.tint)}">
      <header><span class="ic">${icon(deck.icon)}</span><span class="cat">${esc(deck.name)}</span><span class="code">${esc(q.id)}</span></header>
      <p class="q">${esc(q.q)}</p><ol class="opts">${opts}</ol>
      <footer><span class="dots" aria-hidden="true">${dots}</span><span class="pill">AVANZA ${q.dif}</span></footer>${sol}</article>`;
  }

  function viewQuestion() {
    const q = Q[S.card], solved = S.phase === "solution", teams = activeTeams();
    const banner = S.tie ? `<div class="banner">Desempate entre ${esc(joinNames(teams))}</div>` : "";
    const rows = teams.map((t) => {
      const a = S.answers[t.i];
      const right = solved ? (a === q.ans ? `<span class="result ok"><span class="lt">${a}</span>✓ ${S.tie ? "" : "+" + q.dif}</span>` : `<span class="result ko"><span class="lt">${a}</span>✗</span>`)
        : `<div class="paddles" role="group" aria-label="Respuesta de ${esc(t.name)}">${["A", "B", "C"].map((l) => `<button type="button" data-act="answer" data-team="${t.i}" data-l="${l}" aria-pressed="${a === l}">${l}</button>`).join("")}</div>`;
      return `<div class="arow" style="--tc:${hex(t.color)};--ti:${hex(t.ink)}">${disc(t, "sm")}<span class="tn">${esc(t.name)}<small>${where(t)}</small></span>${right}</div>`;
    }).join("");
    const hint = solved ? "" : `<p class="hint">A la de tres, cada equipo levanta su paleta. Marca la letra de cada uno.</p>`;
    let actions;
    if (!solved) {
      const missing = teams.filter((t) => !S.answers[t.i]).length;
      actions = (missing ? `<p class="note">${missing === 1 ? "Falta 1 equipo" : `Faltan ${missing} equipos`} por marcar</p>` : "") + `<button class="primary" type="button" data-act="reveal"${missing ? " disabled" : ""}>Ver solución</button>`;
    } else {
      const any = teams.some((t) => S.answers[t.i] === q.ans);
      actions = `<button class="primary" type="button" data-act="resolve">${S.tie ? "Seguir" : any ? "Mover fichas" : "Seguir"}</button>`;
    }
    return [banner + cardHtml(q, solved) + `<div class="answers">${hint}${rows}</div>`, actions];
  }

  function viewMoving() {
    return [logHtml() + standingsHtml(), `<button class="primary" type="button" disabled>Moviendo fichas…</button>`];
  }

  function viewReto() {
    const R0 = S.reto, r = X[R0.id], t = S.teams[R0.team], deck = D.reto;
    const secs = retoSeconds(r), others = S.teams.filter((o) => o.i !== t.i);
    let body;
    if (R0.stage === "cover") {
      body = `<div class="cover"><p>Esta tarjeta solo la puede ver el equipo <b>${esc(t.name)}</b>. Los demás, mirad hacia otro lado.</p><button class="btn good" type="button" data-act="reto-peek">Somos ${esc(t.name)}: enseñar la tarjeta</button></div>`;
    } else if (R0.stage === "peek") {
      body = `<p class="q">${esc(r.q)}</p><div class="cover"><p>¿Ya la habéis leído? Ocultadla antes de enseñar la pantalla a los demás.</p><button class="btn good" type="button" data-act="reto-hide">Ocultar la tarjeta</button></div>`;
    } else {
      const text = r.secret ? `<p class="q">Tarjeta secreta: solo ${esc(t.name)} sabe qué hay que adivinar.</p>` : `<p class="q">${esc(r.q)}</p>`;
      const tm = R0.timer;
      const timer = !secs ? "" : tm ? `<div class="timerbox"><div class="count${tm.left <= 0 ? " done" : ""}" id="retoCount">${tm.left > 0 ? tm.left : "¡Tiempo!"}</div></div>`
        : `<div class="timerbox"><button class="btn" type="button" data-act="reto-timer" style="width:100%">${icon("GiHourglass")} Empezar la cuenta atrás: ${secs} segundos</button></div>`;
      const sol = r.secret ? "" : `<div class="sol"><details><summary>Solución, solo para quien arbitra</summary><p>${esc(r.sol[0].toUpperCase() + r.sol.slice(1))}</p></details></div>`;
      body = text + timer + sol;
    }
    let choices = "";
    if (R0.stage === "play") {
      choices = r.secret
        ? `<p class="askwho">¿Qué equipo ha adivinado la palabra? Si alguno la adivina, ${esc(t.name)} supera el reto y avanza ${r.adv}, y quien la adivina avanza 1.</p>
           <div class="whobtns">${others.map((o) => `<button class="btn" type="button" data-act="reto-guess" data-team="${o.i}">${disc(o, "sm")}${esc(o.name)}</button>`).join("")}<button class="btn bad" type="button" data-act="reto-fail">Nadie</button></div>`
        : `<div class="choices"><div class="row"><button class="btn good" type="button" data-act="reto-pass">¡Superado! Avanza ${r.adv}</button><button class="btn bad" type="button" data-act="reto-fail">No superado</button></div>
           <button class="linkbtn" type="button" data-act="reto-swap">Nos falta material para este reto: otra tarjeta</button></div>`;
    }
    const html = `<article class="card reto" style="--c:${hex(deck.color)};--t:${hex(deck.tint)};--ink2:${hex(C.navy)}">
      <header><span class="ic">${icon(deck.icon)}</span><span class="cat">RETO</span><span class="code">${esc(r.id)}</span></header>
      <div class="forteam">${disc(t, "sm")}<span>Reto para <b>${esc(t.name)}</b></span></div>
      <h3 class="rt">${esc(r.title)}</h3>${body}
      <footer><span></span><span class="pill">SI LO CONSEGUÍS, AVANZAD ${r.adv}</span></footer></article>${choices}`;
    return [html, ""];
  }

  function logHtml() {
    if (!S.log.length) return "";
    return `<h2>${S.tie ? "Desempate" : "Lo que ha pasado"}</h2><ul class="log">${S.log.map((e) => `<li>${e.team ? disc(e.team, "sm") : icon(e.icon)}<span>${esc(e.text)}</span></li>`).join("")}</ul>`;
  }
  function standingsHtml(title = "Así va la cosecha") {
    const sorted = S.teams.slice().sort((a, b) => b.pos - a.pos || a.i - b.i);
    return `<h2>${title}</h2><ol class="standings">${sorted.map((t) => `<li style="--tc:${hex(t.color)}">${disc(t, "sm")}<span class="nm">${esc(t.name)}</span><span class="where">${where(t)}</span><span class="track"><i style="width:${(Math.min(t.pos, N) / N * 100).toFixed(1)}%"></i></span></li>`).join("")}</ol>`;
  }

  function viewBetween() {
    const next = D.decks[S.turn % D.decks.length];
    const best = Math.max(...S.teams.map((t) => t.pos)), lead = S.teams.filter((t) => t.pos === best);
    const label = S.tie ? "Pregunta de desempate" : "Siguiente pregunta";
    const note = S.tie || best === 0 ? "" : `<p class="note">${lead.length === 1 ? "Va" : "Van"} en cabeza ${esc(joinNames(lead))}, ${where(lead[0])}</p>`;
    return [logHtml() + standingsHtml(), `${note}<button class="primary" type="button" data-act="next" style="--dc:${hex(next.color)}"><span class="dot"></span>${label}</button>`];
  }

  function viewEnd() {
    const t = S.teams[S.winner];
    const why = {
      meta: `${t.name} ha dado la vuelta al año y ha llegado antes que nadie a la meta.`,
      tiempo: `Se acabó el tiempo y ${t.name} es el equipo que más lejos ha llegado.`,
      desempate: `${t.name} ha ganado el desempate.`,
    }[S.reason];
    const diploma = t.pos >= N ? `<div class="diploma"><div class="d1">DIPLOMA</div><div class="d2">DE LA BUENA COSECHA</div><div class="d3">Se concede a</div><div class="d4">${esc(t.name)}</div>
      <div class="d5">por dar la vuelta al año de un frutal: pasar el invierno en reposo, florecer a tiempo y llegar a la cosecha con toda la fruta.</div></div>` : "";
    const mins = Math.max(1, Math.round(S.secs / 60));
    const html = `<div class="win" style="--tc:${hex(t.color)};--ti:${hex(t.ink)}"><div class="cup">${icon("GiFruitBowl")}</div>
      <h2>¡${esc(t.name)} recoge la cosecha!</h2><p class="why">${esc(why)}</p>${diploma}
      ${standingsHtml("Clasificación")}<p class="stats">${S.turn} ${S.turn === 1 ? "pregunta" : "preguntas"} · ${mins} ${mins === 1 ? "minuto" : "minutos"}</p>
      <a class="kit" href="${KIT_URL}">Descarga el juego para imprimirlo y jugar con tablero y tarjetas</a></div>`;
    return [html, `<button class="primary" type="button" data-act="again">Jugar otra vez</button>`];
  }

  // § 11 — Toasts and the falling fruit that celebrates the winner
  // A new toast replaces the one on screen; the replaced one still resolves, so a move waiting on it never stalls
  let toastTimer = null, toastDone = null;
  function toast(iconName, color, title, text, ms = 1800) {
    const el = $("#toast");
    el.style.setProperty("--tc", hex(color));
    el.innerHTML = `${icon(iconName)}<div><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
    el.classList.add("show");
    clearTimeout(toastTimer);
    if (toastDone) toastDone();
    return new Promise((res) => {
      toastDone = res;
      toastTimer = setTimeout(() => { el.classList.remove("show"); toastDone = null; res(); }, ms);
    });
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

  // § 12 — Screens and views. Narrow screens show either the card or the board (tabs), and the
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
    G = null;
    drawBoard();
  }
  function showSetup() {
    S = null;
    $("#game").hidden = true;
    $("#setup").hidden = false;
    renderSetup();
    window.scrollTo(0, 0);
  }

  // § 13 — Setup screen: number of teams and their names, clock, and optional number of players
  const setup = Object.assign({ count: 4, names: D.teams.map((t) => t.name), minutes: 15 }, store.get(SETUP_KEY) || {});
  function renderSetup() {
    $("#segTeams").innerHTML = [2, 3, 4, 5, 6].map((n) => `<button type="button" data-n="${n}" aria-pressed="${n === setup.count}">${n}</button>`).join("");
    $("#teamList").innerHTML = D.teams.slice(0, setup.count).map((t, i) => `<label class="teamrow">${disc(t)}<input type="text" maxlength="16" data-i="${i}" value="${esc(setup.names[i] || t.name)}" aria-label="Nombre del equipo ${i + 1}"></label>`).join("");
    document.querySelectorAll("#segClock button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.min === setup.minutes)));
    const saved = store.get(STORE_KEY), resume = $("#resume");
    if (saved && saved.v === 1 && saved.teams && saved.phase !== "end") {
      resume.hidden = false;
      resume.innerHTML = `<p>Tenéis una partida a medias: ${saved.teams.length} equipos, pregunta ${saved.turn}.</p><div class="seg"><button type="button" class="btn good" data-act="resume">Seguir la partida</button><button type="button" class="btn" data-act="discard">Empezar otra</button></div>`;
    } else resume.hidden = true;
  }
  function readSetup() {
    document.querySelectorAll("#teamList input").forEach((inp) => { setup.names[+inp.dataset.i] = inp.value; });
  }
  function startFromSetup() {
    readSetup();
    store.set(SETUP_KEY, { count: setup.count, names: setup.names, minutes: setup.minutes });
    const raw = parseInt($("#people").value, 10);
    const people = raw >= 1 && raw <= 200 ? raw : null;
    const teams = D.teams.slice(0, setup.count).map((t, i) => ({ key: t.name, name: (setup.names[i] || "").trim().toUpperCase() || t.name, color: t.color, ink: t.ink, icon: t.icon }));
    store.drop(STORE_KEY);
    newGame({ teams, minutes: setup.minutes, people });
  }
  function resumeGame() {
    const saved = store.get(STORE_KEY);
    if (!saved) return renderSetup();
    S = saved;
    if (S.phase === "solution") S.phase = "question";
    showGame();
    setView(S.phase === "question" ? "card" : "board");
    render();
  }

  // § 14 — One click handler for the whole page (buttons carry a data-act name)
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b) return act(b.dataset.act, b, e);
    const stone = e.target.closest(".stone[data-stone]");
    if (stone) explainStone(+stone.dataset.stone);
  });
  function act(name, b, e) {
    switch (name) {
      case "answer":
        if (S.phase !== "question") return;
        S.answers[b.dataset.team] = b.dataset.l;
        save(); render();
        return;
      case "reveal": S.phase = "solution"; save(); render(); panel().scrollTop = 0; return;
      case "resolve": resolveQuestion(); return;
      case "next": askQuestion(); panel().scrollTop = 0; return;
      case "reto-peek": S.reto.stage = "peek"; render(); return;
      case "reto-hide": S.reto.stage = "play"; render(); return;
      case "reto-timer": startRetoTimer(); return;
      case "reto-pass": finishReto(true); return;
      case "reto-fail": finishReto(false); return;
      case "reto-guess": finishReto(true, +b.dataset.team); return;
      case "reto-swap":
        stopRetoTimer();
        S.reto.id = drawReto(); S.reto.timer = null; S.reto.stage = X[S.reto.id].secret ? "cover" : "play";
        render();
        return;
      case "view": setView(b.dataset.view); return;
      case "clock":
        if (S && S.clock && !S.clock.expired) { S.clock.paused = !S.clock.paused; drawClock(); save(); }
        return;
      case "rules": $("#rulesDlg").showModal(); return;
      case "quit": $("#quitDlg").showModal(); return;
      case "quit-yes":
        $("#quitDlg").close();
        if (resolver) { resolver = null; }
        store.drop(STORE_KEY);
        showSetup();
        return;
      case "close": b.closest("dialog").close(); return;
      case "again": showSetup(); return;
      case "resume": resumeGame(); return;
      case "discard": store.drop(STORE_KEY); renderSetup(); return;
    }
  }
  function explainStone(k) {
    const ev = D.board.events[k];
    if (ev) {
      const [title, detail] = ev.text.split(": ");
      toast(ev.icon, ev.delta > 0 ? C.good : C.bad, title, `${detail[0].toUpperCase() + detail.slice(1)}: ${ev.delta > 0 ? "avanza" : "retrocede"} ${Math.abs(ev.delta)}.`, 2400);
    } else toast("GiStarMedal", C.reto, "Reto", `Quien cae aquí hace una prueba. Si la supera, avanza ${D.board.retoReward}.`, 2400);
  }

  document.getElementById("segTeams").addEventListener("click", (e) => {
    const b = e.target.closest("[data-n]");
    if (!b) return;
    readSetup(); setup.count = +b.dataset.n; renderSetup();
  });
  document.getElementById("segClock").addEventListener("click", (e) => {
    const b = e.target.closest("[data-min]");
    if (!b) return;
    setup.minutes = +b.dataset.min; renderSetup();
  });
  document.querySelector(".stepper").addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]");
    if (!b) return;
    const inp = $("#people"), v = parseInt(inp.value, 10) || 0;
    inp.value = Math.min(200, Math.max(1, v + +b.dataset.step));
  });
  document.getElementById("setupForm").addEventListener("submit", (e) => { e.preventDefault(); startFromSetup(); });
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

  let resizeTimer = null;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (S) drawBoard(); }, 150); });

  // § 15 — Start: the key to the special stones in the rules, the counter, then the setup screen
  // Each line shows the stone as the board draws it, so the key follows any change of shape
  const mini = (inner) => `<svg class="mini" viewBox="-19 -19 39 39" aria-hidden="true">${inner}</svg>`;
  const retoMini = `<circle r="14.5" fill="${hex(C.reto)}" stroke="#FFFFFF" stroke-width="1.6"/>` + svgIcon("GiStarMedal", 0, -2.4, 13.5, C.navy);
  $("#legend").innerHTML = [
    `<li>${mini(retoMini)}<span><b>Reto</b> (casilla amarilla con medalla): el equipo hace una prueba en el momento.</span><span class="d" style="background:#B8860B">+${D.board.retoReward}</span></li>`,
    ...Object.entries(D.board.events).map(([k, ev]) => `<li>${mini(ev.svg)}<span><b>Casilla ${k}</b>, ${ev.delta > 0 ? "con suerte" : "de mala pata"}: ${esc(ev.text)}.</span><span class="d" style="background:${hex(ev.delta > 0 ? C.good : C.bad)}">${ev.delta > 0 ? "+" : "−"}${Math.abs(ev.delta)}</span></li>`),
  ].join("");
  counter.init();
  showSetup();
})();
