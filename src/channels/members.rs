//! Membership changes: `conversations.join`, `.leave`, `.invite` and `.kick`.

use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::auth::Auth;
use crate::channels::{ChannelArg, load_channel, membership_event, ok_channel};
use crate::slack::{ApiError, ApiResult, Args, now_secs, parse_user_id};

/// Slack caps `conversations.invite` at 1000 ids per call.
const MAX_INVITE: usize = 1000;

/// Adds a membership row, reporting whether it was actually new. `INSERT OR
/// IGNORE` rather than a SELECT-then-INSERT: the read and the write would
/// otherwise race two tabs of the same user against each other.
async fn add_member(state: &AppState, ch_id: i64, user: i64) -> Result<bool, ApiError> {
    let res = sqlx::query(
        "INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined) VALUES (?, ?, ?)",
    )
    .bind(ch_id)
    .bind(user)
    .bind(now_secs())
    .execute(&state.db)
    .await?;
    Ok(res.rows_affected() > 0)
}

async fn remove_member(state: &AppState, ch_id: i64, user: i64) -> Result<bool, ApiError> {
    let res = sqlx::query("DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?")
        .bind(ch_id)
        .bind(user)
        .execute(&state.db)
        .await?;
    Ok(res.rows_affected() > 0)
}

/// Any authenticated caller may join any channel — including a private one.
/// Membership is metadata here, not an access control list, so joining grants
/// nothing that reading the channel did not already grant.
pub async fn conversations_join(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<ChannelArg>,
) -> ApiResult {
    let id = a.id()?;
    load_channel(&state, id, auth.id).await?;

    if add_member(&state, id, auth.id).await? {
        membership_event(&state, "member_joined_channel", auth.id, id, None);
    }
    ok_channel(&state, id, auth.id).await
}

/// Leaving a channel you are not in is not an error in Slack, and is not one
/// here — the caller's intent ("I am not in this channel") already holds.
pub async fn conversations_leave(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<ChannelArg>,
) -> ApiResult {
    let id = a.id()?;
    load_channel(&state, id, auth.id).await?;

    if remove_member(&state, id, auth.id).await? {
        membership_event(&state, "member_left_channel", auth.id, id, None);
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct InviteArgs {
    channel: Option<String>,
    /// A comma-separated list of user ids, which is how Slack spells it.
    users: Option<String>,
}

/// Slack reports a partial failure by answering `ok: false` with a per-user
/// `errors` array *and* the channel — the caller needs to know which ids landed,
/// not just that something went wrong. A whole-call failure (bad channel, no
/// ids) still goes through `ApiError`.
pub async fn conversations_invite(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<InviteArgs>,
) -> ApiResult {
    let ch_id = crate::slack::parse_channel_id(a.channel.as_deref().unwrap_or(""))?;
    load_channel(&state, ch_id, auth.id).await?;

    let ids: Vec<&str> = a
        .users
        .as_deref()
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if ids.is_empty() {
        return Err(ApiError("no_user"));
    }
    if ids.len() > MAX_INVITE {
        return Err(ApiError("too_many_users"));
    }

    let mut errors: Vec<Value> = Vec::new();
    for raw in ids {
        let failure = match invite_one(&state, ch_id, auth.id, raw).await? {
            None => continue,
            Some(e) => e,
        };
        errors.push(json!({ "user": raw, "ok": false, "error": failure }));
    }

    let ch = load_channel(&state, ch_id, auth.id).await?;
    if errors.is_empty() {
        return Ok(Json(json!({ "ok": true, "channel": ch.to_json() })));
    }
    Ok(Json(json!({
        "ok": false,
        "error": "failed_for_some_users",
        "errors": errors,
        "channel": ch.to_json(),
    })))
}

/// `Ok(None)` on success, `Ok(Some(reason))` when this one id could not be
/// added. Only a database fault escapes as an `Err`.
async fn invite_one(
    state: &AppState,
    ch_id: i64,
    inviter: i64,
    raw: &str,
) -> Result<Option<&'static str>, ApiError> {
    let user = match parse_user_id(raw) {
        Ok(u) => u,
        Err(_) => return Ok(Some("user_not_found")),
    };
    if user == inviter {
        return Ok(Some("cant_invite_self"));
    }

    let exists: Option<(i64,)> = sqlx::query_as("SELECT id FROM users WHERE id = ?")
        .bind(user)
        .fetch_optional(&state.db)
        .await?;
    if exists.is_none() {
        return Ok(Some("user_not_found"));
    }

    if !add_member(state, ch_id, user).await? {
        return Ok(Some("already_in_channel"));
    }
    membership_event(state, "member_joined_channel", user, ch_id, Some(inviter));
    Ok(None)
}

#[derive(Deserialize)]
pub struct KickArgs {
    channel: Option<String>,
    user: Option<String>,
}

pub async fn conversations_kick(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<KickArgs>,
) -> ApiResult {
    let ch_id = crate::slack::parse_channel_id(a.channel.as_deref().unwrap_or(""))?;
    let user = parse_user_id(a.user.as_deref().unwrap_or(""))?;
    load_channel(&state, ch_id, auth.id).await?;

    // Slack refuses this and points you at conversations.leave, because kicking
    // yourself and leaving are different intents with different audit trails.
    if user == auth.id {
        return Err(ApiError("cant_kick_self"));
    }
    if !remove_member(&state, ch_id, user).await? {
        return Err(ApiError("not_in_channel"));
    }

    membership_event(&state, "member_left_channel", user, ch_id, None);
    Ok(Json(json!({ "ok": true })))
}
