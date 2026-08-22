// Cloud's landed logs, folded into the shape the message renderer already
// speaks.
//
// Cloud returns immutable history and never folds it: an edit, a deletion and a
// reaction are each their own record, in sequence. That is the right thing for
// an archive and the wrong thing for a reader, so the folding happens here — the
// same job `formatTimelineMessages` does for relay events, against a different
// wire. It is not shared with that module because the two share no input type:
// one takes nostr events, this takes OTel log rows.
//
// Pure and renderer-free, like `milestones.ts` next door.
import type { TimelineMessage, TimelineReaction } from "@/features/messages/types";
import type { RawRow } from "@/shared/api/cloudGateway/types";

/**
 * Slack's raw platform coordinates and the shared `g6.*` vocabulary. Spelled out
 * rather than derived: these are the keys `g6-slack-otel` emits, and a typo here
 * is a silently empty thread rather than a failure.
 */
const ATTR = {
  actorId: "g6.actor.id",
  actorLogin: "g6.actor.login",
  actorName: "g6.actor.name",
  /** Absent on a plain new message, which is the common case. */
  logKind: "g6.log.kind",
  itemTs: "slack.item.ts",
  messageTs: "slack.message.ts",
  reactionAction: "slack.reaction.action",
  reactionName: "slack.reaction.name",
  threadTs: "slack.thread.ts",
} as const;

/**
 * One attribute, by its dotted OTel name.
 *
 * Cloud returns attributes as a *nested* object — `g6.actor.id` arrives as
 * `{g6: {actor: {id}}}` — because the stored cold and promoted JSON are merged
 * before serialisation. The flat form is checked first anyway: it costs one
 * lookup and it is what the OpenAPI examples show, so both shapes read the same
 * here rather than this breaking again if the wire settles the other way.
 */
function str(bag: Record<string, unknown>, key: string): string {
  const flat = bag[key];
  if (typeof flat === "string") {
    return flat;
  }

  let node: unknown = bag;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return "";
    }
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : "";
}

/**
 * Nanoseconds to seconds. `data.timestamp` is epoch **nanoseconds**; the
 * renderer counts in seconds, and handing it nanoseconds dates every message to
 * some time in the year 33,658 rather than failing visibly.
 */
function seconds(nanos: number): number {
  return Number.isFinite(nanos) ? Math.floor(nanos / 1e9) : 0;
}

