// gear6 replacement for Tauri IPC. `invokeTauri` routes here when USE_HTTP_API.
//
// Phase B: only the boot-critical commands are mapped for real; everything else
// returns a benign `[]` (most buzz commands are list-shaped) and warns once, so
// the app reaches an empty homepage without hanging. Phase D fills in the rest.
import { apiGet } from "@/shared/api/http";
import {
  historyMessageToRelayEvent,
  windowBoundsEvent,
  type HistoryMessage,
} from "@/shared/api/eventAdapter";
import {
  postChatMessage,
  tsFromEventId,
} from "@/shared/api/postMessage";
import type { RawChannel } from "@/shared/api/tauriChannels";
import type {
  RawUserProfileSummary,
  RawUsersBatchResponse,
} from "@/shared/api/tauriProfiles";

type ApiIdentity = {
  ok: boolean;
  user: { id: string; name: string; email: string | null };
};

type ApiMember = {
  id: string;
  name: string;
  real_name?: string;
  is_bot?: boolean;
  profile?: { display_name?: string };
};

type ApiChannel = {
  id: string;
  name: string;
  creator: string;
  created: number;
  is_archived: boolean;
  is_member: boolean;
  is_private: boolean;
  is_im: boolean;
};

// gear6 (Slack) channel → buzz RawChannel. Slack has no forum type, so a normal
// channel is a "stream"; DMs map to "dm". Fields buzz has no gear6 source for
// (topic, members, ttl) get empty/neutral values.
function toRawChannel(c: ApiChannel): RawChannel {
  return {
    id: c.id,
    name: c.name,
    channel_type: c.is_im ? "dm" : "stream",
    visibility: c.is_private ? "private" : "open",
    description: "",
    topic: null,
    purpose: null,
    member_count: 0,
    member_pubkeys: [],
    last_message_at: null,
    archived_at: c.is_archived ? new Date(c.created * 1000).toISOString() : null,
    participants: [],
    participant_pubkeys: [],
    is_member: c.is_member,
    ttl_seconds: null,
    ttl_deadline: null,
  };
}

let identityPromise: Promise<{ pubkey: string; display_name: string }> | null =
  null;

/** gear6 identity (the `dev` user while auth is disabled), fetched once. */
export function getApiIdentity(): Promise<{
  pubkey: string;
  display_name: string;
}> {
  if (!identityPromise) {
    identityPromise = apiGet<ApiIdentity>("users.identity").then((r) => ({
      pubkey: r.user.id,
      display_name: r.user.name,
    }));
  }
  return identityPromise;
}

function relayUrl(): string {
  return import.meta.env.VITE_RELAY_URL ?? "ws://localhost:3000";
}

const warned = new Set<string>();

