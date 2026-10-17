// Density terrain: the CCD signature moment.
//
// A station floor (60 x 40 m) whose surface height is crowd density in people per square metre. Crowd
// groups drift along the concourse; each group lifts a Gaussian hill and carries its own people (points).
// Contours of equal density are drawn in the fragment shader with fwidth(), so lines stay one pixel wide
// at any distance; levels at and above `hot` turn amber. `setTilt(0..1)` moves the camera from an oblique
// view to straight overhead while the terrain flattens into the operator's 2D isoline plan.
//
// One shader, one points cloud, one line set for walls. Pauses off-screen; static under reduced motion.
import * as THREE from 'three';

const W = 60;
const D = 40;
const GROUPS = 9;
const PEOPLE = 420;
const HEIGHT = 4.4; // world metres per person/m²: exaggerated relief so crowds read as hills

// The demo station's concourse walls (floor metres, origin south-west), as in the product's demo seed.
const WALLS = [
  [0, 0, 24, 0], [36, 0, 60, 0], [0, 40, 20, 40], [40, 40, 60, 40], [0, 0, 0, 40], [60, 0, 60, 10], [60, 30, 60, 40],
  [0, 26, 10, 26], [14, 26, 14, 40], [46, 6, 46, 14], [46, 22, 46, 34],
];

