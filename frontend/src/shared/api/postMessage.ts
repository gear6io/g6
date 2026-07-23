// Outbound message send for gear6. Both FE send paths (relayClient.sendMessage
// for plain messages, send_channel_message for replies/media) funnel here and
// POST chat.postMessage. The backend echoes the message on /rtm — rendered via
// dispatchRtmEvent — and the synthetic id `${channel}:${ts}` is identical, so
// the echo dedups against whatever the sender optimistically inserted.
import {
  historyMessageToRelayEvent,
  type HistoryMessage,
} from "@/shared/api/eventAdapter";
import { apiPost } from "@/shared/api/http";
import type { RelayEvent } from "@/shared/api/types";

/** A gear6 message event id is `${channel}:${ts}`; recover the Slack ts. */
export function tsFromEventId(eventId: string): string | undefined {
  const i = eventId.indexOf(":");
  return i >= 0 ? eventId.slice(i + 1) : undefined;
}

type PostResponse = {
  ok: boolean;
  channel: string;
  ts: string;
  message: HistoryMessage;
  error?: string;
};

/**
 * Post to gear6 and return the created message as a RelayEvent. `parentEventId`
 * (a reply target) is a FE event id; its ts becomes chat.postMessage's
 * `thread_ts` (the backend re-parents to the true thread root). Mentions are
 * resolved server-side from the raw `@name`/`#name` text, so no tags are sent.
 */
export async function postChatMessage(
  channelId: string,
  content: string,
  parentEventId?: string | null,
): Promise<RelayEvent> {
  const threadTs = parentEventId ? tsFromEventId(parentEventId) : undefined;
  const res = await apiPost<PostResponse>("chat.postMessage", {
    channel: channelId,
    text: content.trim(),
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
  if (!res.ok) throw new Error(res.error ?? "chat.postMessage failed");
  return historyMessageToRelayEvent(res.message, channelId);
}
