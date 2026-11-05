import { firebaseConfig } from './firebase-config.js';
import { DemoStore, FirebaseStore, isFirebaseConfigured } from './lib/store.js';
import * as C from './lib/calc.js';
import { isNative, native } from './lib/native.js';
import { ic } from './lib/icons.js';
import * as TV from './lib/series.js';
import * as MD from './lib/media.js';
import { createChat } from './lib/chat.js';
import { Prefs, DL_KINDS } from './lib/prefs.js';
import { confetti } from './lib/confetti.js';
import { getNet, onNet } from './lib/net.js';

const Theme = window.Theme;

const $app = document.getElementById('app');
// ?demo=1 en la dirección fuerza el modo demo (pruebas en el navegador, sin tocar Firebase).
const forceDemo = new URLSearchParams(location.search).has('demo');
const store = isFirebaseConfigured(firebaseConfig) && !forceDemo ? new FirebaseStore(firebaseConfig) : new DemoStore();

let S = store.snapshot ? store.snapshot() : { signedIn: false };
let tab = 'inicio';
let monthShift = 0;
let selDay = C.ymd(new Date());
let showForm = null; // null | {} (nueva) | {id,...} (editar)
let dirty = false;
let welcomeName = '';
let authMode = 'signup'; // 'signup' | 'login'
let nativeStatus = null;
let pushedCfg = '';
let autoSynced = false;
let lastReadAt = Number(safeGet('parejas-read') || 0);

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDay = (d) => d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = (d) => d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
const fmtNum = (n) => Math.round(n).toLocaleString('es');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 2800);
}

let currentKey = 'x';
const running = new Set();

async function run(fn, okMsg) {
  const key = currentKey; // la acción que se está atendiendo ahora mismo (ver los manejadores de abajo)
  if (running.has(key)) return;
  running.add(key);
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    console.error(e);
    toast(e?.message || 'Algo salió mal');
  } finally {
    running.delete(key);
  }
}

/* ------------------------------------------------------------ derivados */

const partnerName = () => S.partner?.name || 'Tu pareja';
const myName = () => S.me?.name || 'Yo';
const hasLoc = (p) => p && p.lat != null && p.lon != null;

const GENDERS = [['mujer', 'Mujer'], ['hombre', 'Hombre'], ['nobinario', 'No binario'], ['otro', 'Otro / prefiero no decir']];
const GENDER_NAME = { mujer: 'mujer', hombre: 'hombre', nobinario: 'persona no binaria', otro: 'otra identidad' };

function genderOptions(selected, placeholder) {
  return (placeholder ? `<option value="" ${selected ? '' : 'selected'} disabled>${placeholder}</option>` : '') +
    GENDERS.map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`).join('');
}

/** "Mujer y hombre", "Hombre y hombre"… según lo que eligió cada uno. */
function coupleType() {
  const a = S.me?.gender;
  const b = S.partner?.gender || S.couple?.partnerGender;
  if (!a || !b) return null;
  return cap(`${GENDER_NAME[a]} y ${GENDER_NAME[b]}`);
}

function cyclesToShow() {
  const list = [];
  if (S.me?.cycle?.last && S.me.gender !== 'hombre') list.push({ who: 'me', name: myName(), cycle: S.me.cycle });
  if (S.partner?.cycle?.last && S.partner.cycleShare) list.push({ who: 'pa', name: partnerName(), cycle: S.partner.cycle });
  return list;
}

function eventsOf(who) {
  const p = who === 'me' ? S.me : S.partner;
  return p?.events || [];
}

function eventsOnDay(events, day) {
  const s = C.startOfDay(day).getTime();
  const e = s + 86400000;
  return events.filter((ev) => ev.s < e && ev.e > s).sort((a, b) => a.s - b.s);
}

function best() {
  return C.bestDates(eventsOf('me'), eventsOf('pa'), new Date(), { cycles: cyclesToShow().filter((c) => c.who === 'pa').map((c) => c.cycle) });
}

/* ------------------------------------------------------------ vistas */

function viewWelcome() {
  const demo = store.kind === 'demo';
  let body;
  if (!S.signedIn) {
    const signup = authMode === 'signup';
    body = `<p class="muted">Crea tu cuenta para no perder nada si cambias de teléfono. Después uno de los dos crea la pareja y le pasa un código de 6 letras al otro.</p>
      <div class="seg" role="tablist">
        <button class="${signup ? 'on' : ''}" data-act="auth-mode" data-mode="signup" role="tab" aria-selected="${signup}">Crear cuenta</button>
        <button class="${signup ? '' : 'on'}" data-act="auth-mode" data-mode="login" role="tab" aria-selected="${!signup}">Iniciar sesión</button></div>
      <form id="authform" class="stack" autocomplete="on">
        <label class="field">Correo<input type="email" id="aemail" autocomplete="email" inputmode="email" required></label>
        <label class="field">Contraseña${signup ? ' (mínimo 6 caracteres)' : ''}<input type="password" id="apass" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="6"></label>
        <button class="btn" type="submit">${signup ? 'Crear cuenta' : 'Entrar'}</button>
        ${signup ? '' : '<button class="btn ghost small" type="button" data-act="auth-reset">Olvidé mi contraseña</button>'}
      </form>
      ${nativeStatus?.google && firebaseConfig.googleWebClientId ? '<div class="muted small" style="text-align:center">— o —</div><button class="btn ghost" type="button" data-act="google-in"><span class="gmark">G</span> Continuar con Google</button>' : ''}
      ${!isNative && store.kind === 'firebase' ? '<div class="muted small" style="text-align:center">— o —</div><button class="btn ghost" type="button" data-act="google-web"><span class="gmark">G</span> Continuar con Google</button>' : ''}`;
  } else {
    body = `
      <label class="field">Tu nombre
        <input type="text" id="wname" value="${esc(welcomeName)}" maxlength="30" autocomplete="given-name">
      </label>
      <label class="field">Yo soy<select id="wgender">${genderOptions('', 'Elige…')}</select></label>
      <label class="field">Mi pareja es<select id="wpartner">${genderOptions('', 'Elige…')}</select></label>
      <label class="field">Contraseña de la pareja (opcional, recomendada)
        <input type="password" id="wcpass" autocomplete="new-password" maxlength="60" placeholder="Evita que alguien se una con el código">
      </label>
      <button class="btn" data-act="create">Crear nuestra pareja</button>
      <div class="muted small" style="text-align:center">— o, si tu pareja ya creó la suya —</div>
      <label class="field">Código de tu pareja
        <input type="text" id="wcode" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="ABC123">
      </label>
      <label class="field">Contraseña de la pareja (si la tiene)
        <input type="password" id="wjpass" autocomplete="off" maxlength="60">
      </label>
      <button class="btn ghost" data-act="join">Unirme con el código</button>
      <p class="muted small" style="margin:0">Si ya tenías pareja y entras desde otro teléfono, inicia sesión con tu correo y todo vuelve solo.</p>`;
  }
  return `<div class="welcome">
    <div><div class="logo-sm">${ic('heart', 34, true)}</div><h1>Nosotros</h1>
    <p class="muted">Distancia, días sin vernos, aniversario, agendas, ciclo, mensajes y series. Todo en un solo lugar para los dos.</p></div>
    ${demo ? `<div class="card small"><b>Modo demo.</b> Aún no hay Firebase configurado, así que los datos se guardan solo en este navegador y tu pareja es simulada. Mira <code>LEEME.md</code> para conectar la app real.</div>` : ''}
    <div class="stack">${body}</div></div>`;
}

/** Por qué no se puede calcular la distancia. */
function locWhy() {
  if (S.me?.shareLoc === false) return 'tú no compartes tu ubicación (Ajustes → Ubicación)';
  if (!hasLoc(S.me)) return 'pon la tuya en Ajustes';
  if (S.partner?.shareLoc === false) return `${esc(partnerName())} no comparte su ubicación`;
  return 'tu pareja aún no pone la suya';
}

const hasSeenOn = (key) => S.couple?.lastSeen === key || (S.seen || []).some((x) => x.id === key);

/** Contenido de la tarjeta «Hace cuánto no nos vemos»: «Nos vimos hoy» si ya se vieron; «¡Hoy nos vemos!» solo si hoy toca según el calendario. */
function seenBody(since, now) {
  const key = C.ymd(now);
  if (hasSeenOn(key)) return '<div class="big">Nos vimos hoy</div><div class="muted small">¡Qué bueno!</div>';
  if (meetingsOnDay(now).length) {
    return `<div class="big">¡Hoy nos vemos!</div>${since == null ? '' : `<div class="muted small">Hace ${plural(since, 'día', 'días')} que no se ven</div>`}`;
  }
  if (since == null) return '<p class="muted">Aún no hay fecha del último encuentro.</p>';
  return `<div class="big">${since} <small>${since === 1 ? 'día' : 'días'}</small></div><div class="muted small">Desde el ${esc(fmtDay(C.parseYmd(S.couple.lastSeen)))}</div>`;
}

function viewHome() {
  const now = new Date();
  const cards = [];
  if (!S.partner) {
    cards.push(`<div class="card"><h2>⏳ Esperando a tu pareja</h2>
      <p class="muted">Pásale este código para que se una:</p><div class="code">${esc(S.coupleId)}</div></div>`);
  }
  // distancia
  const d = hasLoc(S.me) && hasLoc(S.partner) ? C.distanceKm(S.me, S.partner) : null;
  let dist;
  if (d == null) {
    dist = `<div class="big" style="font-size:1.5rem">¿A qué distancia estamos?</div>
      <p class="muted">Faltan las ubicaciones: ${locWhy()}.</p>
      ${!hasLoc(S.me) ? '<button class="btn ghost small" data-go="ajustes" data-page="ubicacion">Ir a Ajustes</button>' : ''}`;
  } else if (d < 1) {
    dist = `<div class="big">¡Juntos!</div><div class="muted">Están en el mismo lugar</div>`;
  } else {
    dist = `<div class="muted">Nos separan</div><div class="big">${fmtNum(d)} <small>km</small></div>
      <div class="muted small">${esc(S.me.city || 'Tú')} ↔ ${esc(S.partner.city || partnerName())}</div>`;
  }
  cards.push(`<div class="card hero"><div class="names">${esc(myName())} & ${esc(partnerName())}</div>${dist}</div>`);

  // sin vernos
  const since = C.daysSince(S.couple?.lastSeen, now);
  cards.push(`<div class="card"><h2>${ic('eye')} Hace cuánto no nos vemos</h2>
    ${seenBody(since, now)}
    <div class="row wrap" style="margin-top:10px"><button class="btn ghost small" data-act="seen-today">Nos vimos hoy</button>
    <label class="small muted row">Otra fecha <input type="date" data-field="couple.lastSeen" value="${esc(S.couple?.lastSeen || '')}" max="${C.ymd(now)}"></label></div></div>`);

  // aniversario
  const ann = C.nextAnniversary(S.couple?.anniversary, now);
  if (ann) {
    const tg = C.together(S.couple.anniversary, now);
    const mon = C.nextMonthiversary(S.couple.anniversary, now);
    cards.push(`<div class="card"><h2>${ic('gift')} Próximo aniversario</h2>
      ${ann.days === 0 ? `<div class="big">¡Hoy cumplen ${plural(ann.years, 'año', 'años')}!</div>` : `<div class="big">${ann.days} <small>${ann.days === 1 ? 'día' : 'días'}</small></div><div class="muted small">${esc(cap(fmtDay(ann.date)))} · cumplen ${plural(ann.years, 'año', 'años')}</div>`}
      <div class="muted small" style="margin-top:8px">Juntos hace ${tg.years ? plural(tg.years, 'año', 'años') + ', ' : ''}${plural(tg.months, 'mes', 'meses')} y ${plural(tg.days, 'día', 'días')} (${fmtNum(tg.totalDays)} días).
      ${mon && mon.days > 0 ? ` Mesiversario en ${plural(mon.days, 'día', 'días')}.` : mon ? ' ¡Hoy es su mesiversario!' : ''}</div></div>`);
  } else {
    cards.push(`<div class="card"><h2>${ic('gift')} Próximo aniversario</h2><p class="muted">Pon la fecha en que empezaron.</p>
      <label class="field">Fecha de inicio<input type="date" data-field="couple.anniversary" max="${C.ymd(now)}"></label></div>`);
  }

  // ciclo
  const cyc = cyclesToShow();
  if (cyc.length) {
    for (const c of cyc) cards.push(cycleCard(c, now));
  } else if (S.partner && !S.partner.cycle) {
    // nada: la pareja decide si lo comparte
  }

  // próxima cita
  const nextMeet = upcomingMeetings()[0];
  if (nextMeet) {
    const day = new Date(nextMeet.s);
    const dd = C.diffDays(now, day);
    cards.push(`<div class="card"><h2>${ic('heart')} Próxima cita</h2>
      <div class="big">${dd === 0 ? '¡Hoy!' : `${dd} <small>${dd === 1 ? 'día' : 'días'}</small>`}</div>
      <div class="muted small">${esc(cap(fmtDay(day)))} · ${fmtTime(nextMeet.s)}–${fmtTime(nextMeet.e)}${nextMeet.note ? ' · ' + esc(nextMeet.note) : ''}</div>
      ${cycleLinesHtml(day, false)}
      <button class="btn ghost small" data-day="${C.ymd(day)}" style="margin-top:8px">Ver en la agenda</button></div>`);
  }

  // mejor fecha
  const b = best();
  cards.push(`<div class="card"><h2>${ic('calendar')} Mejor fecha para vernos</h2>${
    b.length
      ? `<div class="best-item top"><b>${esc(cap(fmtDay(b[0].date)))}</b><span class="muted small">${bestDetail(b[0])}</span></div>
         <div class="row wrap" style="margin-top:10px"><button class="btn small" data-act="meet-best" data-i="0">Agendar</button><button class="btn ghost small" data-act="propose" data-i="0">Proponer por mensaje</button><button class="btn ghost small" data-go="agenda">Ver más</button></div>`
      : '<p class="muted">No encuentro un día en 60 días en que ambos tengan 3 horas libres. Conecten sus calendarios en Ajustes.</p>'
  }</div>`);

  // último mensaje
  const last = S.messages[S.messages.length - 1];
  if (last) {
    cards.push(`<div class="card"><h2>${ic('chat')} Último mensaje</h2><p style="margin:0">${esc(MD.previewOf(last))}</p>
      <p class="muted small" style="margin:4px 0 8px">${last.from === S.uid || last.from === 'me' ? 'Tú' : esc(partnerName())} · ${fmtTime(last.at)}</p>
      <button class="btn ghost small" data-go="chat">Abrir chat</button></div>`);
  }
  return cards.join('');
}

function cycleCard({ who, name, cycle }, now) {
  const info = C.cycleInfo(cycle, now);
  const label = who === 'me' ? 'Mi ciclo' : `Ciclo de ${esc(name)}`;
  if (!info) return `<div class="card"><h2>${ic('drop')} ${label}</h2><p class="muted">La fecha del último periodo está en el futuro; revísala en Ajustes.</p></div>`;
  const ph = C.PHASES[info.phase];
  const chip = info.phase === 'menstruacion' ? 'period' : info.phase === 'fertil' ? 'fertile' : '';
  const pct = (n) => `${(n / info.len) * 100}%`;
  const ov = C.diffDays(now, info.ovulation);
  return `<div class="card"><h2>${ic('drop')} ${label}</h2>
    <div class="row between"><span class="chip ${chip}">${ph.nombre}</span><span class="muted small">Día ${info.dayOfCycle} de ${info.len}</span></div>
    <div class="bar" style="margin:10px 0" aria-hidden="true">
      <span style="width:${pct(info.period)};background:var(--period)"></span>
      <span style="width:${pct(info.len - 14 - 5 - info.period + 1)};background:var(--surface2)"></span>
      <span style="width:${pct(6)};background:var(--fertile)"></span>
      <span style="flex:1;background:var(--surface2);opacity:.6"></span></div>
    <p style="margin:0">${ph.nota}</p>
    <p class="muted small" style="margin:6px 0 0">Próximo periodo: ${esc(fmtDay(info.nextStart))} (${info.daysToNext === 0 ? 'hoy' : 'en ' + plural(info.daysToNext, 'día', 'días')}).
    ${ov >= 0 ? `Ovulación estimada ${ov === 0 ? 'hoy' : 'en ' + plural(ov, 'día', 'días')}.` : ''} Es una estimación por calendario, no un método anticonceptivo.</p></div>`;
}

function bestDetail(b) {
  const slots = b.slots.filter(([s, e]) => e - s >= 3600000).map(([s, e]) => `${fmtTime(s)}–${fmtTime(e)}`).join(' y ');
  return `${b.fullDay ? 'Los dos libres todo el día' : 'Libres juntos: ' + slots}${b.weekend ? ' · fin de semana' : ''}${b.periodDay ? ' · ojo: días de periodo' : ''}`;
}

/* ------------------------------------------------------------ citas para verse */

const timeStr = (ms) => `${C.pad(new Date(ms).getHours())}:${C.pad(new Date(ms).getMinutes())}`;
let meetForm = null; // null | { id?, date, from, to, note, tell }

const upcomingMeetings = () => (S.meetings || []).filter((m) => m.e > Date.now()).sort((a, b) => a.s - b.s);

function meetingsOnDay(day) {
  const s = C.startOfDay(day).getTime();
  const e = s + 86400000;
  return (S.meetings || []).filter((m) => m.s < e && m.e > s).sort((a, b) => a.s - b.s);
}

/** Cómo va el ciclo de cada quien (de los que se comparten) ese día. */
function cycleLinesHtml(day, withNote) {
  const lines = cyclesToShow().map((c) => ({ c, sum: C.phaseSummary(c.cycle, day) })).filter((x) => x.sum);
  return lines.map(({ c, sum }) => `<div class="phase ${sum.kind}"><span class="pdot"></span><div><b>${c.who === 'me' ? 'Tu ciclo' : 'Ciclo de ' + esc(c.name)}:</b> ${esc(sum.text)}${withNote ? `<div class="muted small">${esc(sum.nota)}</div>` : ''}</div></div>`).join('');
}

function newMeetForm(date, slot) {
  const d = date || new Date(Date.now() + 86400000);
  let from = '17:00';
  let to = '20:00';
  if (slot) {
    const start = Math.max(slot[0], Date.now());
    const r = Math.ceil(start / 1800000) * 1800000;
    from = timeStr(r);
    to = timeStr(Math.min(slot[1], r + 3 * 3600000));
  }
  return { date: C.ymd(d), from, to, note: '', tell: true };
}

function captureMeetForm() {
  const f = document.getElementById('meetform');
  if (!f || !meetForm) return;
  for (const k of ['date', 'from', 'to', 'note']) if (f.elements[k]) meetForm[k] = f.elements[k].value;
  if (f.elements.tell) meetForm.tell = f.elements.tell.checked;
}

function meetRange(f) {
  const s = new Date(`${f.date}T${f.from}`).getTime();
  const e = new Date(`${f.date}T${f.to}`).getTime();
  return { s, e };
}

/** Qué parte del ciclo es ese día y si choca con algo de la agenda de alguno de los dos. */
function meetPhaseHtml() {
  const f = meetForm;
  if (!f || !f.date) return '';
  const day = C.parseYmd(f.date);
  let out = cycleLinesHtml(day, true);
  const { s, e } = meetRange(f);
  if (e > s) {
    const clash = [['Tú', eventsOf('me')], [partnerName(), eventsOf('pa')]].flatMap(([who, list]) => list.filter((ev) => !ev.free && ev.s < e && ev.e > s).map((ev) => `${esc(who)}: ${esc(ev.t)} (${ev.allDay ? 'todo el día' : fmtTime(ev.s) + '–' + fmtTime(ev.e)})`));
    if (clash.length) out += `<div class="phase warn"><span class="pdot"></span><div><b>Ojo, a esa hora hay:</b><div class="muted small">${clash.join('<br>')}</div></div></div>`;
  }
  return out;
}

/** Campo de hora con el estilo de la app (abre el selector propio; el valor va en un campo oculto para el formulario). */
function timeField(name, label, value) {
  return `<div class="fieldbox">${label}<button type="button" class="timebtn" data-act="pick-time" data-field="${name}">${ic('clock', 18)}<b>${esc(value)}</b></button><input type="hidden" name="${name}" value="${esc(value)}"></div>`;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Selector de hora propio: una columna de horas y otra de minutos (de 5 en 5). */
function openTimePicker(field) {
  captureMeetForm();
  closeTimePicker();
  const [h0, m0] = (meetForm?.[field] || '17:00').split(':').map(Number);
  let m = Math.round(m0 / 5) * 5;
  let h = h0;
  if (m === 60) { m = 0; h = (h + 1) % 24; }
  let selH = h;
  let selM = m;
  const items = (count, step, sel) => Array.from({ length: count }, (_, i) => i * step).map((v) => `<button type="button" class="tp-item${v === sel ? ' on' : ''}" data-v="${v}">${pad2(v)}</button>`).join('');
  const el = document.createElement('div');
  el.id = 'time-root';
  el.innerHTML = `<div class="sheet-back" data-tp-close><div class="sheet timesheet" role="dialog" aria-label="Elegir hora">
    <div class="tp-title">${field === 'from' ? 'Hora de inicio' : 'Hora de término'}</div>
    <div class="tp-cols"><div class="tp-col" data-col="h" role="listbox" aria-label="Hora">${items(24, 1, selH)}</div><div class="tp-sep">:</div><div class="tp-col" data-col="m" role="listbox" aria-label="Minutos">${items(12, 5, selM)}</div></div>
    <div class="row"><button type="button" class="btn ghost" data-tp-close style="flex:1">Cancelar</button><button type="button" class="btn" data-tp-ok style="flex:1">Listo</button></div></div></div>`;
  document.body.appendChild(el);
  el.querySelectorAll('.tp-col .on').forEach((b) => b.scrollIntoView({ block: 'center' }));
  el.addEventListener('click', (e) => {
    const item = e.target.closest('.tp-item');
    if (item) {
      const col = item.parentElement;
      col.querySelectorAll('.on').forEach((b) => b.classList.remove('on'));
      item.classList.add('on');
      if (col.dataset.col === 'h') selH = Number(item.dataset.v);
      else selM = Number(item.dataset.v);
      return;
    }
    if (e.target.closest('[data-tp-ok]')) {
      const val = `${pad2(selH)}:${pad2(selM)}`;
      const form = document.getElementById('meetform');
      if (form && meetForm) {
        form.elements[field].value = val;
        meetForm[field] = val;
        // si el término queda antes del inicio, se corre una hora después del inicio
        if (field === 'from' && meetForm.to <= val) {
          const t = Math.min(23 * 60 + 55, selH * 60 + selM + 60);
          meetForm.to = `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
          form.elements.to.value = meetForm.to;
        }
        form.querySelectorAll('.timebtn').forEach((b) => { b.querySelector('b').textContent = meetForm[b.dataset.field]; });
        form.elements[field].dispatchEvent(new Event('change', { bubbles: true }));
      }
      closeTimePicker();
    } else if (e.target.closest('[data-tp-close]') && (e.target === e.currentTarget.firstElementChild || e.target.closest('button'))) {
      closeTimePicker();
    }
  });
}

