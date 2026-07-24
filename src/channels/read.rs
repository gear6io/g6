//! Reading channels: `conversations.list`, `.info`, `.members`, and
//! `users.conversations`.

use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::api::{clamp_limit, metadata, paginate};
use crate::auth::Auth;
use crate::channels::{CHANNEL_COLS, ChannelArg, ChannelRow, load_channel};
use crate::slack::{
    ApiError, ApiResult, Args, decode_cursor, encode_cursor, lenient_bool, user_id,
};

#[derive(Deserialize)]
pub struct ListArgs {
    cursor: Option<String>,
    limit: Option<u32>,
    #[serde(default, deserialize_with = "lenient_bool")]
    exclude_archived: Option<bool>,
}

pub async fn conversations_list(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<ListArgs>,
) -> ApiResult {
    list_channels(&state, auth.id, a, false).await
}

/// Slack's `users.conversations` answers with the channels the caller is *in*;
/// `conversations.list` answers with every channel there is. Same rows, same
/// paging, one predicate apart.
pub async fn users_conversations(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<ListArgs>,
) -> ApiResult {
    // `user` and `types` are accepted and dropped by serde: gear6 has one
    // conversation type and no admin scope for reading someone else's list.
    list_channels(&state, auth.id, a, true).await
}

async fn list_channels(state: &AppState, viewer: i64, a: ListArgs, mine_only: bool) -> ApiResult {
    let limit = clamp_limit(a.limit);
    let after: i64 = match a.cursor.as_deref().filter(|c| !c.is_empty()) {
        Some(c) => decode_cursor(c)?
            .parse()
            .map_err(|_| ApiError("invalid_cursor"))?,
        None => 0,
    };

    // Both flags are restated as predicates rather than spliced into the SQL, so
    // there is exactly one query text and one bind order to reason about.
    let rows: Vec<ChannelRow> = sqlx::query_as(&format!(
        "SELECT {CHANNEL_COLS} FROM channels
          WHERE id > ?
            AND (NOT ? OR is_archived = 0)
            AND (NOT ? OR EXISTS(SELECT 1 FROM channel_members m
                                  WHERE m.channel_id = channels.id AND m.user_id = ?))
          ORDER BY id ASC LIMIT ?"
    ))
    .bind(viewer)
    .bind(after)
    .bind(a.exclude_archived.unwrap_or(false))
    .bind(mine_only)
    .bind(viewer)
    .bind(limit + 1)
    .fetch_all(&state.db)
    .await?;

    let (rows, has_more) = paginate(rows, limit);
    let next = has_more.then(|| encode_cursor(&rows.last().map_or(0, ChannelRow::id).to_string()));
    Ok(Json(json!({
        "ok": true,
        "channels": rows.iter().map(ChannelRow::to_json).collect::<Vec<_>>(),
        "response_metadata": metadata(next),
    })))
}

/// `include_num_members` is not declared: serde drops unknown arguments, and
/// `num_members` costs one indexed COUNT and is always included, so there is
/// nothing for the flag to switch off.
pub async fn conversations_info(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<ChannelArg>,
) -> ApiResult {
    let ch = load_channel(&state, a.id()?, auth.id).await?;
    Ok(Json(json!({ "ok": true, "channel": ch.to_json() })))
}

/// `channel` is spelled out rather than flattening `ChannelArg`: serde's
/// `flatten` collects into a map, which `serde_urlencoded` cannot deserialize —
/// and every form-encoded SDK call would fail with `invalid_arguments`.
#[derive(Deserialize)]
pub struct MembersArgs {
    channel: Option<String>,
    cursor: Option<String>,
    limit: Option<u32>,
}

/// Slack answers with bare user ids and no roles — it has no per-channel role
/// model, and neither does gear6. Clients that want an owner read the channel's
/// `creator` from `conversations.info`.
pub async fn conversations_members(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<MembersArgs>,
) -> ApiResult {
    let ch_id = crate::slack::parse_channel_id(a.channel.as_deref().unwrap_or(""))?;
    load_channel(&state, ch_id, auth.id).await?;
    let limit = clamp_limit(a.limit);

    let after: i64 = match a.cursor.as_deref().filter(|c| !c.is_empty()) {
        Some(c) => decode_cursor(c)?
            .parse()
            .map_err(|_| ApiError("invalid_cursor"))?,
        None => 0,
    };

    let rows: Vec<(i64,)> = sqlx::query_as(
        "SELECT user_id FROM channel_members
          WHERE channel_id = ? AND user_id > ? ORDER BY user_id ASC LIMIT ?",
    )
    .bind(ch_id)
    .bind(after)
    .bind(limit + 1)
    .fetch_all(&state.db)
    .await?;

    let (rows, has_more) = paginate(rows, limit);
    let next = has_more.then(|| encode_cursor(&rows.last().map_or(0, |r| r.0).to_string()));
    let members: Vec<Value> = rows.iter().map(|r| json!(user_id(r.0))).collect();
    Ok(Json(json!({
        "ok": true,
        "members": members,
        "response_metadata": metadata(next),
    })))
}
