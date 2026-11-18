// Landing scene: a low-poly valley behind the title that runs from winter on the left to the
// fruit on the right, the same journey the board makes. It is plain SVG built for the size of
// the screen, so a phone also sees the whole year, and redrawn when that size changes.
// Purely decorative: the game never reads anything from here, and the page works without it.
(function () {
  "use strict";
  const svg = document.getElementById("scene");
  if (!svg) return;
  const hero = svg.parentElement;
  const NS = "http://www.w3.org/2000/svg";

  // § 1 — Helpers: seeded random numbers (the valley looks the same on every visit and every
  // redraw), colours interpolated along the year and SVG elements
  function rng(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  // Colour at t of the year (0 = winter on the left, 1 = fruit on the right) from evenly spaced stops
  function along(stops, t) {
    const n = stops.length - 1, x = Math.min(Math.max(t, 0), 1) * n, i = Math.min(Math.floor(x), n - 1), f = x - i;
    const a = hex(stops[i]), b = hex(stops[i + 1]);
    return toHex(a.map((v, j) => v + (b[j] - v) * f));
  }
  // Lighter (k > 0, towards white) or darker (k < 0) version of a colour
  const shade = (h, k) => toHex(hex(h).map((v) => (k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(e);
    return e;
  }
  const pts = (a) => a.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const poly = (p, fill, parent) => el("polygon", { points: pts(p), fill }, parent);

  // Palettes from winter to fruit. The mountains stay cold blue and only warm a little towards
  // the end; the ground goes from snow to fresh grass, deep green and the gold of late summer.
  const MOUNT_LIT = ["#BAC7F8", "#C0C6F6", "#C8BFF2", "#D2B8EE"];
  const MOUNT_DARK = ["#7E8DE4", "#8590E2", "#9089DE", "#9E83D8"];
  const GROUND_FAR = ["#D8E8FA", "#A2DC86", "#45B86D", "#D2B658"];
  const GROUND_NEAR = ["#F1F8FF", "#B6EA8D", "#58CD7A", "#E8C960"];
  const CANOPY = [null, ["#FFD6E6", "#FFB3CF", "#FF8DB8", "#E8679C"], ["#9BE8A9", "#5BD47F", "#3BBE63", "#279F50"], ["#86DB95", "#4CC870", "#34AE5A", "#218A45"]];
  // The four colours of the printed decks, for the stones along the path
  const STONES = ["#1F6FA8", "#D81B60", "#2E7D4F", "#EF8A17"];

  // § 2 — Pieces of the scene
  function cloud(cx, cy, s, g) {
    for (const [dx, dy, r] of [[-26, 6, 17], [0, -5, 24], [27, 5, 16]]) {
      const ring = [];
      for (let k = 0; k < 8; k++) { const a = Math.PI + (k * Math.PI) / 4; ring.push([cx + (dx + Math.cos(a) * r) * s, cy + (dy + Math.sin(a) * r * 0.9) * s]); }
      poly(ring, "#E1EEFB", g);
      poly(ring.slice(0, 5), "#FFFFFF", g);
    }
    poly([[cx - 40 * s, cy + 9 * s], [cx + 41 * s, cy + 9 * s], [cx + 35 * s, cy + 19 * s], [cx - 34 * s, cy + 19 * s]], "#E1EEFB", g);
  }

  // A band of rolling ground cut into facets: each stretch has a lit or shaded top triangle
  // (by its slope) over a body in the colour of that time of the year
  function band(R, W, H, y0, amp, stepPx, palette) {
    const xs = [];
    for (let x = -30; x < W + stepPx; x += stepPx) xs.push([x, y0 - R() * amp]);
    for (let i = 0; i < xs.length - 1; i++) {
      const p = xs[i], q = xs[i + 1], t = (p[0] + q[0]) / 2 / W, base = along(palette, t);
      const m = [(p[0] + q[0]) / 2 + (R() - 0.5) * stepPx * 0.3, Math.max(p[1], q[1]) + amp * 0.55];
      poly([p, m, q, [q[0], H], [p[0], H]], base);
      poly([p, q, m], shade(base, q[1] < p[1] ? 0.22 : -0.08));
    }
  }

  function tree(R, x, by, s, season) {
    const g = el("g", {});
    el("ellipse", { cx: x + s * 0.06, cy: by + 2, rx: s * 0.42, ry: s * 0.07, fill: "rgba(42,30,74,0.14)" }, g);
    const tw = s * 0.09, th = s * 0.5;
    poly([[x - tw, by], [x, by], [x, by - th], [x - tw * 0.65, by - th]], "#8B5A2B", g);
    poly([[x, by], [x + tw, by], [x + tw * 0.65, by - th], [x, by - th]], "#6E4420", g);
    if (season === 0) {
      // Winter: bare branches with snow on their tips, and a patch of snow at the foot
      el("ellipse", { cx: x, cy: by + 1, rx: s * 0.36, ry: s * 0.06, fill: "#FFFFFF" }, g);
      for (const [dx, dy] of [[-0.42, -0.6], [-0.2, -0.95], [0.1, -1.02], [0.38, -0.74], [0.3, -0.38]]) {
        const ex = x + dx * s, ey = by - th + dy * s * 0.6;
        el("line", { x1: x, y1: by - th * 0.8, x2: ex, y2: ey, stroke: "#7A4A2A", "stroke-width": (s * 0.05).toFixed(1), "stroke-linecap": "round" }, g);
        poly([[ex - s * 0.08, ey + s * 0.015], [ex - s * 0.03, ey - s * 0.045], [ex + s * 0.05, ey - s * 0.035], [ex + s * 0.085, ey + s * 0.02]], "#FFFFFF", g);
      }
      return;
    }
    // Other seasons: a faceted crown lit from the upper left, pink in blossom and green after
    const pal = CANOPY[season], r = s * 0.5, cy = by - th - s * 0.2, n = 7, ring = [];
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / n + (R() - 0.5) * 0.35, rr = r * (0.86 + R() * 0.24);
      ring.push([x + Math.cos(a) * rr * 1.08, cy + Math.sin(a) * rr]);
    }
    const c = [x - r * 0.12, cy - r * 0.12];
    for (let k = 0; k < n; k++) {
      const p = ring[k], q = ring[(k + 1) % n];
      const facing = Math.atan2((p[1] + q[1]) / 2 - cy, (p[0] + q[0]) / 2 - x);
      const lit = Math.cos(facing + Math.PI * 0.75);
      poly([c, p, q], pal[lit > 0.5 ? 0 : lit > 0 ? 1 : lit > -0.5 ? 2 : 3], g);
    }
    const dots = season === 1 ? 5 : season === 3 ? 4 : 0;
    for (let k = 0; k < dots; k++) {
      const a = R() * Math.PI * 2, d = R() * r * 0.62, fx = x + Math.cos(a) * d * 1.05, fy = cy + Math.sin(a) * d * 0.9;
      if (season === 1) el("circle", { cx: fx, cy: fy, r: s * 0.035, fill: "#FFFFFF" }, g);
      else {
        el("circle", { cx: fx, cy: fy, r: s * 0.07, fill: "#FF7A26" }, g);
        el("circle", { cx: fx - s * 0.022, cy: fy - s * 0.022, r: s * 0.022, fill: "#FFC48F" }, g);
      }
    }
  }

  // § 3 — The whole scene, back to front: sun, clouds, mountains (high at the sides and low in the
  // middle, a valley like the one of the 3D board), two bands of ground, the path with the four
  // colours of the board, the orchard and, on top, snow and petals falling on their side of the year
  function draw(W, H) {
    while (svg.firstChild) svg.firstChild.remove();
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const R = rng(7), small = W < 600;
    const ground = H - (small ? 62 : 78);
    const base = ground - (small ? 24 : 32);

    // On a phone the title takes the whole width, so the sun moves up into the corner
    const sun = small ? { x: W - 38, y: 40, r: 14 } : { x: W * 0.89, y: Math.min(H * 0.18, 86), r: 25 };
    const rays = el("g", { class: "rays", style: `transform-origin:${sun.x.toFixed(1)}px ${sun.y.toFixed(1)}px` });
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6, r1 = sun.r * 1.35, r2 = sun.r * 1.95;
      poly([[sun.x + Math.cos(a - 0.14) * r1, sun.y + Math.sin(a - 0.14) * r1], [sun.x + Math.cos(a) * r2, sun.y + Math.sin(a) * r2], [sun.x + Math.cos(a + 0.14) * r1, sun.y + Math.sin(a + 0.14) * r1]], "#FFD34D", rays);
    }
    el("circle", { cx: sun.x, cy: sun.y, r: sun.r, fill: "#FFC21A" });
    el("circle", { cx: sun.x - sun.r * 0.3, cy: sun.y - sun.r * 0.3, r: sun.r * 0.45, fill: "#FFE27A" });

    const nC = small ? 2 : 4;
    for (let i = 0; i < nC; i++) {
      const g = el("g", { class: "cloud", style: `--d:${(18 + R() * 14).toFixed(1)}s;--dx:${((R() > 0.5 ? 1 : -1) * (18 + R() * 24)).toFixed(0)}px` });
      cloud(W * (0.06 + (0.8 * (i + 0.5)) / nC) + (R() - 0.5) * 50, H * (0.1 + R() * 0.2), (small ? 0.7 : 1) * (0.8 + R() * 0.45), g);
    }

    const nM = Math.max(5, Math.round(W / (small ? 95 : 150))), step = (W + 120) / nM, hMax = Math.min(base * 0.62, small ? 150 : 235);
    const peaks = [];
    for (let i = 0; i <= nM; i++) {
      const x = -60 + i * step + (R() - 0.5) * step * 0.4, t = x / W;
      const h = hMax * (0.3 + 0.7 * Math.pow(Math.abs(2 * t - 1), 1.3)) * (0.85 + R() * 0.3);
      peaks.push({ x, t, h, w: h * (0.95 + R() * 0.3), snow: R() < 1.15 - t * 0.9 });
    }
    peaks.sort((a, b) => b.h - a.h);
    for (const p of peaks) {
      const y = base - p.h, b = base + 4, lit = along(MOUNT_LIT, p.t), dark = along(MOUNT_DARK, p.t);
      poly([[p.x - p.w, b], [p.x, y], [p.x, b]], lit);
      poly([[p.x, y], [p.x + p.w, b], [p.x, b]], dark);
      if (p.snow && p.h > hMax * 0.38) {
        const d = p.h * (0.24 + 0.1 * (1 - p.t)), e = (p.w * d) / p.h;
        poly([[p.x, y], [p.x - e, y + d], [p.x - e * 0.45, y + d * 0.78], [p.x, y + d * 1.02]], "#FFFFFF");
        poly([[p.x, y], [p.x, y + d * 1.02], [p.x + e * 0.5, y + d * 0.82], [p.x + e, y + d]], "#E2E9FF");
      }
    }

    band(R, W, H, base + 6, small ? 18 : 26, small ? 48 : 66, GROUND_FAR);
    band(R, W, H, ground + 4, small ? 10 : 14, small ? 56 : 80, GROUND_NEAR);

    const pathY = (x) => ground + (H - ground) * 0.5 + Math.sin(x / 95) * 5;
    const line = [];
    for (let x = -20; x <= W + 20; x += 12) line.push([x, pathY(x)]);
    el("polyline", { points: pts(line), fill: "none", stroke: "#E8C98E", "stroke-width": small ? 15 : 19, "stroke-linecap": "round", "stroke-linejoin": "round" });
    el("polyline", { points: pts(line), fill: "none", stroke: "#FFEBC2", "stroke-width": small ? 10 : 13, "stroke-linecap": "round", "stroke-linejoin": "round" });
    for (let x = 18; x < W; x += small ? 34 : 44) {
      el("circle", { cx: x, cy: pathY(x), r: small ? 3.4 : 4.4, fill: STONES[Math.min(3, Math.floor((x / W) * 4))], stroke: "#FFFFFF", "stroke-width": 1.5 });
    }

    const nT = Math.max(4, Math.min(13, Math.round(W / (small ? 78 : 118)))), s = Math.max(34, Math.min(78, H * (small ? 0.15 : 0.17)));
    for (let i = 0; i < nT; i++) {
      const x = (W * (i + 0.5)) / nT + (R() - 0.5) * (W / nT) * 0.35;
      tree(R, x, ground + 6 + (R() - 0.5) * 6, s * (0.85 + R() * 0.3), Math.min(3, Math.floor((x / W) * 4)));
    }

    const fall = el("g", { class: "fall" });
    const particle = (x, kind) => {
      const d = 7 + R() * 7;
      const style = `--fy:${H + 30}px;--dx:${((R() - 0.5) * 60).toFixed(0)}px;--rot:${((R() - 0.5) * 720).toFixed(0)}deg;animation-duration:${d.toFixed(1)}s;animation-delay:${(-R() * d).toFixed(1)}s`;
      if (kind === "flake") el("circle", { class: "p", style, cx: x, cy: -10, r: (1.6 + R() * 2.2).toFixed(1), fill: "#FFFFFF", stroke: "#9CC2EC", "stroke-width": 0.7 }, fall);
      else el("ellipse", { class: "p", style, cx: x, cy: -10, rx: 4.6, ry: 2.6, fill: R() > 0.5 ? "#FF9CC2" : "#FFC2DA" }, fall);
    };
    for (let i = 0, n = small ? 10 : 18; i < n; i++) particle(R() * W * 0.34, "flake");
    for (let i = 0, n = small ? 7 : 12; i < n; i++) particle(W * (0.26 + R() * 0.26), "petal");
  }

  // § 4 — Draw now and again whenever the hero changes size (a turned phone, the fonts arriving,
  // or the setup screen coming back after a game, when it was hidden and measured zero)
  let last = "";
  function fit() {
    const W = Math.round(hero.clientWidth), H = Math.round(hero.clientHeight);
    if (!W || !H || W + "x" + H === last) return;
    last = W + "x" + H;
    draw(W, H);
  }
  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(fit, 120); };
  if ("ResizeObserver" in window) new ResizeObserver(later).observe(hero);
  else addEventListener("resize", later);
  fit();
})();