function closeTimePicker() {
  document.getElementById('time-root')?.remove();
}

function meetFormHtml() {
  const f = meetForm;
  return `<form class="card stack" id="meetform"><h2>${ic('heart')} ${f.id ? 'Cambiar la cita' : 'Agendar una cita'}</h2>
    <label class="field">Día<input type="date" name="date" value="${esc(f.date)}" min="${C.ymd(new Date())}" required></label>
    <div class="grid2">${timeField('from', 'Desde', f.from)}${timeField('to', 'Hasta', f.to)}</div>
    <label class="field">Nota o lugar (opcional)<input type="text" name="note" value="${esc(f.note)}" maxlength="80" autocomplete="off" placeholder="Ej.: cena en tu casa"></label>
    <div id="meetphase" class="stack">${meetPhaseHtml()}</div>
    ${f.id ? '' : `<label class="check"><input type="checkbox" name="tell" ${f.tell ? 'checked' : ''}> Avisar a ${esc(partnerName())} por mensaje</label>`}
    <p class="muted small" style="margin:0">${isNative && Prefs.get().meetToCal ? 'Se guarda en el calendario de tu teléfono y de tu pareja, y ese tiempo no cuenta como ocupado al buscar fechas.' : 'Queda en la agenda de los dos y no cuenta como ocupado al buscar fechas.'}</p>
    <div class="row wrap"><button class="btn" type="submit">${f.id ? 'Guardar cambios' : 'Agendar'}</button><button class="btn ghost" type="button" data-act="meet-cancel">Cancelar</button></div></form>`;
}

function meetingCard(m) {
  const day = new Date(m.s);
  return `<div class="meet"><span class="meet-ic">${ic('heart', 18, true)}</span><div class="meet-main"><b>${esc(cap(fmtDay(day)))}</b>
    <div class="muted small">${fmtTime(m.s)}–${fmtTime(m.e)}${m.note ? ' · ' + esc(m.note) : ''}</div>${cycleLinesHtml(day, false)}</div>
    <div class="meet-btns"><button class="btn ghost small" data-act="meet-edit" data-id="${esc(m.id)}">Cambiar</button><button class="btn danger small" data-act="meet-del" data-id="${esc(m.id)}">Quitar</button></div></div>`;
}

const CALMAP_KEY = 'parejas-calmap';
function readCalMap() { try { return JSON.parse(localStorage.getItem(CALMAP_KEY)) || {}; } catch { return {}; } }
let calSyncing = false;

/** Pone las citas en el calendario del teléfono (y quita las que ya no existen). Etiquetadas: la app sabe que no son «ocupado». */
async function syncMeetingsToCalendar() {
  if (!isNative || calSyncing || !S.coupleId || !Prefs.get().meetToCal) return;
  calSyncing = true;
  try {
    nativeStatus = nativeStatus || await native.status();
    if (!nativeStatus.calendarWrite) return;
    const map = readCalMap();
    const list = S.meetings || [];
    const ids = new Set(list.map((m) => m.id));
    for (const [id, v] of Object.entries(map)) {
      if (!ids.has(id)) { await native.removeEvent(v.ev); delete map[id]; }
    }
    for (const m of list) {
      const sig = `${m.s}|${m.e}|${m.note || ''}`;
      const cur = map[m.id];
      if (cur && cur.sig === sig) continue;
      if (m.e < Date.now()) continue;
      if (cur) { await native.removeEvent(cur.ev); delete map[m.id]; }
      const r = await native.addEvent({ title: `Cita con ${partnerName()}`, s: m.s, e: m.e, notes: m.note || '' });
      if (r.ok) map[m.id] = { ev: r.eventId, sig };
    }
    safeSet(CALMAP_KEY, JSON.stringify(map));
  } catch (e) {
    console.error(e);
  } finally {
    calSyncing = false;
  }
}

/* ------------------------------------------------------------ colores del calendario */

const CAL_ITEMS = [['me', 'Tus eventos'], ['pa', 'Eventos de tu pareja'], ['period', 'Periodo'], ['fertile', 'Ventana fértil'], ['ovul', 'Ovulación'], ['meet', 'Citas para verse']];
const PALETTE = ['#e11d48', '#f97316', '#eab308', '#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#db2777'];

function defaultColors() {
  const dark = Theme.isDark();
  const A = Theme.ACCENTS[Theme.get().accent];
  const accent = dark ? A.dark : A.light;
  return { me: accent, pa: dark ? A.pd : A.pl, period: dark ? '#fb7185' : '#f43f5e', fertile: dark ? '#2dd4bf' : '#14b8a6', ovul: dark ? '#fbbf24' : '#f59e0b', meet: accent };
}

function applyColors() {
  const def = defaultColors();
  const cur = Prefs.get().colors;
  const s = document.documentElement.style;
  const vars = { me: '--me', pa: '--partner', period: '--period', fertile: '--fertile', ovul: '--ovul', meet: '--meet' };
  for (const [k, v] of Object.entries(vars)) s.setProperty(v, cur[k] || def[k]);
}

