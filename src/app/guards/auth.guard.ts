import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { FirestoreService } from '../services/firestore.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.getCurrentUser()) return true;
  router.navigate(['/login']);
  return false;
};

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAdmin()) return true;
  router.navigate(['/login']);
  return false;
};

export const abogadoGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const fs = inject(FirestoreService);
  const router = inject(Router);
  const email = auth.getCurrentEmail();
  if (!email) { router.navigate(['/login']); return false; }
  const rol = await fs.getRolPorEmail(email);
  if (rol === 'abogado' || rol === 'josefina') return true;
  // También permitir si tiene módulo iniciado explícito
  const modulos = await fs.getModulosPorEmail(email);
  if (modulos.includes('iniciado')) return true;
  router.navigate(['/login']);
  return false;
};

export const iniciadoresGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const fs = inject(FirestoreService);
  const router = inject(Router);
  const email = auth.getCurrentEmail();
  if (!email) { router.navigate(['/login']); return false; }
  const rol = await fs.getRolPorEmail(email);
  if (rol === 'josefina') return true;
  const modulos = await fs.getModulosPorEmail(email);
  if (modulos.includes('iniciado')) return true;
  router.navigate(['/login']);
  return false;
};

export const procurarGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const fs = inject(FirestoreService);
  const router = inject(Router);
  const email = auth.getCurrentEmail();
  if (!email) { router.navigate(['/login']); return false; }
  const modulos = await fs.getModulosPorEmail(email);
  if (modulos.includes('procurar')) return true;
  router.navigate(['/login']);
  return false;
};

export const srtGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const fs = inject(FirestoreService);
  const router = inject(Router);
  const email = auth.getCurrentEmail();
  if (!email) { router.navigate(['/login']); return false; }
  const modulos = await fs.getModulosPorEmail(email);
  if (modulos.includes('srt')) return true;
  router.navigate(['/login']);
  return false;
};

export const sisfeGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const fs = inject(FirestoreService);
  const router = inject(Router);
  const email = auth.getCurrentEmail();
  if (!email) { router.navigate(['/login']); return false; }
  const modulos = await fs.getModulosPorEmail(email);
  if (modulos.includes('sisfe')) return true;
  router.navigate(['/login']);
  return false;
};

// kept for backward-compat (not used in routes anymore)
export const josefinaGuard = iniciadoresGuard;

export const estudioAdminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const fs = inject(FirestoreService);
  const router = inject(Router);
  const email = auth.getCurrentEmail();
  if (!email) { router.navigate(['/login']); return false; }
  if (auth.isAdmin()) return true;
  const usuario = await fs.getUsuarioPorEmail(email);
  if (usuario?.esAdminEstudio && usuario?.estudioId) return true;
  router.navigate(['/login']);
  return false;
};
