/**
 * Typed WebSocket client. Connects to `/ws/cascade` or `/ws/realtime` (Vite
 * proxies these to the backend) and speaks the shared ClientMessage /
 * ServerMessage protocol. It is intentionally dumb about interpretation — it
 * just sends control/audio frames and forwards normalised server messages to a
 * handler, which is what keeps mode-specific transport out of the React tree.
 */

import type {
  ClientMessage,
  LanguagePairCode,
  Mode,
  ServerMessage,
} from '@workbench/types';

export interface InterpreterSocketHandlers {
  readonly onMessage: (message: ServerMessage) => void;
  readonly onOpen?: () => void;
  readonly onClose?: () => void;
  readonly onError?: (error: Event) => void;
}

export class InterpreterSocket {
  private ws: WebSocket | null = null;

  constructor(
    private readonly mode: Mode,
    private readonly handlers: InterpreterSocketHandlers,
  ) {}

  connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${protocol}://${window.location.host}/ws/${this.mode}`);
    this.ws.addEventListener('open', () => this.handlers.onOpen?.());
    this.ws.addEventListener('close', () => this.handlers.onClose?.());
    this.ws.addEventListener('error', (e) => this.handlers.onError?.(e));
    this.ws.addEventListener('message', (event: MessageEvent<string>) => {
      try {
        this.handlers.onMessage(JSON.parse(event.data) as ServerMessage);
      } catch {
        // Ignore malformed frames.
      }
    });
  }

  start(sessionId: string, languagePair: LanguagePairCode): void {
    this.send({ type: 'start', sessionId, mode: this.mode, languagePair });
  }

  sendAudio(base64: string): void {
    this.send({ type: 'audio', chunk: base64 });
  }

  updateLanguage(languagePair: LanguagePairCode): void {
    this.send({ type: 'language.update', languagePair });
  }

  stop(): void {
    this.send({ type: 'stop' });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}
