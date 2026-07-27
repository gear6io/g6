//! Messages: the wire shape of one message, the two ways to read a page of them,
//! and the three ways to write one — post, update, delete.
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
    edited: Option<String>,
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
        // Slack's edit marker. `user` is the author because only the author can
        // edit — see the migration.
        if let Some(e) = &self.edited {
            o.insert(
                "edited".into(),
                json!({ "user": user_id(self.user_id), "ts": e }),
            );
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
pub(crate) const MSG_COLS: &str = "m.ts, m.user_id, m.thread_ts, m.text, m.edited,
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

#[derive(Deserialize)]
pub struct UpdateArgs {
    channel: Option<String>,
    ts: Option<String>,
    text: Option<String>,
}

/// The author of a message, or the Slack error a caller who may not touch it gets.
///
/// `denied` differs per method (`cant_update_message` / `cant_delete_message`) but
/// the rule behind both is the same: gear6 has no roles, so authorship is the
/// whole authorization model. A workspace admin cannot delete someone else's
/// message here, unlike in Slack.
async fn own_message(
    state: &AppState,
    auth: &Auth,
    ch_id: i64,
    ts: &str,
    denied: &'static str,
) -> Result<(), ApiError> {
    let author: Option<i64> =
        sqlx::query_scalar("SELECT user_id FROM messages WHERE channel_id = ? AND ts = ?")
            .bind(ch_id)
            .bind(ts)
            .fetch_optional(&state.db)
            .await?;
    match author.ok_or(ApiError("message_not_found"))? {
        a if a == auth.id => Ok(()),
        _ => Err(ApiError(denied)),
    }
}

/// One message by key, in the same shape a history page returns it — sidecars and
/// all, so an edited message answers with what a re-fetch would have produced.
async fn message_json(state: &AppState, ch_id: i64, ts: &str) -> Result<Value, ApiError> {
    let row: MsgRow = sqlx::query_as(&format!(
        "SELECT {MSG_COLS} FROM messages m WHERE m.channel_id = ? AND m.ts = ?"
    ))
    .bind(ch_id)
    .bind(ts)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError("message_not_found"))?;

    let mut msg = row.to_json();
    mentions::decorate(&state.db, std::slice::from_mut(&mut msg)).await?;
    reactions::decorate(&state.db, ch_id, std::slice::from_mut(&mut msg)).await?;
    Ok(msg)
}

/// `chat.update` — replace a message's text.
///
/// Only the text changes: an edit never re-parents a message, never changes its
/// `ts`, and never touches its reactions. Slack's `edit_window_closed` has no
/// counterpart, because gear6 sets no window.
pub async fn chat_update(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<UpdateArgs>,
) -> ApiResult {
    let ch_id = parse_channel_id(a.channel.as_deref().unwrap_or(""))?;
    load_channel(&state, ch_id, auth.id).await?;
    let ts = a.ts.unwrap_or_default();

    let text = a.text.unwrap_or_default();
    if text.is_empty() {
        return Err(ApiError("no_text"));
    }
    // Same order as the post path: linkify first, then measure what is stored.
    let text = mentions::encode(&state.db, &text).await?;
    if text.len() > MAX_TEXT {
        return Err(ApiError("msg_too_long"));
    }

    own_message(&state, &auth, ch_id, &ts, "cant_update_message").await?;

    let edited = now_ts();
    sqlx::query("UPDATE messages SET text = ?, edited = ? WHERE channel_id = ? AND ts = ?")
        .bind(&text)
        .bind(&edited)
        .bind(ch_id)
        .bind(&ts)
        .execute(&state.db)
        .await?;

    let message = message_json(&state, ch_id, &ts).await?;

    // Slack's edit frame: a `message` whose subtype says the payload is a
    // replacement rather than a new row, `hidden` so clients that do not
    // understand the subtype at least do not append it to the timeline.
    //
    // ponytail: no `previous_message`. Slack sends the pre-edit copy for clients
    // that render diffs; nothing in gear6 reads it, and carrying it means holding
    // the old row across the write for no consumer.
    let _ = state.tx.send(json!({
        "type": "message",
        "subtype": "message_changed",
        "hidden": true,
        "channel": channel_id(ch_id),
        "ts": edited,
        "message": message,
    }));

    Ok(Json(json!({
        "ok": true,
        "channel": channel_id(ch_id),
        "ts": ts,
        "text": text,
        "message": message,
    })))
}

#[derive(Deserialize)]
pub struct DeleteArgs {
    channel: Option<String>,
    ts: Option<String>,
}

/// `chat.delete` — remove a message, and a thread root's replies with it.
///
/// Deleting a root takes the thread down, which is what Slack's client warns
/// about before it calls this and the only outcome that leaves no unreachable
/// replies behind. Each removed message gets its own frame, so a client holding
/// the thread open drops every row rather than the head alone.
pub async fn chat_delete(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<DeleteArgs>,
) -> ApiResult {
    let ch_id = parse_channel_id(a.channel.as_deref().unwrap_or(""))?;
    load_channel(&state, ch_id, auth.id).await?;
    let ts = a.ts.unwrap_or_default();
    own_message(&state, &auth, ch_id, &ts, "cant_delete_message").await?;

    // `ts = ?` is the message; `thread_ts = ?` is its replies, and matches nothing
    // when it is a reply itself — threads are exactly one level deep, so a reply
    // is never anyone's parent. One predicate covers both cases.
    let mut tx = state.db.begin().await?;
    let removed: Vec<String> = sqlx::query_scalar(
        "SELECT ts FROM messages WHERE channel_id = ? AND (ts = ? OR thread_ts = ?)",
    )
    .bind(ch_id)
    .bind(&ts)
    .bind(&ts)
    .fetch_all(&mut *tx)
    .await?;

    // Reactions reference (channel_id, ts) with no ON DELETE clause, so they go
    // first or the message delete fails on the foreign key.
    for sql in [
        "DELETE FROM reactions WHERE channel_id = ?1
           AND ts IN (SELECT ts FROM messages
                       WHERE channel_id = ?1 AND (ts = ?2 OR thread_ts = ?2))",
        "DELETE FROM messages WHERE channel_id = ?1 AND (ts = ?2 OR thread_ts = ?2)",
    ] {
        sqlx::query(sql)
            .bind(ch_id)
            .bind(&ts)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    let event_ts = now_ts();
    for gone in &removed {
        let _ = state.tx.send(json!({
            "type": "message",
            "subtype": "message_deleted",
            "hidden": true,
            "channel": channel_id(ch_id),
            "deleted_ts": gone,
            "ts": event_ts,
        }));
    }

    Ok(Json(json!({
        "ok": true,
        "channel": channel_id(ch_id),
        "ts": ts,
    })))
}
