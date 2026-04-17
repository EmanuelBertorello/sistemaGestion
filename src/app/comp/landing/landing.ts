import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [],
  templateUrl: './landing.html',
})
export class Landing {
  year = new Date().getFullYear();

  constructor(private router: Router) {}

  irLogin() {
    this.router.navigate(['/login']);
  }
}
