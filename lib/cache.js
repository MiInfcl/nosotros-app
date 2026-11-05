// Archivos del chat ya descargados, guardados en este teléfono (IndexedDB) para que sigan ahí al cerrar y volver
// a abrir la app. Clave: «CÓDIGO/mediaId». Si IndexedDB no está disponible, todo responde «no hay» y el chat
// sigue funcionando (baja los archivos de nuevo).
const DB_NAME = 'nosotros-media';
const STORE = 'files';

let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('sin IndexedDB')); return; }
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    dbp.catch(() => { dbp = null; });
    // que el sistema no borre estos archivos cuando falte espacio
    try { navigator.storage?.persist?.(); } catch {}
  }
  return dbp;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const FileCache = {
  key: (coupleId, mediaId) => `${coupleId}/${mediaId}`,
  /** Blob guardado o null. */
  async get(key) {
    try { return (await run('readonly', (s) => s.get(key))) || null; } catch { return null; }
  },
  async put(key, blob) {
    try { await run('readwrite', (s) => s.put(blob, key)); return true; } catch { return false; }
  },
  /** Claves guardadas que empiezan con el prefijo (p. ej. «CÓDIGO/»). */
  async keys(prefix) {
    try {
      const all = await run('readonly', (s) => s.getAllKeys());
      return (all || []).filter((k) => String(k).startsWith(prefix));
    } catch { return []; }
  },
  async removePrefix(prefix) {
    try {
      const ks = await this.keys(prefix);
      await run('readwrite', (s) => { ks.forEach((k) => s.delete(k)); });
    } catch {}
  },
};
