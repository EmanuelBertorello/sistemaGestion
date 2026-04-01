import { Routes } from '@angular/router';
import { Login } from './comp/login/login';
import { DashboardLlamador} from './comp/dashboard-llamador/dashboard-llamador';
import { DashboardAdmin } from './comp/dashboard-admin/dashboard-admin';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: Login },
  { path: 'dashboard-llamador', component: DashboardLlamador },
  { path: 'dashboard-admin', component: DashboardAdmin },
];