// chat.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { HubConnection, HubConnectionBuilder } from '@microsoft/signalr';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnDestroy {
  public hubConnection!: HubConnection;
  messages: { user: string; message: string; timestamp: string; type: string }[] = [];
  newMessage: string = '';
  userName: string = 'User_' + Math.floor(Math.random() * 1000);
  micEnabled: boolean = false;
  private audioContext!: AudioContext;

  constructor() {
    this.hubConnection = new HubConnectionBuilder()
      // Set your SignalR hub URL (adjust port and path as needed)
      .withUrl('https://localhost:7158/chatstream')
      .build();

    // Listen for incoming messages from the hub.
    this.hubConnection.on('ReceiveMessage', (user: string, message: string, type: string) => {
      this.handleIncomingMessage(user, message, type);
    });

    // Listen for mic status updates
    this.hubConnection.on('MicStatus', (status: boolean) => {
      this.micEnabled = status;
    });
  }

  ngOnInit(): void {
    // Create an AudioContext for streaming audio playback.
    this.audioContext = new AudioContext();
    this.connect();
  }

  ngOnDestroy(): void {
    this.hubConnection.stop();
    if (this.audioContext) {
      this.audioContext.close();
    }
  }

  async connect(): Promise<void> {
    try {
      await this.hubConnection.start();
      console.log('Connected to SignalR hub.');
    } catch (error) {
      console.error('Error connecting to SignalR hub:', error);
    }
  }

  async sendMessage(): Promise<void> {
    if (this.newMessage.trim() && this.hubConnection?.state === 'Connected') {
      await this.hubConnection.invoke('SendMessage', this.userName, this.newMessage);
      this.newMessage = '';
    }
  }

  // Toggle mic status (enable/disable)
  async toggleMic(): Promise<void> {
    if (!this.micEnabled) {
      // Turn mic on
      await this.hubConnection.invoke('StartMic');
    } else {
      // Turn mic off
      await this.hubConnection.invoke('StopMic');
    }
  }

  // Handle incoming messages. For text, update chat view;
  // for audio, decode and play it.
  handleIncomingMessage(user: string, message: string, type: string): void {
    if (type === 'system-text') {
      // Append the text delta to the chat view.
      const lastIndex = this.messages.length - 1;
      if (
        lastIndex >= 0 &&
        this.messages[lastIndex].user === 'System' &&
        this.messages[lastIndex].type === 'system-text'
      ) {
        this.messages[lastIndex].message += message;
        this.messages[lastIndex].timestamp = new Date().toLocaleTimeString();
      } else {
        this.messages.push({
          user: 'System',
          message,
          timestamp: new Date().toLocaleTimeString(),
          type: 'system-text'
        });
      }
    } else if (type === 'system-audio') {
      // For audio chunks, decode and play immediately.
      this.playAudioChunk(message);
    } else {
      // Handle regular messages.
      this.messages.push({
        user,
        message,
        timestamp: new Date().toLocaleTimeString(),
        type
      });
    }
  }

  // Converts a Base64 encoded string to an ArrayBuffer.
  base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Decode and play a received audio chunk.
  playAudioChunk(base64Audio: string): void {
    const arrayBuffer = this.base64ToArrayBuffer(base64Audio);
    if (!arrayBuffer) {
      console.error('Failed to convert Base64 audio chunk to ArrayBuffer.');
      return;
    }
    // Decode the audio data and play it immediately.
    this.audioContext.decodeAudioData(arrayBuffer).then(decodedData => {
      const source = this.audioContext.createBufferSource();
      source.buffer = decodedData;
      source.connect(this.audioContext.destination);
      source.start(0);
    }).catch(error => {
      console.error('Error decoding audio data', error);
    });
  }
}
