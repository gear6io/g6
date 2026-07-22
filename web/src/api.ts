import type { Channel, Message, Presence, Profile, User } from "./types";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const TOKEN_KEY = "gear6.token";

/** The backend answers HTTP 200 for failures too, reporting them as `{ok:false,error}`. */
export class SlackError extends Error {}

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/** Set by App so an expired or forged token drops the whole UI back to the login screen. */
let onAuthLost: () => void = () => {};
export const setAuthLostHandler = (fn: () => void) => {
  onAuthLost = fn;
};

type Envelope = { ok: boolean; error?: string; [k: string]: unknown };

async function request(path: string, args: unknown, withAuth: boolean): Promise<Envelope> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (withAuth) {
    const token = getToken();
    if (!token) throw new SlackError("not_authed");
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args ?? {}),
  });

  // Non-200 is not part of the API contract, so it is a transport problem.
  if (!res.ok) throw new SlackError(`http_${res.status}`);

  const body = (await res.json()) as Envelope;
  if (!body.ok) {
    if (body.error === "invalid_auth" || body.error === "not_authed") {
      clearToken();
      onAuthLost();
    }
    throw new SlackError(body.error ?? "unknown_error");
  }
  return body;
}

const call = (method: string, args?: unknown) => request(`/api/${method}`, args, true);

/** An empty string means "no more pages"; the server always sends the key. */
const cursorOf = (b: Envelope) =>
  (b.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || undefined;

// ------------------------------------------------------------------ auth

export async function register(username: string, password: string) {
  await request("/register", { username, password }, false);
}

export async function login(username: string, password: string) {
  const b = await request("/login", { username, password }, false);
  setToken(b.token as string);
}

export async function logout() {
  try {
    await call("logout");
  } finally {
    clearToken();
  }
}

export type Identity = { user_id: string; user: string; team: string };

export async function authTest(): Promise<Identity> {
  const b = await call("auth.test");
  return { user_id: b.user_id as string, user: b.user as string, team: b.team as string };
}

// ------------------------------------------------------------------ channels

export async function conversationsList(): Promise<Channel[]> {
  const all: Channel[] = [];
  let cursor: string | undefined;
  // A workspace has few enough channels that the sidebar wants all of them.
  do {
    const b = await call("conversations.list", { limit: 200, cursor });
    all.push(...(b.channels as Channel[]));
    cursor = cursorOf(b);
  } while (cursor);
  return all;
}

export async function conversationsCreate(name: string, is_private = false): Promise<Channel> {
  const b = await call("conversations.create", { name, is_private });
  return b.channel as Channel;
}

// ------------------------------------------------------------------ messages

export type HistoryPage = { messages: Message[]; cursor?: string };

/** Newest-first, pages backwards. Returns thread parents and plain messages only. */
export async function conversationsHistory(
  channel: string,
  opts: { cursor?: string; oldest?: string; limit?: number } = {},
): Promise<HistoryPage> {
  const b = await call("conversations.history", { channel, limit: 50, ...opts });
  return { messages: b.messages as Message[], cursor: cursorOf(b) };
}

/** Oldest-first and includes the parent as the first message. */
export async function conversationsReplies(channel: string, ts: string): Promise<Message[]> {
  const b = await call("conversations.replies", { channel, ts, limit: 200 });
  return b.messages as Message[];
}

export async function postMessage(channel: string, text: string, thread_ts?: string): Promise<Message> {
  const b = await call("chat.postMessage", { channel, text, thread_ts });
  return b.message as Message;
}

// ------------------------------------------------------------------ users, rtm

/** `presence` is opt-in server-side; without it the roster boots with nobody active. */
export async function usersList(): Promise<(User & { presence: Presence })[]> {
  const all: (User & { presence: Presence })[] = [];
  let cursor: string | undefined;
  do {
    const b = await call("users.list", { limit: 200, cursor, presence: true });
    all.push(...(b.members as (User & { presence: Presence })[]));
    cursor = cursorOf(b);
  } while (cursor);
  return all;
}

/** For authors who registered after this tab loaded its roster. */
export async function usersInfo(user: string): Promise<User> {
  const b = await call("users.info", { user });
  return b.user as User;
}

export async function usersProfileGet(): Promise<Profile> {
  const b = await call("users.profile.get");
  return b.profile as Profile;
}

/** Only the named fields are touched; anything left out keeps its stored value. */
export async function usersProfileSet(profile: Partial<Profile>): Promise<Profile> {
  const b = await call("users.profile.set", { profile });
  return b.profile as Profile;
}

/** `auto` hands presence back to the websocket; `away` pins it regardless. */
export async function usersSetPresence(presence: "auto" | "away"): Promise<void> {
  await call("users.setPresence", { presence });
}

/** The returned URL carries a one-shot ticket that expires in 30s — never cache it. */
export async function rtmConnect(): Promise<string> {
  const b = await call("rtm.connect");
  return b.url as string;
}
