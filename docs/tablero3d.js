// 3D valley of the browser version, the default way to see the board. The 32 stepping stones of
// the printed track run along the floor of a valley closed by forested hills and mountains.
// Each quarter of the valley is a season (snowy winter, spring in bloom, green summer, golden
// late summer), a river comes down from the snowy peaks and crosses the path on a bridge, and a
// big tree in the middle changes with the season of the token that matters at each moment.
// The style is low poly on purpose: flat facets with saturated colours, a sky in gradient and
// fog of the same colour, a warm sun with soft shadows. Everything is built in code from simple
// shapes (no models are downloaded) and the amount of detail adapts to the device.
// The game (juego.js) only says on which spot of the printed board each token stands and which
// tokens matter right now. Loaded on demand: without WebGL the game uses another board.
import * as THREE from "./vendor/three.module.min.js";

const W = 420, H = 297;                         // the track is laid out in millimetres of the printed board
const TA = 183, TB = 121.5, TR = 48, PATH_W = 39; // track centre line (half sides, corner radius) and path width
const FLOOR = 54;                               // the valley floor stays flat up to this distance outside the track
const EXT_X = 1300, EXT_Z = 1100;               // half size of the terrain
const TAU = Math.PI * 2;
const SEASONS = 4;                              // winter, spring, summer, late summer: top right, then clockwise

// § 1 — Colours. Ground colours are fixed per quarter; sky and light follow the season "in the air".
const C3 = (h) => new THREE.Color(h);
const GROUND = [
  { floor: ["#EEF4FB", "#E2ECF7", "#F8FBFF"], hill: ["#D5E2F0", "#C6D7EA", "#DFE9F4"], tuft: "#E9F1FA" },
  { floor: ["#8FD86A", "#A1E077", "#7ECC5F"], hill: ["#5FC056", "#6ECB5C", "#54B24E"], tuft: "#7DD457" },
  { floor: ["#57BD45", "#4DB13E", "#66C550"], hill: ["#3A9C3E", "#44A842", "#348E39"], tuft: "#4CB43F" },
  { floor: ["#E8C251", "#DDB447", "#F0CC62"], hill: ["#BFA642", "#B19B3B", "#C9B04C"], tuft: "#EBC65A" },
].map((g) => ({ floor: g.floor.map(C3), hill: g.hill.map(C3), tuft: C3(g.tuft) }));
const ROCK = ["#8E8BAA", "#7D7A9A", "#9C99B5"].map(C3), CLIFF = C3("#6E6A8C"), SNOW = ["#FFFFFF", "#EEF3FB"].map(C3);
const AIR = [
  { top: "#6FA3D6", low: "#E3EDF7", sun: "#EEF4FF", sunI: 1.55, sky: "#DDE8FA", gnd: "#95A9C2", hemiI: 1.95 },
  { top: "#45ABF0", low: "#D6F0FF", sun: "#FFF4E2", sunI: 1.7, sky: "#E6F5FF", gnd: "#9CC47A", hemiI: 1.85 },
  { top: "#2A93EA", low: "#C2E8FF", sun: "#FFF0CC", sunI: 1.85, sky: "#E2F4FF", gnd: "#8DBC6A", hemiI: 1.8 },
  { top: "#5C97D6", low: "#FFE0B0", sun: "#FFD8A0", sunI: 1.75, sky: "#FFEFD8", gnd: "#C8A55C", hemiI: 1.8 },
].map((a) => ({ top: C3(a.top), low: C3(a.low), sun: C3(a.sun), sunI: a.sunI, sky: C3(a.sky), gnd: C3(a.gnd), hemiI: a.hemiI }));

// § 2 — Noise and shapes of the valley. Value noise with fractal sums gives the hills; a ridged
// version gives the mountain crests. trackDist is the signed distance to the centre line of the
// track (negative inside the loop), which is how the valley knows where to stay flat.
const hash = (a, b, c = 0) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1442695041) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, z, oct) => { let s = 0, amp = 0.5, f = 1, norm = 0; for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, z * f); norm += amp; f *= 2.03; amp *= 0.5; } return s / norm; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function trackDist(x, z) {
  const qx = Math.abs(x) - (TA - TR), qz = Math.abs(z) - (TB - TR);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - TR;
}
// How much of each season a spot belongs to: the four quarters melt into each other over a band
// that widens with the distance from the centre, so far mountains blend more softly
function seasonWeights(x, z, out = [0, 0, 0, 0]) {
  const band = 34 + Math.hypot(x, z) * 0.1, wx = smooth(-band, band, x), wz = smooth(-band, band, z);
  out[0] = wx * (1 - wz); out[1] = wx * wz; out[2] = (1 - wx) * wz; out[3] = (1 - wx) * (1 - wz);
  return out;
}

// The river: it comes down from the snowy mountains in the winter corner, crosses the path at
// stone 8 (the change from winter to spring) under a bridge and ends in a pond inside the loop.
const RIVER_PTS = [[860, -520], [700, -380], [560, -250], [430, -140], [320, -60], [240, -12], [183, 0], [148, 5], [118, 8]];
const POND = { x: 108, z: 9, r: 25 };
const river = (() => {
  const curve = new THREE.CatmullRomCurve3(RIVER_PTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "centripetal");
  return curve.getSpacedPoints(110).map((p) => ({ x: p.x, z: p.z, bed: 0, half: 0 }));
})();
function riverNear(x, z) {
  let best = 1e9, k = 0;
  for (let i = 0; i < river.length - 1; i++) {
    const a = river[i], b = river[i + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)), px = a.x + dx * t - x, pz = a.z + dz * t - z, d = px * px + pz * pz;
    if (d < best) { best = d; k = i + t; }
  }
  const i = Math.min(river.length - 2, Math.floor(k)), f = k - i, a = river[i], b = river[i + 1];
  return { d: Math.sqrt(best), bed: a.bed + (b.bed - a.bed) * f, half: a.half + (b.half - a.half) * f };
}
// Height of the land before the river is carved
function landHeight(x, z) {
  const d = trackDist(x, z);
  if (d < FLOOR) {
    // On and next to the path the floor is dead flat; elsewhere it swells a little
    const off = Math.abs(d) - PATH_W / 2 - 7;
    return off > 0 ? (fbm(x * 0.022 + 3, z * 0.022 - 5, 2) - 0.45) * 4.5 * Math.min(1, off / 22) : 0;
  }
  const t = d - FLOOR;
  const hills = smooth(0, 170, t) * (30 + 34 * fbm(x * 0.0062, z * 0.0062, 3));
  const ridge = 1 - Math.abs(fbm(x * 0.0042 + 7.3, z * 0.0042 + 1.9, 4) * 2 - 1);
  const mountains = smooth(70, 500, t) * (130 + 320 * ridge * ridge);
  return hills + mountains + (fbm(x * 0.035, z * 0.035, 2) - 0.5) * 7 * smooth(0, 60, t);
}
// River bed: from the pond up the stream it climbs gently, never above a fraction of the land
for (let i = river.length - 1; i >= 0; i--) {
  const r = river[i], land = landHeight(r.x, r.z), down = i === river.length - 1 ? -3.2 : river[i + 1].bed;
  r.bed = i === river.length - 1 ? -3.2 : Math.max(down, Math.min(land * 0.62 - 3.2, down + 9));
  r.half = 9.5 - 4 * smooth(0, 60, Math.max(0, r.bed));
}
function heightAt(x, z) {
  let h = landHeight(x, z);
  const rv = riverNear(x, z);
  if (rv.d < rv.half + 140) h = Math.min(h, rv.bed + Math.max(0, rv.d - rv.half) * 0.6);
  const pd = Math.hypot(x - POND.x, z - POND.z);
  if (pd < POND.r + 30) h = Math.min(h, -3.2 + Math.max(0, pd - POND.r) * 0.5);
  return h;
}

