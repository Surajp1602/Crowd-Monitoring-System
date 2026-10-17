// Orbit hub: a gold core (the brand mark, extruded) with N labelled system nodes on a tilted ring.
// Data pulses travel from every node into the core. Pairs with a list: hovering either side highlights both.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

// Lighting: three's RoomEnvironment (a neutral photo studio) plus a graduated softbox behind the camera,
// baked to PMREM. Flat metal faces mirror that gradient, so the mark reads as polished gold bar stock
// rather than flat paint; a warm key and rim add the highlights.
function gradientPanel(w, h, stops, intensity) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), lg = g.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([o, col]) => lg.addColorStop(o, col));
  g.fillStyle = lg; g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(intensity, intensity, intensity), side: THREE.DoubleSide }));
}
function studioLighting(renderer, scene) {
  const env = new RoomEnvironment();
  // The mark faces the camera tilted down, so its faces mirror the space low in front of it: put the softbox there.
  const box = gradientPanel(26, 16, [[0, '#f6f2e8'], [0.4, '#c9c4b6'], [0.72, '#4a4d47'], [1, '#0c0e0d']], 1.8);
  box.position.set(0, -6.5, 8.5); box.lookAt(0, 0, 0); env.add(box);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.035).texture;
  pm.dispose();
  scene.environmentIntensity = 0.9;
  const key = new THREE.DirectionalLight(0xf4efe4, 2.0); key.position.set(-4, 5, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xf2a93b, 1.6); rim.position.set(5, 2, -4); scene.add(rim);
}

