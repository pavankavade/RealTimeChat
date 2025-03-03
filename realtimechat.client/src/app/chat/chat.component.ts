import { Component, OnDestroy, OnInit } from '@angular/core';
import { HubConnection, HubConnectionBuilder } from '@microsoft/signalr';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnDestroy {
  public hubConnection: HubConnection;
  messages: { user: string; message: string; timestamp: string; type: string }[] = [];
  newMessage: string = '';
  userName: string = 'User_' + Math.floor(Math.random() * 1000);

  constructor() {
    this.hubConnection = new HubConnectionBuilder()
      .withUrl('https://localhost:7158/chatstream')
      .build();

    // Listen for the ReceiveMessage event
    this.hubConnection.on('ReceiveMessage', (user: string, message: string, type: string) => {
      this.handleIncomingMessage(user, message, type);
    });
  }

  ngOnInit(): void {
    this.connect();
  }

  ngOnDestroy() {
    this.hubConnection.stop();
  }

  async connect() {
    try {
      await this.hubConnection.start();
      console.log('Connected to SignalR hub');
    } catch (err) {
      console.error('Error connecting:', err);
    }
  }

  async sendMessage() {
    if (this.newMessage.trim() && this.hubConnection.state === 'Connected') {
      await this.hubConnection.invoke('SendMessage', this.userName, this.newMessage);
      this.newMessage = '';
    }
  }

  // Updated method to combine system messages into one message.
  handleIncomingMessage(user: string, message: string, type: string) {
    if (type === 'system') {
      // Check if the last message is already from System
      const lastMsgIndex = this.messages.length - 1;
      if (lastMsgIndex >= 0 && this.messages[lastMsgIndex].user === 'System') {
        // Append the current message text to the existing system message
        this.messages[lastMsgIndex].message += ' ' + message;
        this.messages[lastMsgIndex].timestamp = new Date().toLocaleTimeString();
      } else {
        this.messages.push({
          user: 'System',
          message,
          timestamp: new Date().toLocaleTimeString(),
          type: 'system'
        });
      }
    } else {
      this.messages.push({
        user,
        message,
        timestamp: new Date().toLocaleTimeString(),
        type,
      });
    }
  }
}
