// gear6 replacement for Tauri IPC. `invokeTauri` routes here when USE_HTTP_API.
//
// Phase B: only the boot-critical commands are mapped for real; everything else
// returns a benign `[]` (most g6 commands are list-shaped) and warns once, so
// the app reaches an empty homepage without hanging. Phase D fills in the rest.
import { apiCall, apiGet, apiPost } from "@/shared/api/http";
import {
  editEventFor,
  historyMessageToRelayEvent,
  reactionEventsFor,
  windowBoundsEvent,
  type HistoryMessage,
} from "@/shared/api/eventAdapter";
import {
  postChatMessage,
  tsFromEventId,
} from "@/shared/api/postMessage";
import {
  toRawChannel,
  toRawChannelDetail,
  toRawChannelMembers,
  type ApiChannel,
} from "@/shared/api/channelAdapter";
import type {
  RawUserProfileSummary,
  RawUsersBatchResponse,
} from "@/shared/api/tauriProfiles";
import type { ChannelVisibility } from "@/shared/api/types";

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

/**
 * Every profile in the workspace, keyed by lowercase id — the shape
 * `get_users_batch` returns and `get_channel_members` reuses for display names.
 *
 * gear6 has no per-id batch endpoint; users.list returns everyone. ponytail: one
 * page (limit 1000) — a user beyond it falls back to a truncated id. Paginate if
 * teams grow.
 */
async function loadUserProfiles(): Promise<
  Record<string, RawUserProfileSummary>
> {
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
  return profiles;
}

