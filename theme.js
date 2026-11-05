/* Tema de la app (script clásico: se carga en <head> para que no haya parpadeo de colores).
   Modo: 'system' | 'light' | 'dark'. Color de énfasis: una clave de ACCENTS.
   Se guarda en este teléfono (localStorage), no en la nube. */
(function () {
  var KEY = 'parejas-theme';
  var ACCENTS = {
    rosa: { name: 'Rosa', h: 347, light: '#e11d48', dark: '#fb5b7d', pl: '#0369a1', pd: '#38bdf8' },
    violeta: { name: 'Violeta', h: 262, light: '#7c3aed', dark: '#a78bfa', pl: '#b45309', pd: '#fbbf24' },
    azul: { name: 'Azul', h: 221, light: '#2563eb', dark: '#60a5fa', pl: '#c2410c', pd: '#fb923c' },
    turquesa: { name: 'Turquesa', h: 173, light: '#0f766e', dark: '#2dd4bf', pl: '#be185d', pd: '#f472b6' },
    naranja: { name: 'Naranja', h: 21, light: '#c2410c', dark: '#fb923c', pl: '#1d4ed8', pd: '#60a5fa' },
    verde: { name: 'Verde', h: 142, light: '#15803d', dark: '#4ade80', pl: '#6d28d9', pd: '#a78bfa' },
  };
  var listeners = [];
  var prefs = { mode: 'system', accent: 'rosa' };

  try {
    var saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && (saved.mode === 'system' || saved.mode === 'light' || saved.mode === 'dark')) prefs.mode = saved.mode;
    if (saved && ACCENTS[saved.accent]) prefs.accent = saved.accent;
  } catch (e) {}

  function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    var a = s * Math.min(l, 1 - l);
    var f = function (n) {
      var k = (n + h / 30) % 12;
      var c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  function isDark() {
    if (prefs.mode === 'dark') return true;
    if (prefs.mode === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function apply() {
    var A = ACCENTS[prefs.accent];
    var dark = isDark();
    var h = A.h;
    var v = dark
      ? {
          bg: hslToHex(h, 30, 8), surface: hslToHex(h, 26, 12), surface2: hslToHex(h, 24, 17), line: hslToHex(h, 22, 23),
          text: hslToHex(h, 55, 95), muted: hslToHex(h, 14, 72), accent: A.dark, ink: hslToHex(h, 50, 8),
          partner: A.pd, shadow: 'none',
        }
      : {
          bg: hslToHex(h, 100, 97), surface: '#ffffff', surface2: hslToHex(h, 85, 93), line: hslToHex(h, 55, 86),
          text: hslToHex(h, 40, 11), muted: hslToHex(h, 14, 38), accent: A.light, ink: '#ffffff',
          partner: A.pl, shadow: '0 1px 2px rgba(60,30,40,.08), 0 6px 18px rgba(60,30,40,.07)',
        };
    var s = document.documentElement.style;
    s.setProperty('--bg', v.bg);
    s.setProperty('--surface', v.surface);
    s.setProperty('--surface2', v.surface2);
    s.setProperty('--line', v.line);
    s.setProperty('--text', v.text);
    s.setProperty('--muted', v.muted);
    s.setProperty('--accent', v.accent);
    s.setProperty('--accent-ink', v.ink);
    s.setProperty('--me', v.accent);
    s.setProperty('--partner', v.partner);
    s.setProperty('--shadow', v.shadow);
    // la tarjeta principal usa siempre el tono oscuro del color (el texto blanco se lee bien)
    s.setProperty('--hero1', A.light);
    s.setProperty('--hero2', 'color-mix(in srgb, ' + A.light + ' 76%, #000)');
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    s.colorScheme = dark ? 'dark' : 'light';
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', v.bg);
    var info = { dark: dark, bg: v.bg, accent: v.accent };
    listeners.forEach(function (fn) { try { fn(info); } catch (e) {} });
    return info;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  window.Theme = {
    ACCENTS: ACCENTS,
    get: function () { return { mode: prefs.mode, accent: prefs.accent }; },
    set: function (patch) {
      if (patch.mode === 'system' || patch.mode === 'light' || patch.mode === 'dark') prefs.mode = patch.mode;
      if (ACCENTS[patch.accent]) prefs.accent = patch.accent;
      save();
      return apply();
    },
    /** Color de una muestra en el tema actual. */
    swatch: function (key) { return isDark() ? ACCENTS[key].dark : ACCENTS[key].light; },
    onChange: function (fn) { listeners.push(fn); },
    isDark: isDark,
    current: function () { var cs = getComputedStyle(document.documentElement); return { dark: isDark(), bg: cs.getPropertyValue('--bg').trim(), accent: cs.getPropertyValue('--accent').trim() }; },
    apply: apply,
  };

  apply();
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var again = function () { if (prefs.mode === 'system') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', again);
    else if (mq.addListener) mq.addListener(again);
  }
})();
