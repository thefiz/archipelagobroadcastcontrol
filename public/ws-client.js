export class BroadcastSocket {
  constructor({ onOpen, onClose, onMessage } = {}) {
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.onMessage = onMessage;
    this.ws = null;
    this.pending = new Map();
    this.reconnectTimer = null;
    this.manualClose = false;
    this.connect();
  }

  get url() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/ws`;
  }

  connect() {
    clearTimeout(this.reconnectTimer);
    this.ws = new WebSocket(this.url);

    this.ws.addEventListener("open", () => this.onOpen?.());

    this.ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === "ack" && message.requestId && this.pending.has(message.requestId)) {
        const { resolve, timeout } = this.pending.get(message.requestId);
        clearTimeout(timeout);
        this.pending.delete(message.requestId);
        resolve(message.data);
        return;
      }

      this.onMessage?.(message);
    });

    this.ws.addEventListener("close", () => {
      this.onClose?.();
      for (const { resolve, timeout } of this.pending.values()) {
        clearTimeout(timeout);
        resolve({ ok: false, error: "Connection closed before acknowledgement." });
      }
      this.pending.clear();
      if (!this.manualClose) this.reconnectTimer = setTimeout(() => this.connect(), 1000);
    });
  }

  send(type, data = {}) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type, data }));
    return true;
  }

  request(type, data = {}, timeoutMs = 5000) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ ok: false, error: "WebSocket is not connected." });
    }

    const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, error: "Command timed out." });
      }, timeoutMs);
      this.pending.set(requestId, { resolve, timeout });
      this.ws.send(JSON.stringify({ type, requestId, data }));
    });
  }

  close() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
