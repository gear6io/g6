export type Channel = {
  id: string;
  name: string;
  is_private: boolean;
  created: number;
  creator: string;
};

export type Message = {
  type: "message";
  user: string;
  text: string;
  ts: string;
  /** Absent on plain messages. Equals `ts` on a thread parent, the root's ts on a reply. */
  thread_ts?: string;
  /** Only present on parents that have replies. */
  reply_count?: number;
  latest_reply?: string;
  /** Server-resolved sidecar for the `<@U…>` / `<#C…>` tokens in `text`. Omitted when there are none. */
  mentions?: Record<string, string>;
};

export type Profile = {
  display_name: string;
  real_name: string;
  title: string;
  status_text: string;
  status_emoji: string;
  status_expiration: number;
  email: string | null;
};

export type User = {
  id: string;
  name: string;
  real_name: string;
  updated: number;
  profile: Profile;
};

/** Derived server-side from open websockets, so it is never stored on the user row. */
export type Presence = "active" | "away";

/** A message event off the websocket: the message plus the channel it landed in. */
export type RtmMessage = Message & { channel: string };

/**
 * Everything the socket delivers. `team_join` and `user_change` carry the same
 * payload — a whole user — because in both cases the roster entry is simply replaced.
 */
export type RtmEvent =
  | RtmMessage
  | { type: "user_change"; user: User }
  | { type: "team_join"; user: User }
  | { type: "presence_change"; user: string; presence: Presence };
