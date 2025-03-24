import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// Define the response interface
interface ChatResponse {
  response: string;
  audio: string;
  visemes: { offset: number; id: number }[];
}

@Injectable({
  providedIn: 'root',
})
export class ChatService {
  private chatUrl = `${environment.BACKEND_API_URL}/chat`;

  constructor(private http: HttpClient) { }

  sendMessage(message: string): Observable<ChatResponse> {
    const headers = new HttpHeaders({ 'Content-Type': 'application/json' });
    const body = { message };

    return this.http.post<ChatResponse>(this.chatUrl, body, { headers }).pipe(
      catchError((error) => {
        console.error('Error in chat service:', error);
        return throwError(() => new Error('Failed to process message'));
      })
    );
  }
}
