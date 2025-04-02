import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, NgZone } from '@angular/core';
import { HubConnection, HubConnectionBuilder } from '@microsoft/signalr';
import { HttpClient } from '@angular/common/http'; // Import HttpClient
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk'; // Import Speech SDK
import { environment } from '../../../src/environments/environment';
import { AvatarComponent } from '../avatar/avatar.component';

// Define the structure expected from the backend config endpoint
interface AvatarConfigResponse {
  token: string;
  region: string;
  iceServerUrl: string;
  iceServerUsername: string;
  iceServerPassword: string;
  ttsVoice: string;
  avatarCharacter: string;
  avatarStyle: string;
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css'],
  standalone: false // Keep as is if using modules
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewInit { // Removed AfterViewChecked
  @ViewChild('chatContainer') chatContainer!: ElementRef;
  // Reference to the div where the avatar video will be placed
  @ViewChild('remoteVideo', { static: false }) remoteVideoElementRef!: ElementRef<HTMLDivElement>;

  hubConnection!: HubConnection;
  messages: { user: string; message: string; timestamp: string }[] = [];
  newMessage = ''; // Keep if you add text input later
  micEnabled = false;
  // autoSend = false; // Remove if not used

  // Timer properties
  seconds: number = 0;
  timerDisplay: string = '00:00';
  private timerInterval: any;

  // --- REMOVE OLD AUDIO/VISEME PROPERTIES ---
  // private audioContext!: AudioContext; // Removed
  private micStream!: MediaStream;
  private micSource!: MediaStreamAudioSourceNode;
  private micProcessor!: ScriptProcessorNode;
  // private audioBufferQueue: Float32Array[] = []; // Removed
  // private isPlaying = false; // Removed
  // currentVisemeImage: string = 'assets/0.svg'; // Removed
  // private analyser!: AnalyserNode; // Removed

  // --- ADD AZURE AVATAR PROPERTIES ---
  private avatarSynthesizer: SpeechSDK.AvatarSynthesizer | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private speechConfig: SpeechSDK.SpeechConfig | null = null;
  private avatarConfig: SpeechSDK.AvatarConfig | null = null;
  private ttsTextBuffer: string = ''; // Buffer for incoming text for TTS
  private sentenceEndChars = ['.', '?', '!', '。', '？', '！', '\n']; // Characters indicating sentence end
  isAvatarConnected: boolean = false; // For UI feedback
  private avatarTokenConfig: AvatarConfigResponse | null = null; // Store fetched config


  private currentSystemMessageIndex = -1; // Keep for message display logic
  private currentUserMessageIndex = -1;  // Keep for message display logic

  url: string; // Keep SignalR URL logic

  constructor(
    private http: HttpClient, // Inject HttpClient
    private ngZone: NgZone // Inject NgZone for running async SDK callbacks in Angular's zone
  ) {
    // Determine SignalR URL
    if (!environment.production) {
      this.url = '/chatstream';
    } else {
      // Adjust your production URL if needed
      this.url = 'https://localhost:7158/chatstream'; // Example
    }
  }

  ngOnInit(): void {
    // --- REMOVE OLD AUDIO CONTEXT/ANALYSER SETUP ---
    // this.audioContext = new AudioContext({ sampleRate: 24000 });
    // this.analyser = this.audioContext.createAnalyser();
    // ... etc ...

    // Establish the SignalR connection
    this.connectSignalR();

    // Start timer
    this.timerInterval = setInterval(() => {
      this.updateTimer();
    }, 1000);

    // --- REMOVE VISEME LOOP ---
    // this.updateViseme();
  }

  ngAfterViewInit(): void {
    // No camera needed for avatar, keep if you want user video separate
    // this.startUserCamera();
    // No specific action needed here now for avatar, it starts with the mic
  }

  // --- UI Helper Methods (Keep as is) ---
  updateTimer(): void { /* ... keep implementation ... */ }
  scrollToBottom(): void { /* ... keep implementation ... */ }
  // AdjustTextareaHeight, handleKeyDown etc. - keep if needed for text input

  // --- SignalR Connection ---
  connectSignalR(): void {
    this.hubConnection = new HubConnectionBuilder()
      .withUrl(this.url)
      .build();

    this.hubConnection.on('ReceiveMessage', (user: string, message: string, type: string) => {
      this.ngZone.run(() => { // Ensure updates run in Angular's zone
        // --- MODIFY MESSAGE HANDLING ---
        if (type === 'system-text-delta') {
          this.currentUserMessageIndex = -1; // Reset user index on new system message part
          this.appendSystemMessageDelta(message); // Update chat display
          this.bufferAndSpeakAvatarText(message); // Buffer text for TTS Avatar
        } else if (type === 'system-text-complete') {
          // Final chance to speak any remaining buffered text
          this.bufferAndSpeakAvatarText('', true); // Force speaking remainder
          this.currentSystemMessageIndex = -1; // Reset system index
        } else if (type === 'user-text-delta') {
          this.appendUserMessageDelta(message); // Update chat display
        } else if (type === 'system-audio') {
          // --- IGNORE system-audio ---
          // console.log('Ignoring system-audio chunk');
        } else if (type === 'system-error' || type === 'system-info' || type === 'user') {
          // Handle errors, info, or direct user messages as before
          this.messages.push({ user, message, timestamp: new Date().toLocaleTimeString() });
          this.currentSystemMessageIndex = -1; // Reset indexes on non-delta messages
          this.currentUserMessageIndex = -1;
        }
        this.scrollToBottom(); // Scroll after adding/updating messages
      });
    });

    this.hubConnection.on('MicStatus', (enabled: boolean) => {
      this.ngZone.run(() => {
        console.log('Mic status from server:', enabled);
        // This might become less relevant if mic start/stop is purely client driven now
        // but keep it for potential server-side status updates
        this.micEnabled = enabled;
      });
    });

    this.hubConnection.start()
      .then(() => console.log('Connected to SignalR hub'))
      .catch(err => console.error('Error connecting to SignalR:', err));
  }

  // --- Message Display Logic (Extracted for Clarity) ---
  private appendSystemMessageDelta(textChunk: string): void {
    if (this.currentSystemMessageIndex === -1 || this.messages[this.currentSystemMessageIndex]?.user !== 'System') {
      this.messages.push({ user: 'System', message: textChunk, timestamp: new Date().toLocaleTimeString() });
      this.currentSystemMessageIndex = this.messages.length - 1;
    } else {
      this.messages[this.currentSystemMessageIndex].message += textChunk; // Append to existing
    }
  }

  private appendUserMessageDelta(textChunk: string): void {
    if (this.currentUserMessageIndex === -1 || this.messages[this.currentUserMessageIndex]?.user !== 'User') {
      // Insert user message before potential active system message or at the end
      const insertIndex = this.currentSystemMessageIndex !== -1 ? this.currentSystemMessageIndex : this.messages.length;
      this.messages.splice(insertIndex, 0, { user: 'User', message: textChunk, timestamp: new Date().toLocaleTimeString() });
      this.currentUserMessageIndex = insertIndex;
      if (this.currentSystemMessageIndex !== -1 && insertIndex <= this.currentSystemMessageIndex) {
        this.currentSystemMessageIndex++; // Adjust system index if user msg inserted before it
      }
    } else {
      this.messages[this.currentUserMessageIndex].message += textChunk; // Append to existing
    }
  }

  // --- Mic and Audio Methods ---
  async toggleMic(): Promise<void> {
    console.log('Toggling mic, current state:', this.micEnabled);
    if (this.micEnabled) {
      // --- STOPPING ---
      try {
        console.log('Stopping Mic and Avatar');
        await this.hubConnection.invoke('StopMic'); // Tell server STT loop to stop
        this.stopCapturingMicAudio(); // Stop local mic capture
        await this.stopAvatarSession(); // Stop Azure Avatar session
        this.micEnabled = false;
        console.log('Mic and Avatar stopped');
        await this.hubConnection.send("SendMessage", "System", "[Mic Off]", "system-info"); // Inform UI via message
      } catch (error) {
        console.error('Error stopping mic/avatar:', error);
        this.messages.push({ user: 'System', message: `[Error stopping: ${(error as Error).message}]`, timestamp: new Date().toLocaleTimeString() });
        // Might need to force state cleanup even on error
        this.micEnabled = false;
        this.isAvatarConnected = false;
      }
    } else {
      // --- STARTING ---
      try {
        console.log('Starting Mic and Avatar');
        // 1. Fetch config needed for Avatar SDK *before* starting anything else
        this.avatarTokenConfig = await this.fetchAvatarConfig();

        // 2. Tell server to start its STT processing loop
        await this.hubConnection.invoke('StartMic');

        // 3. Start local mic capture and sending audio chunks
        await this.startCapturingMicAudio();

        // 4. Initialize and start the Azure Avatar session
        await this.initializeAndStartAvatar();

        this.micEnabled = true;
        console.log('Mic and Avatar started');
        await this.hubConnection.send("SendMessage", "System", "[Mic On]", "system-info"); // Inform UI via message

      } catch (error) {
        console.error('Error starting mic/avatar:', error);
        this.messages.push({ user: 'System', message: `[Error starting: ${(error as Error).message}]`, timestamp: new Date().toLocaleTimeString() });
        this.micEnabled = false;
        this.isAvatarConnected = false;
        // Clean up potentially partially started things
        this.stopCapturingMicAudio();
        await this.stopAvatarSession();
        // Attempt to tell server to stop if StartMic was invoked
        try { await this.hubConnection.invoke('StopMic'); } catch { /* Ignore error */ }
      }
    }
  }

  // Renamed from startCapturing
  private async startCapturingMicAudio(): Promise<void> {
    try {
      // --- Use modern AudioWorklet if possible, fallback to ScriptProcessor ---
      // This ScriptProcessor approach is kept from your original code, but note it's deprecated.
      // Consider migrating to AudioWorklet for better performance/future-proofing.
      // https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet

      if (!this.micStream) { // Get stream only if not already available
        console.log('Requesting mic access');
        // Ensure AudioContext is running
        const tempAudioContext = new AudioContext({ sampleRate: 16000 }); // Use 16kHz often preferred for STT
        await tempAudioContext.resume();

        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
        console.log('Mic stream obtained');

        this.micSource = tempAudioContext.createMediaStreamSource(this.micStream);
        console.log('Mic source created');

        // Adjust buffer size if needed (e.g., 1024, 2048, 4096)
        const bufferSize = 4096;
        this.micProcessor = tempAudioContext.createScriptProcessor(bufferSize, 1, 1);
        console.log('Mic processor created');

        this.micProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
          // Convert Float32 to PCM16 and Base64 encode
          const inputBuffer = event.inputBuffer.getChannelData(0);
          const pcm16 = this.float32ToPCM16(inputBuffer);
          const base64Audio = this.arrayBufferToBase64(pcm16.buffer);

          if (this.hubConnection.state === 'Connected') {
            this.hubConnection.invoke('SendAudioChunk', base64Audio)
              .catch(err => console.error('Error sending audio chunk:', err));
          }
        };

        this.micSource.connect(this.micProcessor);
        this.micProcessor.connect(tempAudioContext.destination); // Connect to destination to start processing
        // It's often recommended *not* to connect mic input directly to output destination unless you want to hear yourself.
        // For sending only, connecting to destination might not be strictly required for ScriptProcessor but is common practice.
        console.log('Mic capturing pipeline connected');
      }
    } catch (error) {
      console.error('Error in startCapturingMicAudio:', error);
      this.messages.push({ user: 'System', message: `[Mic Error: ${(error as Error).message}]`, timestamp: new Date().toLocaleTimeString() });
      throw error; // Re-throw to be caught by toggleMic
    }
  }