/** conversations.info, which every channel mutation answers with. */
async function channelInfo(channelId: string): Promise<ApiChannel> {
  const res = await apiCall<{ channel: ApiChannel }>("conversations.info", {
    channel: channelId,
  });
  return res.channel;
}

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

    case "get_channel_details":
      return toRawChannelDetail(
        await channelInfo(String(_args?.channelId ?? "")),
      ) as T;

    // Two round trips: Slack's members response is bare ids, so the channel is
    // fetched alongside it for the `creator` the owner role is derived from.
    case "get_channel_members": {
      const channelId = String(_args?.channelId ?? "");
      const [res, channel, profiles] = await Promise.all([
        apiCall<{ members: string[] }>("conversations.members", {
          channel: channelId,
          limit: 1000,
        }),
        channelInfo(channelId),
        loadUserProfiles(),
      ]);
      return toRawChannelMembers(res.members ?? [], channel, profiles) as T;
    }

    // One FE edit dialog spans three gear6 methods. `ttlSeconds` is accepted and
    // dropped — gear6 has no ephemeral-channel concept.
    case "update_channel": {
      const input = (_args?.input ?? _args ?? {}) as {
        channelId?: string;
        name?: string;
        description?: string;
        visibility?: ChannelVisibility;
      };
      const channel = String(input.channelId ?? "");
      if (input.name !== undefined) {
        await apiCall("conversations.rename", { channel, name: input.name });
      }
      if (input.description !== undefined) {
        await apiCall("conversations.setDescription", {
          channel,
          description: input.description,
        });
      }
      if (input.visibility !== undefined) {
        await apiCall(
          input.visibility === "private"
            ? "admin.conversations.convertToPrivate"
            : "admin.conversations.convertToPublic",
          { channel_id: channel },
        );
      }
      return toRawChannelDetail(await channelInfo(channel)) as T;
    }

    case "set_channel_topic":
      await apiCall("conversations.setTopic", {
        channel: String(_args?.channelId ?? ""),
        topic: String(_args?.topic ?? ""),
      });
      return undefined as T;

    case "set_channel_purpose":
      await apiCall("conversations.setPurpose", {
        channel: String(_args?.channelId ?? ""),
        purpose: String(_args?.purpose ?? ""),
      });
      return undefined as T;

    case "archive_channel":
    case "unarchive_channel":
    case "join_channel":
    case "leave_channel": {
      const method = command.replace(/_channel$/, "");
      await apiCall(`conversations.${method}`, {
        channel: String(_args?.channelId ?? ""),
      });
      return undefined as T;
    }

    // The public Slack API has no conversations.delete; deletion is admin-only.
    case "delete_channel":
      await apiCall("admin.conversations.delete", {
        channel_id: String(_args?.channelId ?? ""),
      });
      return undefined as T;

    // conversations.invite is all-in-one-call and reports per-user failures in
    // an `errors` array, so it cannot go through apiCall — a partial success
    // answers ok:false and the caller still needs the ids that landed.
    case "add_channel_members": {
      const pubkeys = (_args?.pubkeys as string[] | undefined) ?? [];
      const res = await apiPost<{
        ok: boolean;
        error?: string;
        errors?: Array<{ user: string; error: string }>;
      }>("conversations.invite", {
        channel: String(_args?.channelId ?? ""),
        users: pubkeys.join(","),
      });
      if (!res.ok && !res.errors) {
        throw new Error(res.error ?? "conversations.invite failed");
      }
      const errors = (res.errors ?? []).map((e) => ({
        pubkey: e.user,
        error: e.error,
      }));
      const failed = new Set(errors.map((e) => e.pubkey));
      return {
        added: pubkeys.filter((p) => !failed.has(p)),
        errors,
      } as T;
    }

    case "remove_channel_member":
      await apiCall("conversations.kick", {
        channel: String(_args?.channelId ?? ""),
        user: String(_args?.pubkey ?? ""),
      });
      return undefined as T;

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
      const messages = res.messages ?? [];
      const rows = messages.map((m) => historyMessageToRelayEvent(m, channelId));
      // Reactions and edit markers ride with their message (there is no relay to
      // backfill them from) and the window parser routes these aux kinds into
      // the page's aux bucket.
      const aux = messages.flatMap((m) => [
        ...reactionEventsFor(m, channelId),
        ...editEventFor(m, channelId),
      ]);
      // The window parser requires exactly one bounds event alongside the rows.
      return [...rows, ...aux, windowBoundsEvent(channelId)] as T;
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

    // Editing rewrites the message in place — `ts` never changes, so the
    // timeline row keeps its id. gear6 has no attachments or custom emoji, so
    // the `mediaTags`/`emojiTags` the composer computed have nowhere to go;
    // `mentionPubkeys` is dropped too because the backend re-links mentions
    // from the text itself, exactly like the send path.
    case "edit_message": {
      const eventId = String(_args?.eventId ?? "");
      const ts = tsFromEventId(eventId);
      if (!ts) throw new Error(`Malformed message id ${eventId}.`);
      await apiCall("chat.update", {
        channel: eventId.split(":")[0],
        ts,
        text: String(_args?.content ?? ""),
      });
      return undefined as T;
    }

    // Deleting a thread root deletes its replies with it, and the backend sends
    // one message_deleted frame per removed message, so the timeline drops the
    // whole thread rather than orphaning the replies.
    case "delete_message": {
      const eventId = String(_args?.eventId ?? "");
      const ts = tsFromEventId(eventId);
      if (!ts) throw new Error(`Malformed message id ${eventId}.`);
      await apiCall("chat.delete", {
        channel: eventId.split(":")[0],
        ts,
      });
      return undefined as T;
    }

    // Author name resolution. The FE batch lowercases pubkeys and looks them up
    // by lowercase id, so key the map that way.
    case "get_users_batch": {
      const profiles = await loadUserProfiles();
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
      const messages = res.messages ?? [];
      const events = messages
        .filter((m) => m.ts !== rootTs)
        .map((m) => historyMessageToRelayEvent(m, channelId));
      // Reaction and edit events are overlays, not rows, so the root's come
      // along too — they are what puts pills and an "(edited)" on the head.
      const aux = messages.flatMap((m) => [
        ...reactionEventsFor(m, channelId),
        ...editEventFor(m, channelId),
      ]);
      return { events: [...events, ...aux], next_cursor: null } as T;
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

    // gear6 keys a reaction by the emoji itself, which is what the picker hands
    // us — a custom emoji arrives as `:name:` and travels unchanged too.
    case "add_reaction":
    case "remove_reaction": {
      const eventId = String(_args?.eventId ?? "");
      const name = String(_args?.emoji ?? "");
      const ts = tsFromEventId(eventId);
      if (!ts) throw new Error(`Malformed message id ${eventId}.`);
      await apiCall(
        command === "add_reaction" ? "reactions.add" : "reactions.remove",
        { channel: eventId.split(":")[0], timestamp: ts, name },
      );
      return undefined as T;
    }

    // ponytail: deliberately unmapped, not forgotten. `change_channel_member_role`
    // has no Slack counterpart (Slack has no per-channel roles); `open_dm`/`hide_dm`
    // wait on conversations.open; `get_canvas`/`set_canvas` have no backend at all.
    default:
      if (!warned.has(command)) {
        warned.add(command);
        console.warn(`[gear6] unmapped command → [] default: ${command}`);
      }
      return [] as T;
  }
}
