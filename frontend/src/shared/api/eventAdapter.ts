// gear6 /rtm (Slack) message → nostr-shaped RelayEvent, plus the client-side
// filter match the relay would normally do server-side. This is the single
// translation layer between the gear6 backend's message shape and the buzz
// timeline pipeline (RelayEvent[] keyed by #h + kind). Reused by both the live
// /rtm dispatch and (Phase D) history/replies fetches.
import type { RelaySubscriptionFilter } from "@/shared/api/relayClientShared";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_CHANNEL_WINDOW_BOUNDS,
  KIND_STREAM_MESSAGE_V2,
} from "@/shared/constants/kinds";

/** A message frame off the gear6 /rtm socket — see `chat_post_message` in src/api.rs. */
export type RtmMessage = {
  type: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
};

export function isRtmMessage(v: unknown): v is RtmMessage {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.type === "message" &&
    typeof o.channel === "string" &&
    typeof o.user === "string" &&
    typeof o.text === "string" &&
    typeof o.ts === "string"
  );
}

/**
 * gear6 (Slack) message → RelayEvent the timeline expects.
 *
 * `ts` is the Slack decimal id `"<seconds>.<microseconds>"` (e.g.
 * "1784823629.190046"); `created_at` is the whole-seconds part, but the raw `ts`
 * is kept in a tag so ordering/dedup stay exact (two messages in the same second
 * still differ). `id` is a stable synthetic key so `mergeTimelineCacheMessages`
 * dedups the /rtm echo against any history-fetched copy. `sig` is empty: gear6
 * events are never verified client-side (the backend is the trust boundary).
 */
export function messageToRelayEvent(m: RtmMessage): RelayEvent {
  const tags: string[][] = [
    ["h", m.channel],
    ["ts", m.ts],
  ];
  if (m.thread_ts) tags.push(["e", m.thread_ts]);
  return {
    id: `${m.channel}:${m.ts}`,
    pubkey: m.user,
    created_at: Math.floor(Number(m.ts)),
    kind: KIND_STREAM_MESSAGE_V2,
    tags,
    content: m.text,
    sig: "",
  };
}

/** A message object from conversations.history / .replies — identical to the
 * /rtm frame but with no `channel` (it's the request param). */
export type HistoryMessage = {
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
};

/** History/replies message → RelayEvent, injecting the channel the fetch was for. */
export function historyMessageToRelayEvent(
  m: HistoryMessage,
  channel: string,
): RelayEvent {
  return messageToRelayEvent({ type: "message", channel, ...m });
}

/**
 * The channel-window pipeline (parseChannelWindowResponse) requires exactly one
 * KIND_CHANNEL_WINDOW_BOUNDS event describing the page — the old nostr backend
 * assembled it server-side. gear6's conversations.history returns bare messages,
 * so fabricate the bounds event the parser demands. The d-tag must match
 * `expectedBoundsKey(channelId, null)` = `${channelId.toLowerCase()}:head`.
 *
 * ponytail: has_more:false — the newest window loads, older-message scrollback is
 * deferred. gear6's opaque base64 history cursor doesn't map to the window
 * store's {createdAt,id} cursor; wire real pagination when a channel outgrows one
 * window (limit 50).
 */
export function windowBoundsEvent(channelId: string): RelayEvent {
  return {
    id: `bounds:${channelId}`,
    pubkey: "",
    created_at: 0,
    kind: KIND_CHANNEL_WINDOW_BOUNDS,
    tags: [["d", `${channelId.toLowerCase()}:head`]],
    content: JSON.stringify({ has_more: false, next_cursor: null }),
    sig: "",
  };
}

/**
 * Client-side filter match for gear6 live dispatch. The /rtm socket carries one
 * stream for every channel with no subId routing, so we replicate the #tag/kind
 * filtering the relay would have done server-side.
 *
 * `since`/`limit` are backlog-window hints for the initial REQ and deliberately
 * ignored here — a pushed live event is by definition new; enforcing an
 * off-by-one `since` would drop a just-posted message.
 */
export function eventMatchesFilter(
  filter: RelaySubscriptionFilter,
  event: RelayEvent,
): boolean {
  if (filter.kinds.length > 0 && !filter.kinds.includes(event.kind)) {
    return false;
  }
  for (const [key, raw] of Object.entries(filter)) {
    if (!key.startsWith("#")) continue;
    const values = raw as string[] | undefined;
    if (!Array.isArray(values)) continue;
    const tagName = key.slice(1);
    const hasMatch = event.tags.some(
      (t) => t[0] === tagName && values.includes(t[1]),
    );
    if (!hasMatch) return false;
  }
  return true;
}
