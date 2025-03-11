import { Component, OnInit, OnDestroy } from '@angular/core';
import { HubConnection, HubConnectionBuilder } from '@microsoft/signalr';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnDestroy {
  hubConnection!: HubConnection;
  messages: { user: string; message: string; timestamp: string }[] = [];
  newMessage = '';
  micEnabled = false;

  private audioContext!: AudioContext;
  private micStream!: MediaStream;
  private micSource!: MediaStreamAudioSourceNode;
  private micProcessor!: ScriptProcessorNode;
  private playbackProcessor!: ScriptProcessorNode;
  private audioBufferQueue: Float32Array[] = [];

  constructor() {
    // Initialize properties if needed
  }

  ngOnInit(): void {
    this.audioContext = new AudioContext({ sampleRate: 24000 });
    this.setupPlayback();
    this.connect();
  }

  ngOnDestroy(): void {
    this.cleanupResources();
  }

  /** Establishes connection to SignalR hub */
  connect(): void {
    this.hubConnection = new HubConnectionBuilder()
      .withUrl('https://localhost:7158/chatstream')
      .build();

    this.hubConnection.on('ReceiveMessage', (user: string, message: string, type: string) => {
      if (type === 'system-text') {
        this.messages.push({ user, message, timestamp: new Date().toLocaleTimeString() });
      } else if (type === 'system-audio') {
        this.handleAudioChunk(message);
      } else if (type === 'system-error') {
        this.messages.push({ user, message, timestamp: new Date().toLocaleTimeString() });
      }
    });

    this.hubConnection.start()
      .then(() => console.log('Connected to SignalR hub'))
      .catch(err => console.error('Error connecting:', err));
  }

  /** Sends a text message via SignalR */
  async sendMessage(): Promise<void> {
    if (this.newMessage.trim() && this.hubConnection.state === 'Connected') {
      await this.hubConnection.invoke('SendMessage', 'User', this.newMessage);
      this.newMessage = '';
    }
  }

  /** Toggles microphone on/off */
  async toggleMic(): Promise<void> {
    if (this.micEnabled) {
      await this.hubConnection.invoke('StopMic');
      this.stopCapturing();
      this.micEnabled = false;
    } else {
      await this.hubConnection.invoke('StartMic');
      await this.startCapturing();
      this.micEnabled = true;
    }
  }

  /** Starts capturing audio from the microphone */
  private async startCapturing(): Promise<void> {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.micSource = this.audioContext.createMediaStreamSource(this.micStream);
      this.micProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.micProcessor.addEventListener('audioprocess', (event) => {
        const inputBuffer = event.inputBuffer.getChannelData(0); // Float32Array
        const pcmData = new Int16Array(inputBuffer.length);
        for (let i = 0; i < inputBuffer.length; i++) {
          const s = Math.max(-1, Math.min(1, inputBuffer[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; // Convert to 16-bit PCM
        }
        const base64Audio = this.arrayBufferToBase64(pcmData.buffer);
        this.hubConnection.invoke('SendAudioChunk', base64Audio)
          .catch(err => console.error('Error sending audio:', err));
      });

      this.micSource.connect(this.micProcessor);
      this.micProcessor.connect(this.audioContext.destination); // Activates processing
    } catch (error) {
      console.error('Error starting mic:', error);
      this.messages.push({
        user: 'System',
        message: `[Error: ${(error as Error).message}]`,
        timestamp: new Date().toLocaleTimeString()
      });
    }
  }

  /** Stops audio capture and cleans up related resources */
  private stopCapturing(): void {
    if (this.micProcessor) {
      this.micProcessor.disconnect();
    }
    if (this.micSource) {
      this.micSource.disconnect();
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
    }
  }

  /** Sets up audio playback processor */
  private setupPlayback(): void {
    this.playbackProcessor = this.audioContext.createScriptProcessor(4096, 0, 1);
    this.playbackProcessor.addEventListener('audioprocess', (event) => {
      const outputBuffer = event.outputBuffer.getChannelData(0);
      if (this.audioBufferQueue.length > 0) {
        const nextChunk = this.audioBufferQueue.shift()!;
        const length = Math.min(outputBuffer.length, nextChunk.length);
        outputBuffer.set(nextChunk.slice(0, length), 0);
        if (length < nextChunk.length) {
          this.audioBufferQueue.unshift(nextChunk.slice(length));
        }
      } else {
        outputBuffer.fill(0); // Silence when no data
      }
    });
    this.playbackProcessor.connect(this.audioContext.destination);
  }

  /** Handles incoming audio chunks from SignalR */
  private handleAudioChunk(base64Audio: string): void {
    const byteCharacters = atob(base64Audio);
    const byteNumbers = new Uint8Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const int16Array = new Int16Array(byteNumbers.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0; // Convert back to Float32
    }
    this.audioBufferQueue.push(float32Array);
  }

  /** Converts ArrayBuffer to base64 string */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /** Cleans up all audio resources on component destruction */
  private cleanupResources(): void {
    if (this.micEnabled) {
      this.stopCapturing();
    }
    if (this.playbackProcessor) {
      this.playbackProcessor.disconnect();
    }
    if (this.audioContext) {
      this.audioContext.close().catch(err => console.error('Error closing AudioContext:', err));
    }
    if (this.hubConnection) {
      this.hubConnection.stop().catch(err => console.error('Error stopping hub:', err));
    }
  }
}