function colorsCard() {
  const cur = Prefs.get().colors;
  const def = defaultColors();
  return `<div class="card stack"><h2>${ic('calendar')} Colores del calendario</h2>
    ${CAL_ITEMS.map(([k, label]) => `<div class="colrow"><span>${label}</span><div class="swatches sm" role="group" aria-label="Color de: ${label}">
      <button class="sw" data-act="cal-color" data-key="${k}" data-hex="" aria-pressed="${!cur[k]}" aria-label="Predeterminado" style="--c:${def[k]};color:#fff">${!cur[k] ? ic('check', 14) : ''}</button>
      ${PALETTE.map((h) => `<button class="sw" data-act="cal-color" data-key="${k}" data-hex="${h}" aria-pressed="${cur[k] === h}" aria-label="${h}" style="--c:${h};color:#fff">${cur[k] === h ? ic('check', 14) : ''}</button>`).join('')}</div></div>`).join('')}
    <p class="muted small" style="margin:0">Se guardan en este teléfono. El círculo de la izquierda es el color de siempre.</p></div>`;
}

/* ------------------------------------------------------------ agenda */

function viewAgenda() {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth() + monthShift, 1);
  const title = first.toLocaleDateString('es', { month: 'long', year: 'numeric' });
  const offset = (first.getDay() + 6) % 7; // semana empieza en lunes
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const meEv = eventsOf('me');
  const paEv = eventsOf('pa');
  const cyc = cyclesToShow();
  const b = best();
  const bestSet = new Set(b.map((x) => C.ymd(x.date)));
  const meetDays = new Set((S.meetings || []).filter((m) => m.e > Date.now() - 86400000 * 400).map((m) => C.ymd(new Date(m.s))));
  const seenSet = new Set((S.seen || []).map((x) => x.id));
  let cells = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < offset; i++) cells += '<div></div>';
  for (let n = 1; n <= daysInMonth; n++) {
    const d = new Date(first.getFullYear(), first.getMonth(), n);
    const key = C.ymd(d);
    const past = C.diffDays(today, d) < 0;
    const kinds = cyc.map((c) => C.dayKindOn(c.cycle, d));
    const isPeriod = kinds.includes('menstruacion');
    const isOvul = kinds.includes('ovulacion');
    const isFertile = isOvul || kinds.includes('fertil');
    const cls = ['day', past ? 'off' : '', key === C.ymd(today) ? 'today' : '', key === selDay ? 'sel' : '', isPeriod ? 'period' : isOvul ? 'ovul' : isFertile ? 'fertile' : ''].join(' ');
    const m = eventsOnDay(meEv, d).length;
    const p = eventsOnDay(paEv, d).length;
    const isBest = bestSet.has(key);
    const meet = meetDays.has(key);
    const label = [fmtDay(d), isPeriod ? 'periodo' : '', isOvul ? 'ovulación estimada' : isFertile ? 'ventana fértil' : '', meet ? 'tienen una cita' : '', seenSet.has(key) ? 'se vieron' : '', isBest ? 'mejor fecha para verse' : '', m ? plural(m, 'evento tuyo', 'eventos tuyos') : '', p ? plural(p, 'evento de tu pareja', 'eventos de tu pareja') : ''].filter(Boolean).join(', ');
    const left = isPeriod ? `<span class="mark">${ic('drop', 11, true)}</span>` : isOvul ? `<span class="mark ov">${ic('sparkle', 12)}</span>` : '';
    const right = meet ? `<span class="star meet">${ic('heart', 12, true)}</span>` : isBest ? `<span class="star">${ic('star', 12, true)}</span>` : '';
    cells += `<button class="${cls}" data-day="${key}" aria-label="${esc(label)}"><span>${n}</span>${left}${right}${seenSet.has(key) ? `<span class="seenmk">${ic('eye', 11)}</span>` : ''}<span class="dots">${m ? '<i class="me"></i>' : ''}${p ? '<i class="pa"></i>' : ''}</span></button>`;
  }
  const sel = C.parseYmd(selDay);
  const evRow = (ev, cls) => `<div class="ev"><b style="background:var(--${cls})"></b><div>${esc(ev.t)}<div class="muted small">${ev.allDay ? 'Todo el día' : fmtTime(ev.s) + '–' + fmtTime(ev.e)}</div></div></div>`;
  const mine = eventsOnDay(meEv, sel);
  const theirs = eventsOnDay(paEv, sel);
  const dayMeets = meetingsOnDay(sel);
  const noCal = !S.me?.eventsAt || !S.partner?.eventsAt;
  const upcoming = upcomingMeetings();
  return `${meetForm ? meetFormHtml() : `<button class="btn" data-act="meet-new">${ic('heart', 18)} Agendar una cita</button>`}
    <div class="card">
      <div class="row between" style="margin-bottom:8px">
        <button class="btn ghost small" data-act="month" data-d="-1" aria-label="Mes anterior">‹</button>
        <h2>${esc(cap(title))}</h2>
        <button class="btn ghost small" data-act="month" data-d="1" aria-label="Mes siguiente">›</button>
      </div>
      <div class="cal">${cells}</div>
      <div class="legend" aria-label="Significado de las marcas">${legendHtml(cyc)}</div>
      ${seenSet.size ? `<p class="muted small" style="margin:8px 0 0">Se han visto ${plural(seenSet.size, 'día', 'días')} (los que detecta la ubicación y los que anotan).</p>` : ''}
    </div>
    <div class="card"><h2>${esc(cap(fmtDay(sel)))}</h2>
      ${cycleLinesHtml(sel, false)}
      ${seenSet.has(C.ymd(sel)) ? `<span class="chip fertile">${ic('eye', 13)} Se vieron este día${(S.seen || []).find((x) => x.id === C.ymd(sel))?.how === 'auto' ? ' (lo detectó la ubicación)' : ''}</span>` : ''}
      ${bestSet.has(C.ymd(sel)) ? `<span class="chip">${ic('star', 13, true)} Buena fecha para verse</span>` : ''}
      ${dayMeets.length ? `<h3 class="small muted" style="margin:10px 0 2px">Cita</h3>${dayMeets.map(meetingCard).join('')}` : ''}
      <h3 class="small muted" style="margin:10px 0 2px">${esc(myName())}</h3>${mine.map((e) => evRow(e, 'me')).join('') || '<div class="muted small">Sin eventos</div>'}
      <h3 class="small muted" style="margin:10px 0 2px">${esc(partnerName())}</h3>${theirs.map((e) => evRow(e, 'partner')).join('') || '<div class="muted small">Sin eventos</div>'}
      <div class="row" style="margin-top:10px"><button class="btn ghost small" data-act="meet-day">Agendar este día</button></div>
    </div>
    ${upcoming.length ? `<div class="card"><h2>${ic('heart')} Próximas citas</h2>${upcoming.map(meetingCard).join('')}</div>` : ''}
    <div class="card"><h2>${ic('star')} Mejores fechas para vernos</h2>
      ${noCal ? `<p class="muted small">${!S.me?.eventsAt ? 'Conecta tu calendario' : 'Tu pareja aún no conecta el suyo'}: mientras tanto se asume que está libre. <button class="btn ghost small" data-go="ajustes" data-page="calendario">Ajustes</button></p>` : ''}
      <p class="muted small" style="margin-top:0">Busca días de los próximos 60 en que ambos tengan al menos 3 horas libres entre las 9:00 y las 23:00. Prefiere fines de semana. Las citas que ya agendaron no cuentan como ocupado.</p>
      <div class="stack">${b.map((x, i) => `<div class="best-item ${i === 0 ? 'top' : ''}"><b>${esc(cap(fmtDay(x.date)))}</b><span class="muted small">${bestDetail(x)}</span>${cycleLinesHtml(x.date, false)}
        <div class="row wrap" style="margin-top:6px"><button class="btn small" data-act="meet-best" data-i="${i}">Agendar</button><button class="btn ghost small" data-act="propose" data-i="${i}">Proponer</button><button class="btn ghost small" data-day="${C.ymd(x.date)}">Ver día</button></div></div>`).join('') || '<p class="muted">No hay días con 3 horas libres para ambos en 60 días.</p>'}</div>
    </div>`;
}

function legendHtml(cyc) {
  const periodTxt = cyc.length === 1 ? (cyc[0].who === 'me' ? 'Tu periodo' : `Periodo de ${esc(cyc[0].name)}`) : 'Periodo';
  const items = [
    `<span><i class="lg me"></i>Tus eventos</span>`,
    `<span><i class="lg pa"></i>Eventos de ${esc(partnerName())}</span>`,
    ...(cyc.length ? [
      `<span><i class="lg-cell period">${ic('drop', 10, true)}</i>${periodTxt}</span>`,
      `<span><i class="lg-cell fertile"></i>Ventana fértil</span>`,
      `<span><i class="lg-cell ovul">${ic('sparkle', 11)}</i>Ovulación estimada</span>`,
    ] : []),
    `<span><i class="lg-cell meet">${ic('heart', 11, true)}</i>Cita para verse</span>`,
    `<span><i class="lg-cell seen">${ic('eye', 11)}</i>Se vieron</span>`,
    `<span><i class="lg-cell star">${ic('star', 11, true)}</i>Buena fecha para verse</span>`,
  ];
  return items.join('');
}

function viewChat() {
  return chat.view();
}

const PLATFORMS = ['Netflix', 'Disney+', 'Max', 'Prime Video', 'Apple TV+', 'Paramount+', 'Otra'];
let showResults = [];
let searchTimer = null;
let searchAbort = null;
const openSyn = new Set();

/** Opciones del selector: las de la serie elegida; si no se sabe cuál es, todas. */
function platformOptions(f) {
  if (!f.platforms) return PLATFORMS;
  const list = [...f.platforms];
  if (f.platform && !list.includes(f.platform)) list.push(f.platform); // no perder lo ya guardado
  return list.length ? list : ['Otra'];
}

/** Temporada y episodio: si la serie está vinculada, solo los que existen; si no, números libres. */
function seasonEpisodeFields(f) {
  if (TV.refOf(f) && f.eps === undefined) return '<p class="muted small" style="margin:0">Cargando temporadas y episodios…</p>';
  if (f.eps?.length) {
    const seasons = [...new Set(f.eps.map((e) => e.season))];
    const season = f.season ?? seasons[0];
    const inSeason = f.eps.filter((e) => e.season === season);
    const clip = (t) => (t.length > 34 ? t.slice(0, 33) + '…' : t);
    return `<div class="grid2"><label class="field">Temporada<select name="season">${seasons.map((n) => `<option value="${n}" ${n === season ? 'selected' : ''}>Temporada ${n} (${plural(f.eps.filter((e) => e.season === n).length, 'ep.', 'ep.')})</option>`).join('')}</select></label>
      <label class="field">Episodio<select name="episode">${inSeason.map((e) => `<option value="${e.number}" ${e.number === f.episode ? 'selected' : ''}>${e.number}${e.name ? ' · ' + esc(clip(e.name)) : ''}</option>`).join('')}</select></label></div>`;
  }
  return `<div class="grid2"><label class="field">Temporada<input type="number" name="season" min="0" max="99" value="${esc(f.season ?? '')}" inputmode="numeric"></label>
      <label class="field">Episodio<input type="number" name="episode" min="0" max="999" value="${esc(f.episode ?? '')}" inputmode="numeric"></label></div>`;
}

/** Trae las temporadas y episodios reales de la serie elegida y corrige lo que no exista. */
function loadShowEpisodes() {
  const f = showForm;
  if (!f || !TV.refOf(f)) return;
  f.eps = undefined;
  TV.episodesOf(f).then((eps) => {
    if (showForm !== f) return;
    captureShowForm();
    if (!eps.length) { f.eps = null; render(); return; }
    f.eps = eps;
    if (!eps.some((e) => e.season === f.season && e.number === f.episode)) {
      const s = eps.some((e) => e.season === f.season) ? f.season : eps[0].season;
      f.season = s;
      f.episode = eps.find((e) => e.season === s).number;
    }
    render();
  }).catch(() => {
    if (showForm !== f) return;
    captureShowForm();
    f.eps = null; // sin conexión con el servicio de series: números libres
    render();
  });
}

function posterHtml(s, w, h) {
  return s.poster
    ? `<img class="poster" src="${esc(s.poster)}" alt="Carátula de ${esc(s.title)}" width="${w}" height="${h}" loading="lazy" referrerpolicy="no-referrer">`
    : `<div class="poster poster-ph" style="width:${w}px;height:${h}px">${ic('tv', 24)}</div>`;
}

