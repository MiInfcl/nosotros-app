// Fachada de datos de series: usa TMDB (español) si hay clave en tmdb-config.js; si no, TVmaze (inglés).
import * as TVM from './tvmaze.js';
import * as TMDB from './tmdb.js';
import { tmdbKey } from '../tmdb-config.js';

export const provider = tmdbKey ? 'tmdb' : 'tvmaze';
export const providerName = provider === 'tmdb' ? 'TMDB' : 'TVmaze';
export const attributionHtml =
  provider === 'tmdb'
    ? 'Datos de series: <a href="https://www.themoviedb.org" target="_blank" rel="noopener">TMDB</a>. Esta app usa la API de TMDB pero no está avalada ni certificada por TMDB.'
    : 'Datos de series: <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVmaze</a>.';

export const { findEpisode, nextEpisode, platformFromName } = TVM;

export function searchShows(q, signal) {
  return provider === 'tmdb' ? TMDB.searchShows(q, tmdbKey, signal) : TVM.searchShows(q, signal).then((l) => l.map((r) => ({ ...r, src: 'tvmaze' })));
}

const norm = (name) => {
  const p = TVM.platformFromName(name);
  return p === 'Otra' ? name : p; // si no es de nuestra lista, se deja el nombre real (p. ej. Crunchyroll)
};
const unique = (list) => [...new Set(list.filter(Boolean))];

/**
 * Plataformas donde está disponible la serie ({src, id, network}), o null si no se puede saber
 * (entonces se ofrecen todas). Una lista vacía significa que no está en ninguna plataforma conocida.
 */
export async function platformsOf(ref) {
  if (ref.src === 'tmdb') return unique((await TMDB.platformNamesOf(ref.id, tmdbKey)).map(norm));
  return ref.network ? [norm(ref.network)] : null;
}

/** Referencia {src, id} de una serie guardada (acepta las guardadas antes con `tvmazeId`). */
export function refOf(show) {
  if (show?.src && show.srcId != null) return { src: show.src, id: show.srcId };
  if (show?.tvmazeId) return { src: 'tvmaze', id: show.tvmazeId };
  return null;
}

/** Solo los episodios ya emitidos (no se puede ir en un capítulo que todavía no sale). */
export function aired(eps, today = new Date().toISOString().slice(0, 10)) {
  return eps.filter((e) => !e.airdate || e.airdate <= today);
}

export function episodesOf(show) {
  const r = refOf(show);
  if (!r) return Promise.resolve([]);
  if (r.src === 'tmdb') return (tmdbKey ? TMDB.episodesOf(r.id, tmdbKey) : Promise.reject(new Error('Falta la clave de TMDB'))).then((l) => aired(l));
  return TVM.episodesOf(r.id).then((l) => aired(l.map((e) => ({ ...e, summaryLang: 'en' }))));
}
