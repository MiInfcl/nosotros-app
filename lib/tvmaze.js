// Datos de series desde TVmaze (https://www.tvmaze.com/api): gratis, sin clave y con CORS abierto.
// Se usa para buscar el título, la carátula y la sinopsis de cada episodio.
// Atribución requerida por TVmaze (CC BY-SA): se muestra «Datos: TVmaze» en la pantalla de series.
const BASE = 'https://api.tvmaze.com';

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&rsquo;': "'", '&lsquo;': "'", '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—', '&hellip;': '…' };

/** Quita las etiquetas HTML de los resúmenes (siempre se muestran como texto plano). */
export function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&[#a-z0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plataforma de nuestra lista a partir del canal que informa TVmaze. */
export function platformFromName(name) {
  const n = String(name || '');
  if (/netflix/i.test(n)) return 'Netflix';
  if (/disney/i.test(n)) return 'Disney+';
  if (/hbo|(^|\W)max($|\W)/i.test(n)) return 'Max';
  if (/prime|amazon/i.test(n)) return 'Prime Video';
  if (/apple/i.test(n)) return 'Apple TV+';
  if (/paramount/i.test(n)) return 'Paramount+';
  return 'Otra';
}

export async function searchShows(q, signal) {
  const r = await fetch(`${BASE}/search/shows?q=${encodeURIComponent(q)}`, { signal });
  if (!r.ok) throw new Error('No se pudo buscar');
  const list = await r.json();
  return list.slice(0, 6).map(({ show: s }) => ({
    id: s.id,
    title: s.name,
    year: s.premiered ? s.premiered.slice(0, 4) : null,
    poster: s.image?.medium || null,
    network: s.webChannel?.name || s.network?.name || null,
    lang: s.language || null,
  }));
}

const cache = new Map();

/** Todos los episodios de una serie (una sola petición por serie, queda en memoria). */
export function episodesOf(showId) {
  if (!cache.has(showId)) {
    const p = fetch(`${BASE}/shows/${showId}/episodes`)
      .then((r) => {
        if (!r.ok) throw new Error('No se pudieron leer los episodios');
        return r.json();
      })
      .then((list) =>
        list
          .filter((e) => e.number != null)
          .map((e) => ({ season: e.season, number: e.number, name: e.name, airdate: e.airdate, summary: stripHtml(e.summary), image: e.image?.medium || null }))
          .sort((a, b) => a.season - b.season || a.number - b.number),
      );
    cache.set(showId, p);
    p.catch(() => cache.delete(showId));
  }
  return cache.get(showId);
}

export function findEpisode(eps, season, number) {
  return eps.find((e) => e.season === Number(season) && e.number === Number(number)) || null;
}

/** El episodio que sigue al (temporada, número), pasando de temporada si hace falta. null si no hay más. */
export function nextEpisode(eps, season, number) {
  const s = Number(season) || 0;
  const n = Number(number) || 0;
  return eps.find((e) => e.season > s || (e.season === s && e.number > n)) || null;
}