// A gentle "pillow" normal map: flat faces curve by a few degrees, so reflections sweep across them
// like cast and polished metal instead of sitting there as one flat colour.
function pillowNormalMap(size = 128, k = 0.9) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x / (size - 1) - 0.5) * 2, v = (y / (size - 1) - 0.5) * 2;
    let nx = u * k * 0.5, ny = v * k * 0.5, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = (nz * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createOrbitHub(canvas, { nodes = [], markShapes, onHover } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  studioLighting(renderer, scene);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 1.6, 10.5);
  camera.lookAt(0, 0, 0);

  const root = new THREE.Group();
  root.rotation.x = 0.32;
  scene.add(root);

  const pillow = pillowNormalMap();
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xd9d4c8, metalness: 0.15, roughness: 0.72, clearcoat: 0.5, clearcoatRoughness: 0.12, normalMap: pillow, normalScale: new THREE.Vector2(1, 1) });

  // Core: the brand mark extruded, or a sphere if no shapes are provided.
  const core = new THREE.Group();
  if (markShapes?.length) {
    const geo = new THREE.ExtrudeGeometry(markShapes, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.055, bevelSegments: 8, curveSegments: 4 });
    geo.center();
    // Front/back UVs are shape coordinates; map the mark's bounds onto the pillow map.
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
    const mesh = new THREE.Mesh(geo, gold);
    mesh.scale.setScalar(0.82);
    core.add(mesh);
  } else {
    core.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 8), gold));
  }
  root.add(core);

  // Halo around the core
  const halo = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.37, 128), new THREE.MeshBasicMaterial({ color: 0xf2a93b, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  halo.rotation.x = Math.PI / 2;
  root.add(halo);

  // Orbit ring
  const R = 3.3;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.006, 8, 256), new THREE.MeshBasicMaterial({ color: 0xf2a93b, transparent: true, opacity: 0.45 }));
  ring.rotation.x = Math.PI / 2;
  root.add(ring);

  const nodeGroup = new THREE.Group();
  root.add(nodeGroup);
  const nodeMeshes = [];
  const pulses = [];
  const lineMat = new THREE.LineBasicMaterial({ color: 0xf2a93b, transparent: true, opacity: 0.22 });
  const pulseGeo = new THREE.SphereGeometry(0.035, 12, 12);
  nodes.forEach((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2;
    const pos = new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R);
    const node = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 24), new THREE.MeshPhysicalMaterial({ color: 0xece8de, metalness: 0, roughness: 0.9, emissive: 0x000000, emissiveIntensity: 0 }));
    node.position.copy(pos);
    node.userData.index = i;
    nodeGroup.add(node);
    nodeMeshes.push(node);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pos, new THREE.Vector3(0, 0, 0)]), lineMat);
    nodeGroup.add(line);
    for (let k = 0; k < 2; k++) {
      const p = new THREE.Mesh(pulseGeo, new THREE.MeshBasicMaterial({ color: 0xf6c46a, transparent: true }));
      p.userData = { from: pos.clone(), t: (k * 0.5 + i * 0.13) % 1, speed: 0.18 + (i % 3) * 0.04 };
      nodeGroup.add(p);
      pulses.push(p);
    }
  });

  // HTML labels projected onto the canvas
  const labelLayer = document.createElement('div');
  labelLayer.className = 'orbit-labels';
  labelLayer.setAttribute('aria-hidden', 'true');
  Object.assign(labelLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  canvas.parentElement.appendChild(labelLayer);
  const labels = nodes.map((n) => {
    const el = document.createElement('span');
    el.textContent = n.label;
    Object.assign(el.style, { position: 'absolute', left: '0', top: '0', fontSize: '0.8rem', fontWeight: '600', color: '#ece8de', whiteSpace: 'nowrap', transform: 'translate(-50%, -160%)', transition: 'color .3s, opacity .3s', letterSpacing: '-0.005em' });
    labelLayer.appendChild(el);
    return el;
  });

  let hot = -1;
  const setHot = (i) => {
    hot = i;
    nodeMeshes.forEach((m, k) => { m.material.emissiveIntensity = k === i ? 1.2 : 0.15; m.scale.setScalar(k === i ? 1.6 : 1); });
    labels.forEach((l, k) => { l.style.color = k === i ? '#f2a93b' : '#ece8de'; l.style.opacity = i === -1 || k === i ? '1' : '0.45'; });
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(9, 9);
  const target = { x: 0, y: 0 };
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    target.x = pointer.x; target.y = pointer.y;
  });
  canvas.addEventListener('pointerleave', () => { pointer.set(9, 9); target.x = 0; target.y = 0; if (hot !== -1) { setHot(-1); onHover?.(-1); } });

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Narrow canvases (phones): pull the camera back so the ring and its labels stay inside the frame.
    const pull = w < 640 ? 1.6 : 1.12;
    camera.position.set(0, 1.6 * pull, 10.5 * pull);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  let visible = false, raf = 0, last = performance.now();
  const v = new THREE.Vector3();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    root.rotation.y += dt * 0.12;
    root.rotation.x += ((0.32 - target.y * 0.12) - root.rotation.x) * 0.05;
    core.rotation.y = -root.rotation.y * 0.6 + target.x * 0.3;
    for (const p of pulses) {
      p.userData.t = (p.userData.t + dt * p.userData.speed) % 1;
      const t = p.userData.t;
      p.position.copy(p.userData.from).multiplyScalar(1 - t);
      p.material.opacity = Math.sin(t * Math.PI);
    }
    // hover picking
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(nodeMeshes, false)[0];
    const hi = hit ? hit.object.userData.index : -1;
    if (hi !== hot && pointer.x < 5) { setHot(hi); onHover?.(hi); }
    // labels
    const w = canvas.clientWidth, h = canvas.clientHeight;
    nodeMeshes.forEach((m, k) => {
      m.getWorldPosition(v);
      const depth = v.z;
      v.project(camera);
      labels[k].style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -170%)`;
      if (hot === -1) labels[k].style.opacity = depth < -1.5 ? '0.35' : '1';
    });
    renderer.render(scene, camera);
  }
  const loop = () => { raf = 0; if (!visible) return; frame(performance.now()); raf = requestAnimationFrame(loop); };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) { last = performance.now(); loop(); } }, { rootMargin: '100px' }).observe(canvas);

  return { highlight: setHot, renderOnce: () => frame(performance.now()) };
}

// Build THREE.Shapes from simple polygon lists (brand mark as clean polygons, y up).
export function shapesFromPolygons(polys, scale = 1) {
  return polys.map((pts) => {
    const s = new THREE.Shape();
    pts.forEach(([x, y], i) => (i ? s.lineTo(x * scale, y * scale) : s.moveTo(x * scale, y * scale)));
    s.closePath();
    return s;
  });
}

// Build THREE.Shapes from the traced logo SVG (tools/brand.mjs output or any single-colour SVG),
// centred and scaled so the larger side is `size` world units, y flipped to 3D "up".
export async function shapesFromSvg(url, size = 2.7) {
  const text = await fetch(url).then((r) => r.text());
  const shapes = new SVGLoader().parse(text).paths.flatMap((p) => SVGLoader.createShapes(p));
  if (!shapes.length) return [];
  const box = new THREE.Box2();
  const parts = shapes.map((sh) => sh.extractPoints(12));
  parts.forEach((e) => e.shape.forEach((p) => box.expandByPoint(p)));
  const c = box.getCenter(new THREE.Vector2());
  const k = size / Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
  const tf = (pts) => pts.map((p) => new THREE.Vector2((p.x - c.x) * k, -(p.y - c.y) * k));
  return parts.map((e) => { const ns = new THREE.Shape(tf(e.shape)); ns.holes = e.holes.map((h) => new THREE.Path(tf(h))); return ns; });
}
