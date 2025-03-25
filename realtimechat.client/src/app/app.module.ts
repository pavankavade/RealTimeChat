import { HttpClientModule } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms'; // Add this
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ChatComponent } from './chat/chat.component';
import { AvatarComponent } from './avatar/avatar.component';
import { AvatarRealtimeComponent } from './avatar-realtime/avatar-realtime.component';
import { AvatarRealtimeV2Component } from './avatar-realtime-v2/avatar-realtime-v2.component';

@NgModule({
  declarations: [
    AppComponent,
    ChatComponent,
    AvatarComponent,
    AvatarRealtimeComponent,
    AvatarRealtimeV2Component
  ],
  imports: [
    BrowserModule, HttpClientModule,
    AppRoutingModule,
    FormsModule 
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
