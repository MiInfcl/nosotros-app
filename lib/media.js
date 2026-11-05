// Fotos, videos y GIFs del chat. Firebase Storage exige plan de pago, así que los archivos se guardan
// en Firestore troceados en documentos de ~900 KB (ver store.js). Aquí: preparación y utilidades.
export const CHUNK = 900000; // bytes por documento (Firestore admite 1 MiB por documento)
export const LIMITS = { image: 25 * 1024 * 1024, gif: 10 * 1024 * 1024, video: 15 * 1024 * 1024, audio: 6 * 1024 * 1024 };
export const AUDIO_MAX_SECONDS = 300;
/** Días que un archivo del chat queda en el servidor; después se borra (lo ya descargado se queda en cada teléfono). */
export const MEDIA_KEEP_DAYS = 15;
/** Fotos: caben en una caja (1920x1080 normal, 2560x1440 HD, vertical u horizontal) y pesan menos que el tope. */
export const PHOTO = {
  std: { long: 1920, short: 1080, bytes: 300_000 },
  hd: { long: 2560, short: 1440, bytes: 400_000 },
};
const THUMB_MAX_SIDE = 240;

/** 'image' | 'gif' | 'video' | 'audio' | null según el tipo del archivo. */
export function kindOf(file) {
  const t = file?.type || '';
  if (t === 'image/gif') return 'gif';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  return null;
}

/** Tamaño reducido para que el lado mayor no pase de `max` (sin agrandar). */
export function fitSize(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Reduce para que quepa en una caja de `longMax` x `shortMax` (en cualquier orientación), sin agrandar. */
export function fitBox(w, h, longMax, shortMax) {
  const k = Math.min(1, longMax / Math.max(w, h), shortMax / Math.min(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Rangos [desde, hasta) para trocear `total` bytes en pedazos de `size`. */
export function chunkRanges(total, size = CHUNK) {
  const out = [];
  for (let i = 0; i < total; i += size) out.push([i, Math.min(total, i + size)]);
  return out;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Texto corto para listas, avisos y respuestas: «Foto», «Video»… o el texto del mensaje. */
export function previewOf(m) {
  if (m?.deleted) return 'Mensaje eliminado';
  const label = { image: 'Foto', gif: 'GIF', video: 'Video', audio: 'Audio' }[m?.type];
  const text = (m?.text || '').trim();
  if (m?.once && label) return `${label} de una sola vez`;
  if (label) return text ? `${label}: ${text}` : label;
  return text;
}

function toBlob(canvas, type, quality) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo procesar la imagen'))), type, quality));
}

function drawToCanvas(source, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source.drawable || source, 0, 0, w, h);
  return c;
}

let webpOk;
/** ¿Este WebView sabe guardar WebP? (si no, canvas devolvería PNG, que pesa mucho más) */
function canWebp() {
  if (webpOk === undefined) webpOk = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
  return webpOk;
}

/**
 * Codifica la foto en WebP (JPEG si no hay WebP): busca la mayor calidad que quepa en `profile.bytes`;
 * si ni con la calidad mínima cabe, reduce un poco la resolución y vuelve a intentar.
 */
async function encodePhoto(source, sw, sh, profile) {
  const type = canWebp() ? 'image/webp' : 'image/jpeg';
  let { w, h } = fitBox(sw, sh, profile.long, profile.short);
  let last = null;
  for (let round = 0; round < 8; round++) {
    const canvas = drawToCanvas(source, w, h);
    const top = await toBlob(canvas, type, 0.9);
    last = top;
    if (top.size <= profile.bytes) return { blob: top, w, h };
    let lo = 0.3;
    let hi = 0.9;
    let best = null;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      const b = await toBlob(canvas, type, mid);
      if (b.size <= profile.bytes) { best = b; lo = mid; } else { hi = mid; }
    }
    if (best) return { blob: best, w, h };
    w = Math.max(1, Math.round(w * 0.85));
    h = Math.max(1, Math.round(h * 0.85));
  }
  return { blob: last, w, h };
}

/** Copia en JPEG de una foto (para compartir con apps que no entienden WebP). */
export async function toJpeg(blob) {
  const bmp = await bitmapOf(blob);
  return toBlob(drawToCanvas(bmp, bmp.width, bmp.height), 'image/jpeg', 0.92);
}

function thumbOf(source, sw, sh) {
  const { w, h } = fitSize(sw, sh, THUMB_MAX_SIDE);
  return drawToCanvas(source, w, h).toDataURL('image/jpeg', 0.6);
}

function imageElementOf(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen')); };
    img.src = url;
  });
}

