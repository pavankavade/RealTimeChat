import { Component, OnDestroy } from '@angular/core';
import { HubConnection, HubConnectionBuilder } from '@microsoft/signalr';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styles: [`ul { list-style-type: none; padding: 0; } li { padding: 5px; }`]
})
export class ChatComponent implements OnDestroy { // Removed OnInit since it's not used
  private hubConnection: HubConnection;
  textStream: string[] = [];
  private streamSubscription: any;

  constructor() {
    this.hubConnection = new HubConnectionBuilder()
      .withUrl('https://localhost:7158/chatstream') // Matches server hub endpoint
      .build();
  }

  startStreaming() {
    if (this.hubConnection.state === 'Disconnected') {
      this.hubConnection.start()
        .then(() => {
          console.log('Connected to SignalR hub');
          this.streamSubscription = this.hubConnection.stream<string>('StreamText') // Call the correct method
            .subscribe({
              next: (text) => this.textStream.push(text),
              complete: () => console.log('Stream completed'),
              error: (err) => console.error('Stream error:', err)
            });
        })
        .catch(err => console.error('Error connecting:', err));
    }
  }

  ngOnDestroy() {
    if (this.streamSubscription) {
      this.streamSubscription.dispose();
    }
    this.hubConnection.stop();
  }
}
