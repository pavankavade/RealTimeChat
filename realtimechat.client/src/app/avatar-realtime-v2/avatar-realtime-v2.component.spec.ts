import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AvatarRealtimeV2Component } from './avatar-realtime-v2.component';

describe('AvatarRealtimeV2Component', () => {
  let component: AvatarRealtimeV2Component;
  let fixture: ComponentFixture<AvatarRealtimeV2Component>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AvatarRealtimeV2Component]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AvatarRealtimeV2Component);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
