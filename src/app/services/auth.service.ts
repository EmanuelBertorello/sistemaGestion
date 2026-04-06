import { Injectable } from '@angular/core';
import {
  getAuth,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  createUserWithEmailAndPassword,
  Auth,
  UserCredential,
  User
} from 'firebase/auth';
import { firebaseApp, firebaseAppSecundaria } from '../firebase.config';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth: Auth = getAuth(firebaseApp);
  private authSecundaria: Auth = getAuth(firebaseAppSecundaria);

  login(email: string, password: string): Promise<UserCredential> {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  /** Crea usuario usando una app secundaria para NO desloguear al admin */
  async createUser(email: string, password: string): Promise<string> {
    const cred = await createUserWithEmailAndPassword(this.authSecundaria, email, password);
    await signOut(this.authSecundaria);
    return cred.user.uid;
  }

  sendPasswordReset(email: string): Promise<void> {
    return sendPasswordResetEmail(this.auth, email);
  }

  logout(): Promise<void> {
    return signOut(this.auth);
  }

  getCurrentUser(): User | null {
    return this.auth.currentUser;
  }

  getCurrentEmail(): string {
    return this.auth.currentUser?.email ?? '';
  }

  isAdmin(): boolean {
    return this.auth.currentUser?.email === 'bcapeletti@hotmail.com';
  }
}