  // Renamed from stopCapturing
  private stopCapturingMicAudio(): void {
    console.log('Stopping local mic capture');
    if (this.micProcessor) {
      this.micProcessor.disconnect();
      this.micProcessor.onaudioprocess = null; // Remove listener
      this.micProcessor = null!;
    }
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null!;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null!;
      console.log('Mic stream stopped');
    }
    // Don't close the AudioContext here, Avatar might need it? Revisit if needed.
  }

  // Helper function: Float32 to PCM16 Int16Array
  private float32ToPCM16(buffer: Float32Array): Int16Array {
    let pcm16 = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      let s = Math.max(-1, Math.min(1, buffer[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16;
  }

  // Helper: ArrayBuffer to Base64 (keep as is)
  private arrayBufferToBase64(buffer: ArrayBuffer): any { /* ... keep implementation ... */ }

  // --- AZURE AVATAR METHODS ---

  private async fetchAvatarConfig(): Promise<AvatarConfigResponse> {
    const apiUrl = 'https://localhost:7158/api/avatar/config'; // Adjust if your API route is different
    try {
      console.log('Fetching avatar config from backend...');
      const config = await this.http.get<AvatarConfigResponse>(apiUrl).toPromise();
      if (!config || !config.token || !config.region || !config.iceServerUrl) {
        throw new Error('Incomplete avatar configuration received from backend.');
      }
      console.log('Avatar config received.');
      return config;
    } catch (error) {
      console.error('Failed to fetch avatar config:', error);
      throw new Error('Could not fetch avatar configuration from server.'); // Re-throw for toggleMic
    }
  }

  private async initializeAndStartAvatar(): Promise<void> {
    if (!this.avatarTokenConfig) {
      throw new Error("Avatar token configuration not loaded.");
    }
    if (this.avatarSynthesizer) {
      console.log("Avatar already initialized.");
      return;
    }

    console.log("Initializing Azure Avatar...");
    try {
      // 1. Create Speech Config with Authorization Token
      this.speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(this.avatarTokenConfig.token, this.avatarTokenConfig.region);
      this.speechConfig.speechSynthesisVoiceName = this.avatarTokenConfig.ttsVoice;
      // Optional: Configure logging, proxy, etc. on speechConfig if needed
      //this.speechConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_AvatarEnableBodyTrackingForIdle, "true")

      var videoFormat = new SpeechSDK.AvatarVideoFormat()
      // 2. Create Avatar Config
      this.avatarConfig = new SpeechSDK.AvatarConfig(
        this.avatarTokenConfig.avatarCharacter,
        this.avatarTokenConfig.avatarStyle,
        videoFormat
      );
      // Configure other avatar properties if needed (e.g., background color, customized status)
      // this.avatarConfig.backgroundColor = '#333333';

      // 3. Create Avatar Synthesizer
      this.avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(this.speechConfig, this.avatarConfig);

      console.log("Setting up WebRTC connection...");
      // 4. Setup WebRTC Peer Connection
      this.peerConnection = new RTCPeerConnection({
        iceServers: [{
          urls: [this.avatarTokenConfig.iceServerUrl],
          username: this.avatarTokenConfig.iceServerUsername,
          credential: this.avatarTokenConfig.iceServerPassword
        }]
      });

      this.peerConnection.onicecandidate = event => {
        // console.log('ICE Candidate:', event.candidate);
        // SDK likely handles signaling internally via its connection
      };

      this.peerConnection.oniceconnectionstatechange = event => {
        this.ngZone.run(() => {
          console.log('ICE Connection State:', this.peerConnection?.iceConnectionState);
          if (this.peerConnection?.iceConnectionState === 'connected' || this.peerConnection?.iceConnectionState === 'completed') {
            this.isAvatarConnected = true;
            console.log('Avatar WebRTC Connected.');
          } else if (this.peerConnection?.iceConnectionState === 'disconnected' || this.peerConnection?.iceConnectionState === 'failed' || this.peerConnection?.iceConnectionState === 'closed') {
            this.isAvatarConnected = false;
            console.log('Avatar WebRTC Disconnected/Failed.');
            // Optional: Handle reconnection logic here if desired and enabled
          }
        });
      };

      this.peerConnection.ontrack = event => {
        console.log(`WebRTC Track Received - Kind: ${event.track.kind}, ID: ${event.track.id}`);
        this.ngZone.run(() => {
          if (event.track.kind === 'video') {
            const videoElement = document.createElement('video');
            videoElement.srcObject = event.streams[0];
            videoElement.autoplay = true;
            videoElement.playsInline = true; // Important for mobile
            videoElement.style.width = '100%'; // Fit container
            videoElement.style.height = '100%';
            videoElement.onerror = (e) => console.error('Video element error:', e);
            videoElement.onloadedmetadata = () => console.log('Video metadata loaded');
            videoElement.oncanplay = () => console.log('Video can play');


            const remoteVideoDiv = document.getElementById('remoteVideo'); // Get div by ID
            if (remoteVideoDiv) {
              // Clear previous video elements if any
              while (remoteVideoDiv.firstChild) {
                remoteVideoDiv.removeChild(remoteVideoDiv.firstChild);
              }
              remoteVideoDiv.appendChild(videoElement);
              console.log('Avatar video stream attached.');
            } else {
              console.error("Could not find 'remoteVideo' div element!");
            }

          } else if (event.track.kind === 'audio') {
            // Often, just letting the browser handle the audio track is enough
            // If specific control is needed, create and attach to an <audio> element
            const audioElement = document.createElement('audio');
            audioElement.srcObject = event.streams[0];
            audioElement.autoplay = true;
            document.body.appendChild(audioElement); // Append somewhere, maybe hidden
            console.log('Avatar audio stream attached.');
          }
        });
      };

      // Add transceivers *before* calling startAvatarAsync
      this.peerConnection.addTransceiver('video', { direction: 'recvonly' }); // We only receive video
      this.peerConnection.addTransceiver('audio', { direction: 'recvonly' }); // We only receive audio

      console.log("Starting Avatar session...");
      // 5. Start the Avatar Session (passing the peer connection)
      const result = await this.avatarSynthesizer.startAvatarAsync(this.peerConnection);

      if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) { // This reason seems odd for start, but might be used
        console.log("Avatar session request successful. Waiting for connection...");
        // Connection state changes handled by oniceconnectionstatechange
      } else {
        const cancellationDetails = SpeechSDK.CancellationDetails.fromResult(result as any); // Cast result to any
        console.error(`Failed to start avatar session. Reason: ${SpeechSDK.ResultReason[result.reason]}`);
        if (result.reason === SpeechSDK.ResultReason.Canceled) {
          console.error(`Cancellation Error Code: ${SpeechSDK.CancellationReason[cancellationDetails.reason]}`);
          console.error(`Cancellation Details: ${cancellationDetails.errorDetails}`);
        }
        throw new Error(`Failed to start avatar session: ${cancellationDetails.errorDetails || SpeechSDK.ResultReason[result.reason]}`);
      }

      // Listen for events (optional but useful)
      this.avatarSynthesizer.avatarEventReceived = (s, e) => {
        console.log(`Avatar Event: ${e.description}, Offset: ${e.offset / 10000}ms`);
      };


    } catch (error) {
      console.error('Error initializing or starting Azure Avatar:', error);
      this.isAvatarConnected = false;
      await this.stopAvatarSession(); // Clean up partially initialized state
      throw error; // Re-throw to be caught by toggleMic
    }
  }

  private bufferAndSpeakAvatarText(textChunk: string, forceSpeak: boolean = false): void {
    if (!this.avatarSynthesizer || !this.isAvatarConnected) {
      // Don't try to speak if not ready, just buffer? Or discard?
      // Let's buffer for now.
      if (textChunk) this.ttsTextBuffer += textChunk;
      console.warn("Avatar not ready, buffering text:", textChunk);
      return;
    }

    if (textChunk) this.ttsTextBuffer += textChunk;

    let sentenceToSpeak: string | null = null;

    // Check for sentence endings or process the whole buffer if forceSpeak is true
    if (forceSpeak && this.ttsTextBuffer.length > 0) {
      sentenceToSpeak = this.ttsTextBuffer.trim();
      this.ttsTextBuffer = ''; // Clear buffer
    } else {
      let lastEndIndex = -1;
      for (let i = this.ttsTextBuffer.length - 1; i >= 0; i--) {
        if (this.sentenceEndChars.includes(this.ttsTextBuffer[i])) {
          lastEndIndex = i;
          break;
        }
      }

      if (lastEndIndex !== -1) {
        sentenceToSpeak = this.ttsTextBuffer.substring(0, lastEndIndex + 1).trim();
        this.ttsTextBuffer = this.ttsTextBuffer.substring(lastEndIndex + 1); // Keep remainder
      }
    }

    if (sentenceToSpeak && sentenceToSpeak.length > 0) {
      this.speakTextWithAvatar(sentenceToSpeak);
    }
  }

  private speakTextWithAvatar(text: string): void {
    if (!this.avatarSynthesizer || !this.isAvatarConnected) {
      // ... (warning message) ...
      return;
    }

    console.log('Speaking with avatar:', text);
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
                    <voice name='${this.avatarTokenConfig?.ttsVoice}'>
                        ${this.escapeXml(text)}
                    </voice>
                  </speak>`; // Removed the mstts:viseme tag for simplicity, add back if needed and supported

    // --- Refactor the call below ---
    this.avatarSynthesizer.speakSsmlAsync(ssml)
      // --- REMOVE the explicit type annotation below ---
      .then((result) => { // Let TypeScript infer the type of 'result'
        this.ngZone.run(() => {
          // Now 'result' might be inferred as SynthesisResult or SpeechSynthesisResult
          // We proceed assuming the 'reason' property exists on both (which it does)

          if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log('Avatar finished speaking segment.');
            // If you NEED audio duration, try casting here:
            // const speechResult = result as SpeechSDK.SpeechSynthesisResult;
            // if (speechResult.audioDuration) {
            //    console.log(`Audio duration: ${speechResult.audioDuration / 10000}ms`);
            // }
          } else {
            // Keep 'as any' here for CancellationDetails, as it seems less strict
            const cancellationDetails = SpeechSDK.CancellationDetails.fromResult(result as any);
            console.error(`Avatar TTS Error: ${SpeechSDK.ResultReason[result.reason]}`);
            if (result.reason === SpeechSDK.ResultReason.Canceled) {
              console.error(`Cancellation Reason: ${SpeechSDK.CancellationReason[cancellationDetails.reason]}`);
              console.error(`Cancellation Details: ${cancellationDetails.errorDetails}`);
            }
            this.messages.push({ user: 'System', message: `[Avatar TTS Error: ${cancellationDetails.errorDetails || SpeechSDK.ResultReason[result.reason]}]`, timestamp: new Date().toLocaleTimeString() });
          }
        });
      })
      .catch((error: any) => { // Add type annotation for error
        this.ngZone.run(() => {
          console.error('Avatar speakSsmlAsync promise error:', error);
          this.messages.push({ user: 'System', message: `[Avatar Speak Error: ${error}]`, timestamp: new Date().toLocaleTimeString() });
        });
      });
  }

  // Basic XML escaping
  private escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, function (c) {
      switch (c) {
        case '<': return '<';
        case '>': return '>';
        case '&': return '&';
        case '\'': return '';
        case '"': return '"';
        default: return c;
      }
    });
  }


  private async stopAvatarSession(): Promise<void> {
    console.log('Stopping Avatar session...');
    this.isAvatarConnected = false; // Update UI state immediately

    if (this.avatarSynthesizer) {
      try {
        // Stop any ongoing speaking first
        await this.avatarSynthesizer.stopSpeakingAsync();
        console.log('Avatar speaking stopped.');
      } catch (e) {
        console.warn('Error stopping avatar speaking:', e);
      }

      try {
        // Close the synthesizer (this should handle underlying connections)
        this.avatarSynthesizer.close(); // Use close() - might be synchronous or return void
        console.log('Avatar synthesizer closed.');
      } catch (e) {
        console.error('Error closing avatar synthesizer:', e);
      } finally {
        this.avatarSynthesizer = null;
      }
    }

    if (this.peerConnection) {
      try {
        this.peerConnection.close();
        console.log('Peer connection closed.');
      } catch (e) {
        console.error('Error closing peer connection:', e);
      } finally {
        this.peerConnection = null;
      }
    }

    // Clear related configs
    this.speechConfig = null;
    this.avatarConfig = null;
    this.avatarTokenConfig = null; // Clear fetched config
    this.ttsTextBuffer = ''; // Clear buffer on stop

    // Clear the video display
    const remoteVideoDiv = document.getElementById('remoteVideo');
    if (remoteVideoDiv) {
      while (remoteVideoDiv.firstChild) {
        remoteVideoDiv.removeChild(remoteVideoDiv.firstChild);
      }
      // Optional: Add placeholder back
      // remoteVideoDiv.innerHTML = '<span style="color: white;">Avatar Disconnected</span>';
    }
    console.log('Avatar session cleanup complete.');
  }

  // --- Cleanup ---
  ngOnDestroy(): void {
    console.log('ChatComponent ngOnDestroy');
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    this.cleanupResources();
  }

  private async cleanupResources(): Promise<void> {
    console.log('Cleaning up resources...');
    this.stopCapturingMicAudio(); // Ensure mic capture is stopped
    await this.stopAvatarSession(); // Ensure avatar session is stopped
    if (this.hubConnection && this.hubConnection.state !== 'Disconnected') {
      try {
        await this.hubConnection.stop(); // Stop SignalR connection
        console.log('SignalR connection stopped.');
      } catch (err) {
        console.error('Error stopping SignalR hub:', err);
      }
    } else {
      console.log('SignalR connection already stopped or never started.');
    }
    console.log('Resource cleanup finished.');
  }

  // --- REMOVE OLD METHODS ---
  // private handleAudioChunk(base64Audio: string): void { /* ... remove ... */ }
  // private playNextChunk(): void { /* ... remove ... */ }
  // private testAudio(): void { /* ... remove ... */ }
  // private updateViseme(): void { /* ... remove ... */ }

} // End of ChatComponent class
