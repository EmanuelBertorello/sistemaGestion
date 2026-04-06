import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirestoreService, UsuarioApp } from '../../services/firestore.service';

@Component({
  selector: 'app-crear-usuario',
  imports: [FormsModule],
  templateUrl: './crear-usuario.html',
})
export class CrearUsuario implements OnInit {
  seccion: 'crear' | 'administrar' = 'crear';

  // ── Crear ──
  email = '';
  password = '';
  confirmar = '';
  apodo = '';
  showPassword = false;
  loading = false;
  errorMsg = '';
  successMsg = '';

  // ── Administrar ──
  usuarios: UsuarioApp[] = [];
  cargandoUsuarios = false;
  editandoUid: string | null = null;
  apodoEdit = '';
  guardandoApodo = false;

  constructor(
    private auth: AuthService,
    private fs: FirestoreService,
    private router: Router
  ) {}

  async ngOnInit() {
    await this.cargarUsuarios();
  }

  setSeccion(s: 'crear' | 'administrar') {
    this.seccion = s;
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  async onSubmit() {
    this.errorMsg = '';
    this.successMsg = '';

    if (!this.email || !this.password || !this.confirmar) {
      this.errorMsg = 'Completá todos los campos.';
      return;
    }
    if (this.password !== this.confirmar) {
      this.errorMsg = 'Las contraseñas no coinciden.';
      return;
    }
    if (this.password.length < 6) {
      this.errorMsg = 'La contraseña debe tener al menos 6 caracteres.';
      return;
    }

    this.loading = true;
    try {
      const uid = await this.auth.createUser(this.email, this.password);
      await this.fs.guardarUsuario(uid, this.email, this.apodo);
      this.successMsg = `Usuario ${this.email} creado correctamente.`;
      // Refrescar lista
      await this.cargarUsuarios();
      this.email = '';
      this.password = '';
      this.confirmar = '';
      this.apodo = '';
    } catch (err: any) {
      this.errorMsg = this.mapError(err.code);
    } finally {
      this.loading = false;
    }
  }

  async cargarUsuarios() {
    this.cargandoUsuarios = true;
    this.usuarios = await this.fs.getUsuarios();
    this.cargandoUsuarios = false;
  }

  iniciarEdicion(u: UsuarioApp) {
    this.editandoUid = u.uid;
    this.apodoEdit = u.apodo;
  }

  cancelarEdicion() {
    this.editandoUid = null;
    this.apodoEdit = '';
  }

  async guardarApodo(u: UsuarioApp) {
    this.guardandoApodo = true;
    try {
      await this.fs.actualizarApodo(u.uid, this.apodoEdit);
      u.apodo = this.apodoEdit;
      this.editandoUid = null;
    } finally {
      this.guardandoApodo = false;
    }
  }

  volver() {
    this.router.navigate(['/dashboard-admin']);
  }

  private mapError(code: string): string {
    const errors: Record<string, string> = {
      'auth/email-already-in-use': 'Ya existe un usuario con ese correo.',
      'auth/invalid-email': 'El correo no es válido.',
      'auth/weak-password': 'La contraseña es muy débil.',
    };
    return errors[code] ?? 'Ocurrió un error. Intentá de nuevo.';
  }
}