function clockTime(epochSeconds: number): string {
  const at = new Date(epochSeconds * 1000);
  return Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Who spoke. `g6.actor.id` is an opaque namespaced id (`slack:U123`) and is what
 * identity is keyed on; the display name is whatever enrichment resolved, and
 * falls back to the id rather than to a placeholder — an unresolved author is a
 * real state, and inventing "Unknown" for it reads as a person.
 */
function author(attribute: Record<string, unknown>): {
  author: string;
  pubkey: string;
} {
  const id = str(attribute, ATTR.actorId);
  const name =
    str(attribute, ATTR.actorName) || str(attribute, ATTR.actorLogin) || id;
  return { author: name, pubkey: id };
}

/**
 * A message's own Slack timestamp — the coordinate an edit, a delete and a
 * reaction all name their target by. Empty on GitHub, which has no such thing
 * and needs none: its records are a flat sequence.
 */
function targetTs(row: RawRow): string {
  const attribute = row.data.attribute;
  return str(attribute, ATTR.itemTs) || str(attribute, ATTR.messageTs);
}

function message(row: RawRow): string {
  return str(row.data.body, "message");
}

/** One reaction row's contribution, or null when it is not a reaction. */
type ReactionEdit = { emoji: string; remove: boolean; ts: string };

function reactionEdit(row: RawRow): ReactionEdit | null {
  const attribute = row.data.attribute;
  if (str(attribute, ATTR.logKind) !== "reaction") {
    return null;
  }
  const emoji = str(attribute, ATTR.reactionName);
  const ts = str(attribute, ATTR.itemTs);
  if (!emoji || !ts) {
    // A reaction naming no target cannot be attached to anything. Cloud's own
    // docs call this out: `reaction_added` gives a `ts` but not a `thread_ts`,
    // and enrichment rejoins what it can. Dropping beats guessing a target.
    return null;
  }
  return { emoji, remove: str(attribute, ATTR.reactionAction) === "removed", ts };
}

/**
 * Reaction pills for each message ts, in first-reacted order — the same ordering
 * rule the legacy formatter uses, so a thread does not reorder its pills when it
 * is read from Cloud instead of the relay.
 *
 * `reactedByCurrentUser` is always false: this surface has no viewer identity,
 * and a reaction the reader cannot toggle must not claim to be theirs.
 */
function foldReactions(rows: RawRow[]): Map<string, TimelineReaction[]> {
  const byTarget = new Map<string, TimelineReaction[]>();

  for (const row of rows) {
    const edit = reactionEdit(row);
    if (!edit) {
      continue;
    }
    const pills = byTarget.get(edit.ts) ?? [];
    const existing = pills.find((pill) => pill.emoji === edit.emoji);

    if (edit.remove) {
      if (!existing) {
        continue;
      }
      existing.count -= 1;
      if (existing.count <= 0) {
        byTarget.set(
          edit.ts,
          pills.filter((pill) => pill.emoji !== edit.emoji),
        );
      }
      continue;
    }

    if (existing) {
      existing.count += 1;
    } else {
      pills.push({
        count: 1,
        emoji: edit.emoji,
        reactedByCurrentUser: false,
        users: [],
      });
    }
    byTarget.set(edit.ts, pills);
  }

  return byTarget;
}

/**
 * The conversation behind one event, chronological.
 *
 * Slack threads are one level deep: the row whose `slack.message.ts` equals its
 * `slack.thread.ts` — or which carries no `thread.ts` at all — is the head, and
 * everything else is a reply pointing at it.
 *
 * GitHub carries neither key, so its first record becomes the head and the rest
 * hang off it. That is not a Slack shape forced onto GitHub: a trace there *is*
 * an issue or pull-request lifecycle, so the opening body followed by its
 * comments is what the records already mean. A push or release event has no
 * trace at all and comes back as a single record, which lands as a lone head.
 *
 * Rows arrive chronological by `(timestamp, id)` and stay that way. Deleted
 * messages are removed rather than tombstoned: Cloud keeps the delete record
 * because history is immutable, but a reader asking "what was said" is not
 * asking to see what was unsaid.
 */
export function toTimelineMessages(rows: RawRow[]): TimelineMessage[] {
  const deleted = new Set<string>();
  const edited = new Set<string>();

  for (const row of rows) {
    const kind = str(row.data.attribute, ATTR.logKind);
    const ts = targetTs(row);
    if (!ts) {
      continue;
    }
    if (kind === "delete") {
      deleted.add(ts);
    } else if (kind === "update") {
      edited.add(ts);
    }
  }

  const reactions = foldReactions(rows);

  const utterances = rows.filter(
    (row) => !str(row.data.attribute, ATTR.logKind),
  );

  // Slack states the parent explicitly, so absence of a qualifying row is
  // information: the window began partway into the conversation. GitHub states
  // nothing, so its first record is the head by position. Telling the two apart
  // is what keeps a headless Slack page from promoting a mid-thread reply.
  const threaded = utterances.some((row) =>
    Boolean(str(row.data.attribute, ATTR.messageTs)),
  );

  // Found before the map below so a reply can point at it even when it is not
  // the first row.
  const headId =
    (threaded
      ? utterances.find((row) => {
          const ts = str(row.data.attribute, ATTR.messageTs);
          const thread = str(row.data.attribute, ATTR.threadTs);
          return !thread || thread === ts;
        })
      : utterances[0]
    )?.data.id ?? null;

  const messages: TimelineMessage[] = [];

  for (const row of rows) {
    const attribute = row.data.attribute;
    // Edits, deletes and reactions are folded into the record they name; they
    // are not utterances and must not become rows of their own.
    if (str(attribute, ATTR.logKind)) {
      continue;
    }

    const ts = str(attribute, ATTR.messageTs);
    if (ts && deleted.has(ts)) {
      continue;
    }

    const createdAt = seconds(row.data.timestamp);
    const isHead = row.data.id === headId;
    const { author: name, pubkey } = author(attribute);

    messages.push({
      author: name,
      body: message(row),
      createdAt,
      depth: isHead ? 0 : 1,
      edited: ts ? edited.has(ts) : false,
      id: row.data.id,
      parentId: isHead ? null : headId,
      pubkey,
      reactions: (ts ? reactions.get(ts) : undefined) ?? [],
      rootId: headId,
      time: clockTime(createdAt),
    });
  }

  return messages;
}

/**
 * The head and its replies, as `MessageThreadPanel` takes them. A window that
 * did not include the opening message has no head — the panel renders the
 * replies alone rather than promoting one of them into a role it did not have.
 */
export function toThread(rows: RawRow[]): {
  head: TimelineMessage | null;
  replies: TimelineMessage[];
} {
  const messages = toTimelineMessages(rows);
  const head = messages.find((entry) => entry.depth === 0) ?? null;
  return {
    head,
    replies: head ? messages.filter((entry) => entry.id !== head.id) : messages,
  };
}

/**
 * The message a `record_id` names, or null.
 *
 * Cloud says to match it against a returned record's `id`, or its `span_id` for
 * a span-scoped signal, so both are checked — a signal reconstructed from a span
 * boundary carries the span's id and no log's.
 *
 * Null is a normal answer in three ways, and the caller treats them alike: the
 * obligation carried no pointer, the record it points at is on a page not
 * fetched yet, or it was folded away as an edit, a delete or a reaction and is
 * no longer a row of its own. Checking against `messages` rather than against
 * `rows` alone is what catches that last one.
 */
export function highlightedMessageId(
  rows: RawRow[],
  recordId: string | null,
  messages: TimelineMessage[],
): string | null {
  if (!recordId) {
    return null;
  }
  const row = rows.find(
    (entry) => entry.data.id === recordId || entry.data.span_id === recordId,
  );
  const id = row?.data.id;
  return id && messages.some((message) => message.id === id) ? id : null;
}
