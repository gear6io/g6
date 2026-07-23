// gear6 replacement for Tauri IPC. `invokeTauri` routes here when USE_GEAR6.
//
// Phase B: only the boot-critical commands are mapped for real; everything else
// returns a benign `[]` (most buzz commands are list-shaped) and warns once, so
// the app reaches an empty homepage without hanging. Phase D fills in the rest.
import { gear6Get } from "@/shared/api/gear6/http";
import type { RawChannel } from "@/shared/api/tauriChannels";

type Gear6Identity = {
  ok: boolean;
  user: { id: string; name: string; email: string | null };
};

type Gear6Channel = {
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
function toRawChannel(c: Gear6Channel): RawChannel {
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
export function gear6GetIdentity(): Promise<{
  pubkey: string;
  display_name: string;
}> {
  if (!identityPromise) {
    identityPromise = gear6Get<Gear6Identity>("users.identity").then((r) => ({
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

export async function gear6Invoke<T>(
  command: string,
  _args?: Record<string, unknown>,
): Promise<T> {
  switch (command) {
    case "is_shared_identity":
      return false as T;

    case "get_default_relay_url":
      return relayUrl() as T;

    case "get_channels": {
      const res = await gear6Get<{ channels: Gear6Channel[] }>(
        "conversations.list",
      );
      return (res.channels ?? []).map(toRawChannel) as T;
    }

    case "get_identity": {
      const id = await gear6GetIdentity();
      // RawIdentity: fromRawIdentity reads pubkey/display_name; lost/locked/
      // reset_failed absent → false.
      return { pubkey: id.pubkey, display_name: id.display_name } as T;
    }

    case "get_profile": {
      // RawProfile with has_profile_event:true so the app-onboarding gate
      // (features/onboarding/hooks.ts) resolves to "ready" instead of prompting
      // a nostr profile setup.
      const id = await gear6GetIdentity();
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
