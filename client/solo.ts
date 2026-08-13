/**
 * A WebSocket-shaped wrapper around the in-page worker server, so NetClient
 * can treat "hosted in this tab" exactly like a remote socket.
 */
export class LocalSocket {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 0;
  OPEN = 1;

  private worker: Worker;
  private queue: string[] = [];
  private ready = false;
  private closed = false;

  constructor() {
    this.worker = new Worker(new URL('./worker-server.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<{ data: unknown }>) => {
      const data = ev.data?.data;
      if (data && (data as { t?: string }).t === 'worker-ready') {
        this.ready = true;
        this.readyState = 1;
        for (const raw of this.queue) this.worker.postMessage({ data: JSON.parse(raw) });
        this.queue = [];
        this.onopen?.();
        return;
      }
      // Everything else is a ServerMessage; the client parses it as JSON.
      this.onmessage?.({ data: JSON.stringify(data) });
    };
    this.worker.onerror = () => {
      if (this.closed) return;
      this.closed = true;
      this.onerror?.();
      this.onclose?.();
    };
  }

  send(raw: string): void {
    if (this.closed) return;
    if (!this.ready) {
      this.queue.push(raw);
      return;
    }
    this.worker.postMessage({ data: JSON.parse(raw) });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    this.readyState = 3;
    this.onclose?.();
  }
}
