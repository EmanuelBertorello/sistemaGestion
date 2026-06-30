import { Routes } from '@angular/router';
import { Login } from './comp/login/login';
import { Landing } from './comp/landing/landing';
import { DashboardLlamador } from './comp/dashboard-llamador/dashboard-llamador';
import { DashboardAdmin } from './comp/dashboard-admin/dashboard-admin';
import { DashboardAbogado } from './comp/dashboard-abogado/dashboard-abogado';
import { DashboardJosefina } from './comp/dashboard-josefina/dashboard-josefina';
import { DashboardProcurar } from './comp/dashboard-procurar/dashboard-procurar';
import { ModuleSelector } from './comp/module-selector/module-selector';
import { CrearUsuario } from './comp/crear-usuario/crear-usuario';
import { authGuard, adminGuard, abogadoGuard, iniciadoresGuard, procurarGuard, srtGuard, sisfeGuard, estudioAdminGuard } from './guards/auth.guard';
import { DashboardArca } from './comp/dashboard-arca/dashboard-arca';
import { DashboardEstudio } from './comp/dashboard-estudio/dashboard-estudio';
import { DashboardSuperadmin } from './comp/dashboard-superadmin/dashboard-superadmin';

export const routes: Routes = [
  { path: '', component: Landing },
  { path: 'login', component: Login },
  { path: 'modulos', component: ModuleSelector, canActivate: [authGuard] },
  { path: 'dashboard-llamador', component: DashboardLlamador, canActivate: [authGuard] },
  { path: 'dashboard-admin', component: DashboardAdmin, canActivate: [adminGuard] },
  { path: 'dashboard-abogado', component: DashboardAbogado, canActivate: [abogadoGuard] },
  { path: 'dashboard-josefina', component: DashboardJosefina, canActivate: [iniciadoresGuard] },
  { path: 'dashboard-procurar', component: DashboardProcurar, canActivate: [procurarGuard] },
  { path: 'dashboard-srt',   component: DashboardArca, canActivate: [srtGuard],   data: { modulo: 'srt',   titulo: 'SRT' } },
  { path: 'dashboard-sisfe', component: DashboardArca, canActivate: [sisfeGuard], data: { modulo: 'sisfe', titulo: 'SISFE' } },
  { path: 'crear-usuario', component: CrearUsuario, canActivate: [adminGuard] },
  { path: 'dashboard-estudio', component: DashboardEstudio, canActivate: [estudioAdminGuard] },
  { path: 'dashboard-superadmin', component: DashboardSuperadmin, canActivate: [adminGuard] },
];