function viewSeries() {
  const f = showForm;
  const form = f
    ? `<form class="card stack" id="showform"><h2>${f.id ? 'Editar' : 'Agregar serie'}</h2>
      <label class="field">Título<input type="text" id="stitle" name="title" value="${esc(f.title || '')}" required maxlength="80" autocomplete="off" placeholder="Escribe para buscar…"></label>
      <div id="sresults" class="results" aria-live="polite"></div>
      ${TV.refOf(f) ? `<div class="picked">${posterHtml(f, 36, 50)}<div><b>${esc(f.title)}</b>${f.year ? ` (${esc(f.year)})` : ''}<div class="muted small">Carátula y sinopsis desde ${TV.providerName}</div></div></div>` : '<p class="muted small" style="margin:0">Elige un resultado para traer la carátula y las sinopsis, o déjalo escrito a mano.</p>'}
      <label class="field">Plataforma<select name="platform">${platformOptions(f).map((p) => `<option ${p === (f.platform || platformOptions(f)[0]) ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>${f.platforms ? `<span class="muted small">${f.platforms.length ? 'Solo las plataformas donde está disponible en Chile.' : 'No aparece en ninguna plataforma de suscripción en Chile.'}</span>` : ''}</label>
      ${seasonEpisodeFields(f)}
      <div class="row wrap"><button class="btn" type="submit">Guardar</button><button class="btn ghost" type="button" data-act="show-cancel">Cancelar</button>${f.id ? '<button class="btn danger" type="button" data-act="show-delete">Eliminar</button>' : ''}</div></form>`
    : `<button class="btn" data-act="show-new">${ic('plus', 18)} Agregar serie</button>`;
  const list = [...S.shows].sort((a, b) => b.at - a.at).map((s) => `<div class="show">
      ${posterHtml(s, 64, 90)}
      <div class="show-main">
        <div><b>${esc(s.title)}</b><span class="plat">${esc(s.platform)}</span></div>
        <div class="ep">${esc(C.episodeLabel(s)) || 'Sin episodio'}</div>
        <div class="ep-info" data-ep="${esc(s.id)}"></div>
        <div class="muted small">${s.by === S.uid || s.by === 'me' ? 'Actualizaste tú' : `Actualizó ${esc(partnerName())}`} · ${esc(fmtShort(new Date(s.at)))}</div>
        <div class="row" style="margin-top:6px"><button class="btn small" data-act="show-next" data-id="${esc(s.id)}" aria-label="Siguiente episodio de ${esc(s.title)}">+1 ep.</button>
        <button class="btn ghost small" data-act="show-edit" data-id="${esc(s.id)}">Editar</button></div>
      </div></div>`).join('');
  return `${form}<div class="card"><h2>${ic('tv')} En qué vamos</h2>${list || '<p class="muted">Agreguen lo que están viendo juntos.</p>'}
    <p class="muted small" style="margin-bottom:0">Las plataformas no permiten leer tu historial, así que el episodio se anota con un toque en «+1 ep.». ${TV.attributionHtml}</p></div>`;
}

/** Rellena título y sinopsis del episodio en las tarjetas (una petición por serie, en memoria). */
function hydrateEpisodes() {
  for (const s of S.shows) {
    if (!TV.refOf(s) || s.season == null || s.episode == null) continue;
    const box = document.querySelector(`[data-ep="${CSS.escape(s.id)}"]`);
    if (!box) continue;
    TV.episodesOf(s).then((eps) => {
      const e = TV.findEpisode(eps, s.season, s.episode);
      const el = document.querySelector(`[data-ep="${CSS.escape(s.id)}"]`);
      if (!el || !e) return;
      const key = `${s.id}:${s.season}:${s.episode}`;
      el.innerHTML = `<div class="ep-name">${esc(e.name)}</div>${e.summary ? `<details data-key="${esc(key)}" ${openSyn.has(key) ? 'open' : ''}><summary>Sinopsis del episodio${e.summaryLang === 'en' ? ' <span class="muted small">(en inglés)</span>' : ''}</summary><p>${esc(e.summary)}</p></details>` : ''}`;
    }).catch(() => {});
  }
}

function captureShowForm() {
  const f = document.getElementById('showform');
  if (!f || !showForm) return;
  const v = (n) => f.elements[n]?.value;
  showForm.title = v('title') ?? showForm.title;
  showForm.platform = v('platform') ?? showForm.platform;
  if (f.elements.season) showForm.season = v('season') === '' ? null : Number(v('season'));
  if (f.elements.episode) showForm.episode = v('episode') === '' ? null : Number(v('episode'));
}

function searchShowsNow(q) {
  const box = document.getElementById('sresults');
  if (!box) return;
  if (searchAbort) searchAbort.abort();
  if (q.length < 2) { box.innerHTML = ''; showResults = []; return; }
  searchAbort = new AbortController();
  box.innerHTML = '<p class="muted small" style="margin:0">Buscando…</p>';
  TV.searchShows(q, searchAbort.signal).then((list) => {
    showResults = list;
    box.innerHTML = list.length
      ? list.map((r, i) => `<button type="button" class="res" data-act="pick-show" data-i="${i}">${posterHtml(r, 40, 56)}<span><b>${esc(r.title)}</b>${r.year ? ` (${esc(r.year)})` : ''}${r.network ? `<span class="muted small" style="display:block">${esc(r.network)}</span>` : ''}</span></button>`).join('')
      : '<p class="muted small" style="margin:0">No encontré nada. Puedes dejarlo escrito a mano.</p>';
  }).catch((e) => {
    if (e.name === 'AbortError') return;
    box.innerHTML = '<p class="muted small" style="margin:0">No pude buscar ahora (¿sin internet?). Puedes escribirlo a mano.</p>';
  });
}

/* ------------------------------------------------------------ ajustes (por apartados) */

let settingsPage = null; // null = el menú
// [id, ícono, título, descripción]
const SET_PAGES = [
  ['perfil', 'user', 'Perfil y pareja', 'Tu nombre, cómo te identificas y las fechas de ustedes'],
  ['apariencia', 'palette', 'Apariencia', 'Tema, color de la app y colores del calendario'],
  ['ubicacion', 'pin', 'Ubicación', 'Actualización automática cada 30 minutos'],
  ['calendario', 'calendar', 'Calendario', 'Tus eventos, sus nombres y las citas'],
  ['ciclo', 'drop', 'Ciclo menstrual', 'Seguimiento y si se comparte con tu pareja'],
  ['chat', 'chat', 'Chat y archivos', 'Descarga automática y galería'],
  ['avisos', 'bell', 'Notificaciones', 'Avisos de mensajes nuevos'],
  ['widgets', 'sparkle', 'Widgets', 'Pantalla de inicio: calendario, ciclo, distancia…'],
  ['seguridad', 'lock', 'Seguridad', 'Huella o PIN al abrir y contraseña de la pareja'],
  ['disfraz', 'eye', 'Ocultar la app', 'Cambia el ícono y el nombre para que parezca otra app'],
  ['cuenta', 'user', 'Cuenta', 'Correo, Google y cerrar sesión'],
];

function viewSettings() {
  if (!settingsPage) return settingsMenu();
  const pages = { perfil: pagePerfil, apariencia: pageApariencia, ubicacion: pageUbicacion, calendario: pageCalendario, ciclo: pageCiclo, chat: pageChat, avisos: pageAvisos, widgets: pageWidgets, seguridad: pageSeguridad, disfraz: pageDisfraz, cuenta: pageCuenta };
  const row = SET_PAGES.find((p) => p[0] === settingsPage);
  return `<div class="row setback"><button class="iconbtn flat" data-act="set-back" aria-label="Volver a Ajustes">${ic('back', 22)}</button><h2>${row[2]}</h2></div>${pages[settingsPage]()}`;
}

function settingsMenu() {
  const rows = SET_PAGES.filter((p) => !(p[0] === 'ciclo' && S.me?.gender === 'hombre'))
    .map(([id, icon, title, sub]) => `<button class="setrow" data-act="set-page" data-page="${id}"><span class="seticon">${ic(icon, 22)}</span><span class="settext"><b>${title}</b><span class="muted small">${sub}</span></span>${ic('chevron', 18)}</button>`).join('');
  return `<div class="card setlist">${rows}</div>
    <div class="card stack">${store.kind === 'demo'
      ? '<button class="btn ghost" data-act="leave">Borrar datos de la demo</button>'
      : `<button class="btn ghost" data-act="logout">${ic('logout', 18)} Cerrar sesión</button><p class="muted small" style="margin:0">Tu pareja y tus datos quedan guardados: al volver a entrar con tu correo todo sigue igual.</p>`}</div>`;
}

function pagePerfil() {
  const me = S.me || {};
  return `<div class="card stack"><h2>${ic('user')} Yo</h2>
      <label class="field">Mi nombre<input type="text" data-field="me.name" value="${esc(me.name || '')}" maxlength="30"></label>
      <label class="field">Yo soy<select data-field="me.gender">${genderOptions(me.gender || '', 'Elige…')}</select></label>
    </div>
    <div class="card stack"><h2>${ic('heart')} Nosotros</h2>
      ${coupleType() ? `<div class="muted small">Pareja: <b>${esc(coupleType())}</b></div>` : ''}
      <label class="field">Fecha en que empezaron<input type="date" data-field="couple.anniversary" value="${esc(S.couple?.anniversary || '')}" max="${C.ymd(new Date())}"></label>
      <label class="field">Última vez que nos vimos<input type="date" data-field="couple.lastSeen" value="${esc(S.couple?.lastSeen || '')}" max="${C.ymd(new Date())}"></label>
      ${store.kind === 'firebase' || S.coupleId ? `<div><div class="muted small">Código de la pareja</div><div class="code">${esc(S.coupleId)}</div></div>` : ''}</div>
    <div class="card stack danger"><h2>${ic('ban')} Eliminar la pareja</h2>
      <p class="muted small" style="margin:0">Por si se separan: borra del servidor todo lo de ustedes (chat, archivos, series, citas, ubicaciones) y el código deja de existir. Los dos teléfonos quedan sin pareja. No se puede deshacer.</p>
      <button class="btn dangerfull" data-act="couple-delete">Eliminar la pareja</button></div>`;
}

function pageApariencia() {
  return themeCard() + colorsCard();
}

function pageUbicacion() {
  const me = S.me || {};
  return `<div class="card stack"><h2>${ic('eye')} Compartir mi ubicación</h2>
      <label class="check"><input type="checkbox" data-field="me.shareLoc" ${me.shareLoc !== false ? 'checked' : ''}> Dejar que mi pareja vea mi ubicación</label>
      <p class="muted small" style="margin:0">Viene activado. Si lo apagas, tu ubicación no se sube y se borra la que ya estaba guardada; tu pareja verá que no la compartes y no se podrá detectar cuándo están juntos.</p></div>
    <div class="card stack"><h2>${ic('pin')} Mi ubicación</h2>
      <p class="muted small" style="margin:0">Se guarda aproximada (unos 1–2 km) y solo la ve tu pareja. ${me.city ? `Ahora: <b>${esc(me.city)}</b>` : ''}${me.locAt ? ` · actualizada ${new Date(me.locAt).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</p>
      ${isNative ? nativeLocationControls() : '<button class="btn ghost" data-act="geo">Usar mi ubicación actual</button>'}
      <details><summary class="muted small">Poner la ciudad a mano</summary>
        <div class="row" style="margin-top:8px"><input type="text" id="cityin" placeholder="Ciudad, país" value="${esc(me.city || '')}" aria-label="Ciudad"><button class="btn small" data-act="city-search">Buscar</button></div></details></div>`;
}

function pageCalendario() {
  const me = S.me || {};
  const calOk = me.eventsAt;
  const st = nativeStatus;
  return `<div class="card stack"><h2>${ic('calendar')} Mi calendario</h2>
      <p class="muted small" style="margin:0">${calOk ? `Sincronizado ${new Date(calOk).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })} (${(me.events || []).length} eventos próximos).` : 'Se leen los eventos del calendario de tu teléfono (el de Google incluido) de los próximos 60 días.'}</p>
      ${isNative ? nativeCalendarControls() : '<button class="btn" data-act="cal">' + (calOk ? 'Actualizar' : 'Cargar calendario (demo)') + '</button>'}
      <label class="check"><input type="checkbox" data-field="me.hideTitles" ${me.hideTitles ? 'checked' : ''}> Ocultar los nombres de mis eventos</label>
      <p class="muted small" style="margin:0">Por defecto tu pareja ve cómo se llaman tus eventos. Si lo activas, solo verá «Ocupado» en esas horas.</p></div>
    <div class="card stack"><h2>${ic('heart')} Citas para verse</h2>
      <label class="check"><input type="checkbox" data-pref="meetToCal" ${Prefs.get().meetToCal ? 'checked' : ''}> Poner las citas en el calendario de mi teléfono</label>
      <p class="muted small" style="margin:0">Quedan marcadas como «libre» y la app las reconoce: ese tiempo no cuenta como ocupado al buscar fechas.</p>
      ${isNative && Prefs.get().meetToCal && st && !st.calendarWrite ? '<button class="btn" data-act="cal-write-perm">Permitir crear eventos en mi calendario</button>' : ''}</div>`;
}

/** Explica cuánto «aprendió» el cálculo (solo si ya hay ciclos anotados). */
function learnedNote(cy) {
  if (!cy?.last) return '';
  const learned = C.learnedLen(cy);
  const said = Math.max(20, Math.min(45, Number(cy.len) || 28));
  const n = (cy.starts || []).length;
  if (!n) return '<p class="muted small" style="margin:0">Cada vez que anotes que el periodo empezó, el cálculo aprende de tus ciclos reales y ajusta el largo.</p>';
  return `<p class="muted small" style="margin:0">Ciclos anotados: ${n + 1}. Largo que usa el cálculo: <b>${learned} días</b>${learned !== said ? ` (tú dijiste ${said})` : ''}.</p>`;
}

function pageCiclo() {
  const me = S.me || {};
  const cy = me.cycle || {};
  if (me.gender === 'hombre') return '<div class="card"><p class="muted" style="margin:0">Esta sección es para quien lleva ciclo. Lo que tu pareja comparta lo ves en la agenda.</p></div>';
  return `<div class="card stack"><h2>${ic('drop')} Ciclo menstrual</h2>
      <label class="check"><input type="checkbox" id="cyon" ${cy.last ? 'checked' : ''}> Quiero llevar mi ciclo</label>
      <div class="stack ${cy.last ? '' : 'hidden'}" id="cybox">
        <label class="field">Primer día del último periodo<input type="date" data-field="me.cycle.last" value="${esc(cy.last || '')}" max="${C.ymd(new Date())}"></label>
        <div class="grid2"><label class="field">Duración del ciclo (días)<input type="number" data-field="me.cycle.len" min="20" max="45" value="${esc(cy.len || 28)}" inputmode="numeric"></label>
        <label class="field">Duración del periodo<input type="number" data-field="me.cycle.period" min="1" max="10" value="${esc(cy.period || 5)}" inputmode="numeric"></label></div>
        <label class="check"><input type="checkbox" data-field="me.cycleShare" ${me.cycleShare ? 'checked' : ''}> Compartirlo con mi pareja (los dos ven periodo, días fértiles y ovulación en la agenda)</label>
        <button class="btn ghost small" data-act="cycle-today">El periodo empezó hoy</button>
        ${learnedNote(cy)}</div></div>`;
}

