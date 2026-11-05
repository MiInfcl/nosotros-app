// Lógica pura (sin DOM ni red): se prueba con `node test/calc.test.js`.

const DAY = 86400000;

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const diffDays = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

/** Distancia en km entre dos puntos (fórmula de haversine). */
export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Días desde una fecha 'AAAA-MM-DD' hasta hoy (>= 0 si ya pasó). */
export function daysSince(dateStr, now = new Date()) {
  if (!dateStr) return null;
  return diffDays(parseYmd(dateStr), now);
}

/** Próximo aniversario (fecha de inicio 'AAAA-MM-DD'). Devuelve días, fecha y años que cumplen. */
export function nextAnniversary(startStr, now = new Date()) {
  if (!startStr) return null;
  const start = parseYmd(startStr);
  const today = startOfDay(now);
  let year = today.getFullYear();
  const make = (y) => {
    // 29 de febrero -> 28 en años no bisiestos
    const d = new Date(y, start.getMonth(), start.getDate());
    if (d.getMonth() !== start.getMonth()) return new Date(y, start.getMonth() + 1, 0);
    return d;
  };
  let next = make(year);
  if (next < today) next = make(++year);
  return { date: next, days: diffDays(today, next), years: year - start.getFullYear() };
}

/** Mensualidad (cada día del mismo número): días hasta el próximo "mesiversario". */
export function nextMonthiversary(startStr, now = new Date()) {
  if (!startStr) return null;
  const start = parseYmd(startStr);
  const today = startOfDay(now);
  for (let i = 0; i < 14; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, start.getDate());
    if (d >= today && d.getDate() === start.getDate()) {
      return { date: d, days: diffDays(today, d) };
    }
  }
  return null;
}

/** Texto "x años, y meses, z días" entre dos fechas. */
export function together(startStr, now = new Date()) {
  if (!startStr) return null;
  const s = parseYmd(startStr);
  const t = startOfDay(now);
  let y = t.getFullYear() - s.getFullYear();
  let m = t.getMonth() - s.getMonth();
  let d = t.getDate() - s.getDate();
  if (d < 0) {
    m--;
    d += new Date(t.getFullYear(), t.getMonth(), 0).getDate();
  }
  if (m < 0) {
    y--;
    m += 12;
  }
  return { years: y, months: m, days: d, totalDays: diffDays(s, t) };
}

/**
 * Largo del ciclo que se usa para calcular: el que dijo la persona (`len`) cuenta como una muestra y se promedia con los
 * últimos 6 ciclos reales (días entre inicios de periodo anotados en `starts` + `last`). Así, si dice 32 pero sus periodos
 * llegan cada 29, el cálculo se va acortando solo. Se ignoran intervalos fuera de 20–45 días (meses saltados, errores).
 */
export function learnedLen(cycle) {
  const base = Math.max(20, Math.min(45, Number(cycle?.len) || 28));
  const dates = [...new Set([...(cycle?.starts || []), cycle?.last].filter(Boolean))].sort();
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(diffDays(parseYmd(dates[i - 1]), parseYmd(dates[i])));
  const seen = gaps.filter((g) => g >= 20 && g <= 45).slice(-6);
  if (!seen.length) return base;
  const avg = (base + seen.reduce((a, b) => a + b, 0)) / (seen.length + 1);
  return Math.max(20, Math.min(45, Math.round(avg)));
}

/** El periodo empezó en `dateStr`: el inicio anterior pasa al historial (si es posterior; si es una corrección, solo se cambia). */
export function withNewPeriod(cycle, dateStr) {
  const base = cycle || { len: 28, period: 5 };
  const starts = [...(base.starts || [])];
  if (base.last && dateStr > base.last && !starts.includes(base.last)) starts.push(base.last);
  starts.sort();
  return { ...base, last: dateStr, starts: starts.slice(-12) };
}

/**
 * Ciclo menstrual (estimación por calendario, NO es un método anticonceptivo).
 * cycle = { last: 'AAAA-MM-DD' (inicio del último periodo), len: 28, period: 5 }
 */
export function cycleInfo(cycle, now = new Date()) {
  if (!cycle || !cycle.last) return null;
  const len = learnedLen(cycle);
  const period = Math.max(1, Math.min(10, Number(cycle.period) || 5));
  const today = startOfDay(now);
  const last = parseYmd(cycle.last);
  let since = diffDays(last, today);
  if (since < 0) return null;
  const cyclesPassed = Math.floor(since / len);
  const dayOfCycle = (since % len) + 1; // 1..len
  const currentStart = addDays(last, cyclesPassed * len);
  const nextStart = addDays(currentStart, len);
  const ovulationDay = len - 14; // ~14 días antes del siguiente periodo
  let phase;
  if (dayOfCycle <= period) phase = 'menstruacion';
  else if (dayOfCycle < ovulationDay - 4) phase = 'folicular';
  else if (dayOfCycle <= ovulationDay + 1) phase = 'fertil';
  else phase = 'lutea';
  return {
    len,
    period,
    dayOfCycle,
    phase,
    nextStart,
    daysToNext: diffDays(today, nextStart),
    currentStart,
    ovulation: addDays(currentStart, ovulationDay - 1),
  };
}

/** Fase de un día cualquiera (para pintar el calendario). */
export function phaseOn(cycle, date) {
  const info = cycleInfo(cycle, date);
  return info ? info.phase : null;
}

