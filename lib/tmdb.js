// Series desde TMDB (https://developer.themoviedb.org): carátulas y sinopsis en español, con clave gratuita.
// Requiere atribución: «This product uses the TMDB API but is not endorsed or certified by TMDB».
const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';
const LANG = 'es-MX'; // español latino; si falta la sinopsis se usa la inglesa
const COUNTRY = 'CL'; // dónde se ve: para adivinar la plataforma

async function get(path, key, params = {}, signal) {
  const u = new URL(BASE + path);
  u.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString(), { signal });
  if (r.status === 401) throw new Error('La clave de TMDB no es válida');
  if (!r.ok) throw new Error(`TMDB respondió ${r.status}`);
  return r.json();
}

export async function searchShows(q, key, signal) {
  const j = await get('/search/tv', key, { query: q, language: LANG, include_adult: 'false' }, signal);
  return (j.results || []).slice(0, 6).map((s) => ({
    src: 'tmdb',
    id: s.id,
    title: s.name,
    year: s.first_air_date ? s.first_air_date.slice(0, 4) : null,
    poster: s.poster_path ? `${IMG}w185${s.poster_path}` : null,
    network: null,
    lang: s.original_language || null,
  }));
}

/** Plataformas de suscripción donde se ve en Chile; si no hay, la cadena original. Puede salir vacía. */
export async function platformNamesOf(id, key) {
  const j = await get(`/tv/${id}/watch/providers`, key);
  const flat = j.results?.[COUNTRY]?.flatrate || [];
  if (flat.length) return flat.map((p) => p.provider_name);
  const d = await get(`/tv/${id}`, key, { language: LANG });
  return (d.networks || []).map((n) => n.name);
}

function normalize(seasonNumber, e, lang) {
  return {
    season: e.season_number ?? seasonNumber,
    number: e.episode_number,
    name: e.name || '',
    airdate: e.air_date || null,
    summary: (e.overview || '').trim(),
    summaryLang: lang,
    image: e.still_path ? `${IMG}w300${e.still_path}` : null,
  };
}

async function fetchAll(id, key, lang) {
  const d = await get(`/tv/${id}`, key, { language: lang });
  const seasons = (d.seasons || []).map((s) => s.season_number).filter((n) => n > 0);
  const out = [];
  // append_to_response admite hasta 20 temporadas por petición
  for (let i = 0; i < seasons.length; i += 20) {
    const chunk = seasons.slice(i, i + 20);
    const j = await get(`/tv/${id}`, key, { language: lang, append_to_response: chunk.map((n) => `season/${n}`).join(',') });
    for (const n of chunk) for (const e of j[`season/${n}`]?.episodes || []) out.push(normalize(n, e, lang === LANG ? 'es' : 'en'));
  }
  return out;
}

async function load(id, key) {
  let eps = await fetchAll(id, key, LANG);
  if (eps.some((e) => !e.summary)) {
    try {
      const en = new Map((await fetchAll(id, key, 'en-US')).map((e) => [`${e.season}:${e.number}`, e]));
      eps = eps.map((e) => (e.summary ? e : { ...e, summary: en.get(`${e.season}:${e.number}`)?.summary || '', summaryLang: 'en' }));
    } catch {}
  }
  return eps.filter((e) => e.number != null).sort((a, b) => a.season - b.season || a.number - b.number);
}

const cache = new Map();

/** Todos los episodios de la serie (en español, con respaldo en inglés), una sola vez por serie. */
export function episodesOf(id, key) {
  if (!cache.has(id)) {
    const p = load(id, key);
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return cache.get(id);
}
