import { Component, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { ChatService } from '../services/chat.service';

@Component({
  selector: 'app-avatar',
  templateUrl: './avatar.component.html',
  styleUrls: ['./avatar.component.css'],
})
export class AvatarComponent implements OnDestroy {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;
  userInput: string = '';
  messages: { text: string; sender: string; time: string }[] = [];
  isLoading: boolean = false;
  errorMessage: string = '';
  audioCache: { [key: string]: HTMLAudioElement } = {};
  visemes: { offset: number; id: number }[] = [];
  currentVisemeImage: string = '';
  visemeTimeouts: any[] = [];

  constructor(private chatService: ChatService) { }

  ngOnDestroy() {
    this.visemeTimeouts.forEach(clearTimeout);
  }

  async sendMessage() {
    if (!this.userInput.trim()) return;

    const userMessage = { text: this.userInput, sender: 'user', time: new Date().toLocaleTimeString() };
    this.messages.push(userMessage);
    this.scrollToBottom();

    const messageToSend = this.userInput;
    this.userInput = '';
    this.isLoading = true;
    this.errorMessage = '';

    try {
      const result = await this.chatService.sendMessage(messageToSend).toPromise();
      if (!result) throw new Error('No response received from server');

      const { response, audio, visemes } = result;
      this.visemes = visemes;
      this.currentVisemeImage = '';
      this.visemeTimeouts.forEach(clearTimeout);
      this.visemeTimeouts = [];

      const aiMessage = { text: response, sender: 'ai', time: new Date().toLocaleTimeString() };
      this.messages.push(aiMessage);
      this.scrollToBottom();

      this.playAudio(audio); // Pass Base64 string to playAudio
    } catch (error) {
      console.error('Error:', error);
      const errorMsg = 'Sorry, something went wrong.';
      this.messages.push({ text: errorMsg, sender: 'ai', time: new Date().toLocaleTimeString() });
      this.errorMessage = errorMsg;
      this.scrollToBottom();
    } finally {
      this.isLoading = false;
    }
  }

  playAudio(base64Audio: string) {
    const audioUrl = `data:audio/mp3;base64,${base64Audio}`; // Convert Base64 to data URL

    if (this.audioCache[audioUrl]) {
      this.audioCache[audioUrl].currentTime = 0; // Reset to start if cached
      this.audioCache[audioUrl].play().catch((error) => console.error('Error playing cached audio:', error));
      return;
    }

    const audio = new Audio(audioUrl);
    this.audioCache[audioUrl] = audio;

    audio.addEventListener('play', () => this.startVisemeAnimation(audio), { once: true });
    audio.addEventListener('ended', () => {
      this.currentVisemeImage = '';
      this.visemeTimeouts.forEach(clearTimeout);
      this.visemeTimeouts = [];
    }, { once: true });

    audio.play().catch((error) => console.error('Error playing audio:', error));
  }

  startVisemeAnimation(audio: HTMLAudioElement) {
    this.visemeTimeouts.forEach(clearTimeout);
    this.visemeTimeouts = [];

    const audioStartTime = audio.currentTime * 1000; // Convert to milliseconds
    this.visemes.forEach((viseme) => {
      const delay = viseme.offset - audioStartTime;
      if (delay >= 0) {
        const timeout = setTimeout(() => {
          this.currentVisemeImage = `assets/${viseme.id}.svg`;
        }, delay);
        this.visemeTimeouts.push(timeout);
      }
    });
  }

  scrollToBottom() {
    setTimeout(() => {
      this.messagesContainer.nativeElement.scrollTop = this.messagesContainer.nativeElement.scrollHeight;
    }, 0);
  }
}
