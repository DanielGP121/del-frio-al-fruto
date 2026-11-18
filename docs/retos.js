// Challenge cards played at a distance, with one device per player. Each card has a "kind":
// the small input the team uses on its own screen (a text box, items to put in order, true or
// false, a number, a drawing of buds to tap, emojis, a finger drawing). This file draws those
// inputs, reads them, shows a finished answer to everybody and checks the ones a machine can
// check; the others are judged by whoever hosts the room.
window.Retos = (function () {
  "use strict";

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // Lower case, no accents, no punctuation: "¡Polinización!" and "polinizacion" compare equal
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  // § 1 — The bud drawing: three buds on a twig, two flower buds (plump and round) and one leaf
  // bud (slim and pointed), which is how the stand teaches to tell them apart on a real branch.
  const BUDS = ["flor", "hoja", "flor"];
  const BUD_NAME = { flor: "una yema de flor", hoja: "la yema de hoja" };
  function budsSvg(o = {}) {
    const xs = [78, 150, 222];
    const bud = (kind, x) => kind === "flor"
      ? `<path d="M${x - 22} 150 C${x - 35} 120 ${x - 25} 78 ${x} 78 C${x + 25} 78 ${x + 35} 120 ${x + 22} 150 Z" fill="#A9664A" stroke="#6B3F2A" stroke-width="2.5"/>
         <path d="M${x - 15} 126 Q${x} 114 ${x + 15} 126 M${x - 11} 104 Q${x} 95 ${x + 11} 104" fill="none" stroke="#6B3F2A" stroke-width="1.6" stroke-linecap="round"/>
         <ellipse cx="${x - 7}" cy="100" rx="4" ry="9" fill="#FFFFFF" fill-opacity="0.28"/>`
      : `<path d="M${x - 10} 150 C${x - 14} 120 ${x - 7} 88 ${x} 62 C${x + 7} 88 ${x + 14} 120 ${x + 10} 150 Z" fill="#8C7046" stroke="#5E4526" stroke-width="2.5"/>
         <path d="M${x - 7} 128 Q${x} 121 ${x + 7} 128 M${x - 5} 106 Q${x} 100 ${x + 5} 106" fill="none" stroke="#5E4526" stroke-width="1.5" stroke-linecap="round"/>`;
    let out = `<path d="M14 166 Q150 150 286 162" fill="none" stroke="#7A5235" stroke-width="24" stroke-linecap="round"/>
      <path d="M22 160 Q150 145 278 156" fill="none" stroke="#9A6B47" stroke-width="5" stroke-linecap="round" opacity="0.7"/>`;
    BUDS.forEach((kind, i) => {
      const x = xs[i], picked = o.picked === i;
      const mark = o.reveal ? (kind === o.reveal ? `<text x="${x}" y="48" text-anchor="middle" font-size="26" font-weight="900" fill="#2E7D4F">✓</text>` : "") : "";
      const ring = picked ? `<rect x="${x - 38}" y="52" width="76" height="106" rx="16" fill="#F9B000" fill-opacity="0.22" stroke="#F9B000" stroke-width="4"/>` : "";
      const label = o.labels ? `<text x="${x}" y="200" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="22" font-weight="900" fill="#1E3A5F">${"ABC"[i]}</text>` : "";
      out += `<g${o.tap ? ` class="rx-bud" data-rx="bud" data-v="${i}"` : ""}>${ring}${bud(kind, x)}${mark}${label}<rect x="${x - 38}" y="52" width="76" height="106" fill="transparent"/></g>`;
    });
    return `<svg class="rx-buds" viewBox="0 0 300 ${o.labels ? 210 : 186}" role="img" aria-label="Tres yemas en una rama">${out}</svg>`;
  }

  // § 2 — Finger drawings travel as lists of points (0 to 600 across, 0 to 450 down), not as images
  const DRAW_W = 600, DRAW_H = 450, MAX_POINTS = 1600;
  const drawingSvg = (strokes) => `<svg class="rx-drawing" viewBox="0 0 ${DRAW_W} ${DRAW_H}" role="img" aria-label="Dibujo del equipo">${(strokes || []).map((s) => {
    const pts = [];
    for (let i = 0; i + 1 < s.length; i += 2) pts.push(`${s[i]},${s[i + 1]}`);
    return pts.length === 1 ? `<circle cx="${s[0]}" cy="${s[1]}" r="3.5" fill="#1E3A5F"/>` : `<polyline points="${pts.join(" ")}" fill="none" stroke="#1E3A5F" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("")}</svg>`;
  function mountDraw(canvas, strokes, onChange) {
    const ctx = canvas.getContext("2d");
    let cur = null;
    const count = () => strokes.reduce((n, s) => n + s.length / 2, 0);
    const redraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1E3A5F"; ctx.fillStyle = "#1E3A5F";
      strokes.forEach((s) => {
        ctx.beginPath(); ctx.moveTo(s[0], s[1]);
        if (s.length === 2) { ctx.arc(s[0], s[1], 3, 0, 6.3); ctx.fill(); return; }
        for (let i = 2; i + 1 < s.length; i += 2) ctx.lineTo(s[i], s[i + 1]);
        ctx.stroke();
      });
    };
    const at = (e) => { const r = canvas.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * canvas.width), Math.round((e.clientY - r.top) / r.height * canvas.height)]; };
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (count() >= MAX_POINTS) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      cur = at(e); strokes.push(cur); redraw();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!cur) return;
      const [x, y] = at(e), n = cur.length;
      // Points closer than a few pixels add nothing to the line and would bloat the message
      if (Math.abs(x - cur[n - 2]) + Math.abs(y - cur[n - 1]) < 7 || count() >= MAX_POINTS) return;
      cur.push(x, y); redraw();
    });
    const end = () => { if (cur) { cur = null; onChange(strokes); } };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    redraw();
    return { clear() { strokes.length = 0; cur = null; redraw(); onChange(strokes); } };
  }

  // § 3 — Empty value, input widget and what a tap does, per kind
  function blank(def) {
    switch (def.kind) {
      case "orden": return [];
      case "vf": return def.items.map(() => null);
      case "yemas": return null;
      case "emoji": return { at: 0, v: def.slots.map(() => []) };
      case "dibujo": return [];
      default: return "";
    }
  }
  function isBlank(def, v) {
    switch (def.kind) {
      case "orden": case "dibujo": return !v || !v.length;
      case "vf": return !v || v.every((x) => x == null);
      case "yemas": return v == null;
      case "emoji": return !v || v.v.every((s) => !s.length);
      default: return !String(v || "").trim();
    }
  }
  function widget(def, value) {
    switch (def.kind) {
      case "texto": case "pistas":
        return `<textarea class="rx-text" data-rxi="text" rows="3" maxlength="200" placeholder="Escribid aquí" aria-label="Vuestra respuesta">${esc(value || "")}</textarea>`;
      case "numero":
        return `<input class="rx-num" data-rxi="text" type="text" inputmode="numeric" maxlength="4" value="${esc(value || "")}" placeholder="?" aria-label="Vuestra respuesta">`;
      case "orden":
        return `<div class="rx-order">${def.items.map((it, i) => { const p = value.indexOf(i); return `<button type="button" class="rx-item${p >= 0 ? " on" : ""}" data-rx="ord" data-v="${i}"><b>${p >= 0 ? p + 1 : ""}</b><span>${esc(it)}</span></button>`; }).join("")}</div>`;
      case "vf":
        return `<div class="rx-vflist">${def.items.map(([text], i) => `<div class="rx-vf"><span>${i + 1}) ${esc(text)}</span><span class="rx-vfb">
          <button type="button" data-rx="vf" data-v="${i}:1" aria-pressed="${value[i] === true}">V</button><button type="button" data-rx="vf" data-v="${i}:0" aria-pressed="${value[i] === false}">F</button></span></div>`).join("")}</div>`;
      case "yemas":
        return budsSvg({ tap: true, picked: value });
      case "emoji":
        return `<div class="rx-slots">${def.slots.map((name, i) => `<button type="button" class="rx-slot${value.at === i ? " on" : ""}" data-rx="slot" data-v="${i}"><small>${esc(name)}</small><span>${value.v[i].join("") || "·"}</span></button>`).join("")}</div>
          <div class="rx-palette">${def.palette.map((e) => `<button type="button" data-rx="emo" data-v="${e}">${e}</button>`).join("")}<button type="button" class="rx-del" data-rx="del" aria-label="Borrar esta estación">⌫</button></div>`;
      case "dibujo":
        return `<div class="rx-draw"><canvas id="rxCanvas" width="${DRAW_W}" height="${DRAW_H}" aria-label="Zona para dibujar"></canvas><button type="button" class="linkbtn" data-rx="clear">Borrar el dibujo</button></div>`;
    }
    return "";
  }
  // New value after a tap on a widget button (el is the button)
  function click(def, value, el) {
    const what = el.dataset.rx, v = el.dataset.v;
    if (what === "ord") { const i = +v, list = value.slice(), p = list.indexOf(i); if (p >= 0) list.splice(p, 1); else list.push(i); return list; }
    if (what === "vf") { const [i, b] = v.split(":"), list = value.slice(); list[+i] = b === "1"; return list; }
    if (what === "bud") return +v;
    if (what === "slot") return { at: +v, v: value.v };
    if (what === "emo") {
      const slots = value.v.map((s) => s.slice());
      if (slots[value.at].length >= 2) return value;
      slots[value.at].push(v);
      // A full slot hands over to the next one, so four taps can fill the four seasons
      return { at: slots[value.at].length >= 2 ? Math.min(value.at + 1, slots.length - 1) : value.at, v: slots };
    }
    if (what === "del") { const slots = value.v.map((s) => s.slice()); slots[value.at] = []; return { at: value.at, v: slots }; }
    return value;
  }

  // § 4 — Checking and showing a finished answer. check() says true or false when the answer
  // can be checked by itself, and null when a person has to judge it.
  function banned(def, text) {
    return !!def.banWord && new RegExp(`(^|[^a-z])${def.banWord.replace(/\[ií\]/g, "i")}([^a-z]|$)`).test(norm(text));
  }
  function check(def, value, extra) {
    if (isBlank(def, value)) return false;
    switch (def.kind) {
      case "texto": return banned(def, value) ? false : null;
      case "numero": return parseInt(norm(value), 10) === def.answer;
      case "orden": return value.length === def.right.length && value.every((v, i) => v === def.right[i]);
      case "vf": return value.every((v, i) => v === def.items[i][1]);
      case "yemas": return BUDS[value] === (extra && extra.ask);
      default: return null;
    }
  }
  // reveal = show the right answer next to the team's
  function show(def, value, extra, reveal) {
    if (isBlank(def, value)) return `<p class="rx-none">No han contestado.</p>`;
    switch (def.kind) {
      case "texto": return `<blockquote class="rx-quote">${esc(value)}</blockquote>` + (banned(def, value) ? `<p class="rx-warn">Han escrito «${esc(def.banName)}».</p>` : "");
      case "numero": return `<div class="rx-big">${esc(value)}</div>` + (reveal ? `<p class="rx-ans">La respuesta es ${def.answer}.</p>` : "");
      case "orden": return `<ol class="rx-olist">${value.map((i) => `<li>${esc(def.items[i])}</li>`).join("")}</ol>` + (reveal ? `<p class="rx-ans">El orden es: ${def.right.map((i) => esc(def.items[i]).toLowerCase()).join(", ")}.</p>` : "");
      case "vf": return `<ul class="rx-vfshow">${def.items.map(([text, right], i) => `<li><b class="${reveal ? (value[i] === right ? "ok" : "ko") : ""}">${value[i] == null ? "–" : value[i] ? "V" : "F"}</b><span>${esc(text)}${reveal ? ` <i>(${right ? "verdadero" : "falso"})</i>` : ""}</span></li>`).join("")}</ul>`;
      case "yemas": return budsSvg({ picked: value, reveal: reveal ? extra && extra.ask : null });
      case "emoji": return `<div class="rx-slots show">${def.slots.map((name, i) => `<div class="rx-slot"><small>${esc(name)}</small><span>${value.v[i].join("") || "·"}</span></div>`).join("")}</div>`;
      case "dibujo": return drawingSvg(value);
    }
    return "";
  }

  // What the team hands in: every member can type or tap on a personal device. Texts are put
  // together; for the rest, the answer is the one of whoever pressed "Enviar" first, or of the
  // first member who entered anything if time ran out.
  function teamValue(def, entries) {
    const filled = entries.filter((e) => !isBlank(def, e.v));
    if (!filled.length) return blank(def);
    if (def.kind === "texto" || def.kind === "pistas") return filled.map((e) => String(e.v).trim()).join(" / ").slice(0, 400);
    return (filled.find((e) => e.done) || filled[0]).v;
  }

  // Word-guessing card: a clue may not contain the word (or its family); a guess is right when it is the word
  const maskClue = (def, text) => String(text || "").split(/(\s+)/).map((w) => (def.ban.some((b) => norm(w).replace(/ /g, "").includes(b)) ? "•••" : w)).join("");
  const guessOk = (def, text) => def.accept.includes(norm(text));
  const askText = (def, extra) => def.q.replace("{ask}", BUD_NAME[(extra && extra.ask) || "flor"]);

  return { BUDS, norm, blank, isBlank, widget, click, check, show, teamValue, maskClue, guessOk, askText, budsSvg, mountDraw };
})();
