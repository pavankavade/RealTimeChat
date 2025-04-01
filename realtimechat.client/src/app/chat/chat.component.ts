import { Component, OnInit, OnDestroy, AfterViewInit, AfterViewChecked, ElementRef, ViewChild } from '@angular/core';

import { HubConnection, HubConnectionBuilder } from '@microsoft/signalr';

import { environment } from '../../../src/environments/environment';



@Component({

  selector: 'app-chat',

  templateUrl: './chat.component.html',

  styleUrls: ['./chat.component.css'],

  standalone: false

})

export class ChatComponent implements OnInit, OnDestroy, AfterViewInit, AfterViewChecked {

  @ViewChild('chatContainer') chatContainer!: ElementRef;

  //@ViewChild('userVideo') userVideo!: ElementRef<HTMLVideoElement>; 



  hubConnection!: HubConnection;

  messages: { user: string; message: string; timestamp: string }[] = [];

  newMessage = '';

  micEnabled = false;

  autoSend = false;



  // Timer properties 

  seconds: number = 0;

  timerDisplay: string = '00:00';

  private timerInterval: any;



  // Audio and Mic properties (from your existing chat component code) 

  private audioContext!: AudioContext;

  private micStream!: MediaStream;

  private micSource!: MediaStreamAudioSourceNode;

  private micProcessor!: ScriptProcessorNode;

  private audioBufferQueue: Float32Array[] = [];

  private isPlaying = false;

  private currentSystemMessageIndex = -1;



  private currentUserMessageIndex = -1;

  currentVisemeImage: string = 'assets/0.svg';

  private analyser!: AnalyserNode;

  url: any;

  constructor() { }



  ngOnInit(): void {

    // Set up audio context needed for mic operations 

    this.audioContext = new AudioContext({ sampleRate: 24000 });



    this.audioContext.resume().then(() => {

      console.log('AudioContext resumed, state:', this.audioContext.state);

      // Create an analyser node for real-time audio analysis (for lip sync) 

      this.analyser = this.audioContext.createAnalyser();

      this.analyser.fftSize = 256;

      // Connect the analyser once to the destination 

      this.analyser.connect(this.audioContext.destination);

    });



    // Establish the websocket connection 

    this.connect();



    // Start a test audio oscillator (optional) 

    this.testAudio();



    // Start timer 

    this.timerInterval = setInterval(() => {

      this.updateTimer();

    }, 1000);



    // Start the viseme animation loop 

    this.updateViseme();

  }



  ngAfterViewInit(): void {

    this.startUserCamera();

  }



  ngAfterViewChecked(): void {

    this.scrollToBottom();

  }



  // --- UI Helper Methods --- 

  updateTimer(): void {

    let minutes = Math.floor(this.seconds / 60);

    let displaySeconds = this.seconds % 60;

    this.timerDisplay = `${String(minutes).padStart(2, '0')}:${String(displaySeconds).padStart(2, '0')}`;

    this.seconds++;

  }



  scrollToBottom(): void {

    setTimeout(() => {

      if (this.chatContainer) {

        const element = this.chatContainer.nativeElement;

        element.scrollTop = element.scrollHeight;

      }

    }, 100);

  }



  adjustTextareaHeight(event: Event): void {

    const textarea = event.target as HTMLTextAreaElement;

    textarea.style.height = 'auto';

    const computedStyle = window.getComputedStyle(textarea);

    const lineHeight = parseInt(computedStyle.lineHeight || '20', 10);

    const maxHeight = 5 * lineHeight;

    if (textarea.scrollHeight > maxHeight) {

      textarea.style.height = `${maxHeight}px`;

      textarea.style.overflowY = 'auto';

    } else {

      textarea.style.height = `${textarea.scrollHeight}px`;

      textarea.style.overflowY = 'hidden';

    }

    textarea.scrollTop = textarea.scrollHeight;

  }



  handleKeyDown(event: KeyboardEvent): void {

    if (event.key === 'Enter' && event.shiftKey) {

      event.preventDefault();

      const textarea = event.target as HTMLTextAreaElement;

      const start = textarea.selectionStart;

      this.newMessage = this.newMessage.slice(0, start) + '\n' + this.newMessage.slice(textarea.selectionEnd);

      textarea.selectionStart = textarea.selectionEnd = start + 1;

      this.adjustTextareaHeight(event);

    } else if (event.key === 'Enter') {

      event.preventDefault();

      this.sendMessage();

    }

  }



  // --- Camera and Connection Methods --- 

  startUserCamera(): void {

    navigator.mediaDevices.getUserMedia({ video: true })

      .then(stream => {

        //if (this.userVideo.nativeElement) { 

        //  this.userVideo.nativeElement.srcObject = stream; 

        //} 

      })

      .catch(error => {

        console.error('Error accessing camera:', error);

      });

  }



