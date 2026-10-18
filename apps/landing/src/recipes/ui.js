// Small, dependency-light UI behaviours shared by every Juried site.
import gsap from 'gsap';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Accessible tabs: click, arrow keys, Home/End. Emits `tabs:change` on the container.
export function tabs(root) {
  const list = [...root.querySelectorAll('[role="tab"]')];
  const panels = list.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  const select = (i, focus = false) => {
    list.forEach((t, k) => {
      const on = k === i;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
      if (on) { panels[k].classList.remove('is-entering'); void panels[k].offsetWidth; panels[k].classList.add('is-entering'); }
    });
    if (focus) list[i].focus();
    root.dispatchEvent(new CustomEvent('tabs:change', { detail: { index: i, panel: panels[i] } }));
  };
  list.forEach((t, i) => {
    t.addEventListener('click', () => select(i));
    t.addEventListener('keydown', (e) => {
      const n = list.length;
      const k = { ArrowRight: (i + 1) % n, ArrowDown: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, ArrowUp: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
      if (k !== undefined) { e.preventDefault(); select(k, true); }
    });
  });
  return { select };
}

// Infinite logo marquee: duplicate the list once so translateX(-50%) loops seamlessly.
export function marquee(root) {
  const track = root.querySelector('.marquee__track');
  [...track.children].forEach((li) => { const c = li.cloneNode(true); c.setAttribute('aria-hidden', 'true'); c.querySelectorAll('img').forEach((im) => (im.alt = '')); track.appendChild(c); });
}

// Count-up numbers ("80%", "$5.1M", "10k+", "99.9%") when they scroll into view. Keeps prefix/suffix.
export function countUp(el) {
  const raw = el.textContent.trim();
  const m = raw.match(/^([^\d]*)([\d.,]+)(.*)$/);
  if (!m || reducedMotion()) return;
  const [, pre, num, post] = m;
  const target = parseFloat(num.replace(/,/g, ''));
  const decimals = (num.split('.')[1] || '').length;
  const fmt = (v) => pre + (num.includes(',') ? v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals)) + post;
  const obj = { v: 0 };
  // The real value stays in the DOM until the number scrolls into view (screenshots, crawlers and no-JS all
  // see it). When counting starts, the box is locked to the final width so nothing around it shifts.
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    const w = el.getBoundingClientRect().width;
    if (getComputedStyle(el).display === 'inline') el.style.display = 'inline-block';
    el.style.minWidth = `${Math.ceil(w)}px`;
    el.style.fontVariantNumeric = 'tabular-nums'; // steady digits while counting; proportional once settled
    gsap.to(obj, { v: target, duration: 0.9, ease: 'power3.out', onUpdate: () => { el.textContent = fmt(obj.v); }, onComplete: () => { el.textContent = raw; el.style.fontVariantNumeric = ''; } });
  }, { threshold: 0.6 });
  io.observe(el);
}

// Magnetic buttons: a few pixels of pull toward the pointer. Pointer devices only.
export function magnetic(el, strength = 0.25) {
  if (!window.matchMedia('(pointer: fine)').matches || reducedMotion()) return;
  const xTo = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3' });
  const yTo = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3' });
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    xTo((e.clientX - r.left - r.width / 2) * strength);
    yTo((e.clientY - r.top - r.height / 2) * strength);
  });
  el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
}

// Only one <details> open at a time, with a height animation.
export function accordion(root) {
  const items = [...root.querySelectorAll('details')];
  items.forEach((d) => {
    const s = d.querySelector('summary');
    s.addEventListener('click', (e) => {
      if (reducedMotion()) return;
      e.preventDefault();
      if (d.open) {
        const h = d.offsetHeight;
        gsap.fromTo(d, { height: h }, { height: s.offsetHeight, duration: 0.45, ease: 'power3.inOut', onComplete: () => { d.open = false; d.style.height = ''; } });
      } else {
        items.forEach((o) => { if (o !== d && o.open) { o.open = false; } });
        const start = d.offsetHeight;
        d.open = true;
        const end = d.scrollHeight;
        gsap.fromTo(d, { height: start }, { height: end, duration: 0.55, ease: 'power3.out', onComplete: () => (d.style.height = '') });
      }
    });
  });
}

// Third-party embeds (chat widgets, schedulers) sometimes inject images without alt text, which fails
// accessibility checks on your page. For a short while after load, give such images an accessible name:
// `label`, else the nearest aria-label/title, else mark them decorative.
export function patchEmbedAlts({ selector = 'img:not([alt])', label, duration = 30000 } = {}) {
  const fix = () => document.querySelectorAll(selector).forEach((img) => {
    if (img.hasAttribute('alt')) return;
    const named = img.closest('[aria-label],[title]');
    img.setAttribute('alt', label || named?.getAttribute('aria-label') || named?.getAttribute('title') || '');
  });
  fix();
  const id = setInterval(fix, 1000);
  setTimeout(() => clearInterval(id), duration);
}
