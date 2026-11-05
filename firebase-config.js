// Configuración de la app web de Firebase (proyecto nosotros-chile). Son identificadores públicos,
// no son secretos: la seguridad la dan las reglas de `firestore.rules`.
// Si dice "PEGA...", la app corre en MODO DEMO (todo local, pareja simulada).
export const firebaseConfig = {
  apiKey: 'AIzaSyD2-q39ZAw1Cyr9R42XhRvFBslXdV04nTM',
  authDomain: 'nosotros-chile.firebaseapp.com',
  projectId: 'nosotros-chile',
  storageBucket: 'nosotros-chile.firebasestorage.app',
  messagingSenderId: '13399132894',
  appId: '1:13399132894:web:afb184d5950229ee12d04f',
  // ID de cliente web (público) para «Continuar con Google» en la app de Android.
  googleWebClientId: '13399132894-2r9umjok5gh6nv24mlr2v0c3qq3qqta1.apps.googleusercontent.com',
};
