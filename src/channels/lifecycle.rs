//! Creating a channel and everything that mutates it afterwards: rename, the
//! three narrative fields, archive/unarchive, and the `admin.conversations.*`
//! methods behind the web client's delete and visibility controls.

use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use serde_json::json;

use crate::AppState;
use crate::auth::Auth;
use crate::channels::{
    AdminChannelArg, ChannelArg, MAX_NARRATIVE, load_channel, normalize_name, ok_channel,
};
use crate::slack::{ApiError, ApiResult, Args, channel_id, now_secs, user_id};

#[derive(Deserialize)]
pub struct CreateArgs {
    name: Option<String>,
    #[serde(default, deserialize_with = "crate::slack::lenient_bool")]
    is_private: Option<bool>,
}

pub async fn conversations_create(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<CreateArgs>,
) -> ApiResult {
    let name = normalize_name(a.name.as_deref().unwrap_or(""))?;
    let now = now_secs();

    let mut tx = state.db.begin().await?;
    let res = sqlx::query(
        "INSERT INTO channels (name, creator_id, created, updated, is_private)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&name)
    .bind(auth.id)
    .bind(now)
    .bind(now)
    .bind(a.is_private.unwrap_or(false))
    .execute(&mut *tx)
    .await;

    let id = match res {
        Ok(r) => r.last_insert_rowid(),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            return Err(ApiError("name_taken"));
        }
        Err(e) => return Err(e.into()),
    };

    // Slack puts the creator in the channel. Same transaction as the insert:
    // a channel whose own creator is not a member is not a state worth having.
    sqlx::query("INSERT INTO channel_members (channel_id, user_id, joined) VALUES (?, ?, ?)")
        .bind(id)
        .bind(auth.id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let _ = state.tx.send(json!({
        "type": "channel_created",
        "channel": {
            "id": channel_id(id),
            "name": name,
            "created": now,
            "creator": user_id(auth.id),
        },
    }));

    ok_channel(&state, id, auth.id).await
}

#[derive(Deserialize)]
pub struct RenameArgs {
    channel: Option<String>,
    name: Option<String>,
}

pub async fn conversations_rename(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<RenameArgs>,
) -> ApiResult {
    let id = crate::slack::parse_channel_id(a.channel.as_deref().unwrap_or(""))?;
    let name = normalize_name(a.name.as_deref().unwrap_or(""))?;
    load_channel(&state, id, auth.id).await?;
    let now = now_secs();

    match sqlx::query("UPDATE channels SET name = ?, updated = ? WHERE id = ?")
        .bind(&name)
        .bind(now)
        .bind(id)
        .execute(&state.db)
        .await
    {
        Ok(_) => {}
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            return Err(ApiError("name_taken"));
        }
        Err(e) => return Err(e.into()),
    }

    let _ = state.tx.send(json!({
        "type": "channel_rename",
        "channel": { "id": channel_id(id), "name": name, "created": now },
    }));

    ok_channel(&state, id, auth.id).await
}

#[derive(Deserialize)]
pub struct NarrativeArgs {
    channel: Option<String>,
    topic: Option<String>,
    purpose: Option<String>,
    /// Not a Slack argument; see `conversations_set_description`.
    description: Option<String>,
}

pub async fn conversations_set_topic(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<NarrativeArgs>,
) -> ApiResult {
    let value = a.topic.clone().unwrap_or_default();
    set_narrative(&state, &auth, &a, "topic", value).await
}

pub async fn conversations_set_purpose(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<NarrativeArgs>,
) -> ApiResult {
    let value = a.purpose.clone().unwrap_or_default();
    set_narrative(&state, &auth, &a, "purpose", value).await
}

