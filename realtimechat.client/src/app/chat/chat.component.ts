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
  private audioBufferQueue: Float32Array[] = [];
  private isPlaying = false;
  private currentSystemMessageIndex = -1;

  constructor() { }

  ngOnInit(): void {
    this.audioContext = new AudioContext({ sampleRate: 24000 });
    this.audioContext.resume().then(() => console.log('AudioContext resumed, state:', this.audioContext.state));
    this.connect();
    this.testAudio();
  }

  ngOnDestroy(): void {
    this.cleanupResources();
  }

  connect(): void {
    this.hubConnection = new HubConnectionBuilder()
      .withUrl('https://localhost:7158/chatstream')
      .build();

    this.hubConnection.on('ReceiveMessage', (user: string, message: string, type: string) => {
      if (type === 'system-text-delta') {
        if (this.currentSystemMessageIndex === -1 || this.messages[this.currentSystemMessageIndex].user !== 'System') {
          this.messages.push({ user: 'System', message: message, timestamp: new Date().toLocaleTimeString() });
          this.currentSystemMessageIndex = this.messages.length - 1;
        } else {
          this.messages[this.currentSystemMessageIndex].message += ' ' + message;
        }
      } else if (type === 'system-text-complete') {
        this.currentSystemMessageIndex = -1;
      } else if (type === 'system-audio') {
        console.log('Received audio chunk, length:', message.length, 'sample:', message.substring(0, 50) + '...');
        this.handleAudioChunk(message);
      } else if (type === 'system-error') {
        this.messages.push({ user, message, timestamp: new Date().toLocaleTimeString() });
      }
    });

    this.hubConnection.on('MicStatus', (enabled: boolean) => {
      console.log('Mic status from server:', enabled);
      this.micEnabled = enabled;
    });

    this.hubConnection.start()
      .then(() => console.log('Connected to SignalR hub'))
      .catch(err => console.error('Error connecting:', err));
  }

  async sendMessage(): Promise<void> {
    if (this.newMessage.trim() && this.hubConnection.state === 'Connected') {
      await this.hubConnection.invoke('SendMessage', 'User', this.newMessage);
      this.newMessage = '';
    }
  }

  async toggleMic(): Promise<void> {
    console.log('Toggling mic, current state:', this.micEnabled);
    if (this.micEnabled) {
      try {
        console.log('Invoking StopMic');
        await this.hubConnection.invoke('StopMic');
        console.log('StopMic invoked successfully');
        this.stopCapturing();
        this.micEnabled = false;
        console.log('Mic stopped');
      } catch (error) {
        console.error('Error stopping mic:', error);
      }
    } else {
      try {
        console.log('Invoking StartMic');
        const startMicPromise = this.hubConnection.invoke('StartMic');
        console.log('StartMic promise created');
        await startMicPromise;
        console.log('StartMic invoked successfully');
        await this.startCapturing();
        console.log('StartCapturing completed');
        this.micEnabled = true;
        console.log('Mic started');
      } catch (error) {
        console.error('Error starting mic:', error);
        this.micEnabled = false;
      }
    }
  }

  private async startCapturing(): Promise<void> {
    try {
      console.log('Requesting mic access');
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Mic stream obtained, active:', this.micStream.active);

      this.micSource = this.audioContext.createMediaStreamSource(this.micStream);
      console.log('Mic source created');

      this.micProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      console.log('Mic processor created');

      this.micProcessor.addEventListener('audioprocess', (event) => {
        console.log('Audio process triggered');
        const inputBuffer = event.inputBuffer.getChannelData(0);
        console.log('Input buffer length:', inputBuffer.length, 'sample:', inputBuffer.slice(0, 5));
        const pcmData = new Int16Array(inputBuffer.length);
        for (let i = 0; i < inputBuffer.length; i++) {
          const s = Math.max(-1, Math.min(1, inputBuffer[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        const base64Audio = this.arrayBufferToBase64(pcmData.buffer);
        console.log('Sending audio chunk, length:', base64Audio.length, 'sample:', base64Audio.substring(0, 50) + '...');
        this.hubConnection.invoke('SendAudioChunk', base64Audio)
          .then(() => console.log('Audio chunk sent successfully'))
          .catch(err => console.error('Error sending audio to server:', err));
      });

      this.micSource.connect(this.micProcessor);
      this.micProcessor.connect(this.audioContext.destination);
      console.log('Mic capturing pipeline connected');
    } catch (error) {
      console.error('Error in startCapturing:', error);
      this.messages.push({
        user: 'System',
        message: `[Error: ${(error as Error).message}]`,
        timestamp: new Date().toLocaleTimeString()
      });
      throw error;
    }
  }

  private stopCapturing(): void {
    if (this.micProcessor) {
      this.micProcessor.disconnect();
      this.micProcessor = null!;
    }
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null!;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null!;
    }
    console.log('Mic capturing stopped');
  }

  private handleAudioChunk(base64Audio: string): void {
    try {
      const byteCharacters = atob(base64Audio);
      const byteNumbers = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const int16Array = new Int16Array(byteNumbers.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = (int16Array[i] / 32768.0) * 2.0;
      }
      console.log('Decoded audio chunk, length:', float32Array.length);
      this.audioBufferQueue.push(float32Array);
      this.playNextChunk();
    } catch (error) {
      console.error('Error decoding audio chunk:', error);
    }
  }

  private playNextChunk(): void {
    if (this.isPlaying || this.audioBufferQueue.length === 0) return;

    const chunk = this.audioBufferQueue.shift()!;
    console.log('Playing chunk, length:', chunk.length);

    const audioBuffer = this.audioContext.createBuffer(1, chunk.length, this.audioContext.sampleRate);
    audioBuffer.copyToChannel(chunk, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    source.onended = () => {
      this.isPlaying = false;
      this.playNextChunk();
    };

    source.start(0);
    this.isPlaying = true;
  }

  private testAudio(): void {
    const oscillator = this.audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, this.audioContext.currentTime);
    oscillator.connect(this.audioContext.destination);
    oscillator.start();
    setTimeout(() => oscillator.stop(), 1000);
    console.log('Test audio (440 Hz sine wave) played for 1 second');
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private cleanupResources(): void {
    if (this.micEnabled) {
      this.stopCapturing();
    }
    if (this.audioContext) {
      this.audioContext.close().catch(err => console.error('Error closing AudioContext:', err));
    }
    if (this.hubConnection) {
      this.hubConnection.stop().catch(err => console.error('Error stopping hub:', err));
    }
  }
}
