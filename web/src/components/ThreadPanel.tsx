import { useEffect, useRef } from "react";
import type { Channel, Message as Msg, User } from "../types";
import { Message } from "./Message";
import { Composer } from "./Composer";

type Props = {
  messages: Msg[]; // oldest first, parent included — conversations.replies returns it that way
  users: Map<string, User>;
  meId: string;
  channels: Channel[];
  onClose: () => void;
  onSend: (text: string) => Promise<void>;
  onOpenChannel: (id: string) => void;
};

export function ThreadPanel(props: Props) {
  const { messages, users, meId, channels, onClose, onSend, onOpenChannel } = props;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [parent, ...replies] = messages;

  return (
    <aside className="thread" aria-label="Thread">
      <header>
        <span>Thread</span>
        <button className="icon" onClick={onClose} title="Close">
          ×
        </button>
      </header>
      <div className="messages" ref={box}>
        {parent && (
          <Message msg={parent} users={users} meId={meId} onOpenChannel={onOpenChannel} />
        )}
        {replies.length > 0 && (
          <div className="divider">
            <span>
              {replies.length} {replies.length === 1 ? "reply" : "replies"}
            </span>
          </div>
        )}
        {replies.map((m) => (
          <Message key={m.ts} msg={m} users={users} meId={meId} onOpenChannel={onOpenChannel} />
        ))}
      </div>
      <Composer
        placeholder="Reply…"
        onSend={onSend}
        users={[...users.values()]}
        channels={channels}
      />
    </aside>
  );
}
