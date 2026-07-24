//! Messages: the wire shape of one message, the two ways to read a page of them,
//! and the one way to write one.
//!
//! The submodules are the things that hang off a message rather than replace it —
//! `mentions` and `reactions` decorate a page on the way out, `thread` reads one
//! conversation's worth of replies. All of them share `MsgRow`/`MSG_COLS` below.

pub mod mentions;
pub mod reactions;
mod thread;

pub use thread::conversations_replies;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::AppState;
use crate::api::{clamp_limit, metadata, paginate};
use crate::auth::Auth;
use crate::channels::load_channel;
use crate::slack::{
    ApiError, ApiResult, Args, TS_MAX, channel_id, decode_cursor, encode_cursor, lenient_bool,
    now_ts, parse_channel_id, ts_succ, user_id,
};

const MAX_TEXT: usize = 40_000;

#[derive(FromRow)]
pub(crate) struct MsgRow {
    ts: String,
    user_id: i64,
    thread_ts: Option<String>,
    text: String,
    reply_count: i64,
    latest_reply: Option<String>,
}

impl MsgRow {
    pub(crate) fn to_json(&self) -> Value {
        let mut v = json!({
            "type": "message",
            "user": user_id(self.user_id),
            "text": self.text,
            "ts": self.ts,
        });
        let o = v.as_object_mut().unwrap();
        if let Some(t) = &self.thread_ts {
            o.insert("thread_ts".into(), json!(t));
        }
        // Slack only decorates thread parents with these.
        if self.reply_count > 0 {
            o.insert("reply_count".into(), json!(self.reply_count));
            o.insert("latest_reply".into(), json!(self.latest_reply));
        }
        v
    }
}

/// Correlated subqueries rather than a GROUP BY join: both are covered by
/// idx_messages_thread(channel_id, thread_ts, ts), and this keeps the surrounding
/// query readable. `r.ts <> m.ts` excludes the parent from its own reply count.
pub(crate) const MSG_COLS: &str = "m.ts, m.user_id, m.thread_ts, m.text,
     (SELECT COUNT(*) FROM messages r
       WHERE r.channel_id = m.channel_id AND r.thread_ts = m.ts AND r.ts <> m.ts) AS reply_count,
     (SELECT MAX(r.ts) FROM messages r
       WHERE r.channel_id = m.channel_id AND r.thread_ts = m.ts AND r.ts <> m.ts) AS latest_reply";

#[derive(Deserialize)]
pub struct HistoryArgs {
    channel: Option<String>,
    cursor: Option<String>,
    limit: Option<u32>,
    oldest: Option<String>,
    latest: Option<String>,
    #[serde(default, deserialize_with = "lenient_bool")]
    inclusive: Option<bool>,
}

pub async fn conversations_history(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<HistoryArgs>,
) -> ApiResult {
    let ch_id = parse_channel_id(a.channel.as_deref().unwrap_or(""))?;
    // Existence check only. Membership is metadata, not an access control list:
    // any authenticated user may read any channel's history.
    load_channel(&state, ch_id, auth.id).await?;
    let limit = clamp_limit(a.limit);
    let inclusive = a.inclusive.unwrap_or(false);

    // history is NEWEST FIRST and its cursor walks backward in time, so the
    // cursor is an upper bound. A cursor always beats an explicit `latest`.
    let cursor = a.cursor.as_deref().filter(|c| !c.is_empty());
    let (upper, upper_op) = match cursor {
        Some(c) => (decode_cursor(c)?, "<"),
        None => match a.latest.filter(|l| !l.is_empty()) {
            Some(l) => (l, if inclusive { "<=" } else { "<" }),
            None => (TS_MAX.to_string(), "<="),
        },
    };
    let lower = a
        .oldest
        .filter(|o| !o.is_empty())
        .unwrap_or_else(|| "0".into());
    let lower_op = if inclusive { ">=" } else { ">" };

    // Operators come from the literals above, never from user input.
    let rows: Vec<MsgRow> = sqlx::query_as(&format!(
        "SELECT {MSG_COLS} FROM messages m
          WHERE m.channel_id = ?
            AND (m.thread_ts IS NULL OR m.thread_ts = m.ts)
            AND m.ts {upper_op} ? AND m.ts {lower_op} ?
          ORDER BY m.ts DESC LIMIT ?"
    ))
    .bind(ch_id)
    .bind(&upper)
    .bind(&lower)
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
        "pin_count": 0,
        "response_metadata": metadata(next),
    })))
}

#[derive(Deserialize)]
pub struct PostArgs {
    channel: Option<String>,
    text: Option<String>,
    thread_ts: Option<String>,
}

pub async fn chat_post_message(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<PostArgs>,
) -> ApiResult {
    let text = a.text.unwrap_or_default();
    if text.is_empty() {
        return Err(ApiError("no_text"));
    }

    let ch_id = parse_channel_id(a.channel.as_deref().unwrap_or(""))?;
    load_channel(&state, ch_id, auth.id).await?;

    // Linkify before the length check: "@astha" is stored as "<@U00000001>", and
    // what is stored is what the limit is about.
    let text = mentions::encode(&state.db, &text).await?;
    if text.len() > MAX_TEXT {
        return Err(ApiError("msg_too_long"));
    }

    // Replying to a reply re-parents to the real root, which is what Slack does
    // and what clients expect. Keeps threads exactly one level deep.
    let root = match a.thread_ts.as_deref().filter(|t| !t.is_empty()) {
        Some(t) => Some(
            thread::root(&state, ch_id, t)
                .await?
                .ok_or(ApiError("thread_not_found"))?,
        ),
        None => None,
    };

    let mut tx = state.db.begin().await?;

    // Wall clock can repeat or jump backwards; ts must be unique and increasing
    // per channel, so fall back to one microsecond past the current maximum.
    let max_ts: Option<String> =
        sqlx::query_scalar("SELECT MAX(ts) FROM messages WHERE channel_id = ?")
            .bind(ch_id)
            .fetch_one(&mut *tx)
            .await?;
    let mut ts = now_ts();
    if let Some(max) = max_ts
        && ts <= max
    {
        ts = ts_succ(&max);
    }

    sqlx::query(
        "INSERT INTO messages (channel_id, ts, user_id, thread_ts, text) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(ch_id)
    .bind(&ts)
    .bind(auth.id)
    .bind(&root)
    .bind(&text)
    .execute(&mut *tx)
    .await?;

    // Promote the parent: Slack sets thread_ts == ts on a message once it has a reply.
    if let Some(root) = &root {
        sqlx::query(
            "UPDATE messages SET thread_ts = ts
              WHERE channel_id = ? AND ts = ? AND thread_ts IS NULL",
        )
        .bind(ch_id)
        .bind(root)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let mut message = json!({
        "type": "message",
        "user": user_id(auth.id),
        "text": text,
        "ts": ts,
    });
    if let Some(root) = &root {
        message
            .as_object_mut()
            .unwrap()
            .insert("thread_ts".into(), json!(root));
    }
    // Before the clone, so the websocket echo carries the sidecar too.
    mentions::decorate(&state.db, std::slice::from_mut(&mut message)).await?;

    let mut event = message.clone();
    event
        .as_object_mut()
        .unwrap()
        .insert("channel".into(), json!(channel_id(ch_id)));
    let _ = state.tx.send(event); // Err just means nobody is listening.

    Ok(Json(json!({
        "ok": true,
        "channel": channel_id(ch_id),
        "ts": ts,
        "message": message,
    })))
}