export function create(host, o) {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const dpr = window.devicePixelRatio || 1;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 4, 7000);
  scene.fog = new THREE.Fog(AIR[0].low.clone(), 750, 2700);
  const hemi = new THREE.HemisphereLight(AIR[0].sky.clone(), AIR[0].gnd.clone(), AIR[0].hemiI);
  const sun = new THREE.DirectionalLight(AIR[0].sun.clone(), AIR[0].sunI);
  const SUN_DIR = new THREE.Vector3(-0.42, 0.74, 0.52).normalize();
  sun.position.copy(SUN_DIR).multiplyScalar(800);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -400, right: 400, top: 330, bottom: -330, near: 100, far: 1700 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.9;
  scene.add(hemi, sun, sun.target);

  // § 3 — Small helpers: seeded randomness (the valley is the same on every device), materials,
  // basic shapes, merging coloured parts into one geometry, and drawn textures
  let seed = 20261118;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const mat = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0, flatShading: true }, extra));
  const ball = (r, m, sx = 1, sy = 1, sz = 1, seg = 12) => { const b = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))), m); b.scale.set(sx, sy, sz); return b; };
  const rod = (rt, rb, h, m, seg = 8) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  const box = (x, y, z, m) => new THREE.Mesh(new THREE.BoxGeometry(x, y, z), m);
  const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };
  const shade = (obj, receive = false) => { obj.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = receive; } }); return obj; };
  const world = (mx, my) => [mx - W / 2, my - H / 2];
  const hexColor = (c) => "#" + c;
  const M = (x, y, z, sx = 1, sy = sx, sz = sx, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  // Moves the corners of a shape a little, the same way for every copy of a corner, so the facets
  // look hand cut and the surface stays closed
  const rough = (g, amt, s0 = 0) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), f = 1 + (hash(Math.round(x * 97), Math.round(y * 97), Math.round(z * 97) + s0) - 0.5) * amt;
      p.setXYZ(i, x * f, y * (1 + (f - 1) * 0.6), z * f);
    }
    g.computeVertexNormals();
    return g;
  };
  // One geometry from several coloured parts: [geometry, colour, matrix]. Each face gets a slightly
  // different shade of its colour, which is what makes flat low poly surfaces read as facets.
  function merge(parts) {
    const geos = parts.map(([g, color, m]) => { const ng = g.index ? g.toNonIndexed() : g.clone(); if (m) ng.applyMatrix4(m); return [ng, C3(color)]; });
    const total = geos.reduce((s, [g]) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let off = 0;
    geos.forEach(([g, c]) => {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, off * 3);
      for (let i = 0; i < n; i++) { const k = 0.9 + hash(i / 3 | 0, off, 7) * 0.16, j = (off + i) * 3; col[j] = c.r * k; col[j + 1] = c.g * k; col[j + 2] = c.b * k; }
      off += n;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.computeVertexNormals();
    return out;
  }
  const canvasTexture = (w, h, draw) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    draw(c.getContext("2d"), () => { tex.needsUpdate = true; });
    return tex;
  };
  const svgImage = (inner, viewBox, px, attrs = "") => new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${px}" height="${px}" ${attrs}>${inner}</svg>`);
  });
  const iconImage = (name, color) => svgImage(o.icons[name] || "", "0 0 512 512", 256, `fill="#${color}"`);
  const time = { value: 0 }; // shared clock for the materials that sway in the wind

  // § 4 — Sky: a dome in gradient from the colour of the horizon to the colour above, which
  // follows the camera, and a soft sun. The fog takes the colour of the horizon, so the far
  // mountains melt into the sky.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: AIR[0].top.clone() }, low: { value: AIR[0].low.clone() } },
    vertexShader: "varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 low; varying vec3 vDir; void main() { float h = clamp(vDir.y * 1.45 + 0.04, 0.0, 1.0); gl_FragColor = vec4(mix(low, top, pow(h, 0.65)), 1.0); \n#include <colorspace_fragment>\n }",
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3200, 32, 16), skyMat);
  sky.renderOrder = -1;
  scene.add(sky);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, depthWrite: false, transparent: true, map: canvasTexture(256, 256, (g) => {
    const r = g.createRadialGradient(128, 128, 8, 128, 128, 126);
    r.addColorStop(0, "rgba(255,252,236,1)"); r.addColorStop(0.18, "rgba(255,244,210,0.85)"); r.addColorStop(0.5, "rgba(255,236,190,0.22)"); r.addColorStop(1, "rgba(255,230,180,0)");
    g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  }) }));
  glow.scale.set(900, 900, 1);
  scene.add(glow);

  // § 5 — The valley: one sheet of land with flat facets. Each face is coloured by what it is:
  // snow above the snow line (lower on the winter side), rock on steep slopes and high up, and
  // below that the grass, snow or stubble of its season, lighter on the floor and darker on the hills.
  const terrainGeo = (() => {
    const g = new THREE.PlaneGeometry(2 * EXT_X, 2 * EXT_Z, small ? 120 : 160, small ? 102 : 136);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), z = p.getZ(i);
      // Corners away from the path move a little sideways, so the triangles are not a regular grid
      if (trackDist(x, z) > PATH_W / 2 + 14) { x += (hash(i, 3) - 0.5) * 9; z += (hash(i, 5) - 0.5) * 9; }
      p.setXYZ(i, x, heightAt(x, z), z);
    }
    const flat = g.toNonIndexed();
    flat.computeVertexNormals();
    const fp = flat.attributes.position, n = fp.count, col = new Float32Array(n * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const w = [0, 0, 0, 0], out = new THREE.Color(), mix = new THREE.Color();
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(fp, i); b.fromBufferAttribute(fp, i + 1); c.fromBufferAttribute(fp, i + 2);
      const x = (a.x + b.x + c.x) / 3, y = (a.y + b.y + c.y) / 3, z = (a.z + b.z + c.z) / 3;
      const slope = 1 - Math.abs(e1.subVectors(b, a).cross(e2.subVectors(c, a)).normalize().y), v = Math.floor(hash(i, 11) * 3);
      seasonWeights(x, z, w);
      const snowLine = 300 - 175 * w[0] - 35 * w[1] + (hash(i, 13) - 0.5) * 30;
      if (y > snowLine && slope < 0.6) out.copy(SNOW[v % 2]);
      else if (slope > 0.48 || y > 185) out.copy(slope > 0.66 ? CLIFF : ROCK[v]);
      else {
        const hill = smooth(2, 48, y);
        out.setRGB(0, 0, 0);
        for (let s = 0; s < SEASONS; s++) { mix.copy(GROUND[s].floor[v]).lerp(GROUND[s].hill[v], hill); out.r += mix.r * w[s]; out.g += mix.g * w[s]; out.b += mix.b * w[s]; }
        if (y < -0.8) out.multiplyScalar(0.72); // wet banks of the river
      }
      out.multiplyScalar(0.94 + hash(i, 17) * 0.1);
      for (let k = 0; k < 3; k++) col.set([out.r, out.g, out.b], (i + k) * 3);
    }
    flat.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return flat;
  })();
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // The path: a band of sand following the track, with a darker edge and pebbles on both sides
  const rrect = (hx, hz, r) => {
    const s = new THREE.Shape();
    s.moveTo(-hx + r, -hz); s.lineTo(hx - r, -hz); s.absarc(hx - r, -hz + r, r, -Math.PI / 2, 0, false);
    s.lineTo(hx, hz - r); s.absarc(hx - r, hz - r, r, 0, Math.PI / 2, false);
    s.lineTo(-hx + r, hz); s.absarc(-hx + r, hz - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-hx, -hz + r); s.absarc(-hx + r, -hz + r, r, Math.PI, 1.5 * Math.PI, false);
    return s;
  };
  const band = (w, y, color) => {
    const outer = rrect(TA + w / 2, TB + w / 2, TR + w / 2);
    outer.holes.push(rrect(TA - w / 2, TB - w / 2, TR - w / 2));
    const g = new THREE.ShapeGeometry(outer, 28);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color }));
    m.position.y = y;
    m.receiveShadow = true;
    scene.add(m);
  };
  band(PATH_W + 6, 0.22, 0xCFAE72);
  band(PATH_W, 0.4, 0xF2DDAA);
  {
    const pebbles = [], perimStep = 8.5;
    for (const side of [-1, 1]) {
      const hx = TA + side * (PATH_W / 2 + 2.5), hz = TB + side * (PATH_W / 2 + 2.5), r = TR + side * (PATH_W / 2 + 2.5);
      const pts = rrect(hx, hz, r).getSpacedPoints(Math.round((4 * (hx + hz) - 1.7 * r) / perimStep));
      pts.forEach((p) => { if (rnd() < 0.8 && riverNear(p.x, -p.y).d > 14) pebbles.push([p.x + (rnd() - 0.5) * 2, -p.y + (rnd() - 0.5) * 2]); });
    }
    const im = new THREE.InstancedMesh(rough(new THREE.IcosahedronGeometry(1, 0), 0.5, 3), new THREE.MeshLambertMaterial({ flatShading: true }), pebbles.length);
    pebbles.forEach(([x, z], i) => { const s = 1.3 + rnd() * 1.5; im.setMatrixAt(i, M(x, 0.4, z, s, s * 0.6, s, rnd() * TAU)); im.setColorAt(i, C3(pick(["#B9B4C9", "#D8D4E2", "#9E9AB2", "#F1EEF5"]))); });
    im.receiveShadow = true;
    scene.add(im);
  }

  // § 6 — Water: the river as a strip that follows its bed and a pond, both slightly rippling,
  // and a wooden bridge where the river passes under the path at stone 8
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2FB3EA, roughness: 0.22, metalness: 0.05, flatShading: true, transparent: true, opacity: 0.9, emissive: 0x0E4F80, emissiveIntensity: 0.18 });
  const waterStrips = [];
  {
    const n = river.length, pos = [], idx = [];
    river.forEach((r, i) => {
      const a = river[Math.max(0, i - 1)], b = river[Math.min(n - 1, i + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l, y = r.bed + 2.6;
      pos.push(r.x + nx * r.half, y, r.z + nz * r.half, r.x - nx * r.half, y, r.z - nz * r.half);
      if (i < n - 1) idx.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const strip = new THREE.Mesh(g.toNonIndexed(), waterMat);
    strip.geometry.computeVertexNormals();
    strip.userData.base = strip.geometry.attributes.position.array.slice();
    scene.add(strip);
    waterStrips.push(strip);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r + 1, 18, 0, TAU).toNonIndexed(), waterMat);
    pond.geometry.rotateX(-Math.PI / 2);
    pond.position.set(POND.x, -0.6, POND.z);
    pond.userData.base = pond.geometry.attributes.position.array.slice();
    scene.add(pond);
    waterStrips.push(pond);
    // Reeds round the pond
    const reedGeo = merge([[new THREE.ConeGeometry(0.7, 9, 4), "#5E9E3E", M(0, 4.5, 0)], [new THREE.CylinderGeometry(0.9, 0.9, 2.6, 5), "#8A5A33", M(0, 8, 0)]]);
    const reeds = new THREE.InstancedMesh(reedGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 26);
    for (let i = 0; i < 26; i++) { const a = rnd() * TAU, r = POND.r + 1 + rnd() * 3; reeds.setMatrixAt(i, M(POND.x + Math.cos(a) * r, 0, POND.z + Math.sin(a) * r, 0.8 + rnd() * 0.5, 0.8 + rnd() * 0.6, 0.8 + rnd() * 0.5, rnd() * TAU, (rnd() - 0.5) * 0.3)); }
    shade(reeds);
    scene.add(reeds);
  }
  function ripple(t) {
    waterStrips.forEach((m) => {
      const p = m.geometry.attributes.position, base = m.userData.base;
      for (let i = 0; i < p.count; i++) { const x = base[i * 3], z = base[i * 3 + 2]; p.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 1.7 + x * 0.21 + z * 0.13) * 0.35 + Math.cos(t * 1.3 + z * 0.17) * 0.25; }
      p.needsUpdate = true;
      m.geometry.computeVertexNormals();
    });
  }
  {
    const wood = mat(0xB57A47, { roughness: 0.9 }), dark = mat(0x8A5A33, { roughness: 0.9 }), bridge = new THREE.Group();
    for (let i = 0; i < 9; i++) bridge.add(at(box(43, 1.2, 3.1, i % 2 ? wood : dark), 0, 1.0, -14 + i * 3.5));
    for (const x of [-21.5, 21.5]) {
      for (const z of [-15, 0, 15]) bridge.add(at(rod(0.9, 1.1, 9, dark, 6), x, 4.5, z));
      bridge.add(at(box(1.4, 1.2, 32, wood), x, 8.4, 0), at(box(1.1, 1, 32, wood), x, 4.6, 0));
    }
    bridge.position.set(TA, 0, 0);
    scene.add(shade(bridge, true));
  }

  // § 7 — Stepping stones: low pedestals with the face of each stone drawn as on the flat board
  // (number, flower or diamond, challenge medal, start and finish). The faces turn with the
  // camera so the numbers always read upright. A floating sign shows what a special stone does.
  const C = o.colors, zoneColor = (k) => C[o.zones[Math.floor(k / 8)].key];
  const faces = [];
  const faceText = (g, text, y, px, color) => { g.fillStyle = color; g.font = `900 ${px}px "Arial Black", Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 128, y); };
  o.stones.forEach(([mx, my], k) => {
    const [x, z] = world(mx, my), ev = o.events[k], reto = o.retos.includes(k), start = k === 0;
    const r = start ? 19 : 14.2, color = start ? C.navy : reto ? C.reto : zoneColor(k);
    const ped = rod(ev ? 10.5 : r, (ev ? 10.5 : r) + 1.4, 3.2, mat(new THREE.Color(hexColor(color)).multiplyScalar(0.72)), 12);
    scene.add(shade(at(ped, x, 1.6, z), true));
    const size = ev ? 42 : 2 * r + 5;
    const tex = canvasTexture(256, 256, (g, done) => {
      if (ev) { svgImage(ev.svg, "-21 -21 42 42", 256).then((img) => { if (img) { g.drawImage(img, 0, 0, 256, 256); done(); } }); return; }
      const R0 = 256 * r / size;
      g.fillStyle = hexColor(color); g.beginPath(); g.arc(128, 128, R0, 0, TAU); g.fill();
      g.lineWidth = 9; g.strokeStyle = start ? hexColor(C.reto) : "#FFFFFF"; g.stroke();
      if (start) {
        faceText(g, "SALIDA", 62, 27, "#FFFFFF"); faceText(g, "META", 198, 31, "#FFFFFF");
        iconImage("GiFruitBowl", C.reto).then((img) => { if (img) { g.drawImage(img, 84, 82, 88, 88); done(); } });
      } else if (reto) {
        faceText(g, "RETO", 184, 38, hexColor(C.navy));
        iconImage("GiStarMedal", C.navy).then((img) => { if (img) { g.drawImage(img, 76, 44, 104, 104); done(); } });
      } else faceText(g, String(k), 134, 112, "#FFFFFF");
    });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.08 }));
    face.rotation.x = -Math.PI / 2;
    const turn = new THREE.Group();
    turn.add(face);
    at(turn, x, 3.32, z);
    scene.add(turn);
    faces.push(turn);
  });
  const signs = [];
  Object.entries(o.events).forEach(([k, ev]) => {
    const [x, z] = world(...o.stones[k]), good = ev.delta > 0;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, map: canvasTexture(128, 128, (g) => {
      g.fillStyle = "#FFFFFF"; g.beginPath(); g.arc(64, 64, 60, 0, TAU); g.fill();
      g.fillStyle = hexColor(good ? C.good : C.bad); g.beginPath(); g.arc(64, 64, 51, 0, TAU); g.fill();
      g.fillStyle = "#FFFFFF"; g.font = '900 60px "Arial Black", Arial, sans-serif'; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText((good ? "+" : "−") + Math.abs(ev.delta), 64, 68);
    }) }));
    s.scale.set(12, 12, 1);
    scene.add(at(s, x, 27, z));
    signs.push({ s, phase: rnd() * TAU });
  });
  {
    const [x, z] = world(...o.stones[0]), wood = mat(0x8A5A3B), arch = new THREE.Group();
    arch.add(at(rod(1.8, 2.3, 48, wood, 6), 0, 24, -26), at(rod(1.8, 2.3, 48, wood, 6), 0, 24, 26));
    const banner = box(2.2, 14, 58, mat(0xffffff, { flatShading: false, map: canvasTexture(512, 128, (g) => {
      g.fillStyle = hexColor(C.navy); g.fillRect(0, 0, 512, 128);
      g.strokeStyle = hexColor(C.reto); g.lineWidth = 10; g.strokeRect(5, 5, 502, 118);
      g.fillStyle = "#FFFFFF"; g.font = '900 54px "Arial Black", Arial, sans-serif'; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("SALIDA · META", 256, 68);
    }) }));
    arch.add(at(banner, 0, 48, 0));
    // Little pennants in the four season colours hang from the arch
    o.zones.forEach((zn, i) => { const f = new THREE.Mesh(new THREE.ConeGeometry(2.6, 6, 3), mat(hexColor(C[zn.key]))); f.rotation.x = Math.PI; arch.add(at(f, 0, 38.5, -18 + i * 12)); });
    scene.add(shade(at(arch, x, 0, z)));
  }

  // § 8 — The tree in the middle. Its crown is a few big faceted lumps that change with the
  // season: none in winter (bare branches with snow), pink blossom in spring, green leaves in
  // summer and leaves with ripe fruit at the end of summer. The change grows, it never jumps.
  const tree = new THREE.Group();
  const bark = mat(0x7A4F32, { roughness: 0.95 });
  const moundMat = new THREE.MeshLambertMaterial({ color: 0x8FB36B, flatShading: true });
  const MOUND = [C3("#E8F0F8"), C3("#9FDC7C"), C3("#62B84E"), C3("#C9B456")];
  const mound = new THREE.Mesh(rough(new THREE.SphereGeometry(60, 18, 10), 0.08, 9), moundMat);
  mound.scale.y = 0.15;
  tree.add(shade(mound, true));
  tree.add(at(rod(6.5, 11, 56, bark, 7), 0, 28, 0));
  const tips = [];
  const branch = (from, dir, len, rad, depth) => {
    const to = from.clone().addScaledVector(dir, len);
    const b = rod(rad * 0.62, rad, len, bark, 6);
    b.position.copy(from).add(to).multiplyScalar(0.5);
    b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    tree.add(b);
    if (depth === 0) { tips.push(to); return; }
    for (let i = 0; i < 2; i++) branch(to, dir.clone().add(new THREE.Vector3(rnd() - 0.5, rnd() * 0.5 + 0.1, rnd() - 0.5).multiplyScalar(1.1)).normalize(), len * 0.72, rad * 0.62, depth - 1);
    tips.push(to);
  };
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + rnd() * 0.5; branch(new THREE.Vector3(0, 50 + rnd() * 6, 0), new THREE.Vector3(Math.cos(a) * 0.8, 0.75, Math.sin(a) * 0.8).normalize(), 31, 3.8, 2); }
  branch(new THREE.Vector3(0, 54, 0), new THREE.Vector3(0.05, 1, 0.05).normalize(), 27, 3.8, 2);
  const lumpGeos = [0, 1, 2].map((s) => rough(new THREE.IcosahedronGeometry(1, 1), 0.28, s * 31));
  const leafMats = [0, 1, 2].map(() => new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
  const lumps = [];
  tips.forEach((t, i) => {
    if (i % 2 && i > 6) return; // half of the small tips are enough: big lumps read better than many small ones
    const m = new THREE.Mesh(lumpGeos[i % 3], leafMats[i % 3]), s = 10.5 + rnd() * 6;
    m.position.copy(t).add(new THREE.Vector3((rnd() - 0.5) * 6, 3 + rnd() * 5, (rnd() - 0.5) * 6));
    m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    m.userData.s = s;
    tree.add(m);
    lumps.push(m);
  });
  const scatter = (count, geo, material, place) => {
    const im = new THREE.InstancedMesh(geo, material, count), list = [];
    for (let i = 0; i < count; i++) list.push(place(i));
    im.castShadow = true;
    tree.add(im);
    return { im, list };
  };
  const onCrown = (out) => { const l = pick(lumps), d = new THREE.Vector3(rnd() - 0.5, rnd() - 0.3, rnd() - 0.5).normalize(); return l.position.clone().addScaledVector(d, l.userData.s * out); };
  const blossom = scatter(120, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xFFF5FA, flatShading: true }), () => ({ p: onCrown(0.97), s: 1.6 + rnd() * 1.6 }));
  const fruit = scatter(48, new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xFF7E1C, flatShading: true }), () => { const p = onCrown(0.95); p.y -= 2; return { p, s: 2.6 + rnd() * 1.2 }; });
  const snow = scatter(50, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xFFFFFF, flatShading: true }), (i) => ({ p: tips[i % tips.length].clone().add(new THREE.Vector3(0, 1.4, 0)), s: 3 + rnd() * 2.4, flat: 0.45 }));
  const dummy = new THREE.Object3D();
  const growScatter = (sc, amount) => {
    sc.im.visible = amount > 0.01;
    if (!sc.im.visible) return;
    sc.list.forEach((it, i) => { dummy.position.copy(it.p); dummy.scale.set(it.s * amount, it.s * amount * (it.flat || 1), it.s * amount); dummy.updateMatrix(); sc.im.setMatrixAt(i, dummy.matrix); });
    sc.im.instanceMatrix.needsUpdate = true;
  };
  shade(tree);
  scene.add(tree);
  const LEAF = [["#FFFFFF", "#FFFFFF", "#FFFFFF"], ["#FF9CC2", "#FFB8D3", "#FF85B3"], ["#3DAF4A", "#55C55A", "#2C9842"], ["#4DA846", "#6CBE4E", "#3D9140"]].map((row) => row.map(C3));
  const tmpColor = new THREE.Color();
  function dressTree(w) {
    const leaves = 1 - w[0];
    lumps.forEach((m) => m.scale.setScalar(Math.max(0.001, m.userData.s * (0.25 + 0.75 * leaves) * (leaves > 0.02 ? 1 : 0))));
    leafMats.forEach((m, i) => {
      tmpColor.setRGB(0, 0, 0);
      for (let z = 1; z < 4; z++) { tmpColor.r += LEAF[z][i].r * w[z]; tmpColor.g += LEAF[z][i].g * w[z]; tmpColor.b += LEAF[z][i].b * w[z]; }
      if (leaves > 0.001) m.color.setRGB(tmpColor.r / leaves, tmpColor.g / leaves, tmpColor.b / leaves);
    });
    growScatter(blossom, w[1]); growScatter(fruit, w[3]); growScatter(snow, w[0]);
    moundMat.color.setRGB(0, 0, 0);
    MOUND.forEach((c, z) => { moundMat.color.r += c.r * w[z]; moundMat.color.g += c.g * w[z]; moundMat.color.b += c.b * w[z]; });
  }

  // § 9 — Forests. Several kinds of low poly tree, each one geometry drawn many times at once.
  // On the hills and the lower mountains they grow in clumps; high up only conifers, with snow.
  // The kind of tree follows the season of the slope. Leaves sway in the wind.
  const trunk = (h = 9, r = 1.7) => [new THREE.CylinderGeometry(r * 0.7, r, h, 6), "#7A4E2D", M(0, h / 2, 0)];
  const lump = (r, s0) => rough(new THREE.IcosahedronGeometry(r, 0), 0.32, s0);
  const KINDS = {
    pine: merge([trunk(8, 1.6), [new THREE.ConeGeometry(9.5, 13, 7), "#2D7B56", M(0, 12, 0)], [new THREE.ConeGeometry(7.6, 11, 7), "#348A5F", M(0, 18.5, 0, 1, 1, 1, 0.5)], [new THREE.ConeGeometry(5.2, 9, 7), "#3B9566", M(0, 24, 0, 1, 1, 1, 1)]]),
    snowPine: merge([trunk(8, 1.6), [new THREE.ConeGeometry(9.5, 13, 7), "#2B6E55", M(0, 12, 0)], [new THREE.ConeGeometry(6, 5, 7), "#F4F8FD", M(0, 16.2, 0)],
      [new THREE.ConeGeometry(7.6, 11, 7), "#2F7759", M(0, 18.5, 0, 1, 1, 1, 0.5)], [new THREE.ConeGeometry(4.8, 4.4, 7), "#FFFFFF", M(0, 22.3, 0, 1, 1, 1, 0.5)], [new THREE.ConeGeometry(5.2, 9, 7), "#FFFFFF", M(0, 24, 0, 1, 1, 1, 1)]]),
    bare: merge([trunk(14, 1.7), ...[0, 1, 2, 3].map((i) => [new THREE.CylinderGeometry(0.45, 0.85, 10, 5), "#6E4528", M(Math.cos(i * 1.7) * 3, 16.5, Math.sin(i * 1.7) * 3, 1, 1, 1, i * 1.7, 0, 0.75)]),
      ...[0, 1, 2, 3].map((i) => [lump(2.2, i), "#FFFFFF", M(Math.cos(i * 1.7 + 0.2) * 5.8, 20.5, Math.sin(i * 1.7 + 0.2) * 5.8, 1, 0.5, 1)])]),
    blossom: merge([trunk(10), [lump(8.6, 1), "#FF9CC4", M(0, 16, 0)], [lump(6.4, 2), "#FFB6D2", M(4.2, 13, 2)], [lump(6, 3), "#FF86B5", M(-3.8, 13.5, -2.4)], ...[0, 1, 2, 3, 4].map((i) => [lump(1.1, 9 + i), "#FFFFFF", M(Math.cos(i * 1.3) * 7, 15 + (i % 3) * 3, Math.sin(i * 1.3) * 7)])]),
    round: merge([trunk(10), [lump(8.6, 4), "#58C04F", M(0, 16, 0)], [lump(6.4, 5), "#6ACB58", M(4.2, 13, 2)], [lump(6, 6), "#49AE47", M(-3.8, 13.5, -2.4)]]),
    deep: merge([trunk(10), [lump(8.8, 7), "#2F9A44", M(0, 16, 0)], [lump(6.6, 8), "#3BAA49", M(4.2, 13, 2)], [lump(6.2, 9), "#268A3D", M(-3.8, 13.5, -2.4)]]),
    poplar: merge([trunk(7, 1.4), [lump(4.6, 10), "#4DB24A", M(0, 18, 0, 1, 2.9, 1)]]),
    fruit: merge([trunk(9), [lump(8.4, 11), "#4FA846", M(0, 15, 0)], [lump(6.2, 12), "#62B64C", M(4, 12.5, 2)], ...[0, 1, 2, 3, 4, 5, 6].map((i) => [new THREE.IcosahedronGeometry(1.5, 0), "#FF7A1A", M(Math.cos(i * 0.9) * 7.4, 12 + (i % 3) * 3.4, Math.sin(i * 0.9) * 7.4)])]),
    golden: merge([trunk(10), [lump(8.6, 13), "#F2B33A", M(0, 16, 0)], [lump(6.4, 14), "#E8962B", M(4.2, 13, 2)], [lump(6, 15), "#F6C64E", M(-3.8, 13.5, -2.4)]]),
  };
  const BY_SEASON = [
    [["snowPine", 0.6], ["bare", 0.4]],
    [["blossom", 0.45], ["round", 0.35], ["poplar", 0.2]],
    [["deep", 0.45], ["round", 0.2], ["poplar", 0.2], ["pine", 0.15]],
    [["fruit", 0.4], ["golden", 0.35], ["round", 0.25]],
  ];
  const chooseKind = (w, y, snowLine) => {
    if (y > snowLine - 60) return "snowPine";
    if (y > 120) return w[0] > 0.4 ? "snowPine" : "pine";
    let r = rnd(), z = 0;
    for (; z < 3; z++) { if (r < w[z]) break; r -= w[z]; }
    let q = rnd();
    for (const [k, p] of BY_SEASON[z]) { if (q < p) return k; q -= p; }
    return BY_SEASON[z][0][0];
  };
  // Leaves sway in the wind, and a plant very close to the camera shrinks into the ground so it
  // never hides the path. The shadow pass gets the same change, so no shadow is left behind.
  const PLANT_VERTEX = `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        float sway = max(0.0, transformed.y - 6.0) * 0.016;
        transformed.x += sin(uTime * 1.5 + ip.x * 0.045 + ip.y * 0.03) * sway;
        transformed.z += cos(uTime * 1.2 + ip.y * 0.05) * sway * 0.7;
        transformed *= smoothstep(55.0, 105.0, distance(ip, uEye));
      #endif`;
  const eye = { value: new THREE.Vector2(0, 9999) };
  const plantShader = (sh) => {
    sh.uniforms.uTime = time; sh.uniforms.uEye = eye;
    sh.vertexShader = "uniform float uTime;\nuniform vec2 uEye;\n" + sh.vertexShader.replace("#include <begin_vertex>", PLANT_VERTEX);
  };
  const swayMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  swayMat.onBeforeCompile = plantShader;
  const swayDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  swayDepth.onBeforeCompile = plantShader;
  const plants = { near: {}, far: {} };
  {
    const w = [0, 0, 0, 0];
    const add = (x, z, scale, ring) => {
      const y = heightAt(x, z), sl = Math.abs(heightAt(x + 5, z) - heightAt(x - 5, z)) + Math.abs(heightAt(x, z + 5) - heightAt(x, z - 5));
      seasonWeights(x, z, w);
      const snowLine = 300 - 175 * w[0] - 35 * w[1];
      if (sl > 13 || y > snowLine + 30 || riverNear(x, z).d < 20) return;
      const kind = chooseKind(w, y, snowLine), list = (plants[ring][kind] = plants[ring][kind] || []);
      const c = 0.88 + rnd() * 0.22;
      list.push({ m: M(x, y - 0.5, z, scale, scale * (0.9 + rnd() * 0.25), scale, rnd() * TAU), c });
    };
    const step = small ? 19 : 15;
    for (let gx = -EXT_X + 30; gx < EXT_X - 30; gx += step) for (let gz = -EXT_Z + 30; gz < EXT_Z - 30; gz += step) {
      const x = gx + (rnd() - 0.5) * step * 0.9, z = gz + (rnd() - 0.5) * step * 0.9, d = trackDist(x, z), t = d - FLOOR;
      const clump = fbm(x * 0.0075 + 11, z * 0.0075 - 4, 3);
      if (t > 0) {
        if (clump < 0.43 || rnd() > (t < 40 ? 0.3 : 0.72)) continue;
        add(x, z, 0.85 + rnd() * 0.75, d < 250 ? "near" : "far");
      } else if (Math.abs(d) > PATH_W / 2 + 16 && Math.hypot(x, z) > 82 && Math.hypot(x - POND.x, z - POND.z) > POND.r + 14 && rnd() < 0.045 && clump > 0.45) {
        add(x, z, 0.75 + rnd() * 0.4, "near"); // a few trees dotted over the floor of the valley
      }
    }
  }
  const forests = [];
  for (const ring of ["near", "far"]) {
    for (const [kind, list] of Object.entries(plants[ring])) {
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      const im = new THREE.InstancedMesh(KINDS[kind], swayMat, list.length);
      list.forEach((it, i) => { im.setMatrixAt(i, it.m); im.setColorAt(i, tmpColor.setScalar(it.c)); });
      im.castShadow = ring === "near";
      im.receiveShadow = ring === "near";
      im.customDepthMaterial = swayDepth;
      im.userData.full = list.length;
      scene.add(im);
      forests.push(im);
    }
  }

  // § 10 — Small things on the floor: tufts of grass (snowy in winter, golden at the end of
  // summer), flowers in spring and summer, and rocks along the foot of the hills
  const tuftGeo = merge([0, 1, 2].map((i) => [new THREE.ConeGeometry(0.8, 5.5, 3), "#FFFFFF", M(Math.cos(i * 2.1) * 1.1, 2.6, Math.sin(i * 2.1) * 1.1, 1, 1, 1, 0, Math.cos(i * 2.1) * 0.35, Math.sin(i * 2.1) * 0.35)]));
  const flowerGeo = merge([[new THREE.CylinderGeometry(0.22, 0.22, 4, 4), "#4E9A42", M(0, 2, 0)], [new THREE.IcosahedronGeometry(1.25, 0), "#FFFFFF", M(0, 4.3, 0, 1, 0.65, 1)]]);
  const rockGeo = rough(new THREE.IcosahedronGeometry(1, 0), 0.45, 21);
  const tufts = [], flowers = [], rocks = [];
  {
    const w = [0, 0, 0, 0], FLOWER = ["#FF5C9A", "#FFFFFF", "#FFD23F", "#B57BFF", "#FF8A3D"];
    for (let i = 0; i < (small ? 1500 : 2600); i++) {
      const x = (rnd() - 0.5) * 900, z = (rnd() - 0.5) * 720, d = trackDist(x, z);
      if (Math.abs(d) < PATH_W / 2 + 3 || d > FLOOR + 70 || Math.hypot(x, z) < 64 || riverNear(x, z).d < 13 || Math.hypot(x - POND.x, z - POND.z) < POND.r + 4) continue;
      const y = heightAt(x, z);
      seasonWeights(x, z, w);
      const zone = w.indexOf(Math.max(...w));
      if ((zone === 1 || zone === 2) && rnd() < (zone === 1 ? 0.45 : 0.2)) flowers.push({ m: M(x, y, z, 0.8 + rnd() * 0.6, 0.8 + rnd() * 0.6, 0.8 + rnd() * 0.6, rnd() * TAU), c: C3(pick(FLOWER)) });
      else tufts.push({ m: M(x, y, z, 0.8 + rnd() * 0.7, 0.7 + rnd() * 0.8, 0.8 + rnd() * 0.7, rnd() * TAU), c: GROUND[zone].tuft.clone().multiplyScalar(0.85 + rnd() * 0.25) });
    }
    for (let i = 0; i < (small ? 160 : 260); i++) {
      const a = rnd() * TAU, x = Math.cos(a) * (TA + 80 + rnd() * 420), z = Math.sin(a) * (TB + 80 + rnd() * 340), d = trackDist(x, z);
      if (d < PATH_W / 2 + 10 || riverNear(x, z).d < 16) continue;
      const s = 2.5 + rnd() * (d > FLOOR + 60 ? 9 : 4);
      rocks.push({ m: M(x, heightAt(x, z) - s * 0.25, z, s, s * (0.55 + rnd() * 0.4), s * (0.8 + rnd() * 0.4), rnd() * TAU), c: pick(ROCK).clone() });
    }
  }
  const instanced = (geo, items, material, shadows) => {
    const im = new THREE.InstancedMesh(geo, material, items.length);
    items.forEach((it, i) => { im.setMatrixAt(i, it.m); im.setColorAt(i, it.c); });
    im.castShadow = shadows; im.receiveShadow = true;
    im.userData.full = items.length;
    scene.add(im);
    return im;
  };
  const tuftMesh = instanced(tuftGeo, tufts, swayMat, false);
  const flowerMesh = instanced(flowerGeo, flowers, swayMat, false);
  instanced(rockGeo, rocks, new THREE.MeshLambertMaterial({ flatShading: true }), true);

  // § 11 — Each quarter of the floor is furnished for its season with a few props away from the path
  const free = (x, z) => Math.hypot(x, z) > 74 && trackDist(x, z) < FLOOR - 6 && riverNear(x, z).d > 22 && Math.hypot(x - POND.x, z - POND.z) > POND.r + 10
    && o.stones.every(([mx, my]) => Math.hypot(mx - W / 2 - x, my - H / 2 - z) > 30);
  const QUAD = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
  const spot = (zone) => {
    const [sx, sy] = QUAD[zone];
    for (let i = 0; i < 80; i++) { const x = sx * (16 + rnd() * (TA + FLOOR - 26)), z = sy * (16 + rnd() * (TB + FLOOR - 26)); if (free(x, z)) return [x, z]; }
    return null;
  };
  const PROPS = [
    // winter: a snowman, drifts and a sledge
    () => {
      const g = new THREE.Group(), white = mat(0xFFFFFF, { roughness: 0.95 });
      if (rnd() < 0.4) {
        g.add(at(ball(6, white, 1, 0.92, 1, 9), 0, 5.4, 0), at(ball(4.3, white, 1, 1, 1, 9), 0, 13, 0), at(ball(3.1, white, 1, 1, 1, 8), 0, 19, 0));
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.4, 5), mat(0xFF8A1F)); nose.rotation.x = Math.PI / 2; g.add(at(nose, 0, 19, 3.6));
        g.add(at(rod(2.6, 2.6, 3.4, mat(0x2B2B3A), 8), 0, 22.8, 0), at(rod(4, 4, 0.5, mat(0x2B2B3A), 8), 0, 21.2, 0));
        const scarf = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.8, 5, 10), mat(0xD9385E)); scarf.rotation.x = Math.PI / 2; g.add(at(scarf, 0, 16.4, 0));
        return g;
      }
      return ball(8 + rnd() * 6, white, 1.3, 0.38, 1, 8);
    },
    // spring: beehives and patches of tall flowers
    () => {
      const g = new THREE.Group();
      if (rnd() < 0.5) { const wood = mat(0xF2D08A); [0, 1, 2].forEach((i) => g.add(at(box(9, 4.4, 9, i % 2 ? mat(0xE7BE6A) : wood), 0, 2.4 + i * 4.7, 0))); g.add(at(box(11.5, 1.4, 11.5, mat(0xA0764A)), 0, 15.2, 0)); return g; }
      const cols = [0xFF5C9A, 0xFFFFFF, 0xFFD23F, 0xB57BFF];
      for (let i = 0; i < 10; i++) { const x = (rnd() - 0.5) * 16, z = (rnd() - 0.5) * 16; g.add(at(rod(0.3, 0.3, 6, mat(0x4E9A4A), 4), x, 3, z), at(ball(1.7, mat(cols[i % 4]), 1, 0.6, 1, 6), x, 6.3, z)); }
      return g;
    },
    // summer: sunflowers and a bench of fresh green bushes
    () => {
      const g = new THREE.Group();
      if (rnd() < 0.6) {
        for (let i = 0; i < 4; i++) { const x = (rnd() - 0.5) * 13, z = (rnd() - 0.5) * 13, h = 12 + rnd() * 6; g.add(at(rod(0.5, 0.6, h, mat(0x4E9A4A), 5), x, h / 2, z)); const head = rod(3.6, 3.6, 0.9, mat(0xFFC21A), 10); head.rotation.x = 1.1; g.add(at(head, x, h + 1, z + 0.6)); const eye = rod(1.7, 1.7, 1.1, mat(0x6B4423), 8); eye.rotation.x = 1.1; g.add(at(eye, x, h + 1.1, z + 0.9)); }
        return g;
      }
      const b = new THREE.Mesh(rough(new THREE.IcosahedronGeometry(1, 0), 0.3, 41), mat(0x3FAF4A)); b.scale.set(9 + rnd() * 4, 5.5 + rnd() * 2, 9 + rnd() * 4); b.position.y = 3; return b;
    },
    // late summer: crates of peaches, haystacks and a ladder against nothing in particular
    () => {
      const g = new THREE.Group(), wood = mat(0xC89B62);
      const r = rnd();
      if (r < 0.45) {
        g.add(at(box(13, 5.5, 9.5, wood), 0, 2.75, 0));
        for (let i = 0; i < 8; i++) g.add(at(ball(2.1, mat(i % 3 ? 0xFF8A1F : 0xF0532E), 1, 1, 1, 7), -4.2 + (i % 4) * 2.8, 6.4, -1.7 + Math.floor(i / 4) * 3.4));
        return g;
      }
      if (r < 0.8) { g.add(at(rod(7, 8.5, 9, mat(0xEBC155), 9), 0, 4.5, 0)); const top = new THREE.Mesh(new THREE.ConeGeometry(7.4, 6, 9), mat(0xF2CF67)); g.add(at(top, 0, 12, 0)); return g; }
      [-3, 3].forEach((x) => g.add(at(box(0.9, 26, 0.9, wood), x, 13, 0)));
      for (let i = 0; i < 5; i++) g.add(at(box(6.5, 0.8, 0.8, wood), 0, 4 + i * 4.6, 0));
      g.rotation.x = -0.32;
      return g;
    },
  ];
  const props = [];
  for (let zone = 0; zone < 4; zone++) {
    for (let i = 0; i < 9; i++) {
      const p = spot(zone);
      if (!p) continue;
      const prop = PROPS[zone]();
      prop.position.x += p[0]; prop.position.z += p[1]; prop.position.y += heightAt(p[0], p[1]);
      prop.rotation.y = rnd() * TAU;
      scene.add(shade(prop));
      props.push(prop);
    }
  }
  // A wooden sign with the name of the season beside the outer corner of each quarter
  const boards = o.zones.map((zn, z) => {
    const g = new THREE.Group(), [sx, sy] = QUAD[z], k = (TR + PATH_W / 2 + 18) / Math.SQRT2;
    const x = sx * (TA - TR + k), zz = sy * (TB - TR + k);
    g.add(at(rod(1.1, 1.3, 22, mat(0x8A5A3B), 6), 0, 11, 0));
    const plank = box(48, 14, 1.8, mat(0xffffff, { flatShading: false, map: canvasTexture(512, 144, (c) => {
      c.fillStyle = "#FFFBF0"; c.fillRect(0, 0, 512, 144);
      c.strokeStyle = hexColor(C[zn.key]); c.lineWidth = 14; c.strokeRect(7, 7, 498, 130);
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = hexColor(C[zn.key]); c.font = `900 ${zn.name.length > 10 ? 44 : 56}px "Arial Black", Arial, sans-serif`; c.fillText(zn.name, 256, 56);
      c.fillStyle = hexColor(C.navy); c.font = 'italic 30px "Segoe UI", Arial, sans-serif'; c.fillText(zn.sub, 256, 108);
    }) }));
    g.add(at(plank, 0, 26, 0));
    at(g, x, heightAt(x, zz), zz);
    scene.add(shade(g));
    return g;
  });

  // § 12 — Clouds: little faceted clusters drifting over the hills
  const clouds = [];
  {
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xFFFFFF, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.12 });
    for (let i = 0; i < 13; i++) {
      const g = new THREE.Group(), n = 3 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) { const b = new THREE.Mesh(lumpGeos[j % 3], cloudMat), s = 18 + rnd() * 16; b.scale.set(s * 1.3, s * 0.75, s); b.position.set((j - n / 2) * 22 + rnd() * 8, rnd() * 8, (rnd() - 0.5) * 16); g.add(b); }
      const a = i / 13 * TAU + rnd() * 0.3, d = 620 + rnd() * 520;
      g.position.set(Math.cos(a) * d, 250 + rnd() * 110, Math.sin(a) * d * 0.85);
      scene.add(g);
      clouds.push({ g, a, d, v: 0.003 + rnd() * 0.005, y: g.position.y });
    }
  }

  // § 13 — Weather in the air: four clouds of small sprites, one per season; only the one of the
  // season in the air shows. Snowflakes and petals fall, summer motes drift up, leaves spiral down.
  const dot = (draw) => canvasTexture(64, 64, (g) => draw(g));
  const WEATHER = [
    { n: small ? 200 : 340, size: 5.4, fall: [16, 30], sway: 7, color: 0xFFFFFF, tex: dot((g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 30); r.addColorStop(0, "#fff"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }) },
    { n: small ? 120 : 210, size: 7, fall: [10, 19], sway: 16, color: 0xFFFFFF, tex: dot((g) => { g.translate(32, 32); g.rotate(0.6); g.fillStyle = "#FF9CC2"; g.beginPath(); g.ellipse(0, 0, 26, 14, 0, 0, TAU); g.fill(); g.fillStyle = "#FFE0EC"; g.beginPath(); g.ellipse(-6, -3, 12, 6, 0, 0, TAU); g.fill(); }) },
    { n: small ? 80 : 140, size: 4.4, fall: [-7, -2], sway: 9, color: 0xFFF3B0, tex: dot((g) => { const r = g.createRadialGradient(32, 32, 1, 32, 32, 30); r.addColorStop(0, "#FFFDE0"); r.addColorStop(0.4, "rgba(255,236,140,0.85)"); r.addColorStop(1, "rgba(255,228,110,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }) },
    { n: small ? 70 : 120, size: 8, fall: [12, 22], sway: 20, color: 0xFFFFFF, tex: dot((g) => { g.translate(32, 32); g.rotate(-0.5); g.fillStyle = "#E8892A"; g.beginPath(); g.moveTo(-26, 0); g.quadraticCurveTo(0, -20, 26, 0); g.quadraticCurveTo(0, 20, -26, 0); g.fill(); g.strokeStyle = "#B0601A"; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-24, 0); g.lineTo(24, 0); g.stroke(); }) },
  ].map((cfg) => {
    const pos = new Float32Array(cfg.n * 3), spec = [];
    for (let i = 0; i < cfg.n; i++) {
      pos[i * 3] = (rnd() - 0.5) * 820; pos[i * 3 + 1] = rnd() * 260; pos[i * 3 + 2] = (rnd() - 0.5) * 660;
      spec.push({ v: cfg.fall[0] + rnd() * (cfg.fall[1] - cfg.fall[0]), p: rnd() * TAU, f: 0.5 + rnd() });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: cfg.tex, color: cfg.color, size: cfg.size, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false }));
    pts.frustumCulled = false;
    scene.add(pts);
    return { cfg, pts, pos, spec, n: cfg.n };
  });
  function blow(w, dt, t) {
    WEATHER.forEach((wx, z) => {
      wx.pts.material.opacity = Math.min(1, w[z] * 1.15) * 0.95;
      wx.pts.visible = w[z] > 0.02;
      if (!wx.pts.visible || o.reduced) return;
      const p = wx.pos;
      for (let i = 0; i < wx.n; i++) {
        const s = wx.spec[i];
        p[i * 3 + 1] -= s.v * dt;
        p[i * 3] += Math.sin(t * s.f + s.p) * wx.cfg.sway * dt;
        p[i * 3 + 2] += Math.cos(t * s.f * 0.8 + s.p) * wx.cfg.sway * 0.6 * dt;
        if (p[i * 3 + 1] < 0) p[i * 3 + 1] += 260; else if (p[i * 3 + 1] > 260) p[i * 3 + 1] -= 260;
      }
      wx.pts.geometry.attributes.position.needsUpdate = true;
    });
  }

  // § 14 — Tokens: one small model per team, on a base of the team colour. Each has a tiny
  // movement of its own while it waits (wings, sway, spin), so the valley never stands still.
  const MODEL = {
    GiBee() {
      const g = new THREE.Group(), body = new THREE.Group(), yel = mat(0xFFB800, { roughness: 0.5 }), dark = mat(0x2A2018, { roughness: 0.6 });
      body.add(at(ball(4.6, yel, 1, 0.92, 1.3), 0, 0, -3.2));
      [-1.4, -5].forEach((z) => { const s = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.95, 6, 14), dark); s.scale.y = 0.92; body.add(at(s, 0, 0, z)); });
      const sting = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.8, 6), dark); sting.rotation.x = -Math.PI / 2; body.add(at(sting, 0, 0, -9.8));
      body.add(at(ball(3.5, dark, 1, 0.95, 1), 0, 0.2, 2.5), at(ball(2.9, yel), 0, 0.5, 6.4));
      [-1, 1].forEach((s) => {
        body.add(at(ball(0.95, mat(0xffffff, { roughness: 0.2, flatShading: false }), 1, 1, 1, 10), s * 1.3, 1.2, 8.5), at(ball(0.5, dark, 1, 1, 1, 8), s * 1.35, 1.25, 9.2));
        const ant = rod(0.2, 0.2, 3.4, dark, 5); ant.rotation.set(0.5, 0, -s * 0.35); body.add(at(ant, s * 1, 3.9, 7.6), at(ball(0.5, dark, 1, 1, 1, 6), s * 1.55, 5.4, 8.4));
      });
      const wings = [-1, 1].map((s) => { const pivot = new THREE.Group(); pivot.add(at(ball(1, mat(0xffffff, { transparent: true, opacity: 0.7, roughness: 0.15 }), 4.8, 0.22, 2.6, 10), s * 4.4, 0, 0)); body.add(at(pivot, s * 1.1, 3.2, 1.6)); return pivot; });
      g.add(body);
      g.userData.tick = (t) => { body.position.y = 12.5 + Math.sin(t * 3) * 0.9; body.rotation.z = Math.sin(t * 1.7) * 0.07; wings[0].rotation.z = -0.3 - Math.abs(Math.sin(t * 34)) * 0.75; wings[1].rotation.z = 0.3 + Math.abs(Math.sin(t * 34)) * 0.75; };
      return g;
    },
    GiFlowerEmblem() {
      const g = new THREE.Group(), green = mat(0x4E9A4A), pink = mat(0xFF7FB0, { roughness: 0.55 }), head = new THREE.Group();
      g.add(at(rod(0.8, 1, 12, green, 6), 0, 7.6, 0));
      [[2.6, 5.4, 0.5], [-2.6, 8, -0.5]].forEach(([x, y, r]) => { const l = ball(1, green, 3.3, 0.35, 1.5, 8); l.rotation.z = r; g.add(at(l, x, y, 0)); });
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU, p = ball(1, pink, 3.6, 0.85, 2.5, 10); p.rotation.y = -a; head.add(at(p, Math.cos(a) * 3.9, 0, Math.sin(a) * 3.9)); }
      head.add(at(ball(2.3, mat(0xFFD23F), 1, 0.7, 1, 10), 0, 0.5, 0));
      for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; head.add(at(ball(0.42, mat(0xE68A00), 1, 1, 1, 6), Math.cos(a) * 1.5, 1.9, Math.sin(a) * 1.5)); }
      head.rotation.x = 0.95;
      g.add(at(head, 0, 14.6, 0.6));
      g.userData.tick = (t) => { g.rotation.z = Math.sin(t * 1.5) * 0.07; head.rotation.z = Math.sin(t * 1.1 + 1) * 0.1; };
      return g;
    },
    GiPeach() {
      const g = new THREE.Group(), geo = new THREE.SphereGeometry(6.6, 16, 11), col = new Float32Array(geo.attributes.position.count * 3);
      const a = C3("#FFB347"), b = C3("#F0482A"), c = new THREE.Color(), v = new THREE.Vector3(), d = new THREE.Vector3(0.45, 0.35, 0.82).normalize();
      for (let i = 0; i < geo.attributes.position.count; i++) { v.fromBufferAttribute(geo.attributes.position, i).normalize(); c.copy(a).lerp(b, Math.min(1, Math.max(0, v.dot(d) * 0.8 + 0.35))); col.set([c.r, c.g, c.b], i * 3); }
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }), fruitG = new THREE.Group();
      fruitG.add(at(new THREE.Mesh(geo, skin), -0.9, 0, 0), at(new THREE.Mesh(geo, skin), 0.9, 0, 0));
      fruitG.children.forEach((m) => m.scale.set(0.93, 0.97, 1));
      fruitG.add(at(rod(0.5, 0.65, 2.6, mat(0x6B4423), 5), 0, 6.8, 0));
      const leaf = ball(1, mat(0x4E9A4A), 3.6, 0.3, 1.6, 8); leaf.rotation.z = -0.45; fruitG.add(at(leaf, 3, 7.4, 0));
      g.add(at(fruitG, 0, 8, 0));
      g.userData.tick = (t) => { const s = 1 + Math.sin(t * 2.3) * 0.03; fruitG.scale.set(1 / s, s, 1 / s); fruitG.rotation.y = Math.sin(t * 0.8) * 0.3; };
      return g;
    },
    GiOakLeaf() {
      const g = new THREE.Group(), half = [[1.4, 0.4], [3, 1.6], [3.8, 3], [2.7, 3.7], [4.6, 5.2], [5, 6.8], [3.5, 7.2], [4.9, 9], [4.4, 10.8], [2.9, 10.9], [3.4, 12.6], [2.2, 14], [1, 14.6], [0, 15.6]];
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.splineThru(half.map(([x, y]) => new THREE.Vector2(x, y)));
      sh.splineThru(half.slice(0, -1).reverse().map(([x, y]) => new THREE.Vector2(-x, y)).concat([new THREE.Vector2(0, 0)]));
      const leafGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.9, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, bevelSegments: 1, curveSegments: 4 });
      leafGeo.translate(0, 0, -0.45);
      leafGeo.scale(1.25, 1.25, 1.25);
      const big = new THREE.Mesh(leafGeo, mat(0x34A24A, { roughness: 0.6 })), little = new THREE.Mesh(leafGeo, mat(0x5CC05A, { roughness: 0.6 }));
      big.add(at(rod(0.32, 0.5, 18, mat(0x2B6E37), 5), 0, 9.2, 0.9));
      big.rotation.x = -0.22;
      little.scale.setScalar(0.6); little.rotation.set(-0.2, 0.9, -0.55); little.position.set(-2.6, 0.4, 1);
      const sprig = new THREE.Group();
      sprig.add(big, little, at(rod(0.5, 0.7, 3.4, mat(0x6B4423), 5), 0, -1.5, 0));
      g.add(at(sprig, 0, 5.2, 0));
      g.userData.tick = (t) => { sprig.rotation.z = Math.sin(t * 1.4) * 0.1; sprig.rotation.y = Math.sin(t * 0.7) * 0.25; };
      return g;
    },
    GiSnowflake2() {
      // Ice blue rather than white, so the flake still shows against the snow of its own season
      const g = new THREE.Group(), ice = mat(0x9ED3FA, { roughness: 0.12, metalness: 0.15, emissive: 0x3F8FCB, emissiveIntensity: 0.35 }), flake = new THREE.Group();
      flake.scale.setScalar(1.22);
      for (let i = 0; i < 6; i++) {
        const arm = new THREE.Group();
        arm.add(at(box(1.2, 8.6, 1.2, ice), 0, 4.5, 0));
        [-1, 1].forEach((s) => { const barb = box(0.95, 3.4, 0.95, ice); barb.rotation.z = s * 0.95; arm.add(at(barb, s * 1.35, 5.6, 0)); const tip = box(0.85, 2.2, 0.85, ice); tip.rotation.z = s * 0.95; arm.add(at(tip, s * 0.85, 7.9, 0)); });
        arm.rotation.z = i / 6 * TAU;
        flake.add(arm);
      }
      const hub = rod(2.1, 2.1, 1.5, ice, 6); hub.rotation.x = Math.PI / 2; flake.add(hub);
      g.add(at(flake, 0, 15.5, 0));
      g.userData.tick = (t) => { flake.rotation.y = t * 0.9; flake.position.y = 15.5 + Math.sin(t * 2) * 0.8; };
      return g;
    },
    GiAlmond() {
      const g = new THREE.Group(), prof = [[0, 0], [2.3, 0.6], [4, 2.4], [4.7, 5], [4.4, 8], [3.3, 11], [1.7, 13.2], [0, 14.4]].map(([r, y]) => new THREE.Vector2(r, y)), nut = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 12), mat(0xD9A86C, { roughness: 0.9 }));
      shell.scale.z = 0.62;
      const hull = new THREE.Mesh(new THREE.LatheGeometry(prof, 9, 0, Math.PI), mat(0x8FB060, { roughness: 0.95, side: THREE.DoubleSide }));
      hull.scale.set(1.2, 1.04, 0.95); hull.rotation.y = Math.PI / 2; hull.position.set(0, -0.3, -0.5);
      nut.add(shell, hull);
      for (let i = 0; i < 5; i++) { const groove = new THREE.Mesh(new THREE.TorusGeometry(1.2 + i * 0.6, 0.12, 3, 10, Math.PI), mat(0xB98C55)); groove.position.set(0, 3 + i * 1.9, 1.9 - Math.abs(i - 2) * 0.25); groove.scale.y = 1.6; nut.add(groove); }
      nut.rotation.z = 0.22;
      g.add(at(nut, 0, 1.8, 0));
      g.userData.tick = (t) => { nut.rotation.z = 0.22 + Math.sin(t * 1.3) * 0.08; nut.rotation.y = Math.sin(t * 0.6) * 0.3; };
      return g;
    },
  };
  const pawn = (color) => { const g = new THREE.Group(), m = mat(color, { roughness: 0.35 }); g.add(at(rod(2.6, 5.2, 13, m, 10), 0, 8, 0), at(ball(4.6, m), 0, 17.5, 0)); g.userData.tick = () => {}; return g; };
  const ringGeo = new THREE.RingGeometry(9.6, 12, 32);
  const tokens = new Map();
  function makeToken(it) {
    const g = new THREE.Group(), model = (MODEL[it.icon] || (() => pawn(hexColor(it.color))))();
    const base = rod(8.2, 8.8, 1.7, mat(hexColor(it.color), { roughness: 0.45 }), 16);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(8.4, 0.5, 5, 16), mat(0xFFFFFF));
    rim.rotation.x = Math.PI / 2;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    model.position.y = 1.7;
    g.add(at(base, 0, 0.85, 0), at(rim, 0, 1.7, 0), model, at(ring, 0, 0.3, 0));
    shade(g);
    ring.castShadow = false;
    g.position.set(it.x - W / 2, 3.3, it.y - H / 2);
    scene.add(g);
    return { g, model, ring, hop: null, active: false, mine: false, focus: false, zone: 0, face: 0 };
  }
  let lead = null; // the token the camera and the weather follow
  function setTokens(list, ms) {
    const present = new Set();
    lead = null;
    list.forEach((it) => {
      present.add(it.id);
      let tk = tokens.get(it.id);
      if (!tk) { tk = makeToken(it); tokens.set(it.id, tk); }
      Object.assign(tk, { active: !!it.active, mine: !!it.mine, focus: !!it.focus, zone: it.zone || 0 });
      if (it.focus && !lead) lead = tk;
      const x = it.x - W / 2, z = it.y - H / 2, s = it.r / 7.2 * 1.3, p = tk.g.position, goal = tk.hop ? tk.hop.to : [p.x, p.z];
      if (Math.abs(goal[0] - x) > 0.05 || Math.abs(goal[1] - z) > 0.05) {
        if (ms > 0 && !o.reduced) tk.hop = { from: [p.x, p.z], to: [x, z], t: 0, dur: ms / 1000, s0: tk.g.scale.x, s1: s };
        else { tk.hop = null; p.set(x, 3.3, z); tk.g.scale.setScalar(s); }
      } else if (!tk.hop) tk.g.scale.setScalar(s);
    });
    tokens.forEach((tk, id) => { if (!present.has(id)) { scene.remove(tk.g); tokens.delete(id); } });
    if (!lead && tokens.size) lead = tokens.values().next().value;
  }

  // § 15 — Camera. "path" stands just behind the token that matters and looks ahead along the
  // stones, with the tree to one side and the mountains beyond, so playing feels like walking
  // round the year; "whole" shows the whole floor of the valley from above. Dragging turns,
  // the wheel or two fingers zoom, and a double tap undoes both.
  const view = { mode: "path", turn: 0, tilt: 0, zoom: 1 };
  const cam = { theta: 0, phi: 0.9, dist: 700, tx: 0, tz: 0, ty: 10 };
  let touched = 0, fitDist = 700, started = false;
  function place(c) {
    const sp = Math.sin(c.phi), cp = Math.cos(c.phi);
    camera.position.set(c.tx + c.dist * sp * Math.sin(c.theta), c.ty + c.dist * cp, c.tz + c.dist * sp * Math.cos(c.theta));
    camera.lookAt(c.tx, c.ty, c.tz);
    camera.updateMatrixWorld();
  }
  // The whole view frames the floor of the valley and the foot of the hills around it
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a * (TA + 125), 0, b * (TB + 100)));
  const PATH_FOV = 52, WHOLE_FOV = 42;
  // On an upright screen the whole view turns a quarter and looks more from above, so the long
  // side of the track runs up the screen and no mountain stands between the camera and the valley
  const wholeAngles = () => (camera.aspect < 0.85 ? { theta: Math.PI / 2, phi: 0.48, tz: 0 } : { theta: 0, phi: 0.76, tz: 40 });
  function fit() {
    const v = new THREE.Vector3(), wa = wholeAngles();
    let lo = 200, hi = 6000;
    camera.fov = WHOLE_FOV; camera.updateProjectionMatrix();
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      place({ theta: wa.theta, phi: wa.phi, dist: mid, tx: 0, tz: wa.tz, ty: 10 });
      if (corners.every((c) => { v.copy(c).project(camera); return Math.abs(v.x) < 0.94 && Math.abs(v.y) < 0.9; })) hi = mid; else lo = mid;
    }
    return hi;
  }
  const near = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return a + d; };
  function goal() {
    const narrow = camera.aspect < 0.85;
    if (view.mode === "whole" || !lead) { const wa = wholeAngles(); return { theta: wa.theta + view.turn, phi: Math.max(0.15, Math.min(1.25, wa.phi + view.tilt)), dist: fitDist * view.zoom, tx: 0, tz: wa.tz, ty: 10, fov: WHOLE_FOV }; }
    const p = lead.g.position, far = Math.hypot(p.x, p.z) || 1;
    // "out" points away from the tree and "on" along the way the tokens walk (clockwise). The
    // camera is low enough for the far hills, the mountains and some sky to fill the top of the view.
    const ox = p.x / far, oz = p.z / far, nx = -oz, nz = ox;
    return {
      theta: Math.atan2(-nx * 0.82 + ox * 0.57, -nz * 0.82 + oz * 0.57) + view.turn, phi: Math.max(0.4, Math.min(1.45, 1.36 + view.tilt)),
      dist: (narrow ? 300 : 240) * view.zoom, tx: p.x + nx * 52 - ox * 34, tz: p.z + nz * 52 - oz * 34, ty: 28, fov: PATH_FOV,
    };
  }

  // § 16 — Detail level. "alta" for desktops, "media" for phones and "baja" for slow devices:
  // it sets the resolution, the shadows and how many trees, tufts and particles are drawn.
  // On "auto" the valley starts from what the screen suggests and steps down if it runs slowly.
  const TIERS = { alta: { pr: 2, shadow: 2048, plants: 1, small: 1, wx: 1 }, media: { pr: 1.5, shadow: 1024, plants: 0.6, small: 0.55, wx: 0.6 }, baja: { pr: 1, shadow: 0, plants: 0.35, small: 0.25, wx: 0.35 } };
  const ORDER = ["alta", "media", "baja"];
  const auto = !o.quality || o.quality === "auto";
  let tier = auto ? (small || (navigator.hardwareConcurrency || 4) <= 4 ? "media" : "alta") : o.quality;
  function applyTier() {
    const T = TIERS[tier];
    renderer.setPixelRatio(Math.min(dpr, T.pr));
    const shadows = T.shadow > 0;
    if (shadows) { sun.shadow.mapSize.set(T.shadow, T.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    if (renderer.shadowMap.enabled !== shadows) { renderer.shadowMap.enabled = shadows; scene.traverse((c) => { if (c.material) [].concat(c.material).forEach((m) => { m.needsUpdate = true; }); }); }
    sun.castShadow = shadows;
    forests.forEach((im) => { im.count = Math.round(im.userData.full * T.plants); });
    [tuftMesh, flowerMesh].forEach((im) => { im.count = Math.round(im.userData.full * T.small); });
    WEATHER.forEach((wx) => { wx.n = Math.round(wx.cfg.n * T.wx); wx.pts.geometry.setDrawRange(0, wx.n); });
    resize();
  }
  const perf = { frames: 0, time: 0, wait: 2 };

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitDist = fit();
    if (!started) { started = true; const g = goal(); Object.assign(cam, g); camera.fov = g.fov; }
    camera.updateProjectionMatrix();
  }

  // § 17 — Every frame: hops and idle moves of the tokens, the season in the air, water, wind,
  // clouds, camera, and the measure of how fast the device draws
  const air = [1, 0, 0, 0];
  let raf = 0, last = 0, clock = 0;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const mixC = (key, out) => { out.setRGB(0, 0, 0); AIR.forEach((a, z) => { out.r += a[key].r * air[z]; out.g += a[key].g * air[z]; out.b += a[key].b * air[z]; }); return out; };
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!host.clientWidth || document.hidden) { last = 0; return; }
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016), real = last ? (now - last) / 1000 : 0;
    last = now; clock += dt; time.value = clock;
    let mover = null;
    tokens.forEach((tk) => {
      const p = tk.g.position;
      let facing = cam.theta;
      if (tk.hop) {
        const hp = tk.hop;
        hp.t = Math.min(1, hp.t + dt / hp.dur);
        const e = ease(hp.t);
        p.x = hp.from[0] + (hp.to[0] - hp.from[0]) * e;
        p.z = hp.from[1] + (hp.to[1] - hp.from[1]) * e;
        p.y = 3.3 + Math.sin(Math.PI * hp.t) * 11;
        tk.g.scale.setScalar(hp.s0 + (hp.s1 - hp.s0) * e);
        facing = Math.atan2(hp.to[0] - hp.from[0], hp.to[1] - hp.from[1]);
        if (!mover || tk.focus) mover = tk;
        if (hp.t >= 1) { tk.hop = null; p.y = 3.3; }
      }
      tk.face = near(tk.face, facing);
      tk.face += (facing - tk.face) * Math.min(1, dt * 7);
      tk.model.rotation.y = tk.face;
      if (!o.reduced) tk.model.userData.tick(clock + tk.g.id);
      const m = tk.ring.material;
      if (tk.active) { m.color.set(0xF9B000); m.opacity = 0.6 + 0.4 * Math.sin(now / 160); }
      else if (tk.mine) { m.color.set(0xFFFFFF); m.opacity = 0.95; }
      else m.opacity = 0;
    });
    if (mover) lead = mover;
    // Season in the air: the one of the lead token, reached little by little
    const target = lead ? lead.zone : 0, k = 1 - Math.exp(-dt * 1.6);
    let changed = false;
    for (let z = 0; z < 4; z++) { const want = z === target ? 1 : 0; if (Math.abs(want - air[z]) > 0.002) { air[z] += (want - air[z]) * k; changed = true; } else air[z] = want; }
    if (changed || clock < 0.1) {
      dressTree(air);
      mixC("top", skyMat.uniforms.top.value); mixC("low", skyMat.uniforms.low.value); scene.fog.color.copy(skyMat.uniforms.low.value);
      mixC("sun", sun.color); mixC("sky", hemi.color); mixC("gnd", hemi.groundColor);
      sun.intensity = AIR.reduce((s, a, z) => s + a.sunI * air[z], 0);
      hemi.intensity = AIR.reduce((s, a, z) => s + a.hemiI * air[z], 0);
    }
    blow(air, dt, clock);
    if (!o.reduced) ripple(clock);
    signs.forEach((sg) => { sg.s.position.y = 27 + Math.sin(clock * 2 + sg.phase) * 1.6; });
    clouds.forEach((c) => { c.a += c.v * dt; c.g.position.x = Math.cos(c.a) * c.d; c.g.position.z = Math.sin(c.a) * c.d * 0.85; c.g.position.y = c.y + Math.sin(clock * 0.3 + c.a * 5) * 4; });
    const g = goal(), ck = 1 - Math.exp(-dt * (now - touched < 500 ? 22 : 2.6));
    g.theta = near(cam.theta, g.theta);
    for (const key of ["theta", "phi", "dist", "tx", "tz", "ty"]) cam[key] += (g[key] - cam[key]) * ck;
    if (Math.abs(camera.fov - g.fov) > 0.05) { camera.fov += (g.fov - camera.fov) * ck; camera.updateProjectionMatrix(); }
    place(cam);
    // The sky follows the camera; the sun glow and the shadow area follow what the camera looks at
    sky.position.copy(camera.position);
    glow.position.copy(camera.position).addScaledVector(SUN_DIR, 2600);
    sun.target.position.set(cam.tx * 0.6, 0, cam.tz * 0.6);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 800);
    eye.value.set(camera.position.x, camera.position.z);
    props.forEach((pr) => { pr.visible = Math.hypot(pr.position.x - camera.position.x, pr.position.z - camera.position.z) > 70; });
    boards.forEach((b) => { b.visible = view.mode === "whole" || Math.hypot(b.position.x - camera.position.x, b.position.z - camera.position.z) > 150; });
    faces.forEach((f) => { f.rotation.y = cam.theta; });
    boards.forEach((b) => { b.rotation.y = cam.theta; });
    renderer.render(scene, camera);
    // Slow device: after a settling time, if frames take longer than 1/25 s, one step less detail
    if (auto && real > 0 && real < 0.5) {
      perf.time += real; perf.frames++;
      if (perf.time > perf.wait + 2) {
        if (perf.frames / perf.time < 25 && tier !== "baja") { tier = ORDER[ORDER.indexOf(tier) + 1]; applyTier(); }
        perf.frames = 0; perf.time = 0; perf.wait = 0;
      }
    }
  }

  // § 18 — Pointer control, and a plain tap on a special stone explains it (as on the flat board)
  const el = renderer.domElement, pts = new Map();
  let pinch = 0, down = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -3.3), hit = new THREE.Vector3();
  function tapStone(e) {
    const r = el.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    const mx = hit.x + W / 2, my = hit.z + H / 2;
    let best = -1, bd = 17;
    o.stones.forEach(([sx, sy], i) => { const d = Math.hypot(sx - mx, sy - my); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && o.onStone) o.onStone(best);
  }
  const zoom = (f) => { view.zoom = Math.max(0.45, Math.min(1.8, view.zoom * f)); touched = performance.now(); };
  el.addEventListener("pointerdown", (e) => {
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) down = { t: performance.now(), moved: 0 };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); down = null; }
  });
  el.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) {
      if (down) down.moved += Math.abs(dx) + Math.abs(dy);
      if (!down || down.moved > 6) { view.turn -= dx * 0.006; view.tilt = Math.max(-0.7, Math.min(0.5, view.tilt - dy * 0.005)); touched = performance.now(); }
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
  el.addEventListener("dblclick", () => { view.turn = 0; view.tilt = 0; view.zoom = 1; touched = performance.now(); });
  el.addEventListener("webglcontextlost", (e) => { e.preventDefault(); cancelAnimationFrame(raf); if (o.onFail) o.onFail(); });

  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(host);
  applyTier();
  dressTree(air);
  raf = requestAnimationFrame(frame);
  return {
    setTokens, resize,
    // "path" walks with the tokens, "whole" shows the floor of the valley; returns the mode now in use
    setView(mode) { view.mode = mode === "whole" ? "whole" : "path"; view.turn = 0; view.tilt = 0; view.zoom = 1; return view.mode; },
    getView: () => view.mode,
    getQuality: () => tier,
  };
}
