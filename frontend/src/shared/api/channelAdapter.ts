// gear6 (Slack) channel objects → the buzz `Raw*` shapes the frontend's channel
// layer speaks. Pure functions, kept out of invoke.ts so the mapping can be
// tested without a fetch — see channelAdapter.test.mjs.
import type {
  RawChannel,
  RawChannelDetail,
  RawChannelMembersResponse,
} from "@/shared/api/tauriChannels";
import type { RawUserProfileSummary } from "@/shared/api/tauriProfiles";

/** Slack's topic/purpose object. An untouched one is `""`/`""`/`0`. */
export type ApiNarrative = {
  value: string;
  creator: string;
  last_set: number;
};

export type ApiChannel = {
  id: string;
  name: string;
  creator: string;
  created: number;
  updated: number;
  is_archived: boolean;
  is_member: boolean;
  is_private: boolean;
  is_im: boolean;
  num_members: number;
  topic: ApiNarrative;
  purpose: ApiNarrative;
  /** Not a Slack field — a gear6 column the management sheet edits. */
  description: string;
};

const iso = (secs: number) => new Date(secs * 1000).toISOString();

/** gear6 reports "never set" as an empty string; buzz expects null. */
const orNull = (value: string | undefined) => value || null;

// gear6 (Slack) channel → buzz RawChannel. Slack has no forum type, so a normal
// channel is a "stream"; DMs map to "dm". Fields gear6 has no source for
// (participants, ttl) stay empty/neutral.
export function toRawChannel(c: ApiChannel): RawChannel {
  return {
    id: c.id,
    name: c.name,
    channel_type: c.is_im ? "dm" : "stream",
    visibility: c.is_private ? "private" : "open",
    description: c.description ?? "",
    topic: orNull(c.topic?.value),
    purpose: orNull(c.purpose?.value),
    member_count: c.num_members ?? 0,
    // The member list is a separate round trip (conversations.members); the
    // sidebar only needs the count.
    member_pubkeys: [],
    last_message_at: null,
    // `updated` is bumped by the archive itself, so it is the closest thing
    // gear6 has to "archived at".
    archived_at: c.is_archived ? iso(c.updated) : null,
    participants: [],
    participant_pubkeys: [],
    is_member: c.is_member,
    ttl_seconds: null,
    ttl_deadline: null,
  };
}

export function toRawChannelDetail(c: ApiChannel): RawChannelDetail {
  return {
    ...toRawChannel(c),
    created_by: c.creator,
    created_at: iso(c.created),
    updated_at: iso(c.updated),
    topic_set_by: orNull(c.topic?.creator),
    topic_set_at: c.topic?.last_set ? iso(c.topic.last_set) : null,
    purpose_set_by: orNull(c.purpose?.creator),
    purpose_set_at: c.purpose?.last_set ? iso(c.purpose.last_set) : null,
    topic_required: false,
    max_members: null,
    nip29_group_id: null,
  };
}

/**
 * Slack has no per-channel roles and `conversations.members` returns bare ids,
 * so the role is derived: the channel's creator is the owner and everyone else
 * is a member. That is all the management sheet gates on
 * (`useChannelModerationCapabilities` only asks for `role === "owner"`).
 *
 * `joined_at` is the channel's creation time — the join timestamp is stored but
 * not part of Slack's members response, and nothing renders it.
 */
export function toRawChannelMembers(
  ids: string[],
  channel: ApiChannel,
  profiles: Record<string, RawUserProfileSummary>,
): RawChannelMembersResponse {
  return {
    members: ids.map((pubkey) => {
      const profile = profiles[pubkey.toLowerCase()];
      return {
        pubkey,
        role: pubkey === channel.creator ? "owner" : "member",
        is_agent: profile?.is_agent ?? false,
        joined_at: iso(channel.created),
        display_name: profile?.display_name ?? null,
      };
    }),
    next_cursor: null,
  };
}