function pageChat() {
  const p = Prefs.get();
  const row = ([k, label]) => `<div class="dlrow"><b>${label}</b>
      <input type="checkbox" role="switch" data-pref="dl.${k}.wifi" aria-label="${label} con Wi-Fi" ${p.dl[k].wifi ? 'checked' : ''}>
      <input type="checkbox" role="switch" data-pref="dl.${k}.data" aria-label="${label} con datos móviles" ${p.dl[k].data ? 'checked' : ''}></div>`;
  return `<div class="card stack"><h2>${ic('download')} Descarga automática</h2>
      <p class="muted small" style="margin:0">Lo que no se descargue solo se baja al tocarlo. Cada teléfono elige lo suyo, y por separado para Wi-Fi y para datos móviles.</p>
      <div class="dlrow dlhead"><span></span><span>Wi-Fi</span><span>Datos móviles</span></div>
      ${DL_KINDS.map(row).join('')}</div>
    <div class="card stack"><h2>${ic('image')} Galería</h2>
      ${isNative
        ? `<label class="check"><input type="checkbox" data-pref="gallery" ${p.gallery ? 'checked' : ''}> Guardar en la galería las fotos y videos del chat</label>
           <p class="muted small" style="margin:0">Se guardan en la carpeta «Nosotros». Las fotos y videos «de una sola vez» nunca se guardan. Para guardar o compartir una sola foto o video, mantenla presionada en el chat.</p>`
        : '<p class="muted small" style="margin:0">Disponible en la app de Android.</p>'}</div>
    <div class="card stack"><h2>${ic('image')} Calidad de las fotos</h2>
      <label class="check"><input type="checkbox" data-pref="hd" ${p.hd ? 'checked' : ''}> Enviar las fotos en HD por defecto</label>
      <p class="muted small" style="margin:0">Normal: hasta 1080p y 300 KB. HD: hasta 1440p y 400 KB. Siempre en WebP. En el clip del chat puedes cambiarlo en cada envío.</p></div>
    <div class="card stack"><h2>${ic('clock')} Archivos en el servidor</h2>
      <p class="muted small" style="margin:0">Las fotos, videos y audios se borran del servidor a los ${MD.MEDIA_KEEP_DAYS} días y el mensaje queda como «Archivo vencido». Lo que ya descargaste se queda en tu teléfono, aunque cierres la app.</p></div>
    <div class="card stack"><h2>${ic('once')} De una sola vez</h2>
      <p class="muted small" style="margin:0">En el chat, toca el clip, activa «Que se vea una sola vez» y elige cámara o galería. Tu pareja la puede abrir una vez; luego se borra del servidor y no se puede guardar ni capturar.</p></div>
    <div class="card stack danger"><h2>${ic('trash')} Borrar el chat</h2>
      <p class="muted small" style="margin:0">Borra todos los mensajes, fotos, videos y audios, en el servidor y en los dos teléfonos. No se puede deshacer.</p>
      <button class="btn dangerfull" data-act="chat-clear">Borrar todo el chat</button></div>`;
}

function pageAvisos() {
  const p = Prefs.get();
  if (!isNative) {
    return `<div class="card stack"><h2>${ic('bell')} Avisos</h2>
      <button class="btn ghost" data-act="notif">${'Notification' in window && Notification.permission === 'granted' ? 'Avisos de mensajes activados' : 'Activar avisos de mensajes'}</button>
      <p class="muted small" style="margin:0">Llegan cuando la app está abierta (o en segundo plano).</p></div>`;
  }
  const st = nativeStatus;
  return `<div class="card stack"><h2>${ic('bell')} Mensajes</h2>
      <label class="check"><input type="checkbox" data-pref="notify" ${p.notify ? 'checked' : ''}> Avisarme cuando llegue un mensaje</label>
      ${st && !st.notifications ? '<p class="muted small" style="margin:0">Falta el permiso de notificaciones del teléfono.</p><button class="btn" data-act="notif-perm">Permitir notificaciones</button>' : ''}
      <p class="muted small" style="margin:0">Con la app abierta llegan al instante.</p></div>
    <div class="card stack"><h2>${ic('navigation')} Avisos al instante</h2>
      <label class="check"><input type="checkbox" data-pref="instant" ${p.instant ? 'checked' : ''}> Mantener la app atenta en segundo plano</label>
      <p class="muted small" style="margin:0">Revisa si hay mensajes cada 30 segundos aunque la app esté cerrada (deja una notificación fija y silenciosa). Gasta algo más de batería. Sin esto, con la app cerrada el teléfono revisa cada ~15 minutos.</p>
      ${st && !st.battery ? '<p class="muted small" style="margin:0">Para que el teléfono no la duerma, quítale la restricción de batería: <button class="btn ghost small" data-act="battery-ask">Permitir</button></p>' : ''}</div>`;
}

const WIDGET_LIST = [
  ['seen', 'eye', 'Hace cuánto no nos vemos', '2x2'],
  ['distance', 'pin', 'A qué distancia están', '2x2'],
  ['today', 'calendar', 'Calendario: hoy', '1x1'],
  ['week', 'calendar', 'Calendario: semana', '3x2'],
  ['month', 'calendar', 'Calendario: mes', '4x4'],
  ['cycle', 'drop', 'Ciclo menstrual', '2x2'],
  ['together', 'gift', 'Días juntos y aniversario', '2x2'],
  ['meet', 'heart', 'Próxima cita', '2x2'],
  ['shortcuts', 'sparkle', 'Atajos', '4x1'],
];

function pageWidgets() {
  if (!isNative) return '<div class="card"><p class="muted" style="margin:0">Los widgets están disponibles en la app de Android.</p></div>';
  const st = nativeStatus;
  const p = Prefs.get();
  const rows = WIDGET_LIST.map(([k, icon, name, size]) => `<div class="wrow"><span class="seticon">${ic(icon, 22)}</span><span class="settext"><b>${name}</b><span class="muted small">Tamaño inicial ${size}; se puede estirar y achicar</span></span>${st?.widgetPin ? `<button class="btn ghost small" data-act="widget-pin" data-kind="${k}">Agregar</button>` : ''}</div>`).join('');
  return `<div class="card stack"><h2>${ic('sparkle')} Widgets</h2>
      <p class="muted small" style="margin:0">${st?.widgetPin ? 'Toca «Agregar» y confirma en la pantalla de inicio.' : 'Para agregarlos: mantén presionada la pantalla de inicio → Widgets → Nosotros.'} Cada uno se ajusta al tamaño que le des: mantenlo presionado y arrastra sus bordes.${st?.widgets ? ` Ahora hay ${st.widgets} en tu pantalla.` : ''}</p>
      <div class="stack">${rows}</div></div>
    <div class="card stack"><h2>${ic('eye')} Privacidad y datos</h2>
      <label class="check"><input type="checkbox" data-pref="widgetTitles" ${p.widgetTitles ? 'checked' : ''}> Mostrar el nombre de mis eventos en los widgets</label>
      <p class="muted small" style="margin:0">Los widgets se ven en la pantalla de inicio aunque la app esté bloqueada con huella. Si lo apagas, tus eventos aparecen como «Ocupado».</p>
      <p class="muted small" style="margin:0">Se actualizan solos cada ~30 minutos, al abrir la app y a medianoche. Los colores siguen a la app (se renuevan al abrirla).</p>
      <button class="btn ghost" data-act="widgets-refresh">Actualizar ahora</button></div>`;
}

function pageSeguridad() {
  const prot = S.couple?.protected;
  const lock = isNative
    ? `<div class="card stack"><h2>${ic('finger')} Bloqueo de la app</h2>
        <label class="check"><input type="checkbox" id="lockon" ${nativeStatus?.lock ? 'checked' : ''}><span>Pedir huella o PIN del teléfono al abrir</span></label>
        <span class="chip ${nativeStatus?.lock ? 'fertile' : ''}">${nativeStatus?.lock ? ic('check', 14) + ' Activado' : 'Desactivado'}</span>
        <p class="muted small" style="margin:0">Se pide al abrir la app y al volver tras un rato. También oculta la vista previa en las apps recientes.</p></div>`
    : '';
  return `${lock}<div class="card stack"><h2>${ic('key')} Contraseña de la pareja</h2>
      <p class="muted small" style="margin:0">${prot ? 'Hay una contraseña puesta: aunque alguien conozca el código, no puede unirse sin ella.' : 'Sin contraseña, quien adivine el código de 6 letras podría unirse a la pareja. Pon una para evitarlo.'}</p>
      <label class="field">${prot ? 'Contraseña nueva' : 'Contraseña'}<input type="password" id="cpass" autocomplete="new-password" minlength="4" maxlength="60"></label>
      <div class="row wrap"><button class="btn" data-act="couple-pass">${prot ? 'Cambiar contraseña' : 'Poner contraseña'}</button>${prot ? '<button class="btn ghost" data-act="couple-pass-off">Quitar</button>' : ''}</div></div>`;
}

const DISGUISES = [
  ['nosotros', 'Nosotros', 'heart', '#e11d48'],
  ['calc', 'Calculadora', 'calc', '#374151'],
  ['notas', 'Notas', 'edit', '#d97706'],
  ['reloj', 'Reloj', 'clock', '#111827'],
  ['calendario', 'Calendario', 'calendar', '#2563eb'],
  ['clima', 'Clima', 'sun', '#0284c7'],
];

function pageDisfraz() {
  if (!isNative) return '<div class="card"><p class="muted" style="margin:0">Disponible en la app de Android.</p></div>';
  const cur = nativeStatus?.disguise || 'nosotros';
  return `<div class="card stack"><h2>${ic('eye')} Ocultar la app</h2>
      <p class="muted small" style="margin:0">Elige cómo se ve en el cajón de apps: cambia el ícono y el nombre. Dentro, la app sigue igual.</p>
      ${DISGUISES.map(([k, name, icon, color]) => `<button class="disg" data-act="disguise" data-key="${k}" aria-pressed="${k === cur}"><span class="dico" style="background:${color}">${ic(icon, 26, k === 'nosotros')}</span><b>${name}</b>${k === cur ? ic('check', 20) : '<span></span>'}</button>`).join('')}
      <p class="muted small" style="margin:0">Al cambiar, el ícono anterior desaparece (también de la pantalla de inicio): el nuevo queda en el cajón de apps y puedes volver a ponerlo en inicio. Las notificaciones y «Ajustes del teléfono → Aplicaciones» siguen diciendo «Nosotros».</p></div>`;
}

function pageCuenta() {
  return `<div class="card stack"><h2>${ic('user')} Cuenta</h2>
      ${S.email ? `<div class="muted small">Sesión iniciada como <b>${esc(S.email)}</b></div>` : '<div class="muted small">Modo demo: sin cuenta.</div>'}
      ${store.kind === 'demo'
        ? '<button class="btn ghost" data-act="leave">Borrar datos de la demo</button>'
        : `<button class="btn ghost" data-act="logout">${ic('logout', 18)} Cerrar sesión</button>`}</div>`;
}

function themeCard() {
  const t = Theme.get();
  const dark = Theme.isDark();
  const modes = [['system', 'phone', 'Sistema'], ['light', 'sun', 'Claro'], ['dark', 'moon', 'Oscuro']];
  return `<div class="card stack"><h2>${ic('palette')} Apariencia</h2>
    <div class="seg3" role="group" aria-label="Tema">${modes.map(([m, i, l]) => `<button data-act="theme-mode" data-mode="${m}" aria-pressed="${t.mode === m}">${ic(i, 20)}${l}</button>`).join('')}</div>
    <div class="muted small">Color de énfasis</div>
    <div class="swatches" role="group" aria-label="Color de énfasis">${Object.entries(Theme.ACCENTS).map(([k, a]) => `<button class="sw" data-act="theme-accent" data-accent="${k}" aria-label="${a.name}" aria-pressed="${t.accent === k}" style="--c:${Theme.swatch(k)};color:${dark ? '#111' : '#fff'}">${t.accent === k ? ic('check', 18) : ''}</button>`).join('')}</div>
    <p class="muted small" style="margin:0">Se guarda en este teléfono.</p></div>`;
}

function nativeLocationControls() {
  const st = nativeStatus;
  if (!st) return '<p class="muted small" style="margin:0">Comprobando permisos…</p>';
  const on = st.auto && st.fine && st.background;
  return `${on ? `<span class="chip fertile">${ic('check', 14)} Automática cada 30 min</span>` : st.auto ? '<span class="chip period">Falta el permiso «Permitir todo el tiempo»</span>' : ''}
    <div class="row wrap">
    ${on ? '<button class="btn ghost" data-act="auto-off">Desactivar automática</button>' : '<button class="btn" data-act="auto-on">Activar ubicación automática (cada 30 min)</button>'}
    <button class="btn ghost" data-act="sync-now">Actualizar ahora</button></div>
    ${on && !st.battery ? '<p class="muted small" style="margin:0">Si el teléfono la retrasa, quita la restricción de batería a esta app: <button class="btn ghost small" data-act="battery">Abrir ajustes</button></p>' : ''}`;
}

function nativeCalendarControls() {
  const st = nativeStatus;
  if (!st) return '';
  return st.calendar
    ? '<button class="btn" data-act="sync-now">Sincronizar ahora</button><p class="muted small" style="margin:0">Se actualiza sola junto con la ubicación.</p>'
    : '<button class="btn" data-act="cal-perm">Permitir leer mi calendario</button>';
}

const TABS = [['agenda', 'calendar', 'Agenda'], ['chat', 'chat', 'Chat'], ['inicio', 'home', 'Inicio'], ['series', 'tv', 'Series'], ['ajustes', 'sliders', 'Ajustes']];

function unread() {
  return S.messages.some((m) => m.from !== S.uid && m.from !== 'me' && m.at > lastReadAt);
}

const TIPS = [
  'Toca «Nos vimos hoy» cuando se encuentren y la cuenta de días vuelve a empezar.',
  'Tu ubicación se guarda aproximada, a 1 o 2 km. Solo la ve tu pareja.',
  'En Ajustes, Calendario, puedes ocultar los nombres de tus eventos: tu pareja verá solo «Ocupado».',
  'En el chat, el clip te deja mandar una foto o video de una sola vez.',
  'Al agendar una cita ves en qué parte del ciclo cae ese día.',
  'Con el micrófono del chat mandas audios.',
  'La agenda busca los días en que los dos tienen al menos 3 horas libres.',
  'Un toque en «+1 ep.» y tu pareja sabe en qué capítulo van.',
  'Con la ubicación automática, la app se actualiza sola cada 30 minutos, aunque esté cerrada.',
  'Puedes cambiar los colores de la app en Ajustes, en Apariencia.',
  'Si cambias de teléfono, inicia sesión con tu correo y todo vuelve solo.',
  'Netflix y Disney+ no permiten leer tu historial, por eso las series se anotan a mano.',
  'El ciclo solo se comparte con tu pareja si tú lo decides.',
  'Toca un día de la agenda para ver los eventos de los dos.',
];
let tipIndex = Math.floor(Math.random() * TIPS.length);
let tipTimer = null;
let splashTimer = null;
const MIN_SPLASH = 1900; // ms desde que abre la página: que la pantalla de carga se alcance a leer

