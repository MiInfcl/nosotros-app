// Preferencias de este teléfono (no se sincronizan con tu pareja): descargas automáticas, galería,
// avisos, citas en el calendario del teléfono y colores del calendario. Guardadas en localStorage.
const KEY = 'parejas-prefs';

export const DL_KINDS = [['image', 'Fotos'], ['gif', 'GIF'], ['video', 'Videos'], ['audio', 'Audios']];

const DEFAULTS = {
  // Descarga automática de los archivos del chat, por tipo y por tipo de conexión.
  dl: {
    image: { wifi: true, data: true },
    gif: { wifi: true, data: false },
    video: { wifi: false, data: false },
    audio: { wifi: true, data: true },
  },
  hd: false, // fotos en HD (1440p, 400 KB) por defecto; si no, 1080p y 300 KB
  instant: true, // aviso casi al instante (servicio en segundo plano, solo Android)
  widgetTitles: true, // los widgets muestran el nombre de los eventos
  gallery: false, // guardar en la galería las fotos y videos del chat
  notify: true, // avisos de mensajes nuevos
  meetToCal: true, // poner las citas en el calendario del teléfono
  colors: {}, // colores del calendario elegidos (clave → #rrggbb)
  disguise: null, // «Ocultar la app»: nosotros|calc|notas|reloj|calendario|clima (null = sin elegir)
};

let cur = load();
const listeners = [];

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  return normalize(saved);
}

/** Completa lo que falte con los valores por defecto (sirve para lo guardado aquí y lo que llega del servidor). */
function normalize(saved) {
  saved = saved && typeof saved === 'object' ? saved : {};
  const dl = {};
  for (const [k] of DL_KINDS) dl[k] = { ...DEFAULTS.dl[k], ...(saved.dl?.[k] || {}) };
  return {
    dl,
    hd: saved.hd ?? DEFAULTS.hd,
    instant: saved.instant ?? DEFAULTS.instant,
    widgetTitles: saved.widgetTitles ?? DEFAULTS.widgetTitles,
    gallery: saved.gallery ?? DEFAULTS.gallery,
    notify: saved.notify ?? DEFAULTS.notify,
    meetToCal: saved.meetToCal ?? DEFAULTS.meetToCal,
    colors: { ...(saved.colors || {}) },
    disguise: typeof saved.disguise === 'string' ? saved.disguise : DEFAULTS.disguise,
  };
}

function save(silent = false) {
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch {}
  if (!silent) listeners.forEach((fn) => { try { fn(cur); } catch {} });
}

export const Prefs = {
  get: () => cur,
  /** Avisa cuando cambia algo (para guardar los ajustes en el servidor). */
  onChange: (fn) => listeners.push(fn),
  /** Cambia todo de una vez (ajustes que llegan del servidor). No avisa a los oyentes. */
  replace(obj) {
    cur = normalize(obj);
    save(true);
  },
  /** Cambia una descarga automática: kind = 'image'|'gif'|'video'|'audio', net = 'wifi'|'data'. */
  setDl(kind, net, on) {
    cur = { ...cur, dl: { ...cur.dl, [kind]: { ...cur.dl[kind], [net]: !!on } } };
    save();
  },
  set(patch) {
    cur = { ...cur, ...patch };
    save();
  },
  setColor(key, hex) {
    const colors = { ...cur.colors };
    if (hex) colors[key] = hex;
    else delete colors[key];
    cur = { ...cur, colors };
    save();
  },
};
