// Contour art for elements with data-contour="<seed>": isolines of a seeded density field, rendered once
// as inline SVG. Same marching-squares maths as the product's floor plan, so every image on the page is
// made of the thing the product measures. data-contour-hot marks the highest level in amber.
const COLS = 72;
const ROWS = 48;
const LEVELS = [0.35, 0.7, 1.1, 1.6, 2.2, 2.9];

function rng(seed) {
  let s = seed % 2147483647 || 7;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function field(seed, hills) {
  const r = rng(seed);
  const hs = Array.from({ length: hills }, (_, i) => ({
    x: 6 + r() * (COLS - 12), y: 5 + r() * (ROWS - 10), a: i === 0 ? 3.4 : 0.8 + r() * 1.6, s: 4 + r() * 6,
  }));
  const g = new Float32Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    let v = 0;
    for (const h of hs) v += h.a * Math.exp(-((x - h.x) ** 2 + (y - h.y) ** 2) / (2 * h.s * h.s));
    g[y * COLS + x] = v;
  }
  return g;
}

function isoPath(g, level) {
  const at = (x, y) => g[y * COLS + x];
  const seg = [];
  const lerp = (a, b) => (a === b ? 0.5 : (level - a) / (b - a));
  for (let y = 0; y < ROWS - 1; y++) for (let x = 0; x < COLS - 1; x++) {
    const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), d = at(x, y + 1);
    const code = (a >= level) | ((b >= level) << 1) | ((c >= level) << 2) | ((d >= level) << 3);
    if (code === 0 || code === 15) continue;
    const T = [x + lerp(a, b), y], R = [x + 1, y + lerp(b, c)], B = [x + lerp(d, c), y + 1], L = [x, y + lerp(a, d)];
    const pairs = {
      1: [[L, T]], 14: [[L, T]], 2: [[T, R]], 13: [[T, R]], 3: [[L, R]], 12: [[L, R]], 4: [[R, B]], 11: [[R, B]],
      6: [[T, B]], 9: [[T, B]], 7: [[L, B]], 8: [[L, B]], 5: [[L, T], [R, B]], 10: [[T, R], [L, B]],
    }[code];
    for (const [p, q] of pairs) seg.push(`M${p[0].toFixed(2)} ${p[1].toFixed(2)}L${q[0].toFixed(2)} ${q[1].toFixed(2)}`);
  }
  return seg.join('');
}

export function contourArt(el) {
  const seed = Number(el.dataset.contour) || 11;
  const g = field(seed, 6);
  const paths = LEVELS.map((level, i) => {
    const hot = i === LEVELS.length - 1 && el.hasAttribute('data-contour-hot');
    const stroke = hot ? 'var(--accent)' : `rgba(236, 232, 222, ${0.12 + i * 0.07})`;
    return `<path d="${isoPath(g, level)}" fill="none" stroke="${stroke}" stroke-width="${hot ? 1.6 : 1}" vector-effect="non-scaling-stroke"/>`;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${COLS - 1} ${ROWS - 1}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${paths}</svg>`;
}