function splashHtml() {
  return `<div class="splash"><div class="splash-logo">${ic('heart', 46, true)}</div><h1>Nosotros</h1>
    <div class="loadbar" role="progressbar" aria-label="Cargando"></div>
    <div class="tip"><small>Para saber</small><p id="tip">${esc(TIPS[tipIndex])}</p></div></div>`;
}

function startTips() {
  if (tipTimer) return;
  tipTimer = setInterval(() => {
    const el = document.getElementById('tip');
    if (!el) return;
    tipIndex = (tipIndex + 1) % TIPS.length;
    el.classList.add('out');
    setTimeout(() => {
      el.textContent = TIPS[tipIndex];
      el.classList.remove('out');
    }, 350);
  }, 3600);
}

/* ------------------------------------------------------------ navegación hacia atrás */

let curNav = '';
let goingBack = false;
const navStack = [];

/** Recuerda por dónde se fue pasando (pestaña y apartado de ajustes) para que «atrás» retroceda de verdad. */
function trackNav() {
  const key = `${tab}|${settingsPage || ''}`;
  if (key === curNav) return;
  if (curNav && !goingBack) {
    navStack.push(curNav);
    if (navStack.length > 30) navStack.shift();
  }
  curNav = key;
}

/**
 * Botón «atrás» del teléfono. Cierra lo abierto, si no vuelve a la pantalla anterior y, cuando no hay más
 * por donde volver, va a Inicio y sube del todo. Devuelve false solo cuando ya no queda nada: ahí la app se minimiza.
 */
window.__back = () => {
  if (document.getElementById('time-root')) { closeTimePicker(); return true; }
  if (chat.back()) return true;
  if (meetForm) { meetForm = null; render(); return true; }
  if (showForm) { showForm = null; render(); return true; }
  if (!S.signedIn || !S.coupleId) return false;
  while (navStack.length) {
    const prev = navStack.pop();
    if (prev === curNav) continue;
    const [t, p] = prev.split('|');
    goingBack = true;
    tab = t;
    settingsPage = p || null;
    render();
    goingBack = false;
    window.scrollTo(0, 0);
    return true;
  }
  if (tab !== 'inicio' || settingsPage) {
    tab = 'inicio';
    settingsPage = null;
    render();
    window.scrollTo(0, 0);
    return true;
  }
  if (window.scrollY > 4) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  }
  return false;
};

/** Archivo pegado desde el teclado (Gboard: imágenes, GIF, stickers): la app de Android lo deja en /pasted/. */
window.__pasted = async (url) => {
  try {
    const blob = await (await fetch(url)).blob();
    const ext = (blob.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');
    chat.addFiles([new File([blob], `pegado.${ext}`, { type: blob.type })]);
  } catch (e) {
    console.error(e);
    toast('No se pudo pegar el archivo');
  }
};

function render() {
  dirty = false;
  if (S.loading || performance.now() < MIN_SPLASH) {
    $app.innerHTML = splashHtml();
    startTips();
    if (!S.loading && !splashTimer) {
      splashTimer = setTimeout(() => {
        splashTimer = null;
        render();
      }, Math.max(50, MIN_SPLASH - performance.now() + 20));
    }
    return;
  }
  if (S.loadError && !S.coupleId) {
    $app.innerHTML = `<div class="splash"><div class="empty-ic">${ic('wifioff', 56)}</div><h1>Sin conexión</h1>
      <p class="muted" style="margin:0;max-width:280px">No pude conectar con tu cuenta. Revisa tu internet y vuelve a intentar.</p>
      <button class="btn" data-act="retry">Reintentar</button></div>`;
    return;
  }
  if (!S.signedIn || !S.coupleId) {
    $app.innerHTML = viewWelcome();
    return;
  }
  if (tab === 'chat') {
    lastReadAt = Date.now();
    safeSet('parejas-read', String(lastReadAt));
    if (isNative) native.seen();
  }
  trackNav();
  // transición: la pantalla entra desde el lado hacia el que vas (solo al cambiar de pestaña o de apartado)
  const viewKey = `${tab}:${tab === 'ajustes' ? settingsPage || '' : ''}`;
  const depth = TABS.findIndex((t) => t[0] === tab) * 10 + (tab === 'ajustes' && settingsPage ? 1 : 0);
  const enter = viewKey !== lastViewKey ? (depth >= lastDepth ? ' enter-r' : ' enter-l') : '';
  lastViewKey = viewKey;
  lastDepth = depth;
  const views = { inicio: viewHome, agenda: viewAgenda, chat: viewChat, series: viewSeries, ajustes: viewSettings };
  $app.innerHTML = `<header class="top"><h1>${ic('heart', 22, true)} ${esc(myName())} & ${esc(partnerName())}</h1>${store.kind === 'demo' ? '<span class="badge">demo</span>' : ''}</header>
    <main class="${tab === 'chat' ? 'chatmain' : ''}${enter}">${views[tab]()}</main>
    <nav class="tabs" aria-label="Secciones"><div class="in">${TABS.map(([id, icon, label]) => `<button class="tab" data-tab="${id}" ${id === tab ? 'aria-current="page"' : ''}><span class="ic" aria-hidden="true">${ic(icon, 24)}</span>${label}${id === 'chat' && unread() && tab !== 'chat' ? '<span class="dot"></span>' : ''}</button>`).join('')}</div></nav>`;
  if (tab === 'chat') chat.afterRender();
  chat.ack();
  if (isNative && tab === 'ajustes') refreshNativeStatus();
  if (tab === 'series') hydrateEpisodes();
}

async function refreshNativeStatus() {
  const st = await native.status();
  if (JSON.stringify(st) === JSON.stringify(nativeStatus)) return;
  nativeStatus = st;
  const a = document.activeElement;
  if (tab === 'ajustes' && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) render();
}

const MSG = { perm: 'Falta el permiso de ubicación', nolocation: 'No pude obtener la ubicación. ¿Está activado el GPS?' };

/** Lee ubicación (y calendario) del teléfono y lo guarda para la pareja. */
async function syncNative(silent, over = {}) {
  const r = await native.collect();
  if (!r.ok) {
    if (silent) return;
    throw new Error(MSG[r.error] || 'No se pudo actualizar');
  }
  const share = S.me?.shareLoc !== false;
  const patch = share ? { lat: r.lat, lon: r.lon, city: r.city || S.me?.city || 'Ubicación actual', locAt: Date.now() } : {};
  if (r.events) {
    const hide = over.hide ?? !!S.me?.hideTitles;
    patch.events = r.events.map((e) => (hide ? { ...e, t: 'Ocupado' } : e));
    patch.eventsAt = Date.now();
    patch.eventsV = 2; // 2 = los nombres se muestran salvo que se oculten a propósito
  }
  if (!Object.keys(patch).length) return;
  await store.updateMe(patch);
  if (share) await afterLocation();
}

/* ------------------------------------------------------------ ajustes guardados en el servidor, por usuario */

let settingsTimer = null;
let settingsPulledFor = null;
let applyingRemote = false;
let lastSettingsJson = '';
const settingsKey = () => 'parejas-prefs-at-' + S.uid;
const settingsSnapshot = () => ({ prefs: Prefs.get(), theme: Theme.get() });

/** Guarda los ajustes de esta cuenta en el servidor (con un respiro para no escribir en cada toque). */
function queueSettingsUp() {
  if (applyingRemote || !S.signedIn || !S.uid || store.kind !== 'firebase' || settingsPulledFor !== S.uid) return;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    const snap = settingsSnapshot();
    const j = JSON.stringify(snap);
    if (j === lastSettingsJson) return;
    const at = Date.now();
    try {
      await store.saveSettings(snap, at);
      lastSettingsJson = j;
      safeSet(settingsKey(), String(at));
    } catch (e) {
      console.warn('ajustes', e);
    }
  }, 1500);
}

/** Al entrar con una cuenta: si el servidor tiene ajustes más nuevos que los de este teléfono, se aplican (y viceversa). */
async function pullSettings() {
  if (!S.signedIn || !S.uid || store.kind !== 'firebase' || settingsPulledFor === S.uid) return;
  const uid = S.uid;
  settingsPulledFor = uid;
  try {
    const r = await store.loadSettings();
    const localAt = Number(safeGet(settingsKey()) || 0);
    if (r && r.at > localAt) {
      applyingRemote = true;
      try {
        Prefs.replace(r.prefs.prefs);
        if (r.prefs.theme) Theme.set(r.prefs.theme);
      } finally {
        applyingRemote = false;
      }
      lastSettingsJson = JSON.stringify(settingsSnapshot());
      safeSet(settingsKey(), String(r.at));
      applyColors();
      pushedCfg = '';
      pushNativeConfig();
      pushWidgets(true);
      render();
    } else {
      queueSettingsUp(); // lo de este teléfono es más nuevo, o aún no hay nada guardado
    }
  } catch (e) {
    settingsPulledFor = null;
    console.warn('ajustes', e);
  }
}

/** Datos para los widgets de la pantalla de inicio: lo que ve la app (perfiles, citas, fechas) y sus colores actuales. */
let widgetJson = '';
let widgetTimer = null;

function widgetPayload() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const slim = (p) => (p ? {
    name: p.name || '', gender: p.gender || '', lat: p.lat ?? null, lon: p.lon ?? null, city: p.city || '', locAt: p.locAt || 0,
    cycle: p.cycle || null, cycleShare: !!p.cycleShare,
    events: (p.events || []).map((e) => ({ s: e.s, e: e.e, allDay: !!e.allDay, free: !!e.free, t: e.t || '' })),
  } : null);
  return {
    v: 1,
    uid: S.uid,
    me: slim(S.me),
    partner: slim(S.partner),
    couple: { anniversary: S.couple?.anniversary || null, lastSeen: S.couple?.lastSeen || null },
    meetings: (S.meetings || []).map((m) => ({ id: m.id, s: m.s, e: m.e, note: m.note || '' })),
    theme: { dark: Theme.isDark(), bg: v('--bg'), surface: v('--surface'), surface2: v('--surface2'), line: v('--line'), text: v('--text'), muted: v('--muted'), accent: v('--accent'), ink: v('--accent-ink') },
    colors: { me: v('--me'), pa: v('--partner'), period: v('--period'), fertile: v('--fertile'), ovul: v('--ovul'), meet: v('--meet') },
    showTitles: Prefs.get().widgetTitles,
  };
}

/** Manda los datos a los widgets (con un respiro para no hacerlo en cada cambio). `now` la manda ya aunque no haya cambiado. */
function pushWidgets(now = false) {
  if (!isNative || !S.coupleId || !store.syncConfig) return;
  clearTimeout(widgetTimer);
  widgetTimer = setTimeout(() => {
    try {
      const j = JSON.stringify(widgetPayload());
      if (j === widgetJson && !now) return;
      widgetJson = j;
      native.widgetData(j);
    } catch (e) {
      console.warn('widgets', e);
    }
  }, now ? 0 : 600);
}

/** Entrega al trabajo en segundo plano las credenciales y opciones; se llama en cada cambio. */
function pushNativeConfig() {
  if (!isNative || !S.coupleId) return;
  const base = store.syncConfig?.();
  if (!base) return;
  const cfg = { ...base, hideTitles: !!S.me?.hideTitles, notify: Prefs.get().notify, instant: Prefs.get().instant, shareLoc: S.me?.shareLoc !== false, partnerName: partnerName() };
  const j = JSON.stringify(cfg);
  if (j === pushedCfg) return;
  pushedCfg = j;
  native.configure(cfg);
}

async function firstNativeSync() {
  if (!isNative || autoSynced || !S.coupleId || !S.me) return;
  autoSynced = true;
  await refreshNativeStatus();
  if (nativeStatus.fine && (!S.me.locAt || S.me.eventsV !== 2 || Date.now() - S.me.locAt > 10 * 60000)) {
    await syncNative(true).catch(() => {});
  }
}

let lastViewKey = '';
let lastDepth = 0;
let lastSnapJson = '';

/** El día del aniversario, al entrar a la app: mensaje y confeti (una vez al día en este teléfono). */
function maybeAnniversaryConfetti() {
  if (!S.coupleId || document.visibilityState !== 'visible') return;
  const ann = C.nextAnniversary(S.couple?.anniversary, new Date());
  if (!ann || ann.days !== 0 || ann.years < 1) return;
  const key = 'parejas-confetti-' + S.coupleId;
  const today = C.ymd(new Date());
  if (safeGet(key) === today) return;
  safeSet(key, today);
  toast(`¡Feliz aniversario! Cumplen ${plural(ann.years, 'año', 'años')}`);
  confetti();
  setTimeout(() => confetti({ count: 90, duration: 3400 }), 1100);
}
window.__confetti = confetti;

let sweeping = false;

/** Una vez cada 12 horas (cuando alguno abre la app) se borran del servidor los archivos de más de 15 días. */
function maybeSweep() {
  if (sweeping || !S.coupleId || !S.uid || !store.sweepExpired) return;
  const key = 'parejas-sweep-' + S.uid;
  if (Date.now() - Number(safeGet(key) || 0) < 12 * 3600000) return;
  sweeping = true;
  setTimeout(() => {
    store.sweepExpired()
      .then(() => safeSet(key, String(Date.now())))
      .catch((e) => console.warn('vencimiento', e))
      .finally(() => { sweeping = false; });
  }, 4000);
}

/** El chat se borró desde algún teléfono: este también limpia los archivos que tenía guardados. */
function checkChatCleared() {
  if (!S.coupleId || !S.uid) return;
  const key = `parejas-cleared-${S.uid}-${S.coupleId}`;
  const at = S.couple?.chatClearedAt || 0;
  const seen = safeGet(key);
  if (seen === null) { safeSet(key, String(at)); return; }
  if (at > Number(seen)) {
    safeSet(key, String(at));
    chat.wipeLocal(S.coupleId);
  }
}

