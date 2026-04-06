import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  email = '';
  password = '';
  rememberMe = false;
  showPassword = false;

  // Estado de carga y errores
  loading = false;
  errorMsg = '';

  // Modal recuperar contraseña
  showResetModal = false;
  resetEmail = '';
  resetLoading = false;
  resetSuccess = false;
  resetError = '';

  constructor(private auth: AuthService, private router: Router) {}

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  async onSubmit() {
    if (!this.email || !this.password) {
      this.errorMsg = 'Ingresá tu correo y contraseña.';
      return;
    }
    this.loading = true;
    this.errorMsg = '';
    try {
      await this.auth.login(this.email, this.password);
      const destino = this.email.toLowerCase() === 'bcapeletti@hotmail.com'
        ? '/dashboard-admin'
        : '/dashboard-llamador';
      this.router.navigate([destino]);
    } catch (err: any) {
      this.errorMsg = this.mapError(err.code);
    } finally {
      this.loading = false;
    }
  }

  openResetModal() {
    this.showResetModal = true;
    this.resetEmail = this.email;
    this.resetSuccess = false;
    this.resetError = '';
  }

  closeResetModal() {
    this.showResetModal = false;
  }

  async sendReset() {
    if (!this.resetEmail) {
      this.resetError = 'Ingresá tu correo electrónico.';
      return;
    }
    this.resetLoading = true;
    this.resetError = '';
    try {
      await this.auth.sendPasswordReset(this.resetEmail);
      this.resetSuccess = true;
    } catch (err: any) {
      this.resetError = this.mapError(err.code);
    } finally {
      this.resetLoading = false;
    }
  }

  private mapError(code: string): string {
    const errors: Record<string, string> = {
      'auth/user-not-found': 'No existe una cuenta con ese correo.',
      'auth/wrong-password': 'Contraseña incorrecta.',
      'auth/invalid-email': 'El correo no es válido.',
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/too-many-requests': 'Demasiados intentos. Intentá más tarde.',
      'auth/user-disabled': 'Esta cuenta fue deshabilitada.',
    };
    return errors[code] ?? 'Ocurrió un error. Intentá de nuevo.';
  }
}
