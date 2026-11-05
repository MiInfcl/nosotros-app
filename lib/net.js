// Tipo de conexión actual: 'wifi' | 'mobile' | 'none'. Sirve para decidir qué archivos se descargan solos.
import { isNative, native } from './native.js';

let current = 'wifi'; // hasta saberlo, se asume wifi (en un navegador de escritorio no hay datos móviles)
const listeners = new Set();

export const getNet = () => current;
export const onNet = (fn) => { listeners.add(fn); };

export async function refreshNet() {
  let next = current;
  if (isNative) {
    const r = await native.network().catch(() => null);
    if (r?.type) next = r.type;
  } else if (!navigator.onLine) {
    next = 'none';
  } else {
    const t = navigator.connection?.type;
    next = t === 'cellular' ? 'mobile' : 'wifi';
  }
  if (next !== current) {
    current = next;
    listeners.forEach((fn) => fn(current));
  }
  return current;
}

window.addEventListener('online', refreshNet);
window.addEventListener('offline', refreshNet);
navigator.connection?.addEventListener?.('change', refreshNet);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshNet(); });
refreshNet();