/** Decodifica la foto: primero createImageBitmap y, si falla, con un <img> (que aplica la orientación sola). */
async function bitmapOf(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch (e) {
      const img = await imageElementOf(file).catch(() => { throw e; });
      return { width: img.naturalWidth, height: img.naturalHeight, drawable: img };
    }
  }
}

function videoMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    const done = (fn, val) => {
      URL.revokeObjectURL(url);
      fn(val);
    };
    v.onerror = () => done(reject, new Error(`No se pudo leer el video (${file.type || 'tipo desconocido'}, ${formatBytes(file.size)}; código ${v.error?.code ?? '?'})`));
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.2, (v.duration || 1) / 2);
    };
    v.onseeked = () => {
      const w = v.videoWidth || 320;
      const h = v.videoHeight || 180;
      done(resolve, { w, h, duration: v.duration || 0, thumb: thumbOf(v, w, h) });
    };
    v.src = url;
  });
}

/** Prepara una nota de voz grabada: no se reprocesa, solo se comprueba el tamaño. */
export function prepareAudio(blob, duration) {
  if (blob.size > LIMITS.audio) throw new Error(`El audio pesa ${formatBytes(blob.size)}; el máximo es ${formatBytes(LIMITS.audio)}`);
  const mime = (blob.type || 'audio/webm').split(';')[0];
  return { kind: 'audio', blob, mime, size: blob.size, w: null, h: null, duration: Math.round(duration || 0), thumb: null };
}

/**
 * Prepara un archivo para enviarlo. Devuelve { kind, blob, mime, w, h, duration?, thumb, size }.
 * Las fotos se comprimen a WebP (1080p y 300 KB; con `hd`, 1440p y 400 KB); los GIF y videos se envían tal cual.
 */
/**
 * Copia el archivo a memoria. Los archivos que entrega el selector de Android se leen «en diferido» y a veces
 * fallan a mitad de camino (InvalidStateError al decodificar): con la copia en memoria ya no dependen del selector.
 */
async function materialize(file) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const buf = await file.arrayBuffer();
      if (!buf.byteLength) throw new Error('archivo vacío');
      return new File([buf], file.name || 'archivo', { type: file.type });
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw new Error(`No se pudo leer el archivo (${last?.name || 'error'}). Vuelve a elegirlo.`);
}

export async function prepare(input, opts = {}) {
  const kind0 = kindOf(input);
  if (kind0 && input.size <= LIMITS[kind0]) input = await materialize(input);
  return prepareFile(input, opts);
}

async function prepareFile(file, opts = {}) {
  const kind = kindOf(file);
  if (!kind) throw new Error('Solo se pueden enviar fotos, videos y GIF');
  if (file.size > LIMITS[kind]) {
    throw new Error(`${kind === 'video' ? 'El video' : kind === 'gif' ? 'El GIF' : 'La foto'} pesa ${formatBytes(file.size)}; el máximo es ${formatBytes(LIMITS[kind])}. ${kind === 'video' ? 'En el teléfono los videos de hasta 50 MB se comprimen solos; elige uno más corto.' : ''}`.trim());
  }
  if (kind === 'video') {
    const m = await videoMeta(file);
    return { kind, blob: file, mime: file.type, size: file.size, ...m };
  }
  let bmp;
  try {
    bmp = await bitmapOf(file);
  } catch (e) {
    throw new Error(`No se pudo abrir la foto (${e?.name || 'error'}, ${file.type || 'tipo desconocido'}, ${formatBytes(file.size)})`);
  }
  const thumb = thumbOf(bmp, bmp.width, bmp.height);
  if (kind === 'gif') {
    return { kind, blob: file, mime: file.type, size: file.size, w: bmp.width, h: bmp.height, thumb };
  }
  const { blob, w, h } = await encodePhoto(bmp, bmp.width, bmp.height, opts.hd ? PHOTO.hd : PHOTO.std);
  return { kind, blob, mime: blob.type || 'image/jpeg', size: blob.size, w, h, thumb };
}