/// Topic and purpose differ only in which three columns they write, so the field
/// name is a literal chosen by the caller — never a value off the request. Same
/// discipline as `SETTABLE` in api.rs.
///
/// ponytail: Slack also files a `subtype: "channel_topic"` message into the
/// channel, which would mean allocating a real `ts` row. Clients refetch after
/// the mutation instead. Persist it as a message if a client ever wants the
/// history of who changed the topic.
async fn set_narrative(
    state: &AppState,
    auth: &Auth,
    a: &NarrativeArgs,
    field: &'static str,
    value: String,
) -> ApiResult {
    let id = crate::slack::parse_channel_id(a.channel.as_deref().unwrap_or(""))?;
    if value.chars().count() > MAX_NARRATIVE {
        return Err(ApiError("too_long"));
    }
    load_channel(state, id, auth.id).await?;

    let sql = format!(
        "UPDATE channels SET {field} = ?, {field}_creator = ?, {field}_set = ?, updated = ?
          WHERE id = ?"
    );
    let now = now_secs();
    sqlx::query(&sql)
        .bind(&value)
        .bind(auth.id)
        .bind(now)
        .bind(now)
        .bind(id)
        .execute(&state.db)
        .await?;

    ok_channel(state, id, auth.id).await
}

/// Not a Slack method. `description` is a gear6 column the web client edits
/// alongside topic and purpose, and it carries no creator/last_set pair because
/// nothing displays one.
pub async fn conversations_set_description(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<NarrativeArgs>,
) -> ApiResult {
    let id = crate::slack::parse_channel_id(a.channel.as_deref().unwrap_or(""))?;
    let value = a.description.unwrap_or_default();
    if value.chars().count() > MAX_NARRATIVE {
        return Err(ApiError("too_long"));
    }
    load_channel(&state, id, auth.id).await?;

    sqlx::query("UPDATE channels SET description = ?, updated = ? WHERE id = ?")
        .bind(&value)
        .bind(now_secs())
        .bind(id)
        .execute(&state.db)
        .await?;

    ok_channel(&state, id, auth.id).await
}

pub async fn conversations_archive(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<ChannelArg>,
) -> ApiResult {
    set_archived(&state, &auth, a.id()?, true).await
}

pub async fn conversations_unarchive(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<ChannelArg>,
) -> ApiResult {
    set_archived(&state, &auth, a.id()?, false).await
}

async fn set_archived(state: &AppState, auth: &Auth, id: i64, archived: bool) -> ApiResult {
    let ch = load_channel(state, id, auth.id).await?;
    if ch.is_archived() == archived {
        return Err(ApiError(if archived { "already_archived" } else { "not_archived" }));
    }

    sqlx::query("UPDATE channels SET is_archived = ?, updated = ? WHERE id = ?")
        .bind(archived)
        .bind(now_secs())
        .bind(id)
        .execute(&state.db)
        .await?;

    let _ = state.tx.send(json!({
        "type": if archived { "channel_archive" } else { "channel_unarchive" },
        "channel": channel_id(id),
        "user": user_id(auth.id),
    }));

    Ok(Json(json!({ "ok": true })))
}

/// The public Slack API has no `conversations.delete` — deletion lives on the
/// admin surface, and so does it here.
pub async fn admin_conversations_delete(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<AdminChannelArg>,
) -> ApiResult {
    let id = a.id()?;
    load_channel(&state, id, auth.id).await?;

    // `messages` references `channels` with no ON DELETE clause and sqlx turns
    // foreign keys on, so the children have to go first, in one transaction.
    let mut tx = state.db.begin().await?;
    for sql in [
        "DELETE FROM messages WHERE channel_id = ?",
        "DELETE FROM channel_members WHERE channel_id = ?",
        "DELETE FROM channels WHERE id = ?",
    ] {
        sqlx::query(sql).bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;

    let _ = state.tx.send(json!({ "type": "channel_deleted", "channel": channel_id(id) }));
    Ok(Json(json!({ "ok": true })))
}

pub async fn admin_conversations_convert_to_private(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<AdminChannelArg>,
) -> ApiResult {
    set_private(&state, &auth, a.id()?, true).await
}

pub async fn admin_conversations_convert_to_public(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<AdminChannelArg>,
) -> ApiResult {
    set_private(&state, &auth, a.id()?, false).await
}

/// Visibility is a flag on the row, not a re-key: membership is metadata rather
/// than an access control list, so converting a channel moves no data.
async fn set_private(state: &AppState, auth: &Auth, id: i64, private: bool) -> ApiResult {
    load_channel(state, id, auth.id).await?;
    sqlx::query("UPDATE channels SET is_private = ?, updated = ? WHERE id = ?")
        .bind(private)
        .bind(now_secs())
        .bind(id)
        .execute(&state.db)
        .await?;
    ok_channel(state, id, auth.id).await
}