/**
 * Clase de un día para pintar el calendario: 'menstruacion' | 'ovulacion' | 'fertil' | 'folicular' | 'lutea' | null.
 * Igual que phaseOn, pero separa el día estimado de ovulación del resto de la ventana fértil.
 */
export function dayKindOn(cycle, date) {
  const info = cycleInfo(cycle, date);
  if (!info) return null;
  if (info.phase === 'fertil' && info.dayOfCycle === info.len - 14) return 'ovulacion';
  return info.phase;
}

/** Cómo está el ciclo ese día, en una frase: «fase folicular · día 9 de 28». null si no hay datos. */
export function phaseSummary(cycle, date) {
  const info = cycleInfo(cycle, date);
  if (!info) return null;
  const kind = dayKindOn(cycle, date);
  const nombre = { menstruacion: 'menstruación (periodo)', ovulacion: 'ovulación estimada', fertil: 'ventana fértil', folicular: 'fase folicular', lutea: 'fase lútea' }[kind];
  return { kind, text: `${nombre} · día ${info.dayOfCycle} de ${info.len}`, nota: PHASES[info.phase].nota, dayOfCycle: info.dayOfCycle };
}

export const PHASES = {
  menstruacion: { nombre: 'Menstruación', nota: 'Días de periodo. Mimos, calor y planes tranquilos.' },
  folicular: { nombre: 'Fase folicular', nota: 'La energía va subiendo.' },
  fertil: { nombre: 'Ventana fértil / ovulación', nota: 'Es la ventana de más probabilidad de embarazo.' },
  lutea: { nombre: 'Fase lútea', nota: 'Puede haber más cansancio o sensibilidad (SPM).' },
};

// ---------------------------------------------------------------- calendario

/**
 * Evento: { s: ms epoch inicio, e: ms epoch fin, allDay: bool, t: título|null }
 * Devuelve los intervalos libres de un día entre [from,to) horas locales, restando eventos.
 */
export function freeIntervals(events, day, fromH = 9, toH = 23) {
  const dayStart = startOfDay(day);
  const winS = dayStart.getTime() + fromH * 3600000;
  const winE = dayStart.getTime() + toH * 3600000;
  const busy = [];
  for (const ev of events || []) {
    if (ev.allDay) {
      // los eventos de todo el día bloquean el día entero solo si no son "informativos" (marcados libres)
      if (ev.free) continue;
      if (ev.e > winS && ev.s < dayStart.getTime() + DAY) busy.push([winS, winE]);
      continue;
    }
    if (ev.free) continue;
    if (ev.e > winS && ev.s < winE) busy.push([Math.max(ev.s, winS), Math.min(ev.e, winE)]);
  }
  busy.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const b of busy) {
    const last = merged[merged.length - 1];
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]);
    else merged.push([...b]);
  }
  const free = [];
  let cur = winS;
  for (const [s, e] of merged) {
    if (s > cur) free.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (cur < winE) free.push([cur, winE]);
  return free;
}

function intersect(a, b) {
  const out = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]);
    const e = Math.min(a[i][1], b[j][1]);
    if (e > s) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

/**
 * Mejores fechas para verse. Puntúa cada día de los próximos `horizon` días:
 * horas libres juntos (mejor un bloque largo), fin de semana y víspera de festivo suman,
 * y los días con periodo de ella suman 0 (no se descartan) pero se marcan.
 * opts: { horizon=60, minHours=3, fromH=9, toH=23, top=5, cycles: [ciclo...] }
 */
export function bestDates(eventsA, eventsB, now = new Date(), opts = {}) {
  const { horizon = 60, minHours = 3, fromH = 9, toH = 23, top = 5, cycles = [] } = opts;
  const today = startOfDay(now);
  const out = [];
  for (let i = 0; i < horizon; i++) {
    const day = addDays(today, i);
    let a = freeIntervals(eventsA, day, fromH, toH);
    let b = freeIntervals(eventsB, day, fromH, toH);
    let both = intersect(a, b);
    // si es hoy, solo lo que queda del día
    if (i === 0) both = both.map(([s, e]) => [Math.max(s, now.getTime()), e]).filter(([s, e]) => e > s);
    const longest = both.reduce((m, [s, e]) => Math.max(m, e - s), 0) / 3600000;
    const total = both.reduce((m, [s, e]) => m + (e - s), 0) / 3600000;
    if (longest < minHours) continue;
    const dow = day.getDay();
    const weekend = dow === 0 || dow === 6;
    const friday = dow === 5;
    let score = Math.min(longest, 10) * 1.5 + Math.min(total, 14) * 0.5;
    if (weekend) score += 6;
    else if (friday) score += 3;
    const periodDay = cycles.some((c) => phaseOn(c, day) === 'menstruacion');
    out.push({
      date: day,
      score,
      weekend,
      periodDay,
      longestHours: longest,
      slots: both,
      // "ventana completa": ambos libres todo el día
      fullDay: longest >= toH - fromH - 0.01,
    });
  }
  out.sort((x, y) => y.score - x.score || x.date - y.date);
  return out.slice(0, top);
}

/** Series: texto "T2 · E5". */
export function episodeLabel(show) {
  if (!show) return '';
  const parts = [];
  if (show.season != null && show.season !== '') parts.push(`T${show.season}`);
  if (show.episode != null && show.episode !== '') parts.push(`E${show.episode}`);
  return parts.join(' · ');
}

/** Código para emparejarse: 6 caracteres sin ambiguos. */
export function makeCode(rand = Math.random) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(rand() * chars.length)];
  return s;
}
