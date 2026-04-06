import { initializeApp, FirebaseApp, getApps } from 'firebase/app';
import { environment } from '../environments/environment';

export const firebaseApp: FirebaseApp = initializeApp(environment.firebase);

// App secundaria para crear usuarios sin afectar la sesión del admin
export const firebaseAppSecundaria: FirebaseApp =
  getApps().find(a => a.name === 'secondary') ??
  initializeApp(environment.firebase, 'secondary');
