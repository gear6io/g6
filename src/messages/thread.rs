//! Threads: a parent message and the replies hanging off it.
//!
//! gear6 keeps threads exactly one level deep, so a thread is fully named by its
//! root `ts` — `root` below is what turns any message in the thread into that key.

use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::api::{clamp_limit, metadata, paginate};
use crate::auth::Auth;
use crate::channels::load_channel;
use crate::messages::{MSG_COLS, MsgRow, mentions, reactions};
use crate::slack::{ApiError, ApiResult, Args, decode_cursor, encode_cursor, parse_channel_id};

#[derive(Deserialize)]
pub struct RepliesArgs {
    channel: Option<String>,
    ts: Option<String>,
    cursor: Option<String>,
    limit: Option<u32>,
}

pub async fn conversations_replies(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<RepliesArgs>,
) -> ApiResult {
    let ch_id = parse_channel_id(a.channel.as_deref().unwrap_or(""))?;
    load_channel(&state, ch_id, auth.id).await?;
    let limit = clamp_limit(a.limit);
    let ts = a.ts.as_deref().unwrap_or("");

    // `ts` may name any message in the thread, not just the parent.
    let root = root(&state, ch_id, ts)
        .await?
        .ok_or(ApiError("thread_not_found"))?;

    let after = match a.cursor.as_deref().filter(|c| !c.is_empty()) {
        Some(c) => decode_cursor(c)?,
        None => "0".to_string(),
    };

    // replies is OLDEST FIRST and pages forward — the opposite of history.
    let rows: Vec<MsgRow> = sqlx::query_as(&format!(
        "SELECT {MSG_COLS} FROM messages m
          WHERE m.channel_id = ? AND (m.thread_ts = ? OR m.ts = ?) AND m.ts > ?
          ORDER BY m.ts ASC LIMIT ?"
    ))
    .bind(ch_id)
    .bind(&root)
    .bind(&root)
    .bind(&after)
    .bind(limit + 1)
    .fetch_all(&state.db)
    .await?;

    let (rows, has_more) = paginate(rows, limit);
    let next = has_more.then(|| encode_cursor(rows.last().map_or("", |r| r.ts.as_str())));
    let mut messages: Vec<Value> = rows.iter().map(MsgRow::to_json).collect();
    mentions::decorate(&state.db, &mut messages).await?;
    reactions::decorate(&state.db, ch_id, &mut messages).await?;
    Ok(Json(json!({
        "ok": true,
        "messages": messages,
        "has_more": has_more,
        "response_metadata": metadata(next),
    })))
}

/// Resolve any message in a thread to the thread's root ts. Returns None if the
/// message does not exist in this channel.
pub(super) async fn root(
    state: &AppState,
    ch_id: i64,
    ts: &str,
) -> Result<Option<String>, ApiError> {
    let row: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT ts, thread_ts FROM messages WHERE channel_id = ? AND ts = ?")
            .bind(ch_id)
            .bind(ts)
            .fetch_optional(&state.db)
            .await?;
    Ok(row.map(|(ts, thread_ts)| thread_ts.unwrap_or(ts)))
}
