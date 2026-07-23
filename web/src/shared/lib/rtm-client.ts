/**
 * Real-time messaging connection to the gear6 backend.
 *
 * Two-step handshake: POST /api/rtm.connect mints a short-lived ticket and returns
 * the `/rtm` WebSocket URL with that ticket in the query string (browsers can't set
 * headers on a ws handshake). Auth is disabled backend-side for local dev, so no
 * `Authorization` header is sent — the backend resolves the request as its `dev`
 * user. Add token handling here once a real login flow exists.
 *
 * The socket is one-way for events; the only thing we send is a keepalive ping.
 */

import { relayHttpBaseUrl } from "@/shared/lib/relay-url";

const PING_INTERVAL_MS = 30_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface RtmConnectResponse {
  ok: boolean;
  url?: string;
  error?: string;
}

export class RtmClient {
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private closed = false;

  connect(): void {
    this.closed = false;
    void this.open();
  }

  close(): void {
    this.closed = true;
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }

  private async open(): Promise<void> {
    let url: string;
    try {
      const res = await fetch(`${relayHttpBaseUrl()}/api/rtm.connect`, {
        method: "POST",
      });
      const body = (await res.json()) as RtmConnectResponse;
      if (!body.ok || !body.url) {
        throw new Error(body.error ?? "rtm.connect failed");
      }
      url = body.url;
    } catch (err) {
      console.error("[rtm] connect handshake failed", err);
      this.scheduleReconnect();
      return;
    }

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      console.log("[rtm] connected");
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.startPing();
    };
    ws.onmessage = (ev) => {
      // ponytail: no UI consumes chat events yet — just observe the wire.
      console.log("[rtm]", ev.data);
    };
    ws.onerror = (ev) => {
      console.error("[rtm] socket error", ev);
    };
    ws.onclose = () => {
      console.log("[rtm] closed");
      this.stopPing();
      this.ws = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = this.reconnectDelay;
    console.log(`[rtm] reconnecting in ${delay}ms`);
    setTimeout(() => this.open(), delay);
    this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.ws?.send(JSON.stringify({ type: "ping" }));
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

/** Shared instance the app boots at startup. */
export const rtm = new RtmClient();
