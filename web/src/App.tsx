import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { Channel, Message, RtmMessage, User } from "./types";
import { useRtm } from "./useRtm";
import { Login } from "./components/Login";
import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/MessageList";
import { ThreadPanel } from "./components/ThreadPanel";
import { Composer } from "./components/Composer";

/** Upsert by `ts`, keeping oldest-first order. `ts` is unique per channel, so it is the identity. */
function merge(list: Message[], incoming: Message[]): Message[] {
  const by = new Map(list.map((m) => [m.ts, m]));
  for (const m of incoming) by.set(m.ts, { ...by.get(m.ts), ...m });
  return [...by.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

export default function App() {
  const [me, setMe] = useState<api.Identity | null>(null);
  const [booting, setBooting] = useState(true);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [current, setCurrent] = useState<string>();
  const [users, setUsers] = useState<Map<string, User>>(new Map());
  const [unread, setUnread] = useState<Set<string>>(new Set());

  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [thread, setThread] = useState<{ root: string; messages: Message[] }>();

  // Reading these inside the websocket callback must not re-open the socket.
  const currentRef = useRef(current);
  currentRef.current = current;
  const threadRef = useRef(thread);
  threadRef.current = thread;

  // Stable so ThreadPanel's Escape listener is not torn down on every render.
  const closeThread = useCallback(() => setThread(undefined), []);

  const signOut = useCallback(() => {
    setMe(null);
    setChannels([]);
    setCurrent(undefined);
    setMessages([]);
    setThread(undefined);
  }, []);

  useEffect(() => {
    api.setAuthLostHandler(signOut);
  }, [signOut]);

  // ---------------------------------------------------------------- boot

  const boot = useCallback(async () => {
    try {
      setMe(await api.authTest());
    } catch {
      api.clearToken();
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    if (api.getToken()) boot();
    else setBooting(false);
  }, [boot]);

  useEffect(() => {
    if (!me) return;
    api.usersList().then((list) => setUsers(new Map(list.map((u) => [u.id, u]))));
    api.conversationsList().then((list) => {
      setChannels(list);
      setCurrent((c) => c ?? list[0]?.id);
    });
  }, [me]);

  // ---------------------------------------------------------------- channel history

  // Bumped on every channel switch so a slow response for the previous channel is dropped.
  const load = useRef(0);

  useEffect(() => {
    if (!current) return;
    const seq = ++load.current;
    setMessages([]);
    setCursor(undefined);
    setThread(undefined);
    api.conversationsHistory(current).then((page) => {
      if (load.current !== seq) return;
      setMessages(page.messages.slice().reverse()); // history is newest-first
      setCursor(page.cursor);
    });
    setUnread((u) => {
      if (!u.has(current)) return u;
      const next = new Set(u);
      next.delete(current);
      return next;
    });
  }, [current]);

  async function loadOlder() {
    if (!current || !cursor) return;
    const seq = load.current;
    const page = await api.conversationsHistory(current, { cursor });
    if (load.current !== seq) return;
    setMessages((m) => merge(m, page.messages));
    setCursor(page.cursor);
  }

  // ---------------------------------------------------------------- live events

  const onEvent = useCallback(
    (ev: RtmMessage) => {
      // One socket carries every channel; anything else is just an unread marker.
      if (ev.channel !== currentRef.current) {
        setUnread((u) => new Set(u).add(ev.channel));
        return;
      }
      const { channel: _channel, ...msg } = ev;

      if (!msg.thread_ts) {
        setMessages((m) => merge(m, [msg]));
      } else {
        const root = msg.thread_ts;
        // The server does not re-broadcast the parent, so its counter is ours to keep.
        setMessages((m) =>
          m.map((p) =>
            p.ts === root
              ? { ...p, reply_count: (p.reply_count ?? 0) + 1, latest_reply: msg.ts, thread_ts: root }
              : p,
          ),
        );
        if (threadRef.current?.root === root) {
          setThread((t) => (t ? { ...t, messages: merge(t.messages, [msg]) } : t));
        }
      }

      if (!users.has(ev.user)) {
        api.usersInfo(ev.user).then((u) => setUsers((m) => new Map(m).set(u.id, u)));
      }
    },
    [users],
  );

  /** After a dropped socket: pull anything posted while we were away. */
  const onResync = useCallback(async () => {
    const channel = currentRef.current;
    if (!channel) return;
    // ponytail: one page from the newest ts we hold. A gap needs >50 messages during
    // the outage; page with the cursor here if that stops being rare.
    const newest = messages[messages.length - 1]?.ts;
    const page = await api.conversationsHistory(channel, newest ? { oldest: newest } : {});
    setMessages((m) => merge(m, page.messages));

    const open = threadRef.current;
    if (open) {
      const replies = await api.conversationsReplies(channel, open.root);
      setThread((t) => (t?.root === open.root ? { root: t.root, messages: replies } : t));
    }
  }, [messages]);

  const connected = useRtm(!!me, onEvent, onResync);

  // ---------------------------------------------------------------- actions

  async function send(text: string) {
    if (!current) return;
    const msg = await api.postMessage(current, text);
    setMessages((m) => merge(m, [msg])); // The websocket echo will dedupe against this.
  }

  async function openThread(m: Message) {
    if (!current) return;
    setThread({ root: m.ts, messages: [m] });
    const replies = await api.conversationsReplies(current, m.ts);
    setThread((t) => (t?.root === m.ts ? { root: m.ts, messages: replies } : t));
  }

  async function sendReply(text: string) {
    if (!current || !thread) return;
    const msg = await api.postMessage(current, text, thread.root);
    setThread((t) => (t?.root === thread.root ? { ...t, messages: merge(t.messages, [msg]) } : t));
    setMessages((m) =>
      m.map((p) =>
        p.ts === thread.root
          ? {
              ...p,
              reply_count: (p.reply_count ?? 0) + 1,
              latest_reply: msg.ts,
              thread_ts: thread.root,
            }
          : p,
      ),
    );
  }

  async function createChannel(name: string) {
    const ch = await api.conversationsCreate(name);
    setChannels((cs) => [...cs, ch]);
    setCurrent(ch.id);
  }

  // ---------------------------------------------------------------- render

  if (booting) return <div className="login" />;
  if (!me) return <Login onSignedIn={boot} />;

  const channel = channels.find((c) => c.id === current);

  return (
    <div className="app">
      <Sidebar
        team={me.team}
        me={me.user}
        meId={me.user_id}
        channels={channels}
        current={current}
        unread={unread}
        onSelect={setCurrent}
        onCreate={createChannel}
        onLogout={() => api.logout().then(signOut)}
      />

      <main>
        {channel ? (
          <>
            <header className="topbar">
              <h2>
                <span className="hash">#</span>
                {channel.name}
              </h2>
              {!connected && <span className="offline">Reconnecting…</span>}
            </header>
            <MessageList
              channel={channel.id}
              messages={messages}
              users={users}
              hasMore={!!cursor}
              onLoadOlder={loadOlder}
              onOpenThread={openThread}
            />
            <Composer placeholder={`Message #${channel.name}`} onSend={send} />
          </>
        ) : (
          <div className="empty">Create a channel to get started.</div>
        )}
      </main>

      {thread && (
        <ThreadPanel
          messages={thread.messages}
          users={users}
          onClose={closeThread}
          onSend={sendReply}
        />
      )}
    </div>
  );
}
