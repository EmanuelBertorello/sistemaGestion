import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DashboardLlamador } from './dashboard-llamador';

describe('DashboardLlamador', () => {
  let component: DashboardLlamador;
  let fixture: ComponentFixture<DashboardLlamador>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardLlamador]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DashboardLlamador);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
