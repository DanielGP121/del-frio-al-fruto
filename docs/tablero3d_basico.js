// Basic 3D view of the browser version: the printed board lying on a wooden table, the four
// decks on their slots, the challenge deck beside it and one pawn per token, with soft shadows.
// The game (juego.js) only says where each token stands, in millimetres of the printed board;
// this view hops the pawns there, lets the player turn and zoom the camera, and follows the
// pawns with the camera while they move. Loaded on demand: if three.js or WebGL is not
// available the game keeps its flat board. The richer view, the valley, is tablero3d.js.
import * as THREE from "./vendor/three.module.min.js";

const W = 420, H = 297, TOP = 3; // board size and thickness in mm; world units are mm, y is up
// The camera looks at a point a little in front of the board centre: seen at an angle the near
// half takes more of the screen, and this keeps the whole board centred. Pawns are drawn a bit
// larger than the flat tokens so they have presence on the table.
const REST_Z = 14, PAWN = 1.2;

export function create(host, o) {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xFBF6EC, 950, 2700); // the table fades into the colour of the page
  const camera = new THREE.PerspectiveCamera(36, 1, 20, 6000);

  // § 1 — Light: a soft sky light plus one lamp that casts the shadows. Together they show the
  // board picture at about its true brightness (intensities are in the physical units of three.js).
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9c7a8, 2.05));
  const lamp = new THREE.DirectionalLight(0xfff4e0, 1.75);
  lamp.position.set(-190, 420, 250);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  Object.assign(lamp.shadow.camera, { left: -330, right: 330, top: 260, bottom: -260, near: 80, far: 1100 });
  lamp.shadow.bias = -0.0006;
  lamp.shadow.normalBias = 0.7;
  scene.add(lamp);

  // § 2 — Canvas helpers: every picture that is not the board itself is drawn here, so the
  // page downloads a single image for this view
  const canvasTexture = (w, h, draw) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    draw(c.getContext("2d"), () => { tex.needsUpdate = true; invalidate(); });
    return tex;
  };
  // A game-icons glyph as an image; it loads asynchronously, so drawings get it a moment later
  const iconImage = (name, color) => new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="256" height="256" fill="#${color}">${o.icons[name] || ""}</svg>`);
  });

  // § 3 — Table, board and decks
  const wood = canvasTexture(512, 512, (g) => {
    g.fillStyle = "#C79C6E"; g.fillRect(0, 0, 512, 512);
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 150; i++) {
      const y = rnd() * 512, dark = rnd() < 0.5;
      g.strokeStyle = dark ? `rgba(110,72,38,${0.05 + rnd() * 0.13})` : `rgba(255,236,205,${0.05 + rnd() * 0.12})`;
      g.lineWidth = 0.6 + rnd() * 2.4;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 64) g.lineTo(x, y + Math.sin((x + i * 37) / 90) * 2.2);
      g.stroke();
    }
    // Plank joints, so the table reads as boards and not as one sheet
    g.strokeStyle = "rgba(90,58,30,0.35)"; g.lineWidth = 2;
    [128, 384].forEach((y) => { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); });
  });
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  wood.repeat.set(7, 7);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.82 }));
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  scene.add(table);

  const card = new THREE.MeshStandardMaterial({ color: 0xE9E2D3, roughness: 0.9 });
  const face = new THREE.MeshStandardMaterial({ color: 0xF3EEE2, roughness: 0.78 });
  new THREE.TextureLoader().load(o.texture, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    face.map = tex; face.color.set(0xffffff); face.needsUpdate = true;
    invalidate();
  }, undefined, () => { if (o.onFail) o.onFail(); });
  // Box faces go +x, -x, +y, -y, +z, -z: the board picture is the +y one, with its top edge at -z
  const boardMesh = new THREE.Mesh(new THREE.BoxGeometry(W, TOP, H), [card, card, face, card, card, card]);
  boardMesh.position.y = TOP / 2;
  boardMesh.castShadow = true; boardMesh.receiveShadow = true;
  scene.add(boardMesh);

  const edge = new THREE.MeshStandardMaterial({ color: 0xF4F0E6, roughness: 0.85 });
  function deck(d, x, z, w, h, turn) {
    const top = new THREE.MeshStandardMaterial({ roughness: 0.6, map: canvasTexture(352, 252, (g, done) => {
      const ink = d.ink || "FFFFFF";
      g.fillStyle = "#" + d.color; g.fillRect(0, 0, 352, 252);
      g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 5; g.strokeRect(12, 12, 328, 228);
      g.fillStyle = "#" + ink; g.textAlign = "center"; g.font = "900 34px 'Arial Black', Arial, sans-serif";
      g.fillText(d.name, 176, 222);
      iconImage(d.icon, ink).then((img) => { if (img) { g.drawImage(img, 176 - 62, 30, 124, 124); done(); } });
    }) });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 7, h), [edge, edge, top, edge, edge, edge]);
    m.position.set(x, TOP + 3.5, z);
    m.rotation.y = turn;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  (o.slots || []).forEach((s, i) => {
    const d = o.decks.find((k) => k.key === s.deck);
    if (d) deck(d, s.x - W / 2, s.y - H / 2, s.w - 5, s.h - 5, [0.02, -0.025, 0.03, -0.015][i % 4]);
  });
  // The challenge deck has no slot on the board: as the rules say, it sits beside it
  if (o.reto) deck({ ...o.reto, ink: o.colors.navy }, W / 2 + 62, 42, 83, 58, -0.2).position.y = 3.5;

  // § 4 — Pawns. One turned profile shared by all; each gets the colour of its token and its
  // emblem on a small disc that always faces the camera.
  const profile = [[0, 0], [7.4, 0], [7.8, 1], [7.4, 2.4], [5.6, 3.2], [4.2, 5], [3.2, 9], [2.7, 13], [3.9, 14.6], [4.6, 15.4], [3.6, 16.4], [2.6, 17]];
  for (let a = -60; a <= 90; a += 15) profile.push([4.9 * Math.cos(a * Math.PI / 180), 21 + 4.9 * Math.sin(a * Math.PI / 180)]);
  const pawnGeo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 36);
  const ringGeo = new THREE.RingGeometry(9.4, 11.8, 44);
  const tokens = new Map();
  function makeToken(it) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.06 });
    const body = new THREE.Mesh(pawnGeo, mat);
    body.castShadow = true;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
    sprite.scale.set(11.5, 11.5, 1);
    sprite.position.y = 34;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.25;
    g.add(body, sprite, ring);
    g.position.set(it.x - W / 2, TOP, it.y - H / 2);
    scene.add(g);
    return { g, mat, sprite, ring, look: "", hop: null, active: false, mine: false };
  }
  function dress(tk, it) {
    const look = `${it.color}|${it.ink}|${it.icon}`;
    if (tk.look === look) return;
    tk.look = look;
    tk.mat.color.set("#" + it.color);
    if (tk.sprite.material.map) tk.sprite.material.map.dispose();
    tk.sprite.material.map = canvasTexture(128, 128, (c, done) => {
      c.fillStyle = "#FFFFFF"; c.beginPath(); c.arc(64, 64, 62, 0, 7); c.fill();
      c.fillStyle = "#" + it.color; c.beginPath(); c.arc(64, 64, 54, 0, 7); c.fill();
      iconImage(it.icon, it.ink).then((img) => { if (img) { c.drawImage(img, 26, 26, 76, 76); done(); } });
    });
    tk.sprite.material.needsUpdate = true;
  }

  // Called by the game with where every token stands now (mm of the board). ms is how long a hop lasts.
  function setTokens(list, ms) {
    const seenIds = new Set();
    list.forEach((it) => {
      seenIds.add(it.id);
      let tk = tokens.get(it.id);
      if (!tk) { tk = makeToken(it); tokens.set(it.id, tk); }
      dress(tk, it);
      tk.active = it.active; tk.mine = it.mine;
      const x = it.x - W / 2, z = it.y - H / 2, s = it.r / 7.2 * PAWN, p = tk.g.position;
      const goal = tk.hop ? tk.hop.to : [p.x, p.z];
      if (Math.abs(goal[0] - x) > 0.05 || Math.abs(goal[1] - z) > 0.05) {
        if (ms > 0 && !o.reduced) tk.hop = { from: [p.x, p.z], to: [x, z], t: 0, dur: ms / 1000, s0: tk.g.scale.x, s1: s };
        else { tk.hop = null; p.set(x, TOP, z); tk.g.scale.setScalar(s); }
      } else if (!tk.hop) tk.g.scale.setScalar(s);
    });
    tokens.forEach((tk, id) => {
      if (seenIds.has(id)) return;
      scene.remove(tk.g);
      if (tk.sprite.material.map) tk.sprite.material.map.dispose();
      tk.mat.dispose(); tk.sprite.material.dispose(); tk.ring.material.dispose();
      tokens.delete(id);
    });
    invalidate();
  }

  // § 5 — Camera: it circles the board. "rest" is what the player has set by dragging and
  // zooming; while pawns move, the camera leans towards them and comes back afterwards.
  const rest = { theta: 0, phi: 0.72, dist: 600, zoomed: false };
  const cam = { theta: 0, phi: 0.72, dist: 600, tx: 0, tz: REST_Z };
  let touched = 0, calm = 0;
  function place(c) {
    const sp = Math.sin(c.phi), cp = Math.cos(c.phi);
    camera.position.set(c.tx + c.dist * sp * Math.sin(c.theta), 8 + c.dist * cp, c.tz + c.dist * sp * Math.cos(c.theta));
    camera.lookAt(c.tx, 8, c.tz);
    camera.updateMatrixWorld();
  }
  // Smallest distance from which the whole board, with a margin, fits in the view
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a * (W / 2 + 18), TOP, b * (H / 2 + 18)));
  function fit() {
    const v = new THREE.Vector3();
    let lo = 150, hi = 5000;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      place({ theta: rest.theta, phi: rest.phi, dist: mid, tx: 0, tz: REST_Z });
      const inside = corners.every((c) => { v.copy(c).project(camera); return Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.9; });
      if (inside) hi = mid; else lo = mid;
    }
    return hi;
  }
  let fitDist = 600;
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitDist = fit();
    if (!rest.zoomed) { rest.dist = fitDist; cam.dist = fitDist; }
    invalidate();
  }

  // § 6 — Frames are drawn only while something moves, so an idle board costs no battery
  let raf = 0, last = 0, again = false;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  function frame(now) {
    raf = 0;
    if (!host.clientWidth) return;
    const dt = Math.min(0.06, last ? (now - last) / 1000 : 0.016);
    last = now; again = false;
    let busy = false, fx = 0, fz = 0, moving = 0;
    tokens.forEach((tk) => {
      const p = tk.g.position;
      if (tk.hop) {
        const hp = tk.hop;
        hp.t = Math.min(1, hp.t + dt / hp.dur);
        const e = ease(hp.t);
        p.x = hp.from[0] + (hp.to[0] - hp.from[0]) * e;
        p.z = hp.from[1] + (hp.to[1] - hp.from[1]) * e;
        p.y = TOP + Math.sin(Math.PI * hp.t) * 9;
        tk.g.scale.setScalar(hp.s0 + (hp.s1 - hp.s0) * e);
        fx += p.x; fz += p.z; moving++;
        if (hp.t >= 1) { tk.hop = null; p.y = TOP; }
        busy = true;
      }
      const m = tk.ring.material;
      if (tk.active) { m.color.set(0xF9B000); m.opacity = 0.55 + 0.4 * Math.sin(now / 160); busy = true; }
      else if (tk.mine) { m.color.set(0xFFFFFF); m.opacity = 0.95; }
      else m.opacity = 0;
    });
    // The camera leans towards the pawns that are moving, unless the player has just moved it
    const follow = moving && now - touched > 3500;
    if (moving) calm = now;
    const lean = follow || (now - calm < 500 && now - touched > 3500);
    const goal = { theta: rest.theta, phi: rest.phi, dist: lean ? rest.dist * 0.74 : rest.dist, tx: follow ? fx / moving * 0.6 : lean ? cam.tx : 0, tz: follow ? fz / moving * 0.6 : lean ? cam.tz : REST_Z };
    const k = 1 - Math.exp(-dt * (now - touched < 400 ? 30 : 4.5));
    for (const key of ["theta", "phi", "dist", "tx", "tz"]) {
      const d = goal[key] - cam[key];
      if (Math.abs(d) > (key === "theta" || key === "phi" ? 0.0006 : 0.15)) { cam[key] += d * k; busy = true; } else cam[key] = goal[key];
    }
    place(cam);
    renderer.render(scene, camera);
    if (busy || again) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  function invalidate() { again = true; if (!raf) raf = requestAnimationFrame(frame); }

  // § 7 — Pointer control: drag to turn, pinch or wheel to zoom, double tap to go back to the
  // whole board, and a plain tap on a special stone explains it (as on the flat board)
  const el = renderer.domElement, pts = new Map();
  let pinch = 0, down = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP), hit = new THREE.Vector3();
  function tapStone(e) {
    const r = el.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    const mx = hit.x + W / 2, my = hit.z + H / 2;
    let best = -1, bd = 16;
    o.stones.forEach(([sx, sy], i) => { const d = Math.hypot(sx - mx, sy - my); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && o.onStone) o.onStone(best);
  }
  const zoom = (f) => { rest.dist = Math.max(170, Math.min(fitDist * 1.5, rest.dist * f)); rest.zoomed = true; touched = performance.now(); invalidate(); };
  el.addEventListener("pointerdown", (e) => {
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); down = null; }
  });
  el.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) {
      if (down) down.moved += Math.abs(dx) + Math.abs(dy);
      if (!down || down.moved > 6) {
        rest.theta -= dx * 0.006;
        rest.phi = Math.max(0.08, Math.min(1.22, rest.phi - dy * 0.005));
        touched = performance.now(); invalidate();
      }
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch > 0 && d > 0) zoom(pinch / d);
      pinch = d;
    }
  });
  const up = (e) => {
    if (pts.size === 1 && down && down.moved <= 6 && performance.now() - down.t < 500 && e.type === "pointerup") tapStone(e);
    pts.delete(e.pointerId);
    down = null;
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  el.addEventListener("dblclick", () => { rest.theta = 0; rest.phi = 0.72; rest.dist = fitDist; rest.zoomed = false; touched = 0; invalidate(); });
  el.addEventListener("webglcontextlost", (e) => { e.preventDefault(); if (o.onFail) o.onFail(); });

  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(host);
  resize();
  return { setTokens, resize };
}