const vert = /* glsl */ `
  uniform vec4 uHills[${GROUPS}];
  uniform float uFlat;
  varying float vH;
  varying vec2 vXZ;
  float density(vec2 p) {
    float h = 0.0;
    for (int i = 0; i < ${GROUPS}; i++) {
      vec2 d = p - uHills[i].xy;
      h += uHills[i].z * exp(-dot(d, d) / (2.0 * uHills[i].w * uHills[i].w));
    }
    return h;
  }
  // Relief is compressed above 1.5 p/m² so a surge reads as a peak, not a spire; contours and colour
  // still use the true density.
  float relief(float h) { return h < 1.5 ? h : 1.5 + (h - 1.5) * 0.3; }
  void main() {
    vec3 p = position;
    vH = density(p.xz);
    vXZ = p.xz;
    p.y = relief(vH) * ${HEIGHT.toFixed(2)} * (1.0 - uFlat);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uInk2;
  uniform vec3 uPaper;
  uniform vec3 uAmber;
  uniform float uHot;
  uniform float uFlat;
  varying float vH;
  varying vec2 vXZ;
  float lineAt(float value, float step) {
    float v = value / step;
    float f = abs(fract(v - 0.5) - 0.5) / fwidth(v);
    return 1.0 - clamp(f, 0.0, 1.0);
  }
  void main() {
    // Ground: ink, warming very slightly with density so hills read before their lines do.
    // Height shading: the slope of the field lights the hills as if from the north-west.
    vec2 grad = vec2(dFdx(vH), dFdy(vH)) / max(fwidth(vXZ.x), 1e-4);
    float shade = clamp(0.5 - 0.35 * (grad.x - grad.y), 0.0, 1.0);
    vec3 col = mix(uInk, uInk2, smoothstep(0.0, 1.2, vH) * (0.6 + 0.8 * shade));
    // 5 m survey grid, fading out on the hills.
    vec2 g = abs(fract(vXZ / 5.0 - 0.5) - 0.5) / fwidth(vXZ / 5.0);
    float grid = (1.0 - clamp(min(g.x, g.y), 0.0, 1.0)) * (1.0 - smoothstep(0.1, 0.6, vH));
    col = mix(col, uPaper, grid * 0.06);
    // Isolines every 0.5 p/m², brighter with height; the top contours turn amber.
    float iso = lineAt(vH, 0.25) * smoothstep(0.04, 0.2, vH);
    float hot = step(uHot, vH);
    vec3 lineCol = mix(uPaper, uAmber, hot);
    float alpha = mix(0.32 + 0.55 * smoothstep(0.2, 2.0, vH), 1.0, hot);
    col = mix(col, lineCol, iso * alpha);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const relief = (h) => (h < 1.5 ? h : 1.5 + (h - 1.5) * 0.3);

function rand(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export function createTerrain(canvas, { reduced = false, tilt = 0, seed = 17, offsetX = -15 } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch {
    canvas.closest('[data-terrain-root]')?.classList.add('no-webgl');
    return null;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x0c0e0d, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0c0e0d, 70, 150);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 400);

  // ---- crowd model ----
  const r = rand(seed);
  const groups = Array.from({ length: GROUPS }, (_, i) => ({
    // Each group follows a slow loop through the concourse.
    cx: 8 + r() * 44, cz: 6 + r() * 28,
    ax: 4 + r() * 10, az: 2 + r() * 6, speed: 0.04 + r() * 0.06, phase: r() * Math.PI * 2,
    size: 22 + r() * 28, sigma: 2.2 + r() * 1.8, hot: i === 0,
  }));
  const people = Array.from({ length: PEOPLE }, (_, i) => ({ g: i % GROUPS, ox: 0, oz: 0, r: r(), a: r() * Math.PI * 2 }));

  const hillUniform = Array.from({ length: GROUPS }, () => new THREE.Vector4());
  const toWorld = (x, z) => [x - W / 2, -(z - D / 2)];

  const uniforms = {
    uHills: { value: hillUniform },
    uFlat: { value: 0 },
    uHot: { value: 1.9 },
    uInk: { value: new THREE.Color('#101311') },
    uInk2: { value: new THREE.Color('#2a2e29') },
    uPaper: { value: new THREE.Color('#ece8de') },
    uAmber: { value: new THREE.Color('#f2a93b') },
  };
  const plane = new THREE.PlaneGeometry(W, D, 240, 160);
  plane.rotateX(-Math.PI / 2);
  const surface = new THREE.Mesh(plane, new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms }));
  scene.add(surface);

  const wallPos = [];
  for (const [x1, z1, x2, z2] of WALLS) {
    const [a, b] = toWorld(x1, z1);
    const [c, d] = toWorld(x2, z2);
    wallPos.push(a, 0.02, b, c, 0.02, d);
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  const walls = new THREE.LineSegments(wallGeo, new THREE.LineBasicMaterial({ color: 0xece8de, transparent: true, opacity: 0.55 }));
  scene.add(walls);

  const pts = new Float32Array(PEOPLE * 3);
  const cols = new Float32Array(PEOPLE * 3);
  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  pointGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const points = new THREE.Points(pointGeo, new THREE.PointsMaterial({ size: 0.42, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.95 }));
  scene.add(points);

  const paper = new THREE.Color('#ece8de');
  const amber = new THREE.Color('#f2a93b');

  function densityAt(x, z) {
    let h = 0;
    for (const v of hillUniform) {
      const dx = x - v.x;
      const dz = z - v.y;
      h += v.z * Math.exp(-(dx * dx + dz * dz) / (2 * v.w * v.w));
    }
    return h;
  }

  function simulate(t) {
    // The hot group swells into a surge every ~22 s, then disperses: the moment the amber contour appears.
    const surge = 0.5 - 0.5 * Math.cos((t / 22) * Math.PI * 2);
    groups.forEach((g, i) => {
      const k = t * g.speed + g.phase;
      const x = g.cx + Math.cos(k) * g.ax;
      const z = g.cz + Math.sin(k * 1.3) * g.az;
      // Always just over the threshold (peak ≈ 2 p/m²), swelling to ≈ 3.5 at the top of each surge.
      const size = g.hot ? 50 + 40 * surge * surge : g.size;
      const sigma = g.hot ? 2.0 - 0.3 * surge : g.sigma;
      const [wx, wz] = toWorld(x, z);
      // Gaussian hill integrating to `size` people: peak = size / (2π σ²).
      hillUniform[i].set(wx, wz, size / (2 * Math.PI * sigma * sigma), sigma);
      g.wx = wx; g.wz = wz; g.sizeNow = size; g.sigmaNow = sigma;
    });
    let n = 0;
    for (const p of people) {
      const g = groups[p.g];
      const share = Math.min(1, g.sizeNow / 90);
      const visible = p.r < share * 1.6 || !g.hot;
      // People sit within their group's spread, jittering as if walking in place.
      const rad = g.sigmaNow * 1.4 * Math.sqrt(p.r);
      const ang = p.a + t * 0.25 * (p.r - 0.5);
      const x = g.wx + Math.cos(ang) * rad;
      const z = g.wz + Math.sin(ang) * rad;
      const h = densityAt(x, z);
      pts[n * 3] = visible ? x : 9999;
      pts[n * 3 + 1] = relief(h) * HEIGHT * (1 - uniforms.uFlat.value) + 0.35;
      pts[n * 3 + 2] = z;
      const c = g.hot && h >= uniforms.uHot.value * 0.9 ? amber : paper;
      cols[n * 3] = c.r; cols[n * 3 + 1] = c.g; cols[n * 3 + 2] = c.b;
      n++;
    }
    pointGeo.attributes.position.needsUpdate = true;
    pointGeo.attributes.color.needsUpdate = true;
  }

  // ---- camera: oblique terrain (0) to overhead plan (1) ----
  const oblique = new THREE.Vector3(-30, 30, 46);
  const overhead = new THREE.Vector3(0, 78, 0.01);
  let tiltValue = tilt;
  const framing = new THREE.Vector3(0, 0, 0);
  let drift = 0;
  function placeCamera() {
    const t = tiltValue * tiltValue * (3 - 2 * tiltValue);
    const pos = oblique.clone().lerp(overhead, t);
    // A slow orbit while oblique; none overhead.
    const yaw = drift * (1 - t);
    pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    // On wide screens the copy sits left, so aim left of centre and the floor lands on the right.
    const target = framing.clone().multiplyScalar(1 - t);
    camera.position.copy(pos.add(target));
    camera.lookAt(target);
    uniforms.uFlat.value = THREE.MathUtils.smoothstep(tiltValue, 0.45, 0.95);
    points.material.size = 0.42 + 0.25 * t;
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole floor in frame on portrait screens.
    camera.fov = w / h < 1 ? 52 : 34;
    framing.set(w > 900 ? offsetX : 0, 0, 0);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !reduced) loop(); }, { rootMargin: '100px' });
  io.observe(canvas);

  let raf = 0;
  const start = performance.now();
  function frame(now) {
    const t = reduced ? 9 : (now - start) / 1000;
    drift = reduced ? 0 : Math.sin(t * 0.05) * 0.12;
    simulate(t);
    placeCamera();
    renderer.render(scene, camera);
  }
  function loop() {
    cancelAnimationFrame(raf);
    const tick = (now) => {
      if (!visible) return;
      frame(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  frame(performance.now());
  if (!reduced) loop();

  return {
    setTilt(v) {
      tiltValue = Math.min(1, Math.max(0, v));
      if (reduced) frame(performance.now());
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      renderer.dispose();
    },
  };
}
