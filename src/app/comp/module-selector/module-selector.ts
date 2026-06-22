import { Component, OnInit, ChangeDetectorRef, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService } from '../../services/firestore.service';

interface ModuleCard {
  key: string;
  label: string;
  ruta: string;
  letra: string;
  queryParams?: Record<string, string>;
}

// Módulos base
const MODULE_DEFS: Record<string, ModuleCard> = {
  captar:   { key: 'captar',   label: 'Llamador',   ruta: '/dashboard-llamador', letra: 'L' },
  llamador: { key: 'llamador', label: 'Llamador',   ruta: '/dashboard-llamador', letra: 'L' },
  procurar: { key: 'procurar', label: 'Procurar',   ruta: '/dashboard-procurar', letra: 'P' },
  iniciado: { key: 'iniciado', label: 'Iniciados',  ruta: '/dashboard-josefina', letra: 'I' },
  josefina: { key: 'josefina', label: 'Iniciados',  ruta: '/dashboard-josefina', letra: 'I' },
  srt:      { key: 'srt',      label: 'SRT',        ruta: '/dashboard-srt',      letra: 'S' },
  sisfe:    { key: 'sisfe',    label: 'SISFE',      ruta: '/dashboard-sisfe',    letra: 'F' },
};

// Las secciones del dashboard-abogado se muestran como tiles individuales
const ABOGADO_SECCIONES: ModuleCard[] = [
  { key: 'ab_expedientes',  label: 'Expedientes',  ruta: '/dashboard-abogado', queryParams: { seccion: 'expedientes'  }, letra: 'E' },
  { key: 'ab_calculadoras', label: 'Calculadoras', ruta: '/dashboard-abogado', queryParams: { seccion: 'calculadoras' }, letra: 'C' },
  { key: 'ab_escritos',     label: 'Escritos',     ruta: '/dashboard-abogado', queryParams: { seccion: 'escritos'     }, letra: 'W' },
  { key: 'ab_facturacion',  label: 'Facturación',  ruta: '/dashboard-abogado', queryParams: { seccion: 'facturacion'  }, letra: '$' },
  { key: 'ab_agenda',       label: 'Agenda',       ruta: '/dashboard-abogado', queryParams: { seccion: 'agenda'       }, letra: 'A' },
  { key: 'ab_config',       label: 'Config.',      ruta: '/dashboard-abogado', queryParams: { seccion: 'configuracion'}, letra: 'G' },
];

const RUTA_DIRECTA: Record<string, string> = {
  llamador: '/dashboard-llamador',
  captar:   '/dashboard-llamador',
  josefina: '/dashboard-josefina',
  iniciado: '/dashboard-josefina',
  abogado:  '/dashboard-abogado',
  procurar: '/dashboard-procurar',
  srt:      '/dashboard-srt',
  sisfe:    '/dashboard-sisfe',
};

@Component({
  selector: 'app-module-selector',
  standalone: true,
  imports: [],
  templateUrl: './module-selector.html',
})
export class ModuleSelector implements OnInit {
  modulos: ModuleCard[] = [];
  apodo = '';
  cargando = true;
  error = '';

  constructor(
    private auth: AuthService,
    private fs: FirestoreService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;
    const email = this.auth.getCurrentEmail();
    if (!email) { this.router.navigate(['/login']); return; }

    try {
      const [keys, apodo] = await Promise.all([
        this.fs.getModulosPorEmail(email),
        this.fs.getApodoPorEmail(email),
      ]);
      this.apodo = (apodo && apodo !== email) ? apodo : email.split('@')[0];

      const seen = new Set<string>();
      const cards: ModuleCard[] = [];

      // Admin siempre tiene el dashboard de admin primero
      if (this.auth.isAdmin()) {
        cards.push({ key: 'admin', label: 'Admin', ruta: '/dashboard-admin', letra: 'A' });
        seen.add('/dashboard-admin');
      }

      for (const k of keys) {
        if (k === 'abogado') {
          // Expandir en sub-secciones
          for (const sec of ABOGADO_SECCIONES) {
            if (!seen.has(sec.key)) { seen.add(sec.key); cards.push(sec); }
          }
        } else if (MODULE_DEFS[k]) {
          const c = MODULE_DEFS[k];
          if (!seen.has(c.ruta)) { seen.add(c.ruta); cards.push(c); }
        } else {
          const ruta = RUTA_DIRECTA[k] ?? '/dashboard-llamador';
          if (!seen.has(ruta)) {
            seen.add(ruta);
            cards.push({ key: k, label: k.toUpperCase(), ruta, letra: k[0].toUpperCase() });
          }
        }
      }

      if (cards.length === 1) { this.router.navigate([cards[0].ruta], { queryParams: cards[0].queryParams }); return; }
      if (cards.length === 0) { this.router.navigate(['/dashboard-llamador']); return; }

      this.modulos = cards;
    } catch (e: any) {
      const code = e?.code ? `[${e.code}] ` : '';
      this.error = `${code}${e?.message ?? 'Error desconocido. Recargá la página.'}`;
    } finally {
      this.cargando = false;
      this.cdr.detectChanges();
    }
  }

  seleccionar(m: ModuleCard) {
    this.router.navigate([m.ruta], { queryParams: m.queryParams ?? {} });
  }

  cerrarSesion() { this.auth.logout().then(() => this.router.navigate(['/login'])); }

  getGradient(key: string): string {
    const g: Record<string, string> = {
      admin:           'linear-gradient(135deg,#0c1a35,#1e3a5f)',
      llamador:        'linear-gradient(135deg,#f97316,#ea580c)',
      captar:          'linear-gradient(135deg,#f97316,#ea580c)',
      procurar:        'linear-gradient(135deg,#8b5cf6,#7c3aed)',
      iniciado:        'linear-gradient(135deg,#10b981,#059669)',
      josefina:        'linear-gradient(135deg,#10b981,#059669)',
      srt:             'linear-gradient(135deg,#0ea5e9,#0284c7)',
      sisfe:           'linear-gradient(135deg,#a855f7,#9333ea)',
      ab_expedientes:  'linear-gradient(135deg,#4f46e5,#4338ca)',
      ab_calculadoras: 'linear-gradient(135deg,#0ea5e9,#0284c7)',
      ab_escritos:     'linear-gradient(135deg,#64748b,#475569)',
      ab_facturacion:  'linear-gradient(135deg,#16a34a,#15803d)',
      ab_agenda:       'linear-gradient(135deg,#f59e0b,#d97706)',
      ab_config:       'linear-gradient(135deg,#6b7280,#4b5563)',
    };
    return g[key] ?? 'linear-gradient(135deg,#6b7280,#4b5563)';
  }
}
