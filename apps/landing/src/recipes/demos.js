// Agent demos: chat transcripts that play message by message, and step flows that tick through.
// Plays when the panel is visible; restarts when its tab is selected. Reduced motion shows everything.
import { reducedMotion } from './ui.js';

export function playDemo(panel) {
  const demo = panel.querySelector('[data-demo]');
  if (!demo) return () => {};
  const items = [...demo.children];
  let timers = [];
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const reset = () => { clear(); items.forEach((el) => el.classList.remove('is-in', 'is-done', 'is-active')); };
  if (reducedMotion()) { items.forEach((el) => el.classList.add('is-in', 'is-done')); return () => {}; }

  const run = () => {
    reset();
    if (demo.dataset.demo === 'flow') {
      items.forEach((el, i) => {
        timers.push(setTimeout(() => { el.classList.add('is-active'); }, 350 + i * 900));
        timers.push(setTimeout(() => { el.classList.remove('is-active'); el.classList.add('is-done'); }, 350 + i * 900 + 700));
      });
    } else {
      let t = 300;
      items.forEach((el) => {
        const words = el.textContent.split(/\s+/).length;
        timers.push(setTimeout(() => el.classList.add('is-in'), t));
        t += el.dataset.from === 'user' ? 900 : 600 + words * 55;
      });
    }
  };
  return run;
}

export function demos(root) {
  const panels = [...root.querySelectorAll('[role="tabpanel"]')];
  const runners = new Map(panels.map((p) => [p, playDemo(p)]));
  let started = false;
  // Watch the demo boxes themselves (a tall section may never be 35% visible on a phone).
  const io = new IntersectionObserver((entries) => {
    if (started || !entries.some((e) => e.isIntersecting)) return;
    started = true;
    io.disconnect();
    runners.get(panels.find((p) => !p.hidden))?.();
  }, { threshold: 0.2 });
  root.querySelectorAll('[data-demo]').forEach((d) => io.observe(d));
  root.addEventListener('tabs:change', (e) => { if (started) runners.get(e.detail.panel)?.(); });
}
