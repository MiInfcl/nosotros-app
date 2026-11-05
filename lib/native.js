// Puente con la app de Android (WebView). En el navegador `isNative` es false y nada de esto se usa.
// Cada método nativo responde llamando a window.__nativeCb(id, json).
const B = window.NativeBridge;
export const isNative = !!B;

let seq = 0;
const pending = new Map();
window.__nativeCb = (id, json) => {
  const done = pending.get(id);
  pending.delete(id);
  if (done) done(JSON.parse(json));
};

function call(method, arg = '') {
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    try {
      B[method](id, arg);
    } catch (e) {
      pending.delete(id);
      resolve({ ok: false, error: String(e) });
    }
  });
}

export const native = {
  /** {fine, background, calendar, calendarWrite, notifications, auto, battery, lock} */
  status: () => call('status'),
  /** Pide ubicación (y "todo el tiempo") y programa la actualización cada 30 min. */
  enableAuto: () => call('enableAuto'),
  disableAuto: () => call('disableAuto'),
  /** Lee ubicación (+ calendario si hay permiso). {ok, lat, lon, city, events|null, error} */
  collect: () => call('collect'),
  requestCalendar: () => call('requestCalendar'),
  /** Permiso para crear citas en el calendario del teléfono. */
  requestCalendarWrite: () => call('requestCalendarWrite'),
  /** Crea una cita en el calendario del teléfono: {ok, eventId}. La app la reconoce y no cuenta como ocupado. */
  addEvent: (ev) => call('addEvent', JSON.stringify(ev)),
  removeEvent: (eventId) => call('removeEvent', String(eventId)),
  /** Diagnóstico: ejecuta ahora el trabajo de segundo plano. */
  backgroundNow: () => call('backgroundNow'),
  /** Color de las barras del sistema (barra de estado y de navegación). */
  setBars: (bg, dark, accent) => call('setBars', JSON.stringify({ bg, dark, accent })),
  openBatterySettings: () => call('openBatterySettings'),
  /** Tipo de conexión: {type: 'wifi'|'mobile'|'none'}. */
  network: () => call('network'),
  /** Permiso de notificaciones (Android 13+). */
  requestNotifications: () => call('requestNotifications'),
  /** Muestra una notificación local (la app está en segundo plano). */
  notify: (title, body, at) => call('notify', JSON.stringify({ title, body, at })),
  /** El chat se está viendo: quita los avisos pendientes y marca todo como visto para el trabajo de segundo plano. */
  seen: () => call('seen'),
  /** Pestaña que pidió abrir la notificación que lanzó la app (una sola vez). */
  launchTab: () => call('launchTab'),
  /** Bloqueo con huella / PIN al abrir. enable pide autenticarse una vez para confirmar. */
  setLock: (on) => call('setLock', on ? '1' : '0'),
  /** Impide capturas de pantalla (fotos de una sola vez). */
  /** Cambia el ícono y el nombre de la app en el cajón de apps (clave de DISGUISES). */
  setDisguise: (key) => call('setDisguise', key),
  setSecure: (on) => call('setSecure', on ? '1' : '0'),
  /** Guarda un archivo en la galería. Se envía en trozos de base64 por el límite del puente. */
  async saveMedia(blob, name, share = false) {
    const key = String(Date.now()) + Math.random().toString(36).slice(2, 6);
    const begin = await call('saveBegin', JSON.stringify({ key, name, share, mime: blob.type || 'application/octet-stream' }));
    if (!begin.ok) return begin;
    const CH = 384 * 1024; // múltiplo de 3: cada trozo es base64 válido por sí solo
    for (let i = 0; i < blob.size; i += CH) {
      const buf = new Uint8Array(await blob.slice(i, i + CH).arrayBuffer());
      let bin = '';
      for (let j = 0; j < buf.length; j += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(j, j + 0x8000));
      await call('saveChunk', key + '\n' + btoa(bin));
    }
    return call('saveEnd', key);
  },
  /** Abre el menú de compartir de Android con el archivo (misma subida en trozos que saveMedia). */
  shareMedia(blob, name) {
    return this.saveMedia(blob, name, true);
  },
  /** Pide quitar la restricción de batería (para los avisos al instante). */
  requestIgnoreBattery: () => call('requestIgnoreBattery'),
  /** Datos para los widgets de la pantalla de inicio (JSON). */
  widgetData: (json) => B.widgetData(json),
  /** Pide agregar un widget a la pantalla de inicio: kind = seen|distance|today|week|month|cycle|together|meet|shortcuts. */
  pinWidget: (kind) => call('pinWidget', kind),
  /** Baja ya los datos de los widgets desde Firebase. */
  widgetsRefresh: () => call('widgetsRefresh'),
  /** Credenciales y opciones para el trabajo en segundo plano (null = borrar). */
  configure: (cfg) => B.configure(cfg ? JSON.stringify(cfg) : ''),
  /** Inicio de sesión con Google (cuenta del teléfono): {ok, idToken, error}. */
  googleSignIn: (webClientId) => call('googleSignIn', webClientId),
};
