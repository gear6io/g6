//! Channels: the conversation object, its metadata, and its membership.
//!
//! Membership is metadata, not an access control list. `channel_members` answers
//! "who is in this channel" and drives `is_member`/`num_members`, but
//! `conversations.history` and `chat.postMessage` stay open to any authenticated
//! user — the same permissive read/write model the rest of gear6 has always had.

mod lifecycle;
mod members;
mod read;

pub use lifecycle::*;
pub use members::*;
pub use read::*;

use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::AppState;
use crate::slack::{ApiError, ApiResult, TEAM_ID, channel_id, user_id};

/// Slack's limit on a topic or a purpose. `description` is a gear6 field with no
/// Slack counterpart, and borrows the same bound.
const MAX_NARRATIVE: usize = 250;

#[derive(FromRow)]
pub struct ChannelRow {
    id: i64,
    name: String,
    creator_id: i64,
    created: i64,
    updated: i64,
    is_private: bool,
    is_archived: bool,
    description: String,
    topic: String,
    topic_creator: Option<i64>,
    topic_set: i64,
    purpose: String,
    purpose_creator: Option<i64>,
    purpose_set: i64,
    is_member: bool,
    num_members: i64,
}

/// The columns behind `ChannelRow`.
///
/// `is_member` is viewer-dependent and carries a bind, and it sits in the SELECT
/// list — which comes before the WHERE clause. So every query built on this
/// const must bind the viewer's user id FIRST, ahead of its own arguments.
pub const CHANNEL_COLS: &str = "id, name, creator_id, created, updated, is_private,
     is_archived, description, topic, topic_creator, topic_set,
     purpose, purpose_creator, purpose_set,
     EXISTS(SELECT 1 FROM channel_members m
             WHERE m.channel_id = channels.id AND m.user_id = ?) AS is_member,
     (SELECT COUNT(*) FROM channel_members m
       WHERE m.channel_id = channels.id) AS num_members";

/// Slack's topic and purpose are objects, not strings. An untouched one reports
/// an empty creator and a zero timestamp rather than being omitted.
fn narrative(value: &str, creator: Option<i64>, last_set: i64) -> Value {
    json!({
        "value": value,
        "creator": creator.map(user_id).unwrap_or_default(),
        "last_set": last_set,
    })
}

impl ChannelRow {
    /// The paging cursor for `conversations.list` is the row id.
    pub fn id(&self) -> i64 {
        self.id
    }

    pub fn is_archived(&self) -> bool {
        self.is_archived
    }

    pub fn to_json(&self) -> Value {
        json!({
            "id": channel_id(self.id),
            "name": self.name,
            // gear6 lowercases every name on the way in, so the normalized twin
            // is a copy — it exists because real bots read it.
            "name_normalized": self.name,
            "is_channel": true,
            "is_group": false,
            "is_im": false,
            "is_mpim": false,
            "is_private": self.is_private,
            "is_archived": self.is_archived,
            "is_member": self.is_member,
            "created": self.created,
            "updated": self.updated,
            "creator": user_id(self.creator_id),
            "num_members": self.num_members,
            // Renames are not journalled; the key exists so clients that read it
            // find a list rather than undefined.
            "previous_names": [],
            "topic": narrative(&self.topic, self.topic_creator, self.topic_set),
            "purpose": narrative(&self.purpose, self.purpose_creator, self.purpose_set),
            // Not a Slack field. The web client edits it alongside topic and
            // purpose; Slack clients ignore keys they do not know.
            "description": self.description,
        })
    }
}

pub async fn load_channel(state: &AppState, id: i64, viewer: i64) -> Result<ChannelRow, ApiError> {
    sqlx::query_as(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = ?"))
        .bind(viewer)
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError("channel_not_found"))
}

/// What almost every mutator answers with: the channel as it now stands.
async fn ok_channel(state: &AppState, id: i64, viewer: i64) -> ApiResult {
    let ch = load_channel(state, id, viewer).await?;
    Ok(axum::Json(json!({ "ok": true, "channel": ch.to_json() })))
}

/// Channel names are folded to lowercase and unique, so the same rules apply to
/// `conversations.create` and `conversations.rename`.
pub fn normalize_name(raw: &str) -> Result<String, ApiError> {
    let name = raw.trim().to_lowercase();
    if name.is_empty() || name.len() > 80 {
        return Err(ApiError("invalid_name"));
    }
    Ok(name)
}

#[derive(Deserialize)]
pub struct ChannelArg {
    channel: Option<String>,
}

impl ChannelArg {
    fn id(&self) -> Result<i64, ApiError> {
        crate::slack::parse_channel_id(self.channel.as_deref().unwrap_or(""))
    }
}

/// Slack's `admin.conversations.*` methods spell the argument `channel_id`, not
/// `channel`. Kept faithful so an SDK call lands unmodified.
#[derive(Deserialize)]
pub struct AdminChannelArg {
    channel_id: Option<String>,
}

impl AdminChannelArg {
    fn id(&self) -> Result<i64, ApiError> {
        crate::slack::parse_channel_id(self.channel_id.as_deref().unwrap_or(""))
    }
}

/// `member_joined_channel` / `member_left_channel`, in Slack's shape.
fn membership_event(state: &AppState, kind: &str, user: i64, ch: i64, inviter: Option<i64>) {
    let mut event = json!({
        "type": kind,
        "user": user_id(user),
        "channel": channel_id(ch),
        "channel_type": "C",
        "team": TEAM_ID,
    });
    if let Some(inviter) = inviter {
        event
            .as_object_mut()
            .unwrap()
            .insert("inviter".into(), json!(user_id(inviter)));
    }
    let _ = state.tx.send(event);
}
