// Confeti: lluvia de papelitos en un lienzo que no estorba los toques. Sin librerías.
export function confetti({ colors, count = 150, duration = 4200 } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {};
  const cs = getComputedStyle(document.documentElement);
  const palette = colors || [cs.getPropertyValue('--accent'), cs.getPropertyValue('--partner'), cs.getPropertyValue('--ovul'), cs.getPropertyValue('--fertile'), cs.getPropertyValue('--period'), '#ffffff']
    .map((c) => c.trim()).filter(Boolean);
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:70';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  document.body.appendChild(cv);
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const rnd = (a, b) => a + Math.random() * (b - a);
  // la mitad sale en dos chorros desde abajo y la otra mitad cae desde arriba
  const ps = Array.from({ length: count }, (_, i) => {
    const burst = i % 2 === 0;
    const side = i % 4 === 0 ? 0 : 1;
    return {
      x: burst ? (side ? W * 0.9 : W * 0.1) : rnd(0, W),
      y: burst ? H * 0.95 : rnd(-H * 0.4, -10),
      vx: burst ? (side ? rnd(-9, -3) : rnd(3, 9)) : rnd(-1.5, 1.5),
      vy: burst ? rnd(-19, -11) : rnd(1.5, 4.5),
      w: rnd(6, 11),
      h: rnd(4, 8),
      r: rnd(0, Math.PI * 2),
      vr: rnd(-0.25, 0.25),
      c: palette[Math.floor(Math.random() * palette.length)],
      round: Math.random() < 0.3,
      sway: rnd(0, Math.PI * 2),
    };
  });
  const t0 = performance.now();
  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    cv.remove();
  };
  const frame = (now) => {
    const t = now - t0;
    if (t > duration) { stop(); return; }
    g.clearRect(0, 0, W, H);
    const fade = t > duration - 900 ? Math.max(0, (duration - t) / 900) : 1;
    g.globalAlpha = fade;
    for (const p of ps) {
      p.vy += 0.32;
      p.vx *= 0.99;
      p.vy *= 0.992;
      p.sway += 0.08;
      p.x += p.vx + Math.sin(p.sway) * 0.6;
      p.y += p.vy;
      p.r += p.vr;
      if (p.y > H + 20) continue;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.fillStyle = p.c;
      if (p.round) { g.beginPath(); g.arc(0, 0, p.h / 1.6, 0, Math.PI * 2); g.fill(); } else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return stop;
}