function onSnapshot(next) {
  const json = JSON.stringify(next);
  if (json === lastSnapJson) return;
  lastSnapJson = json;
  const before = S.coupleId;
  S = next;
  setTimeout(maybeAnniversaryConfetti, 500);
  pullSettings();
  pushWidgets();
  if (before && !next.coupleId && next.coupleGone) {
    toast('Tu pareja eliminó la pareja');
    afterCoupleGone(before);
    return;
  }
  checkChatCleared();
  maybeSweep();
  pushNativeConfig();
  firstNativeSync();
  syncMeetingsToCalendar();
  const a = document.activeElement;
  const typing = a && $app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox';
  if (S.coupleId && tab === 'chat' && document.getElementById('msgs')) {
    chat.update();
    chat.ack();
    lastReadAt = Date.now();
    safeSet('parejas-read', String(lastReadAt));
    return;
  }
  chat.ack();
  if (typing) {
    dirty = true;
    return;
  }
  render();
}

function maybeNotify(m) {
  if (!m || m.from === S.uid || m.from === 'me') return;
  if (!Prefs.get().notify) return;
  const away = document.visibilityState !== 'visible';
  if (!away && tab === 'chat') return;
  if (isNative) {
    if (away) native.notify(partnerName(), MD.previewOf(m), m.at);
    return;
  }
  if ('Notification' in window && Notification.permission === 'granted' && away) {
    new Notification(partnerName(), { body: MD.previewOf(m), icon: 'icon.svg', tag: 'msg' });
  }
}

/** Cuadro de confirmación con el estilo de la app. Con `type`, hay que escribir ese texto para poder confirmar. */
function askSheet({ title, body, ok, type = '' }) {
  return new Promise((resolve) => {
    const rootEl = document.getElementById('sheet-root');
    rootEl.innerHTML = `<div class="sheet-back" data-ask-cancel><div class="sheet" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-preview"><b>${esc(title)}</b></div>
      <p class="muted" style="margin:6px 10px 12px">${esc(body)}</p>
      ${type ? `<label class="field" style="margin:0 10px 12px"><span>Escribe <b>${esc(type)}</b> para confirmar</span><input type="text" id="askin" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>` : ''}
      <div class="row"><button type="button" class="btn ghost" data-ask-cancel style="flex:1">Cancelar</button><button type="button" class="btn dangerfull" data-ask-ok style="flex:1" ${type ? 'disabled' : ''}>${esc(ok)}</button></div></div></div>`;
    const done = (v) => { rootEl.innerHTML = ''; rootEl.removeEventListener('click', onClick); rootEl.removeEventListener('input', onInput); resolve(v); };
    const onClick = (e) => {
      if (e.target.closest('[data-ask-ok]')) done(true);
      else if (e.target.matches('.sheet-back') || e.target.closest('button[data-ask-cancel]')) done(false);
    };
    const onInput = (e) => {
      if (e.target.id !== 'askin') return;
      rootEl.querySelector('[data-ask-ok]').disabled = e.target.value.trim().toUpperCase() !== String(type).toUpperCase();
    };
    rootEl.addEventListener('click', onClick);
    rootEl.addEventListener('input', onInput);
  });
}

/** Este teléfono se quedó sin pareja (la eliminaste o la eliminó tu pareja): se limpia todo lo local. */
async function afterCoupleGone(code) {
  if (isNative) {
    await native.disableAuto();
    native.configure(null);
    nativeStatus = await native.status();
  }
  pushedCfg = '';
  autoSynced = false;
  await chat.wipeLocal(code);
  chat.reset();
  tab = 'inicio';
  settingsPage = null;
  meetForm = null;
  render();
}

/* ------------------------------------------------------------ acciones */

function setPath(obj, path, val) {
  const parts = path.split('.');
  const out = { ...obj };
  let cur = out;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = { ...(cur[parts[i]] || {}) };
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
  return out;
}

async function saveField(path, value) {
  if (path === 'me.shareLoc' && value === false) {
    // dejar de compartir: se borra también la ubicación que ya estaba guardada
    return store.updateMe({ shareLoc: false, lat: null, lon: null, city: null, locAt: null });
  }
  if (path === 'couple.lastSeen' && value) {
    await store.markSeen(value, 'manual'); // la fecha también cuenta como día visto en el calendario
    return store.updateCouple({ lastSeen: value });
  }
  const [scope, ...rest] = path.split('.');
  const key = rest.join('.');
  if (scope === 'couple') {
    return store.updateCouple({ [key]: value || null });
  }
  if (path === 'me.cycle.last' && value) {
    // un nuevo inicio de periodo: se anota en el historial para que el cálculo aprenda
    return store.updateMe({ cycle: C.withNewPeriod(S.me?.cycle, value) });
  }
  if (rest.length > 1) {
    // me.cycle.xxx -> se guarda el objeto entero
    const base = setPath(S.me || {}, key, value);
    return store.updateMe({ [rest[0]]: base[rest[0]] });
  }
  return store.updateMe({ [key]: value });
}

function readField(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return el.value === '' ? null : Number(el.value);
  return el.value.trim();
}

/** Si la ubicación dice que están juntos (menos de 1 km), ese día cuenta como visto. */
async function afterLocation() {
  if (S.me?.shareLoc === false || S.partner?.shareLoc === false) return;
  if (!hasLoc(S.me) || !hasLoc(S.partner)) return;
  const d = C.distanceKm(S.me, S.partner);
  if (d != null && d < 1) await store.markSeen(C.ymd(new Date()), 'auto');
}

const round2 = (n) => Math.round(n * 50) / 50; // ~1–2 km

async function setLocation(lat, lon, city) {
  if (S.me?.shareLoc === false) throw new Error('Activa «Compartir mi ubicación» para guardarla');
  await store.updateMe({ lat: round2(lat), lon: round2(lon), city, locAt: Date.now() });
  await afterLocation();
}

function proposeText(b) {
  const first = b.slots.find(([s, e]) => e - s >= 3 * 3600000) || b.slots[0];
  return `¿Nos vemos el ${fmtDay(b.date)}? ${b.fullDay ? 'Los dos estamos libres todo el día' : `Estamos libres de ${fmtTime(first[0])} a ${fmtTime(first[1])}`}`;
}

function showMeetForm() {
  tab = 'agenda';
  render();
  window.scrollTo(0, 0);
}

function openMeetForm(b) {
  meetForm = b ? newMeetForm(b.date, b.slots.find(([s, e]) => e - s >= 3 * 3600000) || b.slots[0]) : newMeetForm();
  showMeetForm();
}

function saveMeetingFromForm() {
  captureMeetForm();
  const f = meetForm;
  if (!f) return;
  run(async () => {
    const { s, e } = meetRange(f);
    if (!f.date || Number.isNaN(s) || Number.isNaN(e)) throw new Error('Elige el día y la hora');
    if (e <= s) throw new Error('La hora de fin debe ser después de la de inicio');
    if (e < Date.now()) throw new Error('Esa hora ya pasó');
    if (isNative && Prefs.get().meetToCal) {
      nativeStatus = nativeStatus || await native.status();
      if (!nativeStatus.calendarWrite) {
        const r = await native.requestCalendarWrite();
        nativeStatus = await native.status();
        if (!r.ok) toast('Sin permiso del calendario: la cita queda solo en la app');
      }
    }
    await store.saveMeeting({ id: f.id, date: f.date, s, e, note: f.note.trim() });
    if (!f.id && f.tell) {
      const where = f.note.trim() ? ` (${f.note.trim()})` : '';
      await store.sendMessage(`Agendé vernos el ${fmtDay(C.parseYmd(f.date))} de ${fmtTime(s)} a ${fmtTime(e)}${where}`).catch(() => {});
    }
    meetForm = null;
    selDay = f.date;
    const d = C.parseYmd(f.date);
    const now = new Date();
    monthShift = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
  }, f.id ? 'Cita actualizada' : 'Cita agendada').then(() => { render(); syncMeetingsToCalendar(); });
}

function readSetup() {
  const name = document.getElementById('wname').value.trim();
  const gender = document.getElementById('wgender').value;
  if (!name) throw new Error('Escribe tu nombre');
  if (!gender) throw new Error('Elige cómo te identificas');
  return { name, gender };
}