  connect(): void {

    if (!environment.production) {

      this.url = '/chatstream';

    } else {

      this.url = 'https://localhost:7158/chatstream';

    }

    this.hubConnection = new HubConnectionBuilder()

      .withUrl(this.url)

      .build();



    this.hubConnection.on('ReceiveMessage', (user: string, message: string, type: string) => {

      if (type === 'system-text-delta') {

        this.currentUserMessageIndex = -1;

        console.log(message);

        if (

          this.currentSystemMessageIndex === -1 ||

          this.messages[this.currentSystemMessageIndex].user !== 'System'

        ) {

          this.messages.push({

            user: 'System',

            message: message,

            timestamp: new Date().toLocaleTimeString()

          });

          this.currentSystemMessageIndex = this.messages.length - 1;

        } else {

          this.messages[this.currentSystemMessageIndex].message += ' ' + message;

        }

      } else if (type === 'system-text-complete') {

        this.currentSystemMessageIndex = -1;

      } else if (type === 'user-text-delta') {

        // Instead of always pushing the user message, check if there is an active system message. 

        if (

          this.currentUserMessageIndex === -1 ||

          this.messages[this.currentUserMessageIndex].user !== 'User'

        ) {

          if (this.currentSystemMessageIndex !== -1) {

            // Insert the user message before the active system message. 

            this.messages.splice(this.currentSystemMessageIndex, 0, {

              user: 'User',

              message: message,

              timestamp: new Date().toLocaleTimeString()

            });

            // The inserted user message is at currentSystemMessageIndex. 

            this.currentUserMessageIndex = this.currentSystemMessageIndex;

            // Since a new element was added before the system message, the index for that system message should be incremented. 

            this.currentSystemMessageIndex++;

          } else {

            // If no active system message, just push. 

            this.messages.push({

              user: 'User',

              message: message,

              timestamp: new Date().toLocaleTimeString()

            });

            this.currentUserMessageIndex = this.messages.length - 1;

          }

        } else {

          // Update the active user message delta. 

          this.messages[this.currentUserMessageIndex].message += ' ' + message;

        }

      } else if (type === 'system-audio') {

        this.handleAudioChunk(message);

      } else if (type === 'system-error') {

        this.messages.push({

          user,

          message,

          timestamp: new Date().toLocaleTimeString()

        });

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



  sendMessage(): void {

    if (this.newMessage.trim() && this.hubConnection.state === 'Connected') {

      this.hubConnection.invoke('SendMessage', 'User', this.newMessage)

        .then(() => {

          // Optionally push message locally (the hub may echo it back) 

          this.messages.push({ user: 'User', message: this.newMessage, timestamp: new Date().toLocaleTimeString() });

          this.newMessage = '';

        })

        .catch(err => console.error('Error sending message:', err));

    }

  }



  openSettings(): void {

    // Your settings logic or modal trigger 

    console.log('Settings button clicked');

  }



  endChat(): void {

    // Your cleanup or navigation logic upon ending chat 

    console.log('Chat ended');

  }



  // --- Mic and Audio Methods --- 

  async toggleMic(): Promise<void> {

    console.log('Toggling mic, current state:', this.micEnabled);

    if (this.micEnabled) {

      try {

        console.log('Invoking StopMic');

        await this.hubConnection.invoke('StopMic');

        this.stopCapturing();

        this.micEnabled = false;

        console.log('Mic stopped');

      } catch (error) {

        console.error('Error stopping mic:', error);

      }

    } else {

      try {

        console.log('Invoking StartMic');

        await this.hubConnection.invoke('StartMic');

        await this.startCapturing();

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

      console.log('Mic stream obtained');



      this.micSource = this.audioContext.createMediaStreamSource(this.micStream);

      console.log('Mic source created');



      this.micProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

      console.log('Mic processor created');



      this.micProcessor.addEventListener('audioprocess', (event) => {

        //console.log('Audio process triggered'); 

        const inputBuffer = event.inputBuffer.getChannelData(0);

        const pcmData = new Int16Array(inputBuffer.length);

        for (let i = 0; i < inputBuffer.length; i++) {

          const s = Math.max(-1, Math.min(1, inputBuffer[i]));

          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;

        }

        const base64Audio = this.arrayBufferToBase64(pcmData.buffer);

        //console.log('Sending audio chunk, size:', base64Audio.length); 



        this.hubConnection.invoke('SendAudioChunk', base64Audio)

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

      //console.log('Decoded audio chunk, length:', float32Array.length); 

      this.audioBufferQueue.push(float32Array);

      this.playNextChunk();

    } catch (error) {

      console.error('Error decoding audio chunk:', error);

    }

  }

  private playNextChunk(): void {

    if (this.isPlaying || this.audioBufferQueue.length === 0) return;



    const chunk = this.audioBufferQueue.shift()!;

    const audioBuffer = this.audioContext.createBuffer(1, chunk.length, this.audioContext.sampleRate);

    audioBuffer.copyToChannel(chunk, 0);



    const source = this.audioContext.createBufferSource();

    source.buffer = audioBuffer;



    // It’s important that the destination node is valid. 

    // If the analyser is not available, use the destination node as a fallback. 

    if (this.analyser) {

      source.connect(this.analyser);

    } else {

      console.warn('Analyser node is not available. Connecting directly to destination.');

      source.connect(this.audioContext.destination);

    }



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

  private updateViseme(): void {

    if (!this.analyser) {

      requestAnimationFrame(() => this.updateViseme());

      return;

    }



    const bufferLength = this.analyser.fftSize;

    const dataArray = new Float32Array(bufferLength);

    this.analyser.getFloatTimeDomainData(dataArray);



    // Calculate RMS amplitude 

    let sum = 0;

    for (let i = 0; i < dataArray.length; i++) {

      sum += dataArray[i] * dataArray[i];

    }

    const rms = Math.sqrt(sum / dataArray.length);



    // Map the RMS value to a viseme image asset. 

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



    requestAnimationFrame(() => this.updateViseme());

  }



  // --- Cleanup --- 

  ngOnDestroy(): void {

    if (this.timerInterval) {

      clearInterval(this.timerInterval);

    }

    this.cleanupResources();

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
