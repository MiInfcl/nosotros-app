// Capa de datos. Dos implementaciones con la misma interfaz:
//  - DemoStore: todo en localStorage, con una pareja simulada (sirve para probar sin configurar nada).
//  - FirebaseStore: Firebase Auth (anónima) + Firestore. No necesita servidor propio.
import { makeCode, ymd, addDays } from './calc.js';
import { CHUNK, chunkRanges, MEDIA_KEEP_DAYS } from './media.js';

const KEEP_MS = MEDIA_KEEP_DAYS * 86400000;

const FB_VERSION = '10.12.2';

/** Prueba de que se conoce la contraseña de la pareja: SHA-256 de «CÓDIGO:contraseña» (el servidor solo guarda este hash). */
export async function codeProof(code, password) {
  const bytes = new TextEncoder().encode(`${String(code).toUpperCase()}:${password || ''}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isFirebaseConfigured(cfg) {
  return !!(cfg && cfg.apiKey && cfg.projectId && !String(cfg.apiKey).startsWith('PEGA'));
}

/* ------------------------------------------------------------------ Demo */

function demoPartnerSeed() {
  const today = new Date();
  const at = (days, h, mins = 0) => {
    const d = addDays(today, days);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mins).getTime();
  };
  const h = 3600000;
  const events = [
    { s: at(1, 9), e: at(1, 13), t: 'Clases', allDay: false },
    { s: at(2, 15), e: at(2, 17), t: 'Dentista', allDay: false },
    { s: at(3, 19), e: at(3, 22), t: 'Cena con amigas', allDay: false },
    { s: at(5, 0), e: at(6, 0), t: 'Cumpleaños de su hermana', allDay: true },
    { s: at(8, 10), e: at(8, 18), t: 'Trabajo (turno largo)', allDay: false },
    { s: at(12, 9), e: at(12, 20), t: 'Congreso', allDay: false },
    { s: at(13, 9), e: at(13, 20), t: 'Congreso', allDay: false },
    { s: at(19, 18), e: at(19, 20), t: 'Yoga', allDay: false },
  ];
  const last = ymd(addDays(today, -12));
  return {
    name: 'Tu pareja',
    city: 'Buenos Aires, Argentina',
    lat: -34.6037,
    lon: -58.3816,
    locAt: Date.now(),
    cycle: { last, len: 28, period: 5 },
    cycleShare: true,
    shareTitles: true,
    events,
    eventsAt: Date.now() - h,
  };
}

export class DemoStore {
  constructor() {
    this.kind = 'demo';
    this.key = 'parejas-demo-v1';
    this.listeners = new Set();
    this.state = this._load();
    window.addEventListener('storage', (e) => e.key === this.key && this._reload());
  }
  _load() {
    try {
      const s = JSON.parse(localStorage.getItem(this.key));
      if (s) return s;
    } catch {}
    return { coupleId: null, couple: null, me: null, partner: null, messages: [], shows: [], meetings: [], seen: [] };
  }
  _reload() {
    this.state = this._load();
    this._emit();
  }
  _save() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.state));
    } catch {}
    this._emit();
  }
  _emit() {
    for (const fn of this.listeners) fn(this.snapshot());
  }
  snapshot() {
    const s = this.state;
    return {
      kind: 'demo',
      signedIn: true,
      email: null,
      coupleId: s.coupleId,
      couple: s.couple,
      me: s.me,
      partner: s.partner,
      messages: s.messages,
      shows: s.shows,
      meetings: s.meetings || [],
      seen: s.seen || [],
      uid: 'me',
      partnerUid: 'partner',
    };
  }
  async init() {
    return this.snapshot();
  }
  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }
  async signIn() {}
  async signOut() {
    await this.leave();
  }
  async createCouple(profile, extra = {}, password = '') {
    const code = makeCode();
    this.state.coupleId = code;
    this.state.couple = { anniversary: null, lastSeen: null, created: Date.now(), protected: !!password, ...extra };
    this.state.me = { ...profile };
    this.state.partner = demoPartnerSeed();
    this.state.partner.gender = extra.partnerGender || 'mujer';
    if (this.state.partner.gender === 'hombre') {
      this.state.partner.cycle = null;
      this.state.partner.cycleShare = false;
    }
    this.state.messages = [
      { id: 'm0', from: 'partner', text: 'Hola amor, ¡ya instalé la app! 💕', at: Date.now() - 3600000 },
    ];
    this.state.shows = [
      { id: 's0', title: 'Stranger Things', platform: 'Netflix', season: 3, episode: 4, by: 'partner', at: Date.now() - 86400000 },
    ];
    this._save();
    return code;
  }
  async joinCouple(code, profile) {
    return this.createCouple(profile);
  }
  async setCouplePassword(password) {
    this.state.couple.protected = !!password;
    this._save();
  }
  /** Anota que se vieron ese día (how: 'manual' | 'auto'). */
  async markSeen(day, how = 'manual') {
    this.state.seen = this.state.seen || [];
    if (!this.state.seen.some((x) => x.id === day)) this.state.seen.push({ id: day, how, by: 'me', at: Date.now() });
    if (!this.state.couple.lastSeen || day > this.state.couple.lastSeen) this.state.couple.lastSeen = day;
    this._save();
  }
  async loadSettings() {
    try { return JSON.parse(localStorage.getItem('parejas-demo-settings')) || null; } catch { return null; }
  }
  async saveSettings(prefs, at) {
    try { localStorage.setItem('parejas-demo-settings', JSON.stringify({ prefs, at })); } catch {}
  }
  async saveMeeting(m) {
    this.state.meetings = this.state.meetings || [];
    const i = this.state.meetings.findIndex((x) => x.id === m.id);
    const full = { ...m, id: m.id || 'c' + Date.now(), by: 'me', at: Date.now() };
    if (i >= 0) this.state.meetings[i] = full;
    else this.state.meetings.push(full);
    this._save();
    return full;
  }
  async deleteMeeting(id) {
    this.state.meetings = (this.state.meetings || []).filter((x) => x.id !== id);
    this._save();
  }
  /** «Escribiendo…»: en la demo la pareja simulada solo lo hace justo antes de contestar. */
  async setTyping() {}
  async markOpened(id) {
    const m = this._msg(id);
    if (m) m.openedAt = Date.now();
    if (m?.mediaId && this.mem) this.mem.delete(m.mediaId);
    this._save();
  }
  async updateCouple(patch) {
    Object.assign(this.state.couple, patch);
    this._save();
  }
  async updateMe(patch) {
    Object.assign(this.state.me, patch);
    this._save();
  }
  _msg(id) {
    return this.state.messages.find((m) => m.id === id);
  }
  /** En la demo la pareja simulada "recibe" y "lee" tus mensajes con unos segundos de diferencia. */
  _simulateReceipts(id) {
    setTimeout(() => { const m = this._msg(id); if (m) { m.deliveredAt = Date.now(); this._save(); } }, 800);
    setTimeout(() => { const m = this._msg(id); if (m) { m.readAt = Date.now(); this._save(); } }, 2600);
  }
  async sendMessage(text, extra = {}) {
    const m = { id: 'm' + Date.now(), from: 'me', text, at: Date.now(), ...extra };
    this.state.messages.push(m);
    this._save();
    this._simulateReceipts(m.id);
    setTimeout(() => this.onTyping?.({ at: Date.now(), kind: 'text' }), 700);
    setTimeout(() => {
      this.onTyping?.(null);
      this.state.messages.push({
        id: 'm' + Date.now(),
        from: 'partner',
        text: ['¡Te quiero!', 'Jajaja, qué lindo', 'Pensando en ti', 'Hablamos más tarde, amor'][Math.floor(Math.random() * 4)],
        at: Date.now(),
      });
      this._save();
    }, 3200);
  }
  /** Reacción con emoji (una por persona); si ya era esa, se quita. */
  async react(id, emoji, remove) {
    const m = this._msg(id);
    if (!m) return;
    const r = { ...(m.reactions || {}) };
    if (remove) delete r.me; else r.me = emoji;
    m.reactions = r;
    this._save();
  }
  async editMessage(id, text) {
    const m = this._msg(id);
    if (m) Object.assign(m, { text, editedAt: Date.now() });
    this._save();
  }
  async deleteMessage(m) {
    const x = this._msg(m.id);
    if (x) Object.assign(x, { deleted: true, deletedAt: Date.now(), text: '', thumb: null, mediaId: null });
    this._save();
  }
  async markDelivered(ids) {
    for (const id of ids) { const m = this._msg(id); if (m && !m.deliveredAt) m.deliveredAt = Date.now(); }
    this._save();
  }
  async markRead(ids) {
    for (const id of ids) { const m = this._msg(id); if (m && !m.readAt) m.readAt = Date.now(); }
    this._save();
  }
  /** Demo: los archivos solo viven en memoria (se pierden al recargar); la miniatura sí queda. */
  async sendMedia(prep, extra = {}, onProgress = () => {}) {
    this.mem = this.mem || new Map();
    const mediaId = 'x' + Date.now();
    this.mem.set(mediaId, prep.blob);
    onProgress(1);
    const m = {
      id: 'm' + Date.now(), from: 'me', text: extra.text || '', at: Date.now(), type: prep.kind, mediaId, parts: chunkRanges(prep.size).length,
      mime: prep.mime, size: prep.size, w: prep.w, h: prep.h, duration: prep.duration ?? null, thumb: extra.once ? null : prep.thumb,
      expiresAt: Date.now() + KEEP_MS,
      ...(extra.once ? { once: true } : {}), ...(extra.replyTo ? { replyTo: extra.replyTo } : {}),
    };
    this.state.messages.push(m);
    this._save();
    this._simulateReceipts(m.id);
    return { mediaId };
  }
  /** Demo: marca como vencidos los archivos de más de 15 días. */
  async sweepExpired() {
    let n = 0;
    for (const m of this.state.messages) {
      if (m.mediaId && !m.expiredAt && (m.at || 0) < Date.now() - KEEP_MS) { m.expiredAt = Date.now(); this.mem?.delete(m.mediaId); n++; }
    }
    if (n) this._save();
    return n;
  }
  /** Borra todos los mensajes y archivos. */
  async clearChat() {
    this.state.messages = [];
    this.mem = new Map();
    this.state.couple.chatClearedAt = Date.now();
    this._save();
  }
  async deleteCouple() {
    await this.leave();
  }
  async loadMedia(m) {
    const b = this.mem?.get(m.mediaId);
    if (!b) throw new Error('En la demo el archivo solo está disponible mientras no recargues');
    return b;
  }
  async saveShow(show) {
    const i = this.state.shows.findIndex((x) => x.id === show.id);
    const full = { ...show, id: show.id || 's' + Date.now(), by: 'me', at: Date.now() };
    if (i >= 0) this.state.shows[i] = full;
    else this.state.shows.push(full);
    this._save();
  }
  async deleteShow(id) {
    this.state.shows = this.state.shows.filter((x) => x.id !== id);
    this._save();
  }
  syncConfig() {
    return null;
  }
  async connectCalendar() {
    // En demo generamos eventos de ejemplo para "mi" calendario.
    const seed = demoPartnerSeed().events.map((e, i) => ({
      ...e,
      s: e.s + (i % 3) * 86400000,
      e: e.e + (i % 3) * 86400000,
      t: ['Reunión', 'Gimnasio', 'Almuerzo familiar', 'Médico', 'Estudio'][i % 5],
    }));
    await this.updateMe({ events: seed, eventsAt: Date.now() });
    return seed.length;
  }
  async leave() {
    localStorage.removeItem(this.key);
    this.state = this._load();
    this._emit();
  }
}

/* -------------------------------------------------------------- Firebase */

export class FirebaseStore {
  constructor(cfg) {
    this.kind = 'firebase';
    this.cfg = cfg;
    this.listeners = new Set();
    this.snap = {
      kind: 'firebase', signedIn: false, coupleId: null, couple: null, me: null, partner: null,
      messages: [], shows: [], meetings: [], seen: [], uid: null, partnerUid: null, loading: true, loadError: false,
    };
    this.unsubs = [];
    this.calToken = null;
    this.calTokenAt = 0;
  }
  async _fb() {
    if (this.fb) return this.fb;
    const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;
    const [app, auth, fs] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-firestore.js`),
    ]);
    this.fb = { app, auth, fs };
    const a = app.initializeApp(this.cfg);
    this.auth = auth.getAuth(a);
    this.db = fs.getFirestore(a);
    return this.fb;
  }
  _emit() {
    for (const fn of this.listeners) fn({ ...this.snap });
  }
  subscribe(fn) {
    this.listeners.add(fn);
    fn({ ...this.snap });
    return () => this.listeners.delete(fn);
  }
  async init() {
    this.snap.loading = true;
    this.snap.loadError = false;
    this._emit();
    try {
      const { auth } = await this._fb();
      const user = await new Promise((res) => {
        const off = auth.onAuthStateChanged(this.auth, (u) => {
          off();
          res(u);
        });
      });
      if (user) await this._afterAuth(user);
    } catch (e) {
      console.error(e);
      this.snap.loadError = true;
    } finally {
      this.snap.loading = false;
      this._emit();
    }
    return { ...this.snap };
  }
  /** A qué pareja pertenece la cuenta. Reintenta: al abrir la app la conexión tarda en estar lista. */
  async _coupleOfAccount(uid) {
    const { fs } = this.fb;
    let lastError = null;
    for (let i = 0; i < 3; i++) {
      try {
        const d = await fs.getDoc(this._ref('users', uid));
        return d.exists() ? d.data().coupleId || null : null;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw lastError;
  }
  /** Tras entrar con una cuenta: busca su pareja (sirve también para entrar desde otro teléfono). */
  async _afterAuth(user) {
    this.user = user;
    this.snap.signedIn = true;
    this.snap.uid = user.uid;
    this.snap.email = user.email;
    const saved = localStorage.getItem('parejas-couple-' + user.uid);
    if (saved) {
      // Camino rápido: este teléfono ya sabía la pareja. Se verifica en segundo plano.
      await this._attach(saved, false);
      this._coupleOfAccount(user.uid).then((code) => {
        if (code && code !== this.snap.coupleId) return this._attach(code, false).then(() => this._emit());
      }).catch((e) => console.error(e));
    } else {
      const code = await this._coupleOfAccount(user.uid); // si falla, init marca loadError
      if (code) await this._attach(code, false);
    }
    this._emit();
  }
  async _auth(fn) {
    try {
      return await fn();
    } catch (e) {
      throw new Error(authMessage(e));
    }
  }
  async signUp(email, password) {
    const { auth } = await this._fb();
    await this._auth(async () => {
      const r = await auth.createUserWithEmailAndPassword(this.auth, email, password);
      await this._afterAuth(r.user);
    });
  }
  async signInEmail(email, password) {
    const { auth } = await this._fb();
    await this._auth(async () => {
      const r = await auth.signInWithEmailAndPassword(this.auth, email, password);
      await this._afterAuth(r.user);
    });
  }
  /** Entra con el token de Google que entrega la app de Android (cuenta del teléfono). */
  async signInWithGoogle(idToken) {
    const { auth } = await this._fb();
    await this._auth(async () => {
      const cred = auth.GoogleAuthProvider.credential(idToken);
      const r = await auth.signInWithCredential(this.auth, cred);
      await this._afterAuth(r.user);
    });
  }
  /** Entra con Google desde un navegador (ventana emergente de Firebase). En la app de Android se usa la cuenta del teléfono. */
  async signInWithGooglePopup() {
    const { auth } = await this._fb();
    await this._auth(async () => {
      const r = await auth.signInWithPopup(this.auth, new auth.GoogleAuthProvider());
      await this._afterAuth(r.user);
    });
  }
  async resetPassword(email) {
    const { auth } = await this._fb();
    await this._auth(() => auth.sendPasswordResetEmail(this.auth, email));
  }
  /** Cierra la sesión de este teléfono. La pareja y los datos quedan guardados en la cuenta. */
  async signOut() {
    const { auth } = this.fb;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    if (this.user) localStorage.removeItem('parejas-couple-' + this.user.uid);
    await auth.signOut(this.auth);
    this.user = null;
    this.snap = {
      kind: 'firebase', signedIn: false, coupleId: null, couple: null, me: null, partner: null,
      messages: [], shows: [], meetings: [], seen: [], uid: null, partnerUid: null, email: null, loading: false, loadError: false,
    };
    this._emit();
  }
  _ref(...path) {
    const { fs } = this.fb;
    return fs.doc(this.db, ...path);
  }
  async createCouple(profile, extra = {}, password = '') {
    const { fs } = await this._fb();
    for (let i = 0; i < 5; i++) {
      const code = makeCode();
      const ref = this._ref('couples', code);
      if ((await fs.getDoc(ref)).exists()) continue;
      // «protected» va en el mismo documento que crea la pareja: nadie puede unirse sin contraseña ni un instante.
      await fs.setDoc(ref, { members: [this.user.uid], anniversary: null, lastSeen: null, created: Date.now(), protected: !!password, ...extra });
      if (password) await fs.setDoc(this._ref('couples', code, 'secret', 'key'), { hash: await codeProof(code, password) });
      await fs.setDoc(this._ref('couples', code, 'people', this.user.uid), profile);
      await this._attach(code);
      return code;
    }
    throw new Error('No se pudo crear el código, intenta de nuevo');
  }
  async joinCouple(code, profile, password = '') {
    const { fs } = await this._fb();
    code = code.trim().toUpperCase();
    const ref = this._ref('couples', code);
    const s = await fs.getDoc(ref);
    if (!s.exists()) throw new Error('Ese código no existe');
    const members = s.data().members || [];
    if (!members.includes(this.user.uid)) {
      if (members.length >= 2) throw new Error('Esa pareja ya está completa');
      if (s.data().protected) {
        if (!password) throw new Error('Esa pareja tiene contraseña: escríbela para unirte');
        try {
          await fs.setDoc(this._ref('couples', code, 'joins', this.user.uid), { proof: await codeProof(code, password) });
        } catch (e) {
          throw new Error('La contraseña de la pareja no es correcta');
        }
      }
      await fs.updateDoc(ref, { members: fs.arrayUnion(this.user.uid) });
    }
    await fs.setDoc(this._ref('couples', code, 'people', this.user.uid), profile, { merge: true });
    await this._attach(code);
    return code;
  }
  async _attach(code, check = true) {
    const { fs } = await this._fb();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.snap.coupleId = code;
    const uid = this.user.uid;
    const col = (name) => fs.collection(this.db, 'couples', code, name);
    localStorage.setItem('parejas-couple-' + uid, code);
    this.snap.coupleGone = false;
    if (check) {
      // Al crear o unirse: si falla (no es miembro) se propaga el error.
      const first = await fs.getDoc(this._ref('couples', code));
      if (!first.exists()) throw new Error('Pareja inexistente');
      await fs.setDoc(this._ref('users', uid), { coupleId: code });
    }
    const onErr = (e) => console.error('escucha', e?.code || e);
    this.unsubs.push(
      fs.onSnapshot(this._ref('couples', code), (d) => {
        // La pareja se eliminó desde el otro teléfono: este se queda sin pareja (solo si el servidor lo confirma).
        if (!d.exists() && !d.metadata.fromCache && !d.metadata.hasPendingWrites && this.snap.coupleId === code) {
          this._coupleGone();
          return;
        }
        this.snap.couple = d.data() || null;
        const other = (this.snap.couple?.members || []).find((m) => m !== uid);
        this.snap.partnerUid = other || null;
        this._emit();
      }, onErr),
      fs.onSnapshot(col('people'), (qs) => {
        this.snap.me = null;
        this.snap.partner = null;
        qs.forEach((d) => {
          if (d.id === uid) this.snap.me = d.data();
          else this.snap.partner = d.data();
        });
        this._emit();
      }, onErr),
      // includeMetadataChanges: avisa también cuando un mensaje propio pasa de «enviando» a «enviado»
      fs.onSnapshot(fs.query(col('messages'), fs.orderBy('at'), fs.limitToLast(200)), { includeMetadataChanges: true }, (qs) => {
        const prev = this.snap.messages.length;
        this.snap.messages = qs.docs.map((d) => ({ id: d.id, ...d.data(), pending: d.metadata.hasPendingWrites }));
        const last = this.snap.messages[this.snap.messages.length - 1];
        if (prev && last && last.from !== uid && last.id !== this._lastNotified && this.onIncoming) {
          this._lastNotified = last.id;
          this.onIncoming(last);
        }
        this._emit();
      }, onErr),
      fs.onSnapshot(col('shows'), (qs) => {
        this.snap.shows = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
        this._emit();
      }, onErr),
      fs.onSnapshot(col('meetings'), (qs) => {
        this.snap.meetings = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
        this._emit();
      }, onErr),
      // Días en que se vieron (a mano o porque la ubicación los detectó juntos).
      fs.onSnapshot(col('seen'), (qs) => {
        this.snap.seen = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
        this._emit();
      }, onErr),
      // «Escribiendo…» de tu pareja: va aparte (no entra en el estado) para no redibujar el chat en cada pulsación.
      fs.onSnapshot(col('typing'), (qs) => {
        let other = null;
        qs.forEach((d) => { if (d.id !== uid) other = d.data(); });
        this.onTyping?.(other);
      }, onErr),
    );
  }
  async updateCouple(patch) {
    const { fs } = this.fb;
    await fs.updateDoc(this._ref('couples', this.snap.coupleId), patch);
  }
  /** Pone, cambia (con texto) o quita (vacío) la contraseña que pide la pareja para unirse. */
  async setCouplePassword(password) {
    const { fs } = this.fb;
    const code = this.snap.coupleId;
    if (password) {
      await fs.setDoc(this._ref('couples', code, 'secret', 'key'), { hash: await codeProof(code, password) });
      await fs.updateDoc(this._ref('couples', code), { protected: true });
    } else {
      await fs.updateDoc(this._ref('couples', code), { protected: false });
      await fs.deleteDoc(this._ref('couples', code, 'secret', 'key')).catch(() => {});
    }
  }
  /** Anota que se vieron ese día (how: 'manual' | 'auto') y actualiza «último encuentro» si es el más reciente. */
  async markSeen(day, how = 'manual') {
    const { fs } = this.fb;
    const code = this.snap.coupleId;
    if (!this.snap.seen.some((x) => x.id === day)) {
      await fs.setDoc(this._ref('couples', code, 'seen', day), { how, by: this.user.uid, at: Date.now() });
    }
    const last = this.snap.couple?.lastSeen;
    if (!last || day > last) await fs.updateDoc(this._ref('couples', code), { lastSeen: day });
  }
  /** Ajustes de esta cuenta guardados en el servidor (users/{uid}.prefs): { prefs, at } o null. */
  async loadSettings() {
    const { fs } = this.fb;
    const d = await fs.getDoc(this._ref('users', this.user.uid));
    const v = d.exists() ? d.data() : null;
    return v?.prefs ? { prefs: v.prefs, at: v.prefsAt || 0 } : null;
  }
  async saveSettings(prefs, at) {
    const { fs } = this.fb;
    await fs.setDoc(this._ref('users', this.user.uid), { prefs, prefsAt: at }, { merge: true });
  }
  async saveMeeting(m) {
    const { fs } = this.fb;
    const data = { date: m.date, s: m.s, e: m.e, note: m.note || '', by: this.user.uid, at: Date.now() };
    if (m.id) { await fs.setDoc(this._ref('couples', this.snap.coupleId, 'meetings', m.id), data); return { ...data, id: m.id }; }
    const r = await fs.addDoc(fs.collection(this.db, 'couples', this.snap.coupleId, 'meetings'), data);
    return { ...data, id: r.id };
  }
  async deleteMeeting(id) {
    const { fs } = this.fb;
    await fs.deleteDoc(this._ref('couples', this.snap.coupleId, 'meetings', id));
  }
  /** Avisa a tu pareja que estás escribiendo (kind 'text' | 'audio') o que dejaste de hacerlo (null). */
  async setTyping(kind) {
    const { fs } = this.fb;
    await fs.setDoc(this._ref('couples', this.snap.coupleId, 'typing', this.user.uid), { at: kind ? Date.now() : 0, kind: kind || null });
  }
  async updateMe(patch) {
    const { fs } = this.fb;
    await fs.setDoc(this._ref('couples', this.snap.coupleId, 'people', this.user.uid), patch, { merge: true });
  }
  _msgRef(id) {
    return this._ref('couples', this.snap.coupleId, 'messages', id);
  }
  async sendMessage(text, extra = {}) {
    const { fs } = this.fb;
    const data = { from: this.user.uid, text, at: Date.now() };
    if (extra.replyTo) data.replyTo = extra.replyTo;
    await fs.addDoc(fs.collection(this.db, 'couples', this.snap.coupleId, 'messages'), data);
  }
  /** Reacción con emoji (una por persona, en `reactions.{uid}`); si ya era esa, se quita. */
  async react(id, emoji, remove) {
    const { fs } = this.fb;
    await fs.updateDoc(this._msgRef(id), { [`reactions.${this.user.uid}`]: remove ? fs.deleteField() : emoji });
  }
  async editMessage(id, text) {
    const { fs } = this.fb;
    await fs.updateDoc(this._msgRef(id), { text, editedAt: Date.now() });
  }
  /** «Eliminar para todos»: el mensaje queda como «Mensaje eliminado» y se borran sus archivos. */
  async deleteMessage(m) {
    const { fs } = this.fb;
    await fs.updateDoc(this._msgRef(m.id), { deleted: true, deletedAt: Date.now(), text: '', thumb: null, mediaId: null });
    if (m.mediaId) {
      for (let i = 0; i < (m.parts || 0); i++) {
        await fs.deleteDoc(this._ref('couples', this.snap.coupleId, 'media', `${m.mediaId}_${i}`)).catch(() => {});
      }
    }
  }
  async _markMany(ids, field) {
    if (!ids.length) return;
    const { fs } = this.fb;
    const batch = fs.writeBatch(this.db);
    const now = Date.now();
    for (const id of ids) batch.update(this._msgRef(id), { [field]: now });
    await batch.commit();
  }
  markDelivered(ids) {
    return this._markMany(ids, 'deliveredAt');
  }
  markRead(ids) {
    return this._markMany(ids, 'readAt');
  }
  /** Sube el archivo troceado (Firestore, ~900 KB por documento) y luego crea el mensaje. */
  async sendMedia(prep, extra = {}, onProgress = () => {}) {
    const { fs } = this.fb;
    const mediaId = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const ranges = chunkRanges(prep.size, CHUNK);
    for (let i = 0; i < ranges.length; i++) {
      const bytes = new Uint8Array(await prep.blob.slice(ranges[i][0], ranges[i][1]).arrayBuffer());
      await fs.setDoc(this._ref('couples', this.snap.coupleId, 'media', `${mediaId}_${i}`), { data: fs.Bytes.fromUint8Array(bytes), n: i });
      onProgress((i + 1) / ranges.length);
    }
    const now = Date.now();
    const data = {
      from: this.user.uid, text: extra.text || '', at: now, expiresAt: now + KEEP_MS, type: prep.kind, mediaId, parts: ranges.length,
      mime: prep.mime, size: prep.size, w: prep.w, h: prep.h, duration: prep.duration ?? null, thumb: extra.once ? null : prep.thumb ?? null,
    };
    if (extra.once) data.once = true;
    if (extra.replyTo) data.replyTo = extra.replyTo;
    await fs.addDoc(fs.collection(this.db, 'couples', this.snap.coupleId, 'messages'), data);    return { mediaId };
  }
  /** Ver una vez: quien lo recibe lo marca como abierto y borra los trozos del archivo. */
  async markOpened(id, m) {
    const { fs } = this.fb;
    await fs.updateDoc(this._msgRef(id), { openedAt: Date.now() });
    if (m?.mediaId) {
      for (let i = 0; i < (m.parts || 0); i++) {
        await fs.deleteDoc(this._ref('couples', this.snap.coupleId, 'media', `${m.mediaId}_${i}`)).catch(() => {});
      }
    }
  }
  async loadMedia(m, onProgress = () => {}) {
    const { fs } = this.fb;
    const parts = [];
    for (let i = 0; i < (m.parts || 1); i++) {
      const d = await fs.getDoc(this._ref('couples', this.snap.coupleId, 'media', `${m.mediaId}_${i}`));
      if (!d.exists()) throw new Error('El archivo ya no está disponible');
      parts.push(d.data().data.toUint8Array());
      onProgress((i + 1) / m.parts);
    }
    return new Blob(parts, { type: m.mime });
  }
  /* ---------------------------------------------- vencimiento, borrar chat y eliminar pareja */

  /** Ids de los documentos de una subcolección sin bajar su contenido (API REST con máscara). null si no se pudo. */
  async _listIds(coll, field = 'n') {
    try {
      const token = await this.user.getIdToken();
      const base = `https://firestore.googleapis.com/v1/projects/${this.cfg.projectId}/databases/(default)/documents/couples/${this.snap.coupleId}/${coll}`;
      const ids = [];
      let page = '';
      do {
        const r = await fetch(`${base}?pageSize=300&mask.fieldPaths=${field}${page}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return null;
        const j = await r.json();
        (j.documents || []).forEach((d) => ids.push(d.name.split('/').pop()));
        page = j.nextPageToken ? `&pageToken=${encodeURIComponent(j.nextPageToken)}` : '';
      } while (page);
      return ids;
    } catch {
      return null;
    }
  }

  /** Borra documentos de una subcolección por lotes. */
  async _deleteDocs(coll, ids) {
    const { fs } = this.fb;
    for (let i = 0; i < ids.length; i += 400) {
      const batch = fs.writeBatch(this.db);
      ids.slice(i, i + 400).forEach((id) => batch.delete(this._ref('couples', this.snap.coupleId, coll, id)));
      await batch.commit();
    }
  }

  /**
   * Archivos de más de 15 días: se borran del servidor (cada trozo) y el mensaje queda como «Archivo vencido».
   * No hay servidor propio: lo ejecuta la app de cualquiera de los dos al abrirse, como máximo una vez cada 12 horas.
   */
  async sweepExpired() {
    const { fs } = this.fb;
    const code = this.snap.coupleId;
    const now = Date.now();
    const found = new Map();
    try {
      const qs = await fs.getDocs(fs.query(fs.collection(this.db, 'couples', code, 'messages'), fs.where('expiresAt', '<=', now), fs.limit(100)));
      qs.forEach((d) => found.set(d.id, { id: d.id, ...d.data() }));
    } catch (e) {
      console.warn('vencimiento', e?.code || e);
    }
    // mensajes anteriores a esta función (sin expiresAt) que están en la lista cargada
    for (const m of this.snap.messages) {
      if (m.mediaId && !m.expiredAt && !m.pending && (m.at || 0) < now - KEEP_MS) found.set(m.id, m);
    }
    let n = 0;
    for (const m of found.values()) {
      if (m.expiredAt) continue;
      for (let i = 0; i < (m.parts || 0); i++) {
        await fs.deleteDoc(this._ref('couples', code, 'media', `${m.mediaId}_${i}`)).catch(() => {});
      }
      await fs.updateDoc(this._msgRef(m.id), { expiredAt: now, expiresAt: fs.deleteField() }).catch(() => {});
      n++;
    }
    return n;
  }

  /** Borra TODOS los mensajes y archivos del chat, en el servidor; los dos teléfonos limpian lo suyo al enterarse. */
  async clearChat() {
    const { fs } = this.fb;
    const code = this.snap.coupleId;
    let msgIds = await this._listIds('messages', 'at');
    if (!msgIds) {
      const qs = await fs.getDocs(fs.collection(this.db, 'couples', code, 'messages'));
      msgIds = qs.docs.map((d) => d.id);
    }
    let mediaIds = await this._listIds('media');
    if (!mediaIds) {
      mediaIds = [];
      for (const m of this.snap.messages) for (let i = 0; i < (m.parts || 0); i++) if (m.mediaId) mediaIds.push(`${m.mediaId}_${i}`);
    }
    await this._deleteDocs('media', mediaIds);
    await this._deleteDocs('messages', msgIds);
    await fs.updateDoc(this._ref('couples', code), { chatClearedAt: Date.now() });
  }

  /** Elimina la pareja entera del servidor (mensajes, archivos, series, citas, perfiles y el código). */
  async deleteCouple() {
    const { fs } = this.fb;
    const code = this.snap.coupleId;
    const members = this.snap.couple?.members || [this.user.uid];
    await this.clearChat();
    for (const coll of ['shows', 'meetings', 'seen']) {
      const qs = await fs.getDocs(fs.collection(this.db, 'couples', code, coll));
      await this._deleteDocs(coll, qs.docs.map((d) => d.id));
    }
    await this._deleteDocs('people', members);
    await this._deleteDocs('typing', members);
    await this._deleteDocs('joins', members).catch(() => {});
    await fs.deleteDoc(this._ref('couples', code, 'secret', 'key')).catch(() => {});
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    await fs.deleteDoc(this._ref('couples', code));
    await fs.setDoc(this._ref('users', this.user.uid), { coupleId: null });
    this._detachCouple();
  }

  /** Deja a este teléfono sin pareja (la pareja se eliminó o ya no existe). */
  _detachCouple() {
    if (this.user) localStorage.removeItem('parejas-couple-' + this.user.uid);
    this.snap = {
      ...this.snap, coupleId: null, couple: null, me: null, partner: null, messages: [], shows: [], meetings: [], seen: [], partnerUid: null,
    };
    this._emit();
  }

  _coupleGone() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    const { fs } = this.fb;
    if (this.user) fs.setDoc(this._ref('users', this.user.uid), { coupleId: null }).catch(() => {});
    this.snap.coupleGone = true;
    this._detachCouple();
  }

  async saveShow(show) {
    const { fs } = this.fb;
    const data = {
      title: show.title, platform: show.platform, season: show.season ?? null, episode: show.episode ?? null,
      tvmazeId: show.tvmazeId ?? null, src: show.src ?? null, srcId: show.srcId ?? null, poster: show.poster ?? null, year: show.year ?? null, lang: show.lang ?? null,
      by: this.user.uid, at: Date.now(),
    };
    if (show.id) await fs.setDoc(this._ref('couples', this.snap.coupleId, 'shows', show.id), data);
    else await fs.addDoc(fs.collection(this.db, 'couples', this.snap.coupleId, 'shows'), data);
  }
  async deleteShow(id) {
    const { fs } = this.fb;
    await fs.deleteDoc(this._ref('couples', this.snap.coupleId, 'shows', id));
  }
  /** Datos que la app de Android necesita para actualizar ubicación y calendario en segundo plano. */
  syncConfig() {
    if (!this.user || !this.snap.coupleId) return null;
    return {
      apiKey: this.cfg.apiKey,
      projectId: this.cfg.projectId,
      coupleId: this.snap.coupleId,
      uid: this.user.uid,
      refreshToken: this.user.refreshToken,
      partnerUid: this.snap.partnerUid || '',
    };
  }
  async connectCalendar() {
    throw new Error('El calendario se lee desde la app de Android');
  }
  async leave() {
    await this.signOut();
  }
}

const AUTH_MESSAGES = {
  'auth/invalid-email': 'Ese correo no es válido',
  'auth/email-already-in-use': 'Ese correo ya tiene una cuenta: usa «Iniciar sesión»',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
  'auth/missing-password': 'Escribe tu contraseña',
  'auth/invalid-credential': 'Correo o contraseña incorrectos',
  'auth/wrong-password': 'Correo o contraseña incorrectos',
  'auth/user-not-found': 'Correo o contraseña incorrectos',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos',
  'auth/network-request-failed': 'No hay conexión a internet',
  'auth/operation-not-allowed': 'Este tipo de acceso no está activado en Firebase',
  'auth/popup-closed-by-user': 'Se canceló el inicio con Google',
  'auth/cancelled-popup-request': 'Se canceló el inicio con Google',
  'auth/popup-blocked': 'El navegador bloqueó la ventana de Google: permite las ventanas emergentes de este sitio',
  'auth/unauthorized-domain': 'Este sitio aún no está autorizado en Firebase para entrar con Google',
};

function authMessage(e) {
  return AUTH_MESSAGES[e?.code] || e?.message || 'No se pudo completar';
}