export async function apiInvoke<T>(
  command: string,
  _args?: Record<string, unknown>,
): Promise<T> {
  switch (command) {
    case "is_shared_identity":
      return false as T;

    // Scalar-returning commands the `[]` default would break. get_relay_self must
    // be string|null (a caller does normalizePubkey(x).trim()); gear6 has no
    // relay-signed authorship attribution, so there is no relay self pubkey.
    case "get_relay_self":
      return null as T;

    case "get_default_relay_url":
      return relayUrl() as T;

    case "get_channels": {
      const res = await apiGet<{ channels: ApiChannel[] }>(
        "conversations.list",
      );
      return (res.channels ?? []).map(toRawChannel) as T;
    }

    // Initial timeline load. conversations.history is newest-first top-level
    // messages; return a flat RelayEvent[] (the parser re-sorts). Thread replies
    // load separately. The channel id isn't in each message, so inject it.
    case "get_channel_window": {
      const channelId = String(_args?.channelId ?? "");
      if (!channelId) return [] as T;
      const res = await apiGet<{ messages: HistoryMessage[] }>(
        "conversations.history",
        { channel: channelId, limit: 50 },
      );
      const rows = (res.messages ?? []).map((m) =>
        historyMessageToRelayEvent(m, channelId),
      );
      // The window parser requires exactly one bounds event alongside the rows.
      return [...rows, windowBoundsEvent(channelId)] as T;
    }

    // Reply/media send path (plain sends go via relayClient.sendMessage). gear6
    // has no media/emoji tags, so only channel/content/parent survive. Returns
    // RawSendChannelMessageResult; the backend re-parents replies to the true root.
    case "send_channel_message": {
      const channelId = String(_args?.channelId ?? "");
      const content = String(_args?.content ?? "");
      const parentEventId = (_args?.parentEventId as string | null) ?? null;
      const ev = await postChatMessage(channelId, content, parentEventId);
      const rootTs = ev.tags.find((t) => t[0] === "e")?.[1];
      return {
        event_id: ev.id,
        parent_event_id: parentEventId,
        root_event_id: rootTs ? `${channelId}:${rootTs}` : null,
        depth: rootTs ? 1 : 0,
        created_at: ev.created_at,
      } as T;
    }

    // Author name resolution. The FE batch lowercases pubkeys and looks them up
    // by lowercase id, so key the map that way. gear6 has no per-id batch
    // endpoint; users.list returns everyone. ponytail: one page (limit 1000) —
    // an author beyond it falls back to a truncated id. Paginate if teams grow.
    case "get_users_batch": {
      const res = await apiGet<{ members: ApiMember[] }>("users.list", {
        limit: 1000,
      });
      const profiles: Record<string, RawUserProfileSummary> = {};
      for (const m of res.members ?? []) {
        profiles[m.id.toLowerCase()] = {
          display_name: m.profile?.display_name || m.real_name || m.name || null,
          name: m.name ?? null,
          avatar_url: null,
          nip05_handle: null,
          owner_pubkey: null,
          is_agent: m.is_bot ?? false,
        };
      }
      return { profiles, missing: [] } satisfies RawUsersBatchResponse as T;
    }

    // Thread panel. rootEventId is `${channel}:${ts}`; conversations.replies
    // returns the root + replies oldest-first, but the FE contract wants replies
    // only (depth >= 1), so drop the root. ponytail: single page, no cursor —
    // deep threads truncate. Wire the cursor when a thread outgrows one page.
    case "get_thread_replies": {
      const rootEventId = String(_args?.rootEventId ?? "");
      const rootTs = tsFromEventId(rootEventId);
      const channelId =
        (_args?.channelId as string | null) ?? rootEventId.split(":")[0];
      if (!rootTs || !channelId) return { events: [], next_cursor: null } as T;
      const res = await apiGet<{ messages: HistoryMessage[] }>(
        "conversations.replies",
        { channel: channelId, ts: rootTs },
      );
      const events = (res.messages ?? [])
        .filter((m) => m.ts !== rootTs)
        .map((m) => historyMessageToRelayEvent(m, channelId));
      return { events, next_cursor: null } as T;
    }

    case "get_identity": {
      const id = await getApiIdentity();
      // RawIdentity: fromRawIdentity reads pubkey/display_name; lost/locked/
      // reset_failed absent → false.
      return { pubkey: id.pubkey, display_name: id.display_name } as T;
    }

    case "get_profile": {
      // RawProfile with has_profile_event:true so the app-onboarding gate
      // (features/onboarding/hooks.ts) resolves to "ready" instead of prompting
      // a nostr profile setup.
      const id = await getApiIdentity();
      return {
        pubkey: id.pubkey,
        display_name: id.display_name,
        avatar_url: null,
        about: null,
        nip05_handle: null,
        owner_pubkey: null,
        has_profile_event: true,
      } as T;
    }

    // Community config apply is a no-op: gear6 has no per-community relay to
    // install. Returning resolves useCommunityInit to isReady.
    case "apply_workspace":
      return undefined as T;

    default:
      if (!warned.has(command)) {
        warned.add(command);
        console.warn(`[gear6] unmapped command → [] default: ${command}`);
      }
      return [] as T;
  }
}
