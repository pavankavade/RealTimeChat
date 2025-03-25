import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { HubConnection, HubConnectionBuilder } from '@microsoft/signalr';
import { environment } from '../../environments/environment';

interface Message {
  text: string;
  sender: string;
  time: string;
}

@Component({
  selector: 'app-avatar-realtime-v2',
  templateUrl: './avatar-realtime-v2.component.html',
  styleUrls: ['./avatar-realtime-v2.component.css']
})
export class AvatarRealtimeV2Component implements OnInit, OnDestroy {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;

  userInput: string = '';
  messages: Message[] = [];
  isLoading: boolean = false;
  errorMessage: string = '';
  currentVisemeImage: string = '';

  private audioCtx!: AudioContext;
  private nextScheduledTime: number = 0;
  private hubConnection!: HubConnection;
  private aiTextStream: string = '';
  private analyser!: AnalyserNode;
  private isDestroyed: boolean = false;

  ngOnInit(): void {
    // Initialize AudioContext and set initial scheduling time
    this.audioCtx = new AudioContext();
    this.nextScheduledTime = this.audioCtx.currentTime;

    // Set up AnalyserNode for real-time audio analysis
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256; // Number of samples for analysis
    this.analyser.connect(this.audioCtx.destination);

    // Configure SignalR hub connection to ChatHub
    this.hubConnection = new HubConnectionBuilder()
      .withUrl(`${environment.BACKEND_API_URL}/chathub`)
      .build();

    // Handle incoming text chunks
    this.hubConnection.on('ReceiveAIText', (textChunk: string) => {
      this.aiTextStream += textChunk;
    });

    // Handle incoming audio chunks
    this.hubConnection.on('ReceiveAudioChunk', async (audioChunk: string) => {
      try {
        const audioBuffer = await this.decodeAudioChunk(audioChunk);
        this.scheduleAudioBuffer(audioBuffer);
      } catch (error) {
        console.error('Error decoding/scheduling audio chunk: ', error);
      }
    });

    // Handle errors from the hub
    this.hubConnection.on('Error', (errMsg: string) => {
      this.errorMessage = errMsg;
      this.isLoading = false;
    });

    // Start the SignalR connection
    this.hubConnection.start()
      .catch(err => console.error('Error starting SignalR connection: ', err));

    // Start the viseme animation loop
    this.updateViseme();
  }

  private updateViseme(): void {
    if (this.isDestroyed) return;

    // Get time-domain data from the analyser
    const dataArray = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(dataArray);

    // Calculate RMS (Root Mean Square) to measure amplitude
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);

    // Map RMS to viseme images (using existing assets)
    let visemeId: number;
    if (rms < 0.05) {
      visemeId = 0;    // Closed mouth
    } else if (rms < 0.1) {
      visemeId = 5;    // Slightly open
    } else if (rms < 0.15) {
      visemeId = 10;   // Moderately open
    } else if (rms < 0.2) {
      visemeId = 15;   // More open
    } else {
      visemeId = 19;   // Fully open
    }
    this.currentVisemeImage = `assets/${visemeId}.svg`;

    // Schedule the next frame
    requestAnimationFrame(() => this.updateViseme());
  }

  async sendMessage(): Promise<void> {
    if (!this.userInput.trim()) return;

    // Add user message to chat
    const userMessage: Message = {
      text: this.userInput,
      sender: 'user',
      time: new Date().toLocaleTimeString()
    };
    this.messages.push(userMessage);
    this.scrollToBottom();

    const messageToSend = this.userInput;
    this.userInput = '';
    this.isLoading = true;
    this.errorMessage = '';
    this.aiTextStream = '';

    try {
      // Send message to ChatHub
      await this.hubConnection.invoke('SendMessage', messageToSend);
      const aiMessage: Message = {
        text: this.aiTextStream,
        sender: 'ai',
        time: new Date().toLocaleTimeString()
      };
      this.messages.push(aiMessage);
      this.scrollToBottom();
    } catch (error) {
      console.error('Error in SignalR sendMessage:', error);
      const errorMsg = 'Sorry, something went wrong.';
      this.messages.push({ text: errorMsg, sender: 'ai', time: new Date().toLocaleTimeString() });
      this.errorMessage = errorMsg;
      this.scrollToBottom();
    } finally {
      this.isLoading = false;
    }
  }

  private async decodeAudioChunk(base64Audio: string): Promise<AudioBuffer> {
    const arrayBuffer = this.base64ToArrayBuffer(base64Audio);
    return await this.audioCtx.decodeAudioData(arrayBuffer);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private scheduleAudioBuffer(audioBuffer: AudioBuffer) {
    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.analyser); // Connect to analyser for real-time analysis
    source.start(this.nextScheduledTime);
    this.nextScheduledTime += audioBuffer.duration;
  }

  scrollToBottom(): void {
    setTimeout(() => {
      if (this.messagesContainer && this.messagesContainer.nativeElement) {
        this.messagesContainer.nativeElement.scrollTop = this.messagesContainer.nativeElement.scrollHeight;
      }
    }, 0);
  }

  ngOnDestroy(): void {
    this.isDestroyed = true; // Stop the animation loop
    if (this.hubConnection) {
      this.hubConnection.stop().catch(err => console.error('Error stopping SignalR connection: ', err));
    }
    if (this.audioCtx) {
      this.audioCtx.close(); // Close the audio context
    }
  }
}
