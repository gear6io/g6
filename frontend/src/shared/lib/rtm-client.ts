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
 *
 * ponytail: copy of web/src/shared/lib/rtm-client.ts — the two differ only in the
 * base-URL resolver below (desktop's webview origin is the Tauri dev port, not the
 * backend, so it can't fall back to window.location). Extract to a shared package
 * when a 3rd app (admin-web/mobile) needs it; not worth monorepo infra for 2 copies.
 */

import {
  messageToRelayEvent,
  isRtmMessage,
} from "@/shared/api/eventAdapter";
import { relayClient } from "@/shared/api/relayClient";
import { relayHttpFromWs } from "@/shared/api/inviteHelpers";

const PING_INTERVAL_MS = 30_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Backend HTTP origin. Defaults to the backend's own default rather than deriving
 * from window.location, which in the Tauri webview is the dev server (:1420) or
 * `tauri://localhost` — never the backend.
 */
function backendHttpBaseUrl(): string {
  const wsUrl = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:3000";
  return relayHttpFromWs(wsUrl);
}

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
      const res = await fetch(`${backendHttpBaseUrl()}/api/rtm.connect`, {
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
      let frame: unknown;
      try {
        frame = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return; // non-JSON (shouldn't happen); ignore.
      }
      // Only message frames drive the timeline; hello/pong are keepalive noise.
      if (isRtmMessage(frame)) {
        relayClient.dispatchRtmEvent(messageToRelayEvent(frame));
      }
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