const actions = {
  retry: () => run(() => store.init()),
  'theme-mode': (el) => { Theme.set({ mode: el.dataset.mode }); render(); },
  'theme-accent': (el) => { Theme.set({ accent: el.dataset.accent }); render(); },
  'auth-mode': (el) => { authMode = el.dataset.mode; render(); },
  'auth-reset': () => run(async () => {
    const email = document.getElementById('aemail').value.trim();
    if (!email) throw new Error('Escribe tu correo arriba y vuelve a tocar');
    await store.resetPassword(email);
  }, 'Te enviamos un correo para cambiar la contraseña'),
  create: () => run(async () => {
    const { name, gender } = readSetup();
    const partnerGender = document.getElementById('wpartner').value;
    if (!partnerGender) throw new Error('Elige cómo es tu pareja');
    tab = 'ajustes';
    settingsPage = 'perfil';
    const pass = document.getElementById('wcpass').value;
    if (pass && pass.length < 4) throw new Error('La contraseña de la pareja debe tener al menos 4 caracteres');
    await store.createCouple({ name, gender, hideTitles: false, cycleShare: true }, { partnerGender }, pass);
    toast('Pareja creada. Pásale el código a tu pareja desde Ajustes.');
  }),
  join: () => run(async () => {
    const { name, gender } = readSetup();
    const code = document.getElementById('wcode').value.trim();
    if (code.length !== 6) throw new Error('El código tiene 6 caracteres');
    await store.joinCouple(code, { name, gender, hideTitles: false, cycleShare: true }, document.getElementById('wjpass').value);
    tab = 'inicio';
  }),
  logout: () => {
    if (!confirm('¿Cerrar sesión en este teléfono? Tu pareja y tus datos quedan guardados; al volver a entrar con tu correo todo sigue igual. Se detiene la ubicación automática de este teléfono.')) return;
    run(async () => {
      if (isNative) {
        await native.disableAuto();
        native.configure(null);
      }
      pushedCfg = '';
      autoSynced = false;
      nativeStatus = null;
      chat.reset();
      tab = 'inicio';
      settingsPage = null;
      meetForm = null;
      await store.signOut();
    });
  },
  'seen-today': () => run(() => store.markSeen(C.ymd(new Date()), 'manual'), '¡Anotado!'),
  propose: (el) => {
    const b = best()[Number(el.dataset.i)];
    if (!b) return;
    chat.setDraft(proposeText(b));
    tab = 'chat';
    render();
    chat.focus();
  },
  month: (el) => { monthShift += Number(el.dataset.d); render(); },
  'show-new': () => { showForm = {}; render(); },
  'show-cancel': () => { showForm = null; render(); },
  'show-edit': (el) => {
    const s = S.shows.find((x) => x.id === el.dataset.id);
    showForm = { ...s };
    render();
    loadShowEpisodes();
    const ref = TV.refOf(s);
    if (ref?.src === 'tmdb') {
      TV.platformsOf(ref).then((list) => {
        if (!showForm || showForm.id !== s.id) return;
        captureShowForm();
        showForm.platforms = list;
        render();
      }).catch(() => {});
    }
  },
  'show-delete': () => {
    const s = showForm;
    if (!s?.id) return;
    if (!confirm(`¿Eliminar «${s.title}» de la lista? También se borra para ${partnerName()}.`)) return;
    run(async () => {
      await store.deleteShow(s.id);
      showForm = null;
    }, 'Serie eliminada').then(render);
  },
  'pick-show': (el) => run(async () => {
    const r = showResults[Number(el.dataset.i)];
    if (!r) return;
    captureShowForm();
    const platforms = await TV.platformsOf(r).catch(() => null);
    Object.assign(showForm, { title: r.title, src: r.src, srcId: r.id, tvmazeId: null, poster: r.poster, year: r.year, lang: r.lang, platforms, platform: platforms?.[0] || 'Otra' });
    showForm.season = null;
    showForm.episode = null;
    showForm.eps = undefined;
    showResults = [];
    render();
    loadShowEpisodes();
  }),
  'show-next': (el) => run(async () => {
    const s = S.shows.find((x) => x.id === el.dataset.id);
    let next = { season: s.season ?? 1, episode: (Number(s.episode) || 0) + 1 };
    if (TV.refOf(s)) {
      try {
        const eps = await TV.episodesOf(s);
        const n = TV.nextEpisode(eps, s.season, s.episode);
        if (!n) throw new Error('No hay más episodios publicados');
        next = { season: n.season, episode: n.number };
      } catch (e) {
        if (e.message === 'No hay más episodios publicados') throw e; // sin conexión con el servicio de series: se suma 1 a mano
      }
    }
    return store.saveShow({ ...s, ...next });
  }),
  'city-search': () => run(async () => {
    const q = document.getElementById('cityin').value.trim();
    if (!q) throw new Error('Escribe una ciudad');
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=${encodeURIComponent(q)}`);
    const j = await r.json();
    if (!j.length) throw new Error('No encontré esa ciudad');
    await setLocation(Number(j[0].lat), Number(j[0].lon), j[0].display_name.split(',').slice(0, 1).concat(j[0].display_name.split(',').slice(-1)).join(',').trim());
  }, 'Ubicación guardada'),
  geo: () => run(async () => {
    const pos = await new Promise((res, rej) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(res, () => rej(new Error('No pude obtener tu ubicación')), { timeout: 15000 }) : rej(new Error('Tu navegador no tiene geolocalización')));
    await setLocation(pos.coords.latitude, pos.coords.longitude, S.me?.city || 'Ubicación actual');
  }, 'Ubicación guardada'),
  'auto-on': () => run(async () => {
    const r = await native.enableAuto();
    nativeStatus = await native.status();
    if (!r.ok) throw new Error(r.error === 'background' ? 'Falta elegir «Permitir todo el tiempo» en el permiso de ubicación' : 'No diste el permiso de ubicación');
    await syncNative(true);
    render();
    toast('Ubicación automática activada');
  }),
  'auto-off': () => run(async () => {
    await native.disableAuto();
    nativeStatus = await native.status();
    render();
  }, 'Desactivada'),
  'sync-now': () => run(async () => {
    if (!nativeStatus?.fine) {
      await native.enableAuto();
      nativeStatus = await native.status();
      if (!nativeStatus.fine) throw new Error('No diste el permiso de ubicación');
    }
    await syncNative(false);
    nativeStatus = await native.status();
    render();
  }, 'Actualizado'),
  'cal-perm': () => run(async () => {
    const r = await native.requestCalendar();
    nativeStatus = await native.status();
    if (!r.ok) throw new Error('No diste el permiso del calendario');
    if (!nativeStatus.fine) throw new Error('Activa primero la ubicación');
    await syncNative(false);
    render();
  }, 'Calendario sincronizado'),
  battery: () => native.openBatterySettings(),
  'widget-pin': (el) => run(async () => {
    const r = await native.pinWidget(el.dataset.kind);
    if (!r.ok) throw new Error('No se pudo pedir el widget: agrégalo desde la pantalla de inicio');
  }),
  'widgets-refresh': () => run(async () => {
    pushWidgets(true);
    await native.widgetsRefresh();
    nativeStatus = await native.status();
    render();
  }, 'Widgets actualizados'),
  'battery-ask': () => native.requestIgnoreBattery().then(async () => { nativeStatus = await native.status(); render(); }),
  'chat-clear': async () => {
    if (!(await askSheet({ title: '¿Borrar todo el chat?', body: 'Se borran los mensajes, fotos, videos y audios del servidor y de los dos teléfonos. No se puede deshacer.', ok: 'Borrar todo' }))) return;
    run(async () => {
      await store.clearChat();
      await chat.wipeLocal(S.coupleId);
    }, 'Chat borrado');
  },
  'couple-delete': async () => {
    const code = S.coupleId;
    if (!(await askSheet({
      title: '¿Eliminar la pareja?',
      body: 'Se borra del servidor todo lo de ustedes (chat, archivos, series, citas, ubicaciones) y el código deja de existir. Los dos quedan sin pareja. No se puede deshacer.',
      ok: 'Eliminar la pareja',
      type: code,
    }))) return;
    run(async () => {
      await store.deleteCouple();
      await afterCoupleGone(code);
    }, 'Pareja eliminada');
  },
  cal: () => run(async () => {
    const n = await store.connectCalendar();
    toast(`Calendario sincronizado (${n} eventos)`);
  }),
  'cycle-today': () => run(() => store.updateMe({ cycle: C.withNewPeriod(S.me?.cycle, C.ymd(new Date())) }), 'Anotado: el cálculo aprende de tus ciclos reales'),
  notif: () => run(async () => {
    if (!('Notification' in window)) throw new Error('Tu navegador no admite avisos');
    const r = await Notification.requestPermission();
    render();
    if (r !== 'granted') throw new Error('No diste permiso');
  }, 'Avisos activados'),
  disguise: (el) => {
    const key = el.dataset.key;
    const name = DISGUISES.find((d) => d[0] === key)?.[1];
    if (!name || key === (nativeStatus?.disguise || 'nosotros')) return;
    if (!confirm(`¿Cambiar el ícono y el nombre a «${name}»? El ícono actual desaparecerá y el nuevo aparecerá en el cajón de apps en unos segundos.`)) return;
    run(async () => {
      const r = await native.setDisguise(key);
      if (!r.ok) throw new Error('No se pudo cambiar el ícono');
      nativeStatus = await native.status();
      render();
    }, `Ahora aparece como «${name}»`);
  },
  'set-page': (el) => { settingsPage = el.dataset.page; render(); window.scrollTo(0, 0); },
  'set-back': () => { settingsPage = null; render(); window.scrollTo(0, 0); },
  'cal-color': (el) => { Prefs.setColor(el.dataset.key, el.dataset.hex); applyColors(); pushWidgets(); render(); },
  'cal-write-perm': () => run(async () => {
    const r = await native.requestCalendarWrite();
    nativeStatus = await native.status();
    if (!r.ok) throw new Error('No diste el permiso para crear eventos');
    await syncMeetingsToCalendar();
    render();
  }, 'Listo'),
  'notif-perm': () => run(async () => {
    await native.requestNotifications();
    nativeStatus = await native.status();
    render();
    if (!nativeStatus.notifications) throw new Error('No diste el permiso de notificaciones');
  }, 'Notificaciones permitidas'),
  'pick-time': (el) => openTimePicker(el.dataset.field),
  'meet-new': () => openMeetForm(best()[0]),
  'meet-best': (el) => openMeetForm(best()[Number(el.dataset.i)]),
  'meet-day': () => { meetForm = newMeetForm(C.parseYmd(selDay)); showMeetForm(); },
  'meet-edit': (el) => {
    const m = (S.meetings || []).find((x) => x.id === el.dataset.id);
    if (!m) return;
    meetForm = { id: m.id, date: m.date || C.ymd(new Date(m.s)), from: timeStr(m.s), to: timeStr(m.e), note: m.note || '', tell: false };
    showMeetForm();
  },
  'meet-cancel': () => { meetForm = null; render(); },
  'meet-del': (el) => {
    if (!confirm('¿Quitar esta cita? También se quita del calendario de los dos.')) return;
    run(() => store.deleteMeeting(el.dataset.id), 'Cita quitada');
  },
  'couple-pass': () => run(async () => {
    const input = document.getElementById('cpass');
    if (input.value.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres');
    await store.setCouplePassword(input.value);
    input.value = '';
  }, 'Contraseña guardada'),
  'couple-pass-off': () => {
    if (!confirm('¿Quitar la contraseña? Quien tenga el código podrá unirse.')) return;
    run(() => store.setCouplePassword(''), 'Contraseña quitada');
  },
  'google-in': () => run(async () => {
    const r = await native.googleSignIn(firebaseConfig.googleWebClientId);
    if (!r.ok) throw new Error(r.error === 'cancel' ? 'Se canceló el inicio con Google' : 'No se pudo iniciar sesión con Google');
    await store.signInWithGoogle(r.idToken);
  }),
  'google-web': () => run(() => store.signInWithGooglePopup()),
  leave: () => {
    if (confirm(store.kind === 'demo' ? '¿Borrar los datos de la demo?' : '¿Salir y quitar este teléfono de la pareja?')) {
      run(async () => {
        if (isNative) { await native.disableAuto(); native.configure(null); }
        await store.leave();
      });
    }
  },
};

$app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab],[data-go],[data-act],[data-day]');
  if (!t) return;
  if (t.dataset.tab || t.dataset.go) {
    tab = t.dataset.tab || t.dataset.go;
    if (tab === 'ajustes') settingsPage = t.dataset.page || null; // la pestaña siempre vuelve al menú
    render();
    window.scrollTo(0, 0);
  } else if (t.dataset.day && !t.dataset.act) {
    selDay = t.dataset.day;
    const d = C.parseYmd(selDay);
    const now = new Date();
    monthShift = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
    tab = 'agenda';
    render();
  } else if (t.dataset.act && actions[t.dataset.act]) {
    currentKey = t.dataset.act;
    actions[t.dataset.act](t);
  }
});

$app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'cyon') {
    document.getElementById('cybox').classList.toggle('hidden', !el.checked);
    currentKey = 'chg:cyon';
    if (!el.checked) run(() => store.updateMe({ cycle: null, cycleShare: false }), 'Ciclo desactivado');
    else run(() => store.updateMe({ cycleShare: true }));
    return;
  }
  if (el.dataset.pref) {
    const [k, a, b2] = el.dataset.pref.split('.');
    if (k === 'dl') Prefs.setDl(a, b2, el.checked);
    else Prefs.set({ [k]: el.checked });
    if (k === 'notify' || k === 'instant') {
      pushNativeConfig();
      if (el.checked && isNative && nativeStatus && !nativeStatus.notifications) {
        native.requestNotifications().then(async () => { nativeStatus = await native.status(); render(); });
      }
    }
    if (k === 'widgetTitles') pushWidgets(true);
    if (k === 'meetToCal') {
      if (el.checked) syncMeetingsToCalendar();
      render();
    }
    return;
  }
  if (el.id === 'lockon') {
    currentKey = 'chg:lock';
    const want = el.checked;
    run(async () => {
      const r = await native.setLock(want);
      nativeStatus = await native.status();
      render();
      if (!r.ok) throw new Error(r.error === 'none' ? 'Primero configura una huella o PIN en el teléfono' : 'No se cambió el bloqueo');
    }, want ? 'Bloqueo activado' : 'Bloqueo desactivado');
    return;
  }
  if (el.closest('#meetform')) {
    captureMeetForm();
    const box = document.getElementById('meetphase');
    if (box) box.innerHTML = meetPhaseHtml();
    return;
  }
  if (el.name === 'season' && el.closest('#showform') && showForm?.eps) {
    captureShowForm();
    showForm.episode = showForm.eps.find((e) => e.season === showForm.season)?.number ?? null;
    render();
    return;
  }
  if (!el.dataset.field) return;
  currentKey = 'field:' + el.dataset.field;
  run(() => saveField(el.dataset.field, readField(el)), 'Guardado').then(() => {
    // al cambiar si se ocultan los nombres de los eventos, se vuelven a subir ya con el nuevo criterio
    if (el.dataset.field === 'me.hideTitles' && isNative && nativeStatus?.fine) syncNative(true, { hide: el.checked }).catch(() => {});
    if (dirty) render();
  });
});

$app.addEventListener('toggle', (e) => {
  const key = e.target?.dataset?.key;
  if (!key) return;
  if (e.target.open) openSyn.add(key);
  else openSyn.delete(key);
}, true);

$app.addEventListener('focusout', () => {
  setTimeout(() => { if (dirty && !$app.contains(document.activeElement)) render(); }, 800);
});

$app.addEventListener('input', (e) => {
  if (e.target.id === 'stitle' && showForm) {
    showForm.title = e.target.value;
    showForm.tvmazeId = null; // si cambia el título, deja de estar vinculado a la serie elegida
    showForm.src = null;
    showForm.srcId = null;
    showForm.platforms = null;
    showForm.poster = null;
    showForm.eps = undefined;
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => searchShowsNow(q), 350);
  }
  if (e.target.id === 'wname') welcomeName = e.target.value;
});

$app.addEventListener('submit', (e) => {
  e.preventDefault();
  currentKey = 'form:' + e.target.id;
  if (e.target.id === 'authform') {
    const email = document.getElementById('aemail').value.trim();
    const pass = document.getElementById('apass').value;
    run(() => (authMode === 'signup' ? store.signUp(email, pass) : store.signInEmail(email, pass)));
    return;
  }
  if (e.target.id === 'meetform') {
    saveMeetingFromForm();
    return;
  }
  if (e.target.id === 'composer') {
    return; // lo atiende lib/chat.js
  } else if (e.target.id === 'showform') {
    const f = new FormData(e.target);
    const toNum = (v) => (v === '' || v == null ? null : Number(v));
    const show = { id: showForm?.id, title: String(f.get('title')).trim(), platform: f.get('platform'), season: toNum(f.get('season')), episode: toNum(f.get('episode')), tvmazeId: showForm?.tvmazeId ?? null, src: showForm?.src ?? null, srcId: showForm?.srcId ?? null, poster: showForm?.poster ?? null, year: showForm?.year ?? null, lang: showForm?.lang ?? null };
    run(async () => {
      if (showForm?.eps?.length && !showForm.eps.some((e) => e.season === show.season && e.number === show.episode)) {
        throw new Error('Esa temporada o episodio no existe en la serie');
      }
      await store.saveShow(show);
      showForm = null;
    }, 'Guardado').then(render);
  }
});

/* ------------------------------------------------------------ chat */

const chat = createChat({
  root: $app,
  sheetRoot: document.getElementById('sheet-root'),
  store,
  getS: () => S,
  esc,
  partnerName: () => partnerName(),
  fmtTime,
  toast,
  isActive: () => tab === 'chat',
  prefs: () => Prefs.get(),
  net: getNet,
  gallery: isNative ? (blob, name) => native.saveMedia(blob, name).then((r) => { if (!r.ok) throw new Error(r.error || 'no se guardó'); }) : null,
  secure: isNative ? (on) => { native.setSecure(on); } : null,
  share: isNative ? (blob, name) => native.shareMedia(blob, name).then((r) => { if (!r.ok) throw new Error('No se pudo compartir'); }) : null,
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { pushWidgets(true); setTimeout(maybeAnniversaryConfetti, 400); } // el tema del teléfono pudo cambiar
  chat.ack();
  if (isNative && document.visibilityState === 'visible' && tab === 'chat') native.seen();
});

/* ------------------------------------------------------------ arranque */

if (!isNative && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// El color de la barra de estado y de navegación de Android sigue al tema.
const syncBars = (info) => { if (isNative) native.setBars(info.bg, info.dark, info.accent); };
Theme.onChange(syncBars);
syncBars(Theme.current());

store.onIncoming = maybeNotify;
store.onTyping = (d) => chat.setPartnerTyping(d);
applyColors();
Theme.onChange(applyColors);
Theme.onChange(() => setTimeout(() => pushWidgets(), 50));
Prefs.onChange(() => queueSettingsUp());
Theme.onChange(() => queueSettingsUp());
onNet(() => chat.refresh());
/** Abre una pestaña; con `day` ('AAAA-MM-DD') la agenda queda en ese día (la usan los widgets y los avisos). */
function openTabAt(t, day) {
  if (!S.coupleId || !['agenda', 'chat', 'inicio', 'series', 'ajustes'].includes(t)) return;
  tab = t;
  if (t === 'agenda' && /^\d{4}-\d{2}-\d{2}$/.test(day || '')) {
    selDay = day;
    const d = C.parseYmd(day);
    const now = new Date();
    monthShift = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
  }
  render();
}
window.__openTab = (t, day) => openTabAt(t, day);
store.subscribe(onSnapshot);
Promise.all([store.init(), isNative ? native.status() : null, isNative ? native.launchTab() : null])
  .then(([, st, launch]) => {
    if (st) nativeStatus = st;
    if (launch?.tab && ['agenda', 'chat', 'inicio', 'series', 'ajustes'].includes(launch.tab)) {
      tab = launch.tab;
      if (tab === 'agenda' && /^\d{4}-\d{2}-\d{2}$/.test(launch.day || '')) {
        selDay = launch.day;
        const d = C.parseYmd(launch.day);
        const now = new Date();
        monthShift = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
      }
    }
    render();
  })
  .catch((e) => console.error(e));
window.__app = { get state() { return S; }, store, C };
