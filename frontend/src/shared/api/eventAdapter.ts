// gear6 /rtm (Slack) message → nostr-shaped RelayEvent, plus the client-side
// filter match the relay would normally do server-side. This is the single
// translation layer between the gear6 backend's message shape and the g6
// timeline pipeline (RelayEvent[] keyed by #h + kind). Reused by both the live
// /rtm dispatch and (Phase D) history/replies fetches.
import type { RelaySubscriptionFilter } from "@/shared/api/relayClientShared";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_CHANNEL_WINDOW_BOUNDS,
  KIND_DELETION,
  KIND_REACTION,
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
  // A reply's parent tag has to be what `getThreadReference` reads: a
  // `"reply"`-marked e-tag whose value is an event id (`${channel}:${ts}`), not
  // the bare Slack ts. Without the marker the reply reports `parentId: null` and
  // `buildMainTimelineEntries` renders it as a top-level row in the channel.
  // `thread_ts === ts` is the thread *root* — the backend promotes a message's
  // thread_ts to its own ts once it has replies — so it stays a root here.
  // gear6 re-parents every reply to the true root, so parent === root and one
  // "reply" tag is the whole reference (see buildReplyTags' equal-ids branch).
  if (m.thread_ts && m.thread_ts !== m.ts) {
    tags.push(["e", `${m.channel}:${m.thread_ts}`, "", "reply"]);
  }
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
  /** One entry per emoji, as `reactions::decorate` writes it. `reaction_ts` runs
   * parallel to `users`: one placement token per reactor. */
  reactions?: Array<{
    name: string;
    users: string[];
    count: number;
    reaction_ts: string[];
  }>;
};

/**
 * The synthetic id of one person's one reaction, derived the same way from a
 * fetched record and from a live frame — so the /rtm echo of an add dedups
 * against the history-fetched copy, and a `reaction_removed` names exactly the
 * event it removes.
 *
 * `placedAt` (the backend's `reaction_ts`) is what makes it *this* placement of
 * the emoji rather than the pair of person and emoji: a deletion is permanent in
 * the timeline, so if a re-add reused the removed event's id the pill could never
 * come back.
 */
export function reactionEventId(
  channel: string,
  ts: string,
  user: string,
  name: string,
  placedAt: string,
): string {
  return `${channel}:${ts}:${user}:${name}:${placedAt}`;
}

/**
 * One kind:7 event per (emoji, user) of a message's `reactions` decoration.
 *
 * The timeline derives its pills from reaction *events*, not from a count on the
 * message, and in gear6 mode there is no relay to fetch them from — the aux
 * backfill path needs a nostr socket. So the embedded array is expanded here,
 * next to the message it arrived with.
 *
 * `h` matters as much as `e`: it is what makes a live-dispatched reaction match
 * an open channel subscription's `#h` filter.
 *
 * ponytail: `created_at` is the message's second plus the pill's index, because
 * the wire carries no per-reaction timestamp. The backend already returns emoji
 * first-reacted-first, and the index preserves that through the formatter's
 * earliest-timestamp pill sort. Send real timestamps if pills ever need to
 * interleave with anything else in time.
 */
export function reactionEventsFor(
  m: Pick<HistoryMessage, "ts" | "reactions">,
  channel: string,
): RelayEvent[] {
  const createdAt = Math.floor(Number(m.ts));
  return (m.reactions ?? []).flatMap((reaction, index) => {
    // The tokens run parallel to `users`. A short array would hand two reactors
    // the same id and silently collapse them into one pill, so refuse it here
    // rather than render a wrong count.
    if (reaction.reaction_ts.length !== reaction.users.length) {
      throw new Error(
        `reaction ${reaction.name} on ${m.ts} has ${reaction.reaction_ts.length} placement tokens for ${reaction.users.length} users`,
      );
    }
    return reaction.users.map((user, seat) => ({
      id: reactionEventId(
        channel,
        m.ts,
        user,
        reaction.name,
        reaction.reaction_ts[seat],
      ),
      pubkey: user,
      created_at: createdAt + index,
      kind: KIND_REACTION,
      tags: [
        ["e", `${channel}:${m.ts}`],
        ["h", channel],
      ],
      // The backend stores the emoji itself, so this is already what renders.
      // Custom emoji arrive as `:name:` and stay that way: gear6 has no
      // custom-emoji store, so there is no URL for a NIP-30 `emoji` tag.
      content: reaction.name,
      sig: "",
    }));
  });
}

/** A `reaction_added` / `reaction_removed` frame off the /rtm socket. */
export type RtmReaction = {
  type: string;
  user: string;
  reaction: string;
  /** The placement token of the row that was added or removed. */
  reaction_ts: string;
  item: { type: string; channel: string; ts: string };
  event_ts?: string;
};

export function isRtmReaction(v: unknown): v is RtmReaction {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const item = o.item as Record<string, unknown> | undefined;
  return (
    (o.type === "reaction_added" || o.type === "reaction_removed") &&
    typeof o.user === "string" &&
    typeof o.reaction === "string" &&
    typeof o.reaction_ts === "string" &&
    typeof item?.channel === "string" &&
    typeof item?.ts === "string"
  );
}

/**
 * A live reaction frame → the event the timeline reads. An add is the kind:7
 * itself; a removal is a kind:5 deletion naming it, which is how the formatter
 * takes a pill back down.
 */
export function reactionToRelayEvent(r: RtmReaction): RelayEvent {
  const { channel, ts } = r.item;
  const id = reactionEventId(channel, ts, r.user, r.reaction, r.reaction_ts);
  const createdAt = Math.floor(Number(r.event_ts ?? ts));
  const tags = [
    ["e", r.type === "reaction_added" ? `${channel}:${ts}` : id],
    ["h", channel],
  ];
  return {
    id: r.type === "reaction_added" ? id : `deletion:${id}`,
    pubkey: r.user,
    created_at: createdAt,
    kind: r.type === "reaction_added" ? KIND_REACTION : KIND_DELETION,
    tags,
    content: r.type === "reaction_added" ? r.reaction : "",
    sig: "",
  };
}

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
