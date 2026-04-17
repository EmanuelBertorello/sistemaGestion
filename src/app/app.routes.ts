import { Routes } from '@angular/router';
import { Login } from './comp/login/login';
import { Landing } from './comp/landing/landing';
import { DashboardLlamador } from './comp/dashboard-llamador/dashboard-llamador';
import { DashboardAdmin } from './comp/dashboard-admin/dashboard-admin';
import { CrearUsuario } from './comp/crear-usuario/crear-usuario';
import { authGuard, adminGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', component: Landing },
  { path: 'login', component: Login },
  { path: 'dashboard-llamador', component: DashboardLlamador, canActivate: [authGuard] },
  { path: 'dashboard-admin', component: DashboardAdmin, canActivate: [adminGuard] },
  { path: 'crear-usuario', component: CrearUsuario, canActivate: [adminGuard] },
];
