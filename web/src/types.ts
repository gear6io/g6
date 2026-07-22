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
};

export type User = {
  id: string;
  name: string;
  real_name: string;
  profile: { display_name: string; real_name: string };
};

/** A message event off the websocket: the message plus the channel it landed in. */
export type RtmMessage = Message & { channel: string };
