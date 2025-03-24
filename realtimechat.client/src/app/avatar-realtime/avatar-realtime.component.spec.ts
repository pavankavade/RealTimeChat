import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AvatarRealtimeComponent } from './avatar-realtime.component';

describe('AvatarRealtimeComponent', () => {
  let component: AvatarRealtimeComponent;
  let fixture: ComponentFixture<AvatarRealtimeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AvatarRealtimeComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AvatarRealtimeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
