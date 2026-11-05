// Chat de la pareja: doble check, responder, editar, eliminar, menú al mantener presionado, responder
// arrastrando a la derecha, fotos, videos, GIF y audios, fotos «de una sola vez», aviso de «escribiendo»,
// descarga automática según el tipo de conexión y guardado en la galería.
import { ic } from './icons.js';
import * as M from './media.js';
import { FileCache } from './cache.js';

const LONG_PRESS_MS = 450;
const SWIPE_REPLY_PX = 56;
const TYPING_EVERY_MS = 3000;
const TYPING_FRESH_MS = 7000;
const AUDIO_BPS = 24000; // voz en Opus mono: ~180 KB por minuto
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;

export function createChat(env) {
  const { root, sheetRoot, store, getS, esc, partnerName, fmtTime, toast, isActive } = env;
  const prefs = () => env.prefs();
  const net = () => env.net();

  let replyTo = null; // { id, from, text, type }
  let editing = null; // { id }
  let draft = '';
  let pending = []; // subidas en curso
  let seq = 0;
  let suppressClickUntil = 0;
  let g = null; // gesto en curso sobre un mensaje
  let pickOnce = false; // el próximo archivo elegido se manda «de una sola vez»
  let pickHD = !!env.prefs().hd; // las próximas fotos elegidas se mandan en HD
  let rec = null; // grabación en curso
  let player = null; // audio que suena: { id, el }
  let onceUrl = null; // URL de la foto «de una sola vez» que se está viendo
  let partnerTyping = null; // 'text' | 'audio' | null
  let partnerTypingTimer = null;
  let lastTypingSent = 0;
  let typingStopTimer = null;
  let lastIncomingId = null;
  const urls = new Map(); // mediaId -> URL del archivo ya descargado
  const loads = new Map(); // mediaId -> promesa de descarga
  const acked = new Set();
  let local = new Set(); // mediaId ya guardados en este teléfono (sobreviven al cerrar la app)
  let localFor = null; // pareja de la que se cargó la lista anterior
  const uidKey = (p) => p + (getS().uid || 'x');
  let hidden = new Set();
  let saved = new Set(); // archivos ya guardados en la galería
  let setsFor = null;
  const loadSets = () => {
    setsFor = getS().uid;
    try { hidden = new Set(JSON.parse(localStorage.getItem(uidKey('parejas-hidden-')) || '[]')); } catch {}
    try { saved = new Set(JSON.parse(localStorage.getItem(uidKey('parejas-gallery-')) || '[]')); } catch {}
  };
  loadSets();

  const cacheKey = (m) => FileCache.key(getS().coupleId, m.mediaId);
  const hasLocal = (m) => urls.has(m.mediaId) || local.has(m.mediaId);
  /** Venció en el servidor (15 días) y no se alcanzó a descargar: ya no hay forma de verlo. */
  const isGone = (m) => !!m.mediaId && !m.once && !hasLocal(m) && (!!m.expiredAt || (m.at || 0) < Date.now() - M.MEDIA_KEEP_DAYS * 86400000);

  /** Lee qué archivos hay guardados en el teléfono (una vez por pareja) y vuelve a dibujar si hacía falta. */
  function loadLocalIndex() {
    const code = getS().coupleId;
    if (!code || localFor === code) return;
    localFor = code;
    FileCache.keys(code + '/').then((ks) => {
      if (localFor !== code) return;
      local = new Set(ks.map((k) => k.slice(code.length + 1)));
      if (document.getElementById('msgs')) update();
    });
  }

  const isMine = (m) => m.from === getS().uid || m.from === 'me';
  const find = (id) => getS().messages.find((m) => m.id === id);
  const nameOf = (from) => (from === getS().uid || from === 'me' ? 'Tú' : partnerName());
  const q = (id) => CSS.escape(id);

  /** Texto del mensaje con los enlaces (http, https y www.) clickeables. Todo lo demás va escapado. */
  function richText(text) {
    let out = '';
    let last = 0;
    URL_RE.lastIndex = 0;
    for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
      const href = /^www\./i.test(m[0]) ? `https://${m[0]}` : m[0];
      out += `${esc(text.slice(last, m.index))}<a class="lnk" href="${esc(href)}" rel="noopener noreferrer">${esc(m[0])}</a>`;
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Ayer';
    return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  /** ¿Este archivo se baja solo con la conexión actual? (ajustes de «Chat y archivos») */
  function autoOK(m) {
    const cfg = prefs().dl[m.type];
    const n = net();
    if (!cfg || n === 'none') return false;
    return n === 'wifi' ? !!cfg.wifi : !!cfg.data;
  }

  /* ------------------------------------------------------------ dibujo */

  function ticks(m) {
    if (m.pending) return `<span class="ticks" role="img" aria-label="Enviando">${ic('clock', 13)}</span>`;
    if (m.readAt) return `<span class="ticks read" role="img" aria-label="Leído">${ic('checks', 17)}</span>`;
    if (m.deliveredAt) return `<span class="ticks" role="img" aria-label="Entregado">${ic('checks', 17)}</span>`;
    return `<span class="ticks" role="img" aria-label="Enviado">${ic('check', 14)}</span>`;
  }

  const LABEL = { image: 'Foto', gif: 'GIF', video: 'Video', audio: 'Audio' };

  function onceHtml(m) {
    const label = LABEL[m.type] || 'Archivo';
    if (m.openedAt) return `<div class="once done">${ic('once', 24)}<div><b>${label}</b><span>Abierta</span></div></div>`;
    if (isMine(m)) return `<div class="once">${ic('once', 24)}<div><b>${label} de una sola vez</b><span>Aún sin abrir</span></div></div>`;
    return `<div class="once open" data-act="c-open" data-id="${esc(m.id)}" role="button" tabindex="0">${ic('once', 24)}<div><b>${label} de una sola vez</b><span>Toca para abrir</span></div></div>`;
  }

  function mediaHtml(m) {
    const have = hasLocal(m);
    if (isGone(m)) {
      return `<div class="media gone" style="${m.w && m.h ? `aspect-ratio:${m.w}/${m.h}` : 'aspect-ratio:4/3'}"><img src="${esc(m.thumb || '')}" alt="" draggable="false"><span class="dlc">${ic('clock', 22)}<small>Archivo vencido</small></span></div>`;
    }
    // en un video la URL descargada es del video, no de una imagen: la tarjeta siempre muestra la miniatura
    const src = (m.type !== 'video' && urls.get(m.mediaId)) || m.thumb || '';
    const size = M.formatBytes(m.size || 0);
    const badge = m.type === 'gif' ? '<span class="gifb">GIF</span>' : '';
    let over = '';
    if (m.type === 'video') {
      over = `<span class="play">${ic('play', 30, true)}</span>${m.duration ? `<span class="dur">${M.formatDuration(m.duration)}</span>` : ''}${have ? '' : `<span class="dlb">${ic('download', 13)} ${size}</span>`}`;
    } else if (!have) {
      over = `<span class="dlc">${ic('download', 22)}<small>${size}</small></span>`;
    }
    const ratio = m.w && m.h ? `aspect-ratio:${m.w}/${m.h}` : 'aspect-ratio:4/3';
    return `<div class="media" data-act="c-open" data-id="${esc(m.id)}" style="${ratio}" role="button" tabindex="0" aria-label="${m.type === 'video' ? 'Ver video' : 'Ver foto'}">
      <img src="${esc(src)}" data-mi="${esc(m.mediaId)}" alt="${m.type === 'video' ? 'Video' : m.type === 'gif' ? 'GIF' : 'Foto'} enviado" draggable="false">${badge}${over}</div>`;
  }

  function audioHtml(m) {
    const have = hasLocal(m);
    if (isGone(m)) return `<div class="audio gone">${ic('clock', 18)}<span class="adur">Audio vencido</span></div>`;
    const playing = player?.id === m.id && !player.el.paused;
    return `<div class="audio" data-aid="${esc(m.id)}"><button type="button" class="aplay" data-act="c-audio" data-id="${esc(m.id)}" aria-label="${playing ? 'Pausar' : 'Reproducir'} audio">${ic(playing ? 'pause' : 'play', 20, true)}</button>
      <div class="atrack"><span style="width:0%"></span></div>
      <span class="adur">${have || autoOK(m) ? M.formatDuration(m.duration || 0) : `${ic('download', 12)} ${M.formatBytes(m.size || 0)}`}</span></div>`;
  }

  const QUICK = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];
  const MORE = ['\u{1F618}', '\u{1F970}', '\u{1F60D}', '\u{1F60A}', '\u{1F525}', '\u{1F389}', '\u{1F44F}', '\u{1F64C}', '\u{1F4AA}', '\u{1F914}', '\u{1F644}', '\u{1F62D}',
    '\u{1F621}', '\u{1F631}', '\u{1F634}', '\u{1F60E}', '\u{1F973}', '\u{1F97A}', '\u{1F495}', '\u{1F49E}', '\u{1F48B}', '\u{1F339}', '\u{1F44C}', '\u{1F44E}',
    '\u{2728}', '\u{1F4AF}', '\u{1F37B}', '\u{1F355}'];

  /** Reacciones bajo el mensaje: un chip por emoji (con cuántos lo pusieron). */
  function reactHtml(m) {
    const r = m.reactions;
    if (!r || typeof r !== 'object') return '';
    const me = getS().uid;
    const count = new Map();
    for (const [uid, e] of Object.entries(r)) if (e) count.set(e, (count.get(e) || 0) + (uid === me ? 0.001 : 1));
    if (!count.size) return '';
    const chips = [...count.entries()].map(([e, n]) => {
      const mineR = r[me] === e;
      const total = Math.round(n);
      return `<button type="button" class="rx${mineR ? ' on' : ''}" data-act="c-react" data-id="${esc(m.id)}" data-emoji="${esc(e)}" aria-label="Reacción ${esc(e)}">${esc(e)}${total > 1 ? `<small>${total}</small>` : ''}</button>`;
    });
    return `<div class="reacts">${chips.join('')}</div>`;
  }

  function bubble(m) {
    const mine = isMine(m);
    const time = fmtTime(m.at);
    if (m.deleted) {
      return `<div class="msg ${mine ? 'mine' : ''} deleted" data-mid="${esc(m.id)}"><span class="mtext">${ic('ban', 14)} ${mine ? 'Eliminaste este mensaje' : 'Se eliminó este mensaje'}</span><span class="meta">${time}</span></div>`;
    }
    let inner = `<span class="swipe-ic">${ic('reply', 18)}</span>`;
    if (m.replyTo) {
      inner += `<div class="quote" data-act="c-quote" data-q="${esc(m.replyTo.id)}"><b>${esc(nameOf(m.replyTo.from))}</b><span>${esc(M.previewOf(m.replyTo))}</span></div>`;
    }
    if (m.type === 'audio') inner += audioHtml(m);
    else if (m.type && m.once) inner += onceHtml(m);
    else if (m.type) inner += mediaHtml(m);
    if (m.text) inner += `<span class="mtext">${richText(m.text)}</span>`;
    inner += `<span class="meta">${m.editedAt ? 'editado · ' : ''}${time}${mine ? ' ' + ticks(m) : ''}</span>`;
    inner += reactHtml(m);
    return `<div class="msg ${mine ? 'mine' : ''}${m.reactions && Object.values(m.reactions).some(Boolean) ? ' has-rx' : ''}" data-mid="${esc(m.id)}">${inner}</div>`;
  }

  function uploadingHtml(p) {
    return `<div class="msg mine uploading" data-up="${p.key}">
      ${p.thumb && !p.once ? `<div class="media" style="aspect-ratio:${p.w && p.h ? `${p.w}/${p.h}` : '4/3'}"><img src="${esc(p.thumb)}" alt="" draggable="false"></div>` : ''}
      <div class="bar" role="progressbar" aria-label="Enviando archivo"><span style="width:${Math.round(p.progress * 100)}%"></span></div>
      <span class="meta">${p.label || 'Enviando…'}</span></div>`;
  }

  function listHtml() {
    if (setsFor !== getS().uid) loadSets();
    let out = '';
    let lastDay = '';
    for (const m of getS().messages) {
      if (hidden.has(m.id)) continue;
      const day = new Date(m.at).toDateString();
      if (day !== lastDay) {
        out += `<div class="daysep"><span>${esc(dayLabel(m.at))}</span></div>`;
        lastDay = day;
      }
      out += bubble(m);
    }
    out += pending.map(uploadingHtml).join('');
    return out || '<p class="muted" style="text-align:center">Aún no hay mensajes. ¡Escribe el primero!</p>';
  }

  function ctxHtml() {
    if (editing) {
      const m = find(editing.id);
      return `<div class="ctxbar"><span class="ctx-ic">${ic('edit', 18)}</span><div><b>Editando mensaje</b><span>${esc((m?.text || '').slice(0, 90))}</span></div><button type="button" class="iconbtn flat" data-act="c-ctx-cancel" aria-label="Cancelar edición">${ic('x', 18)}</button></div>`;
    }
    if (replyTo) {
      return `<div class="ctxbar"><span class="ctx-ic">${ic('reply', 18)}</span><div><b>Respondiendo a ${esc(nameOf(replyTo.from))}</b><span>${esc(M.previewOf(replyTo).slice(0, 90))}</span></div><button type="button" class="iconbtn flat" data-act="c-ctx-cancel" aria-label="Cancelar respuesta">${ic('x', 18)}</button></div>`;
    }
    return '';
  }

  function composerHtml() {
    if (rec) {
      return `<button type="button" class="iconbtn" data-act="c-rec-cancel" aria-label="Descartar grabación">${ic('trash', 22)}</button>
        <div class="recbar" role="status"><i class="recdot"></i><b id="rectime">${M.formatDuration((Date.now() - rec.t0) / 1000)}</b><span class="muted small">Grabando audio…</span></div>
        <button type="button" class="btn sendbtn" data-act="c-rec-send" aria-label="Enviar audio">${ic('send', 20)}</button>`;
    }
    const has = !!draft.trim() || !!editing;
    return `<button type="button" class="iconbtn" data-act="c-attach" aria-label="Adjuntar foto, video o GIF">${ic('attach', 22)}</button>
      <input type="file" id="filein" accept="image/*,video/*" multiple hidden>
      <input type="file" id="camphoto" accept="image/*" capture="environment" hidden>
      <input type="file" id="camvideo" accept="video/*" capture="environment" hidden>
      <input type="text" id="msgin" placeholder="${editing ? 'Edita tu mensaje' : 'Escribe un mensaje…'}" value="${esc(draft)}" maxlength="1000" aria-label="Mensaje">
      <button type="button" class="btn sendbtn micbtn ${has ? 'hidden' : ''}" id="micbtn" data-act="c-mic" aria-label="Grabar audio">${ic('mic', 20)}</button>
      <button class="btn sendbtn ${has ? '' : 'hidden'}" id="sendbtn" type="submit" aria-label="Enviar">${ic('send', 20)}</button>`;
  }

  function typingHtml() {
    if (!partnerTyping) return '';
    return `<span class="tdots"><i></i><i></i><i></i></span> ${esc(partnerName())} ${partnerTyping === 'audio' ? 'está grabando un audio…' : 'está escribiendo…'}`;
  }

  function view() {
    return `<div class="chatwrap"><div class="msgs" id="msgs">${listHtml()}</div>
      <div class="typing ${partnerTyping ? '' : 'hidden'}" id="typing" role="status" aria-live="polite">${typingHtml()}</div>
      <div id="ctx">${ctxHtml()}</div>
      <form class="composer" id="composer" autocomplete="off">${composerHtml()}</form></div>`;
  }

  function renderComposer() {
    const f = document.getElementById('composer');
    if (f) f.innerHTML = composerHtml();
  }

  function renderTyping() {
    const el = document.getElementById('typing');
    if (!el) return;
    el.innerHTML = typingHtml();
    el.classList.toggle('hidden', !partnerTyping);
    const box = document.getElementById('msgs');
    if (box && partnerTyping && box.scrollHeight - box.scrollTop - box.clientHeight < 140) box.scrollTop = box.scrollHeight;
  }

  /** Redibuja solo la lista (no toca lo que se está escribiendo). */
  function update() {
    const box = document.getElementById('msgs');
    if (!box) return;
    // un mensaje nuevo de tu pareja quita el «escribiendo…»
    const last = [...getS().messages].reverse().find((m) => !isMine(m));
    if (last && last.id !== lastIncomingId) {
      if (lastIncomingId !== null && partnerTyping) { partnerTyping = null; renderTyping(); }
      lastIncomingId = last.id;
    }
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    const before = new Set([...box.querySelectorAll('[data-mid]')].map((x) => x.dataset.mid));
    box.innerHTML = listHtml();
    if (before.size) box.querySelectorAll('[data-mid]').forEach((x) => { if (!before.has(x.dataset.mid)) x.classList.add('msg-new'); });
    if (atBottom) box.scrollTop = box.scrollHeight;
    renderCtx();
    syncAudio();
    hydrate();
  }

  function renderCtx() {
    const c = document.getElementById('ctx');
    if (c) c.innerHTML = ctxHtml();
    const i = document.getElementById('msgin');
    if (i) i.placeholder = editing ? 'Edita tu mensaje' : 'Escribe un mensaje…';
    const has = !!(i?.value.trim()) || !!editing;
    document.getElementById('micbtn')?.classList.toggle('hidden', has);
    document.getElementById('sendbtn')?.classList.toggle('hidden', !has);
  }

  /** El chat llega justo hasta la barra de abajo (sin hueco sobre el campo de texto). */
  function fit() {
    const w = document.querySelector('.chatwrap');
    const nav = document.querySelector('nav.tabs');
    if (!w || !nav) return;
    const room = nav.getBoundingClientRect().top - w.getBoundingClientRect().top - 6;
    w.style.height = `${Math.max(220, Math.floor(room))}px`;
    const box = document.getElementById('msgs');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function afterRender() {
    fit();
    const box = document.getElementById('msgs');
    if (box) box.scrollTop = box.scrollHeight;
    const last = [...getS().messages].reverse().find((m) => !isMine(m));
    lastIncomingId = last ? last.id : null;
    syncAudio();
    hydrate();
  }

  /** Vuelve a dibujar un solo mensaje (cuando termina de bajar su archivo). */
  function refreshBubble(id) {
    const m = find(id);
    const el = document.querySelector(`#msgs [data-mid="${q(id)}"]`);
    if (!m || !el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = bubble(m);
    el.replaceWith(tmp.firstElementChild);
    syncAudio();
  }

  /* ------------------------------------------------------------ archivos */

  function extOf(mime) {
    const e = (mime || '').split('/')[1]?.split(';')[0] || 'bin';
    return e.replace('jpeg', 'jpg').replace('quicktime', 'mov').replace('x-matroska', 'mkv');
  }

  /** Guarda en la galería lo que llega o se envía, si está activado en Ajustes. Las fotos «de una sola vez» nunca. */
  function maybeSave(blob, m) {
    if (!env.gallery || !prefs().gallery || m.once || m.type === 'audio' || saved.has(m.mediaId)) return;
    saved.add(m.mediaId);
    try { localStorage.setItem(uidKey('parejas-gallery-'), JSON.stringify([...saved].slice(-400))); } catch {}
    env.gallery(blob, `Nosotros_${m.mediaId}.${extOf(m.mime)}`).catch(() => saved.delete(m.mediaId));
  }

  function ensureMedia(m, onProgress) {
    if (urls.has(m.mediaId)) return Promise.resolve(urls.get(m.mediaId));
    if (!loads.has(m.mediaId)) {
      const p = (async () => {
        let blob = local.has(m.mediaId) ? await FileCache.get(cacheKey(m)) : null;
        if (!blob) {
          if (isGone(m)) throw new Error('Este archivo venció: se guardan 15 días en el servidor');
          blob = await store.loadMedia(m, onProgress);
          if (!m.once) {
            FileCache.put(cacheKey(m), blob).then((ok) => { if (ok) local.add(m.mediaId); });
            maybeSave(blob, m);
          }
        }
        const u = URL.createObjectURL(blob);
        urls.set(m.mediaId, u);
        return u;
      })();
      loads.set(m.mediaId, p);
      p.catch(() => loads.delete(m.mediaId));
    }
    return loads.get(m.mediaId);
  }

  /** Baja solos los archivos que los ajustes permiten con la conexión actual. */
  function hydrate() {
    loadLocalIndex();
    const all = getS().messages;
    for (const m of all) {
      if (m.deleted || !m.mediaId || m.once || urls.has(m.mediaId) || loads.has(m.mediaId) || m.pending) continue;
      const stored = local.has(m.mediaId);
      if (!stored && (all.indexOf(m) < all.length - 40 || !autoOK(m) || isGone(m))) continue;
      ensureMedia(m).then((u) => {
        document.querySelectorAll(`img[data-mi="${q(m.mediaId)}"]`).forEach((img) => { if (m.type !== 'video') img.src = u; });
        refreshBubble(m.id);
      }).catch(() => {});
    }
  }

  /** Sube una lista de archivos ya preparados; el primero lleva el texto escrito y la respuesta pendiente. */
  async function upload(entries, once) {
    let first = true;
    for (const entry of entries) {
      const item = { key: ++seq, progress: 0, label: 'Preparando…', thumb: null, once };
      pending.push(item);
      update();
      try {
        const prep = await entry();
        Object.assign(item, { thumb: prep.thumb, w: prep.w, h: prep.h, label: prep.kind === 'audio' ? 'Enviando audio…' : 'Enviando…' });
        update();
        const input = document.getElementById('msgin');
        const caption = first && input && prep.kind !== 'audio' ? input.value.trim() : '';
        const extra = { text: caption };
        if (once) extra.once = true;
        if (first && replyTo) extra.replyTo = { ...replyTo };
        if (first) {
          if (input && prep.kind !== 'audio') { input.value = ''; draft = ''; }
          replyTo = null;
          renderCtx();
        }
        first = false;
        const r = await store.sendMedia(prep, extra, (p) => {
          item.progress = p;
          const bar = document.querySelector(`[data-up="${item.key}"] .bar span`);
          if (bar) bar.style.width = `${Math.round(p * 100)}%`;
        });
        if (r?.mediaId && !once) {
          urls.set(r.mediaId, URL.createObjectURL(prep.blob)); // lo enviado ya está aquí: no hay que bajarlo
          FileCache.put(FileCache.key(getS().coupleId, r.mediaId), prep.blob).then((ok) => { if (ok) local.add(r.mediaId); });
          maybeSave(prep.blob, { mediaId: r.mediaId, mime: prep.mime, type: prep.kind });
        }
      } catch (e) {
        console.error(e);
        toast(e.message || 'No se pudo enviar el archivo');
      } finally {
        pending = pending.filter((x) => x !== item);
        update();
      }
    }
  }

  const handleFiles = (files, once, hd = !!prefs().hd) => upload(files.map((file) => () => M.prepare(file, { hd })), once);

  /* ------------------------------------------------------------ visor: deslizar entre fotos y zoom */

  let vw = null; // visor abierto: { ids, i, s (zoom), x, y, noClickUntil }

  /** Fotos, GIF y videos que se pueden ver en el visor, en orden de la conversación. */
  const viewerIds = () => getS().messages.filter((x) => !x.deleted && x.mediaId && !x.once && x.type !== 'audio' && !isGone(x)).map((x) => x.id);

  function openViewer(id) {
    const m = find(id);
    if (!m || m.deleted || !m.mediaId) return;
    if (m.once) return openOnce(m);
    if (isGone(m)) { toast('Este archivo venció: se guardan 15 días en el servidor'); return; }
    const ids = viewerIds();
    vw = { ids, i: Math.max(0, ids.indexOf(id)), s: 1, x: 0, y: 0, noClickUntil: 0 };
    showViewer();
  }

  /** Pasa a otra foto. Devuelve false si no hay más hacia ese lado. */
  function goViewer(delta) {
    if (!vw) return false;
    const n = vw.i + delta;
    if (n < 0 || n >= vw.ids.length) return false;
    vw.i = n;
    showViewer(delta);
    return true;
  }

  function showViewer(dir = 0) {
    const first = !dir && !sheetRoot.querySelector('.viewer');
    const id = vw.ids[vw.i];
    const m = find(id);
    if (!m) { closeSheet(); return; }
    vw.s = 1; vw.x = 0; vw.y = 0;
    const n = vw.ids.length;
    sheetRoot.innerHTML = `<div class="viewer${first ? ' vfirst' : ''}${dir > 0 ? ' vdir-next' : dir < 0 ? ' vdir-prev' : ''}" data-sheet-close>
      <button class="vclose" data-sheet-close aria-label="Cerrar">${ic('x', 24)}</button>
      ${n > 1 ? `<div class="vcount">${vw.i + 1} / ${n}</div>` : ''}
      ${vw.i > 0 ? `<button class="vnav prev" data-vnav="-1" aria-label="Anterior">${ic('back', 24)}</button>` : ''}
      ${vw.i < n - 1 ? `<button class="vnav next" data-vnav="1" aria-label="Siguiente">${ic('chevron', 24)}</button>` : ''}
      <div class="vbody" id="vbody"><img src="${esc((m.type !== 'video' && urls.get(m.mediaId)) || m.thumb || '')}" alt="" class="vthumb"><p class="vmsg" id="vmsg">${hasLocal(m) ? '' : 'Descargando…'}</p></div></div>`;
    ensureMedia(m, (p) => { const t = document.getElementById('vmsg'); if (t && vw?.ids[vw.i] === id) t.textContent = `Descargando ${Math.round(p * 100)}%`; })
      .then((u) => {
        if (!vw || vw.ids[vw.i] !== id) return; // ya pasó a otra foto
        const b = document.getElementById('vbody');
        if (b) {
          b.innerHTML = m.type === 'video'
            ? `<video src="${u}" controls autoplay playsinline></video>`
            : `<img id="vimg" src="${u}" alt="${m.type === 'gif' ? 'GIF' : 'Foto'}" draggable="false">`;
          if (m.type !== 'video') bindZoom(b, b.querySelector('#vimg'));
        }
        if (m.type !== 'video') document.querySelectorAll(`img[data-mi="${q(m.mediaId)}"]`).forEach((img) => { img.src = u; });
        refreshBubble(m.id);
      })
      .catch((e) => { const t = document.getElementById('vmsg'); if (t) t.textContent = e.message || 'No se pudo descargar'; });
  }

  /**
   * Gestos de la foto: pellizcar para acercar, arrastrar para mover (si está acercada), doble toque para acercar o volver,
   * y deslizar de lado para pasar a la foto anterior o siguiente (si no está acercada).
   */
  function bindZoom(body, img) {
    const ptrs = new Map();
    let pinch = null;
    let drag = null;
    let lastTap = 0;
    const apply = () => { img.style.transform = `translate(${vw.x}px, ${vw.y}px) scale(${vw.s})`; };
    const clampPan = () => {
      const mx = Math.max(0, (img.offsetWidth * vw.s - body.clientWidth) / 2);
      const my = Math.max(0, (img.offsetHeight * vw.s - body.clientHeight) / 2);
      vw.x = Math.max(-mx, Math.min(mx, vw.x));
      vw.y = Math.max(-my, Math.min(my, vw.y));
    };
    const mark = () => { vw.noClickUntil = Date.now() + 350; };
    /** Vuelve la foto a su lugar con una animación corta. */
    const snap = () => {
      img.style.transition = 'transform .2s ease-out';
      apply();
      setTimeout(() => { img.style.transition = ''; }, 230);
    };
    body.style.touchAction = 'none';
    body.addEventListener('pointerdown', (e) => {
      try { body.setPointerCapture(e.pointerId); } catch {}
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: vw.s };
        drag = null;
      } else if (ptrs.size === 1) {
        drag = { x: e.clientX, y: e.clientY, ox: vw.x, oy: vw.y, dx: 0, dy: 0, t: Date.now(), moved: false };
      }
    });
    body.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2 && pinch) {
        const [a, b] = [...ptrs.values()];
        vw.s = Math.max(1, Math.min(6, pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)));
        clampPan();
        apply();
        mark();
      } else if (ptrs.size === 1 && drag) {
        drag.dx = e.clientX - drag.x;
        drag.dy = e.clientY - drag.y;
        if (Math.abs(drag.dx) > 8 || Math.abs(drag.dy) > 8) { drag.moved = true; mark(); }
        if (vw.s > 1) {
          vw.x = drag.ox + drag.dx;
          vw.y = drag.oy + drag.dy;
          clampPan();
          apply();
        } else if (drag.moved) {
          // la foto acompaña al dedo; si ya no hay más fotos hacia ese lado, se resiste
          const edge = (drag.dx > 0 && vw.i === 0) || (drag.dx < 0 && vw.i === vw.ids.length - 1);
          img.style.transform = `translateX(${edge ? drag.dx * 0.3 : drag.dx}px)`;
        }
      }
    });
    const end = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (ptrs.size === 1) {
        // levantó un dedo del pellizco: el otro sigue moviendo desde donde está
        const [p] = [...ptrs.values()];
        drag = { x: p.x, y: p.y, ox: vw.x, oy: vw.y, dx: 0, dy: 0, t: Date.now(), moved: true };
        return;
      }
      if (ptrs.size > 0) return;
      if (vw.s < 1.05) { vw.s = 1; vw.x = 0; vw.y = 0; }
      const d = drag;
      drag = null;
      if (!d) { apply(); return; }
      if (vw.s === 1 && d.moved && Math.abs(d.dx) > 70 && Math.abs(d.dx) > Math.abs(d.dy) * 1.3 && e.type === 'pointerup') {
        mark();
        if (!goViewer(d.dx < 0 ? 1 : -1)) snap(); // no hay más fotos hacia ese lado: la foto vuelve sola
        return;
      }
      if (d.moved) snap(); else apply();
      if (!d.moved && Date.now() - d.t < 300) {
        // doble toque: acerca o vuelve
        if (Date.now() - lastTap < 320) {
          vw.s = vw.s > 1 ? 1 : 2.5;
          vw.x = 0; vw.y = 0;
          img.style.transition = 'transform .18s';
          apply();
          setTimeout(() => { img.style.transition = ''; }, 220);
          lastTap = 0;
          mark();
        } else {
          lastTap = Date.now();
        }
      }
    };
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', end);
  }

  /** Foto o video «de una sola vez»: se baja, se muestra con la pantalla protegida y se borra del servidor. */
  async function openOnce(m) {
    if (isMine(m)) { toast('Solo la puede ver tu pareja'); return; }
    if (m.openedAt) { toast('Ya la abriste'); return; }
    env.secure?.(true);
    sheetRoot.innerHTML = `<div class="viewer" data-sheet-close>
      <button class="vclose" data-sheet-close aria-label="Cerrar">${ic('x', 24)}</button>
      <div class="vbody" id="vbody"><p class="vmsg" id="vmsg">Descargando…</p></div></div>`;
    try {
      const blob = await store.loadMedia(m, (p) => { const t = document.getElementById('vmsg'); if (t) t.textContent = `Descargando ${Math.round(p * 100)}%`; });
      onceUrl = URL.createObjectURL(blob);
      const b = document.getElementById('vbody');
      if (!b) { closeSheet(); return; } // la cerró mientras bajaba: no se consume
      b.innerHTML = (m.type === 'video' ? `<video src="${onceUrl}" controls autoplay playsinline></video>` : `<img src="${onceUrl}" alt="Foto de una sola vez">`) +
        '<p class="vmsg">Se puede ver una sola vez</p>';
      await store.markOpened(m.id, m);
    } catch (e) {
      const t = document.getElementById('vmsg');
      if (t) t.textContent = e?.message === 'El archivo ya no está disponible' ? 'Ya no está disponible' : (e?.message || 'No se pudo abrir');
    }
  }

  /* ------------------------------------------------------------ audio */

  function setAudioUI(id) {
    const wrap = document.querySelector(`#msgs [data-aid="${q(id)}"]`);
    if (!wrap) return;
    const m = find(id);
    const on = player?.id === id;
    const el = on ? player.el : null;
    const btn = wrap.querySelector('.aplay');
    const want = on && !el.paused ? 'pause' : 'play';
    if (btn && btn.dataset.state !== want) {
      btn.dataset.state = want;
      btn.innerHTML = ic(want, 20, true);
    }
    const total = (m?.duration || (el && isFinite(el.duration) ? el.duration : 0)) || 0;
    const t = wrap.querySelector('.atrack span');
    if (t) t.style.width = el && total ? `${Math.min(100, (el.currentTime / total) * 100)}%` : '0%';
    const d = wrap.querySelector('.adur');
    if (d && el && !el.paused) d.textContent = M.formatDuration(el.currentTime);
    else if (d && m && (hasLocal(m) || autoOK(m))) d.textContent = M.formatDuration(m.duration || 0);
  }

  function syncAudio() {
    if (player) setAudioUI(player.id);
  }

  function stopAudio() {
    if (!player) return;
    const old = player.id;
    player.el.pause();
    player = null;
    setAudioUI(old);
  }

  async function toggleAudio(id) {
    const m = find(id);
    if (!m || m.deleted || !m.mediaId) return;
    if (isGone(m)) { toast('Este audio venció: se guardan 15 días en el servidor'); return; }
    if (player?.id === id) {
      if (player.el.paused) player.el.play().catch(() => toast('No se pudo reproducir'));
      else player.el.pause();
      return;
    }
    stopAudio();
    let u;
    try {
      const wrap = document.querySelector(`#msgs [data-aid="${q(id)}"] .adur`);
      if (wrap && !hasLocal(m)) wrap.textContent = 'Descargando…';
      u = await ensureMedia(m, (p) => { const w = document.querySelector(`#msgs [data-aid="${q(id)}"] .adur`); if (w) w.textContent = `${Math.round(p * 100)}%`; });
    } catch (e) {
      toast(e?.message || 'No se pudo descargar el audio');
      return;
    }
    const el = new Audio(u);
    player = { id, el };
    ['timeupdate', 'play', 'pause'].forEach((ev) => el.addEventListener(ev, () => setAudioUI(id)));
    el.addEventListener('ended', () => { el.currentTime = 0; setAudioUI(id); });
    el.play().catch(() => toast('No se pudo reproducir el audio'));
    refreshBubble(id);
  }

  /* ------------------------------------------------------------ grabar audio */

  function pickMime() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  async function startRecording() {
    if (rec) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { toast('Este dispositivo no puede grabar audio'); return; }
    stopAudio();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      toast(e?.name === 'NotAllowedError' ? 'Falta el permiso del micrófono' : 'No se pudo usar el micrófono');
      return;
    }
    const mime = pickMime();
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: AUDIO_BPS } : { audioBitsPerSecond: AUDIO_BPS });
    const r = { mr, stream, chunks: [], t0: Date.now(), timer: null, mime: mr.mimeType || mime };
    mr.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
    mr.start(500);
    r.timer = setInterval(() => {
      const s = (Date.now() - r.t0) / 1000;
      const t = document.getElementById('rectime');
      if (t) t.textContent = M.formatDuration(s);
      if (Date.now() - lastTypingSent > TYPING_EVERY_MS) { lastTypingSent = Date.now(); store.setTyping?.('audio').catch(() => {}); }
      if (s >= M.AUDIO_MAX_SECONDS) finishRecording(true);
    }, 250);
    rec = r;
    lastTypingSent = Date.now();
    store.setTyping?.('audio').catch(() => {});
    renderComposer();
  }

  function finishRecording(send) {
    const r = rec;
    if (!r) return;
    rec = null;
    clearInterval(r.timer);
    const dur = (Date.now() - r.t0) / 1000;
    r.mr.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      if (!send) return;
      if (dur < 0.8) { toast('Audio muy corto'); return; }
      const blob = new Blob(r.chunks, { type: r.mime || 'audio/webm' });
      upload([async () => M.prepareAudio(blob, dur)], false);
    };
    try { r.mr.stop(); } catch { r.stream.getTracks().forEach((t) => t.stop()); }
    stopTypingNow();
    renderComposer();
  }

  /* ------------------------------------------------------------ escribiendo */

  function stopTypingNow() {
    clearTimeout(typingStopTimer);
    if (lastTypingSent) {
      lastTypingSent = 0;
      store.setTyping?.(null).catch(() => {});
    }
  }

  function onTypeInput(hasText) {
    if (!hasText) { stopTypingNow(); return; }
    const now = Date.now();
    if (now - lastTypingSent > TYPING_EVERY_MS) {
      lastTypingSent = now;
      store.setTyping?.('text').catch(() => {});
    }
    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(stopTypingNow, 4500);
  }

  /** Lo llama la capa de datos con el estado de «escribiendo» de tu pareja (o null). */
  function setPartnerTyping(doc) {
    clearTimeout(partnerTypingTimer);
    const fresh = doc && doc.kind && doc.at && Math.abs(Date.now() - doc.at) < 60000;
    partnerTyping = fresh ? doc.kind : null;
    if (partnerTyping) {
      partnerTypingTimer = setTimeout(() => { partnerTyping = null; renderTyping(); }, TYPING_FRESH_MS);
    }
    renderTyping();
  }

  /* ------------------------------------------------------------ acciones del mensaje */

  function startReply(id) {
    const m = find(id);
    if (!m || m.deleted) return;
    replyTo = { id: m.id, from: m.from, text: (m.text || '').slice(0, 100), type: m.type || null };
    if (m.once) replyTo.once = true;
    editing = null;
    renderCtx();
    document.getElementById('msgin')?.focus();
  }

  function startEdit(id) {
    const m = find(id);
    if (!m || !isMine(m) || m.deleted) return;
    editing = { id };
    replyTo = null;
    renderCtx();
    const i = document.getElementById('msgin');
    if (i) {
      i.value = m.text || '';
      draft = i.value;
      i.focus();
    }
    renderCtx();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    toast('Texto copiado');
  }

  function closeSheet() {
    vw = null;
    sheetRoot.querySelectorAll('video').forEach((v) => v.pause());
    sheetRoot.innerHTML = '';
    if (onceUrl) {
      URL.revokeObjectURL(onceUrl);
      onceUrl = null;
    }
    env.secure?.(false);
  }

  function openAttachMenu() {
    sheetRoot.innerHTML = `<div class="sheet-back" data-sheet-close><div class="sheet" role="dialog" aria-label="Adjuntar">
      <button class="sheet-item" data-sheet-act="cam-photo">${ic('camera', 20)}<span>Tomar una foto</span></button>
      <button class="sheet-item" data-sheet-act="cam-video">${ic('video', 20)}<span>Grabar un video</span></button>
      <button class="sheet-item" data-sheet-act="pick">${ic('image', 20)}<span>Elegir de la galería</span></button>
      <label class="check sheet-switch"><input type="checkbox" id="oncechk"><span>Que se vea una sola vez</span></label>
      <label class="check sheet-switch sub"><input type="checkbox" id="hdchk" ${prefs().hd ? 'checked' : ''}><span>Enviar fotos en HD</span></label>
    </div></div>`;
  }

  function openMenu(id) {
    const m = find(id);
    if (!m) return;
    const mine = isMine(m);
    const items = [];
    if (!m.deleted) {
      items.push(['reply', 'reply', 'Responder']);
      if (m.text) items.push(['copy', 'copy', 'Copiar texto']);
      if (m.mediaId && !m.once && m.type !== 'audio' && !isGone(m)) {
        if (env.gallery) items.push(['save', 'download', 'Guardar en la galería']);
        if (env.share) items.push(['share', 'share', 'Compartir']);
      }
      if (mine && !m.pending && (!m.type || m.text)) items.push(['edit', 'edit', 'Editar']);
    }
    items.push(['hide', 'trash', 'Eliminar para mí']);
    if (mine && !m.deleted && !m.pending) items.push(['del', 'trash', 'Eliminar para todos', true]);
    const myR = m.reactions?.[getS().uid];
    const rbtn = (e) => `<button type="button" class="rxpick${myR === e ? ' on' : ''}" data-sheet-act="react" data-id="${esc(id)}" data-emoji="${esc(e)}" aria-label="Reaccionar con ${esc(e)}">${esc(e)}</button>`;
    const reactRow = m.deleted ? '' : `<div class="rxrow">${QUICK.map(rbtn).join('')}<button type="button" class="rxpick more" data-sheet-act="react-more" aria-label="Más reacciones" aria-expanded="false">${ic('plus', 20)}</button></div>
      <div class="rxgrid hidden" id="rxgrid">${MORE.map(rbtn).join('')}</div>`;
    sheetRoot.innerHTML = `<div class="sheet-back" data-sheet-close><div class="sheet" role="dialog" aria-label="Opciones del mensaje">
      ${reactRow}
      <div class="sheet-preview">${esc(M.previewOf(m).slice(0, 120) || 'Mensaje')}</div>
      ${items.map(([k, icon, label, danger]) => `<button class="sheet-item${danger ? ' danger' : ''}" data-sheet-act="${k}" data-id="${esc(id)}">${ic(icon, 20)}<span>${label}</span></button>`).join('')}
    </div></div>`;
  }

  /** Guarda en la galería o comparte (con otra app) la foto, el GIF o el video de un mensaje. */
  async function saveOrShare(m, act) {
    toast(hasLocal(m) ? 'Un momento…' : 'Descargando…');
    const u = await ensureMedia(m);
    let blob = await (await fetch(u)).blob();
    const name = `Nosotros_${m.mediaId}.${extOf(m.mime)}`;
    if (act === 'save') {
      await env.gallery(blob, name);
      saved.add(m.mediaId);
      try { localStorage.setItem(uidKey('parejas-gallery-'), JSON.stringify([...saved].slice(-400))); } catch {}
      toast('Guardado en la galería');
      return;
    }
    // WebP no lo entienden todas las apps al compartir: las fotos salen como JPEG
    let shareName = name;
    if (m.type === 'image' && blob.type === 'image/webp') {
      blob = await M.toJpeg(blob);
      shareName = `Nosotros_${m.mediaId}.jpg`;
    }
    await env.share(blob, shareName);
  }

  async function sheetAction(act, id, emoji) {
    const m = find(id);
    const once = !!document.getElementById('oncechk')?.checked;
    const hd = !!document.getElementById('hdchk')?.checked;
    closeSheet();
    if (act === 'pick' || act === 'cam-photo' || act === 'cam-video') {
      pickOnce = once;
      pickHD = hd;
      document.getElementById(act === 'pick' ? 'filein' : act === 'cam-photo' ? 'camphoto' : 'camvideo')?.click();
      return;
    }
    if (!m) return;
    try {
      if (act === 'reply') startReply(id);
      else if (act === 'react') await store.react(id, emoji, m.reactions?.[getS().uid] === emoji);
      else if (act === 'copy') await copyText(m.text);
      else if (act === 'edit') startEdit(id);
      else if (act === 'save' || act === 'share') await saveOrShare(m, act);
      else if (act === 'hide') {
        hidden.add(id);
        try { localStorage.setItem(uidKey('parejas-hidden-'), JSON.stringify([...hidden])); } catch {}
        update();
      } else if (act === 'del') {
        if (confirm('¿Eliminar este mensaje para todos? No se puede deshacer.')) await store.deleteMessage(m);
      }
    } catch (e) {
      console.error(e);
      toast(e.message || 'No se pudo completar');
    }
  }

  /* ------------------------------------------------------------ confirmaciones de entrega y lectura */

  /** Marca como entregados los mensajes de tu pareja que ya llegaron aquí y como leídos los que estás viendo. */
  function ack() {
    const S = getS();
    if (!S.coupleId || !store.markDelivered) return;
    const incoming = S.messages.filter((m) => !isMine(m) && !m.deleted && !m.pending);
    const needD = incoming.filter((m) => !m.deliveredAt && !acked.has('d' + m.id)).map((m) => m.id);
    if (needD.length) {
      needD.forEach((id) => acked.add('d' + id));
      store.markDelivered(needD).catch(() => needD.forEach((id) => acked.delete('d' + id)));
    }
    if (isActive() && document.visibilityState === 'visible') {
      const needR = incoming.filter((m) => !m.readAt && !acked.has('r' + m.id)).map((m) => m.id);
      if (needR.length) {
        needR.forEach((id) => acked.add('r' + id));
        store.markRead(needR).catch(() => needR.forEach((id) => acked.delete('r' + id)));
      }
    }
  }

  /* ------------------------------------------------------------ eventos */

  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('#msgs .msg');
    if (!el || el.classList.contains('uploading') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    g = { id: el.dataset.mid, el, x: e.clientX, y: e.clientY, dx: 0, drag: false, pid: e.pointerId };
    g.timer = setTimeout(() => {
      if (g && !g.drag) {
        suppressClickUntil = Date.now() + 600;
        openMenu(g.id);
        g = null;
      }
    }, LONG_PRESS_MS);
  });

  function endGesture(cancelled) {
    if (!g) return;
    clearTimeout(g.timer);
    const { el, dx, drag, id } = g;
    g = null;
    el.classList.remove('swiping');
    el.style.transform = '';
    el.style.removeProperty('--sw');
    if (drag) {
      suppressClickUntil = Date.now() + 400;
      if (!cancelled && dx >= SWIPE_REPLY_PX) startReply(id);
    }
  }

  root.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.pid) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.drag) {
      if (Math.abs(dy) > 10 || dx < -12) { clearTimeout(g.timer); g = null; return; } // es un desplazamiento vertical
      if (dx > 12 && dx > Math.abs(dy) * 1.5) {
        g.drag = true;
        clearTimeout(g.timer);
        g.el.classList.add('swiping');
        try { g.el.setPointerCapture(e.pointerId); } catch {}
      }
    }
    if (g.drag) {
      const t = Math.min(dx, 84);
      g.dx = dx;
      g.el.style.transform = `translateX(${t}px)`;
      g.el.style.setProperty('--sw', String(Math.min(1, t / SWIPE_REPLY_PX)));
    }
  });
  root.addEventListener('pointerup', () => endGesture(false));
  root.addEventListener('pointercancel', () => endGesture(true));
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('#msgs .msg')) e.preventDefault(); });

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act^="c-"]');
    if (!t) return;
    if (Date.now() < suppressClickUntil) { e.preventDefault(); return; }
    const act = t.dataset.act;
    if (act === 'c-attach') openAttachMenu();
    else if (act === 'c-open') openViewer(t.dataset.id);
    else if (act === 'c-react') {
      const m = find(t.dataset.id);
      if (m) store.react(m.id, t.dataset.emoji, m.reactions?.[getS().uid] === t.dataset.emoji).catch((err) => toast(err.message || 'No se pudo reaccionar'));
    }
    else if (act === 'c-audio') toggleAudio(t.dataset.id);
    else if (act === 'c-mic') startRecording();
    else if (act === 'c-rec-send') finishRecording(true);
    else if (act === 'c-rec-cancel') finishRecording(false);
    else if (act === 'c-ctx-cancel') {
      if (editing) { const i = document.getElementById('msgin'); if (i) i.value = ''; draft = ''; }
      replyTo = null;
      editing = null;
      renderCtx();
    } else if (act === 'c-quote') {
      const target = document.querySelector(`#msgs [data-mid="${q(t.dataset.q)}"]`);
      if (!target) { toast('Ese mensaje ya no está en la conversación'); return; }
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1300);
    }
  });

  root.addEventListener('input', (e) => {
    if (e.target.id !== 'msgin') return;
    draft = e.target.value;
    const has = !!draft.trim() || !!editing;
    document.getElementById('micbtn')?.classList.toggle('hidden', has);
    document.getElementById('sendbtn')?.classList.toggle('hidden', !has);
    if (!editing) onTypeInput(!!draft.trim());
  });

  root.addEventListener('change', (e) => {
    if (!['filein', 'camphoto', 'camvideo'].includes(e.target.id)) return;
    const files = [...e.target.files];
    e.target.value = '';
    const once = pickOnce;
    const hd = pickHD;
    pickOnce = false;
    pickHD = !!prefs().hd;
    if (files.length) handleFiles(files, once, hd);
  });

  /** Archivos pegados (del portapapeles o desde el teclado): se pide confirmar antes de enviarlos. */
  function addFiles(files) {
    const ok = files.filter((f) => M.kindOf(f) && M.kindOf(f) !== 'audio');
    if (!ok.length) { toast('Solo se pueden enviar fotos, videos y GIF'); return; }
    const what = ok.length === 1 ? 'este archivo' : `estos ${ok.length} archivos`;
    if (!confirm(`¿Enviar ${what} a ${partnerName()}?`)) return;
    handleFiles(ok, false);
  }
  root.addEventListener('paste', (e) => {
    if (e.target.id !== 'msgin') return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  root.addEventListener('submit', (e) => {
    if (e.target.id !== 'composer') return;
    e.preventDefault();
    const input = document.getElementById('msgin');
    if (!input) return;
    const text = input.value.trim();
    if (editing) {
      const id = editing.id;
      const m = find(id);
      if (!text && !m?.type) return;
      editing = null;
      input.value = '';
      draft = '';
      renderCtx();
      if (m && text !== (m.text || '')) store.editMessage(id, text).catch((err) => toast(err.message || 'No se pudo editar'));
      return;
    }
    if (!text) return;
    const extra = replyTo ? { replyTo: { ...replyTo } } : {};
    replyTo = null;
    input.value = '';
    draft = '';
    stopTypingNow();
    renderCtx();
    store.sendMessage(text, extra).catch((err) => toast(err.message || 'No se pudo enviar'));
  });

  sheetRoot.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-vnav]');
    if (nav) { goViewer(Number(nav.dataset.vnav)); return; }
    if (vw && Date.now() < vw.noClickUntil) return; // el dedo acaba de pellizcar o deslizar: no es un toque
    const item = e.target.closest('[data-sheet-act]');
    if (item && item.dataset.sheetAct === 'react-more') {
      const gr = document.getElementById('rxgrid');
      const open = gr?.classList.toggle('hidden') === false;
      item.setAttribute('aria-expanded', String(open));
      return;
    }
    if (item) { sheetAction(item.dataset.sheetAct, item.dataset.id, item.dataset.emoji); return; }
    if (e.target.closest('.sheet-switch')) return; // el interruptor no cierra el menú
    if (e.target.closest('video, .vbody img') && !e.target.closest('.vclose')) return;
    if (e.target.closest('[data-sheet-close]')) closeSheet();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  // Si la app pasa a segundo plano con la pantalla protegida abierta, se cierra (y la foto no se queda en memoria).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (onceUrl) closeSheet();
      if (!rec) stopTypingNow();
    }
  });

  window.addEventListener('resize', () => { if (document.querySelector('.chatwrap')) fit(); });

  /** Atrás: cierra lo que esté abierto en el chat. Devuelve true si hizo algo. */
  function back() {
    if (sheetRoot.innerHTML.trim()) { closeSheet(); return true; }
    if (rec) { finishRecording(false); return true; }
    if (editing || replyTo) {
      if (editing) { const i = document.getElementById('msgin'); if (i) i.value = ''; draft = ''; }
      editing = null;
      replyTo = null;
      renderCtx();
      return true;
    }
    return false;
  }

  return {
    view,
    update,
    fit,
    back,
    addFiles,
    afterRender,
    ack,
    closeSheet,
    setPartnerTyping,
    refresh: () => { hydrate(); },
    /** Borra lo guardado en este teléfono de una pareja (al borrar el chat o eliminar la pareja). */
    async wipeLocal(code) {
      stopAudio();
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear(); loads.clear(); local = new Set(); hidden = new Set(); saved = new Set();
      try { localStorage.removeItem(uidKey('parejas-hidden-')); localStorage.removeItem(uidKey('parejas-gallery-')); } catch {}
      if (code) await FileCache.removePrefix(code + '/');
      if (document.getElementById('msgs')) update();
    },
    setDraft(text) { draft = text; replyTo = null; editing = null; },
    focus() { document.getElementById('msgin')?.focus(); },
    reset() {
      if (rec) finishRecording(false);
      stopAudio();
      replyTo = null; editing = null; draft = ''; pending = []; partnerTyping = null;
      urls.clear(); loads.clear(); acked.clear();
      local = new Set(); localFor = null;
      loadSets();
    },
  };
}
