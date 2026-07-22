import { useEffect, useRef, useState } from "react";
import { rtmConnect } from "./api";
import type { RtmMessage } from "./types";

const PING_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * One websocket for the whole app. The server broadcasts every channel's events to
 * every socket, so callers filter on `event.channel` themselves.
 *
 * Tickets are one-shot and expire in 30s, so every reconnect calls `rtm.connect`
 * again rather than reusing the URL. `onResync` fires after a *re*connection so the
 * caller can backfill whatever it missed while the socket was down.
 */
export function useRtm(enabled: boolean, onEvent: (m: RtmMessage) => void, onResync: () => void) {
  const [connected, setConnected] = useState(false);

  // Handlers change on every render; the socket must not.
  const handlers = useRef({ onEvent, onResync });
  handlers.current = { onEvent, onResync };

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let ws: WebSocket | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;
    let everConnected = false;

    const reconnect = () => {
      if (stopped) return;
      retry = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };

    const connect = async () => {
      if (stopped) return;
      let url: string;
      try {
        url = await rtmConnect();
      } catch {
        reconnect(); // Backend down or token gone; api.ts already handled auth loss.
        return;
      }
      if (stopped) return;

      ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        backoff = 1000;
        ping = setInterval(() => ws?.send(JSON.stringify({ type: "ping" })), PING_MS);
        if (everConnected) handlers.current.onResync();
        everConnected = true;
      };

      ws.onmessage = (e) => {
        const event = JSON.parse(e.data as string);
        if (event.type === "message") handlers.current.onEvent(event as RtmMessage);
      };

      ws.onclose = () => {
        setConnected(false);
        clearInterval(ping);
        reconnect();
      };

      // An error is always followed by a close, which is where reconnection lives.
      ws.onerror = () => ws?.close();
    };

    connect();

    return () => {
      stopped = true;
      clearInterval(ping);
      clearTimeout(retry);
      if (ws) {
        ws.onclose = null; // Unmounting is not a dropped connection.
        ws.close();
      }
    };
  }, [enabled]);

  return connected;
}
