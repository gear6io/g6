import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Message as Msg, User } from "../types";
import { Message } from "./Message";
import { dayOf } from "../format";

type Props = {
  channel: string;
  messages: Msg[]; // oldest first
  users: Map<string, User>;
  meId: string;
  hasMore: boolean;
  onLoadOlder: () => Promise<void>;
  onOpenThread: (m: Msg) => void;
  onOpenChannel: (id: string) => void;
};

const GROUP_WINDOW_SECS = 300;
const sameDay = (a: string, b: string) =>
  new Date(Number(a) * 1000).toDateString() === new Date(Number(b) * 1000).toDateString();

export function MessageList(props: Props) {
  const { channel, messages, users, meId, hasMore, onLoadOlder, onOpenThread, onOpenChannel } = props;
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // Was the reader pinned to the bottom before this render?
  const anchor = useRef<number | null>(null); // scrollHeight captured before prepending a page.
  // The ref guards the fetch (scroll can fire again before React re-renders); the state is display only.
  const loading = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    stick.current = true;
  }, [channel]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (anchor.current !== null) {
      // Older page went in above: hold the reader's place instead of jumping.
      el.scrollTop += el.scrollHeight - anchor.current;
      anchor.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  async function onScroll() {
    const el = box.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120 && hasMore && !loading.current) {
      loading.current = true;
      setLoadingOlder(true);
      anchor.current = el.scrollHeight;
      try {
        await onLoadOlder();
      } finally {
        loading.current = false;
        setLoadingOlder(false);
      }
    }
  }

  return (
    <div className="messages" ref={box} onScroll={onScroll}>
      {hasMore ? (
        <div className="muted center loader" aria-live="polite">
          {loadingOlder ? "Loading older messages…" : ""}
        </div>
      ) : (
        <div className="muted center">Beginning of the channel</div>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || !sameDay(prev.ts, m.ts);
        const compact =
          !newDay && !!prev && prev.user === m.user && Number(m.ts) - Number(prev.ts) < GROUP_WINDOW_SECS;
        return (
          <div key={m.ts}>
            {newDay && (
              <div className="divider">
                <span>{dayOf(m.ts)}</span>
              </div>
            )}
            <Message
              msg={m}
              users={users}
              meId={meId}
              compact={compact}
              onOpenThread={() => onOpenThread(m)}
              onOpenChannel={onOpenChannel}
            />
          </div>
        );
      })}
    </div>
  );
}
