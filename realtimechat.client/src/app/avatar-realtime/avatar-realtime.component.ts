import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { HubConnection, HubConnectionBuilder } from '@microsoft/signalr';
import { environment } from '../../environments/environment';

interface Message {
  text: string;
  sender: string;
  time: string;
}

interface Viseme {
  offset: number; // relative to the start of the audio chunk (in ms)
  id: number;
  // We'll compute absolute timing for viseme activation below
  startTime?: number; // absolute scheduled start time on your AudioContext timeline (in seconds)
}

@Component({
  selector: 'app-avatar-realtime',
  templateUrl: './avatar-realtime.component.html',
  styleUrls: ['./avatar-realtime.component.css']
})
export class AvatarRealtimeComponent implements OnInit, OnDestroy {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;

  userInput: string = '';
  messages: Message[] = [];
  isLoading: boolean = false;
  errorMessage: string = '';
  currentVisemeImage: string = '';
  visemeTimeouts: any[] = [];

  // We keep our viseme events in an array.
  visemes: Viseme[] = [];

  // Instead of using an Audio element, we use the Web Audio API.
  private audioCtx!: AudioContext;
  // This variable tracks when the next audio chunk should start playing.
  private nextScheduledTime: number = 0;
  // Used to schedule the viseme animation polling.
  private visemeAnimationTimer: any = null;

  private hubConnection!: HubConnection;
  private aiTextStream: string = '';

  ngOnInit(): void {
    // Create and resume AudioContext (note: user gesture may be required to start audio)
    this.audioCtx = new AudioContext();
    // Initialize the next scheduled time to the current audio context time.
    this.nextScheduledTime = this.audioCtx.currentTime;

    this.hubConnection = new HubConnectionBuilder()
      .withUrl(`${environment.BACKEND_API_URL}/chathub`)
      .build();

    // Listen for AI text chunks.
    this.hubConnection.on('ReceiveAIText', (textChunk: string) => {
      this.aiTextStream += textChunk;
    });

    // Instead of playing with an Audio element, we decode and schedule the chunk.
    this.hubConnection.on('ReceiveAudioChunk', async (audioChunk: string) => {
      try {
        const audioBuffer = await this.decodeAudioChunk(audioChunk);
        // Optionally, adjust viseme events for this chunk.
        // For any visemes received from the server related to this chunk, set their start time.
        // (Assuming any viseme events that have not yet been scheduled belong to the chunk.)
        this.visemes.forEach(v => {
          if (v.startTime == null) {
            // Convert offset from ms to seconds and add the absolute starting time.
            v.startTime = this.nextScheduledTime + v.offset / 1000;
          }
        });
        this.scheduleAudioBuffer(audioBuffer);
      } catch (error) {
        console.error('Error decoding/scheduling audio chunk: ', error);
      }
    });

    // Listen for viseme events.
    this.hubConnection.on('ReceiveViseme', (viseme: { offset: number; id: number }) => {
      // Add the incoming viseme event. We do not yet know its absolute start time.
      this.visemes.push({
        offset: viseme.offset, // offset in ms relative to the chunk start
        id: viseme.id
      });
    });

    // Listen for errors.
    this.hubConnection.on('Error', (errMsg: string) => {
      this.errorMessage = errMsg;
      this.isLoading = false;
    });

    this.hubConnection.start()
      .catch(err => console.error('Error starting SignalR connection: ', err));

    // Start the viseme animation polling loop.
    this.startVisemeAnimationLoop();
  }

  async sendMessage(): Promise<void> {
    if (!this.userInput.trim()) return;

    // Clear old visemes and reset scheduled audio.
    this.visemes = [];
    // Reset the audio scheduling timeline.
    this.nextScheduledTime = this.audioCtx.currentTime;

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

  // Decodes a Base64-encoded audio string into an AudioBuffer using the Web Audio API.
  private async decodeAudioChunk(base64Audio: string): Promise<AudioBuffer> {
    const arrayBuffer = this.base64ToArrayBuffer(base64Audio);
    return await this.audioCtx.decodeAudioData(arrayBuffer);
  }

  // Helper method: converts a Base64 string to an ArrayBuffer.
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Schedules a given AudioBuffer to play on the AudioContext timeline.
  private scheduleAudioBuffer(audioBuffer: AudioBuffer) {
    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    // Connect the source to the destination.
    source.connect(this.audioCtx.destination);
    // Schedule to play at nextScheduledTime.
    source.start(this.nextScheduledTime);
    // Update nextScheduledTime by adding this chunk’s duration.
    this.nextScheduledTime += audioBuffer.duration;
  }

  // A loop to update the current viseme image based on the current playback time.
  // Because we switched to the AudioContext the timing is based on audioCtx.currentTime
  private startVisemeAnimationLoop(): void {
    const updateViseme = () => {
      const currentTime = this.audioCtx.currentTime; // in seconds
      // Find a viseme event that should be active now.
      // We assume each viseme is effective for a short window (e.g., 100ms).
      const activeViseme = this.visemes.find((v: Viseme) => {
        if (v.startTime != null) {
          return currentTime >= v.startTime && currentTime < v.startTime + 0.1;
        }
        return false;
      });
      if (activeViseme) {
        this.currentVisemeImage = `assets/${activeViseme.id}.svg`;
      } else {
        // Optionally, clear when no viseme is active.
        // this.currentVisemeImage = '';
      }
      this.visemeAnimationTimer = requestAnimationFrame(updateViseme);
    };
    this.visemeAnimationTimer = requestAnimationFrame(updateViseme);
  }

  scrollToBottom(): void {
    setTimeout(() => {
      if (this.messagesContainer && this.messagesContainer.nativeElement) {
        this.messagesContainer.nativeElement.scrollTop = this.messagesContainer.nativeElement.scrollHeight;
      }
    }, 0);
  }

  ngOnDestroy(): void {
    if (this.visemeAnimationTimer) {
      cancelAnimationFrame(this.visemeAnimationTimer);
      this.visemeAnimationTimer = null;
    }
    if (this.hubConnection) {
      this.hubConnection.stop().catch(err => console.error('Error stopping SignalR connection: ', err));
    }
    if (this.audioCtx) {
      this.audioCtx.close();
    }
  }
}
