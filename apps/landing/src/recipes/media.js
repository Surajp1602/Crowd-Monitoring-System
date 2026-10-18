// Living media: wires generated stills and loops (public/media/media.json from tools/film.mjs)
// into any element with data-media="<name>". Stills get a responsive srcset; loops play only in view.
export async function loadMediaManifest(url = '/media/media.json') {
  try { const r = await fetch(url); return r.ok ? await r.json() : {}; } catch { return {}; }
}

export function livingMedia(el, manifest) {
  const name = el.dataset.media;
  const entry = manifest[name];
  const box = el.querySelector('.case__media') || el;
  const img = box.querySelector('img');
  const video = box.querySelector('video');
  if (!entry) { box.classList.add('is-empty'); return; }
  if (img && entry.still) {
    img.srcset = entry.still.widths.map((w) => `/media/${name}-${w}.webp ${w}w`).join(', ');
    img.sizes = '(max-width: 820px) 84vw, min(42vw, 640px)';
    img.src = `/media/${name}.jpg`;
    img.decoding = 'async';
    img.loading = 'lazy';
  }
  if (video && entry.loop && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    video.poster = `/media/${name}-poster.jpg`;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        if (!video.src) video.src = `/media/${name}-loop.${entry.webm && !video.canPlayType('video/mp4; codecs="avc1.640028"') ? 'webm' : 'mp4'}`;
        video.play().then(() => box.classList.add('is-playing')).catch(() => {});
      } else if (video.src) { video.pause(); }
    }, { threshold: 0.25 });
    io.observe(el);
  }
}
