//! Emoji reactions: `reactions.add`, `reactions.remove`, and the `reactions`
//! decoration Slack hangs off a message that has any.
//!
//! A reaction is stored as the emoji itself, not as a shortcode. Shortcodes are an
//! unstable naming layer over a stable character: `thumbsup` and `+1` are the same
//! 👍, sets rename entries between releases, and every client ships a different
//! table. Storing the character means one pill per emoji forever, no matter which
//! name a caller happened to use — so shortcodes are resolved on the way in and
//! never persisted.

use std::collections::HashMap;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::SqlitePool;

use crate::AppState;
use crate::auth::Auth;
use crate::channels::load_channel;
use crate::slack::{ApiError, ApiResult, Args, channel_id, now_ts, parse_channel_id, user_id};

/// Slack stops accepting new *distinct* emoji on a message at 50; the same emoji
/// from more people keeps counting up.
const MAX_DISTINCT: i64 = 50;

/// A custom-emoji shortcode is at most this many characters. Slack does not
/// publish a number; this is comfortably past the longest name in any emoji set.
const MAX_NAME: usize = 64;

/// Resolve what a caller sent to the single string this message keys the pill by.
///
/// Three shapes arrive, and the first two collapse onto one value:
/// - the emoji itself (`👍`), which the web client's picker produces;
/// - any shortcode naming it (`thumbsup`, `+1`, `:thumbsup:`), which is what
///   `slack_sdk` bots send;
/// - `:name:` matching no known emoji, which is a custom emoji — kept verbatim,
///   since there is no character to resolve it to (gear6 has no custom-emoji
///   store yet, so clients render these as the literal shortcode).
///
/// Lookups go through the `emojis` crate, whose entry is the canonical form, so
/// presentation variants of one character (`❤` and `❤️`) also land on one pill.
/// Skin tones stay distinct, exactly as they are distinct in Slack.
fn normalize_name(raw: &str) -> Result<String, ApiError> {
    let bad = ApiError("invalid_name");
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(bad);
    }

    // A bare character, or one written without its variation selector.
    if let Some(e) = emojis::get(trimmed).or_else(|| emojis::get(&format!("{trimmed}\u{fe0f}"))) {
        return Ok(e.as_str().to_owned());
    }

    // Exactly one wrapping pair, so `::` is not silently accepted as an empty name.
    let inner = trimmed
        .strip_prefix(':')
        .and_then(|s| s.strip_suffix(':'))
        .filter(|s| !s.is_empty())
        .unwrap_or(trimmed);
    let shortcode = inner.to_lowercase();

    if shortcode.chars().count() > MAX_NAME {
        return Err(bad);
    }
    if !shortcode
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '+' | '-'))
    {
        return Err(bad);
    }

    Ok(match emojis::get_by_shortcode(&shortcode) {
        Some(e) => e.as_str().to_owned(),
        // Unknown shortcode: a custom emoji, stored the way a client would render
        // it. ponytail: nothing validates that it exists — there is no registry to
        // check against until `emoji.list` has a backend.
        None => format!(":{shortcode}:"),
    })
}

#[derive(Deserialize)]
pub struct ReactionArgs {
    channel: Option<String>,
    /// Slack calls a message's key `timestamp` here and `ts` everywhere else.
    timestamp: Option<String>,
    name: Option<String>,
}

/// (channel row id, message ts, folded name, message author) — every check the
/// two handlers share, in the order Slack reports failures.
async fn target(
    state: &AppState,
    auth: &Auth,
    a: &ReactionArgs,
) -> Result<(i64, String, String, i64), ApiError> {
    let ch_id = parse_channel_id(a.channel.as_deref().unwrap_or(""))?;
    load_channel(state, ch_id, auth.id).await?;
    let name = normalize_name(a.name.as_deref().unwrap_or(""))?;
    let ts = a.timestamp.clone().unwrap_or_default();

    let author: Option<i64> =
        sqlx::query_scalar("SELECT user_id FROM messages WHERE channel_id = ? AND ts = ?")
            .bind(ch_id)
            .bind(&ts)
            .fetch_optional(&state.db)
            .await?;

    Ok((
        ch_id,
        ts,
        name,
        author.ok_or(ApiError("message_not_found"))?,
    ))
}

/// Slack's `reaction_added` / `reaction_removed` frame.
///
/// `reaction_ts` is a gear6 addition (Slack clients ignore keys they do not know):
/// the row's own `created`, which identifies *this* placement of the emoji rather
/// than the pair of people and emoji. A client that tracks reactions as individual
/// records needs it to tell a re-add apart from the add it followed — without it,
/// a removal and the next add are indistinguishable, and the removal wins forever.
fn broadcast(state: &AppState, kind: &str, actor: i64, r: (i64, &str, &str, i64, &str)) {
    let (ch_id, ts, name, author, created) = r;
    let _ = state.tx.send(json!({
        "type": kind,
        "user": user_id(actor),
        "reaction": name,
        "reaction_ts": created,
        "item_user": user_id(author),
        "item": { "type": "message", "channel": channel_id(ch_id), "ts": ts },
        "event_ts": now_ts(),
    }));
}

pub async fn reactions_add(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<ReactionArgs>,
) -> ApiResult {
    let (ch_id, ts, name, author) = target(&state, &auth, &a).await?;

    // Joining an emoji that is already on the message is always allowed; only a
    // 51st distinct one is refused. Both facts come from one scan.
    let (distinct, is_known): (i64, bool) = sqlx::query_as(
        "SELECT COUNT(DISTINCT name), COALESCE(MAX(name = ?), 0)
           FROM reactions WHERE channel_id = ? AND ts = ?",
    )
    .bind(&name)
    .bind(ch_id)
    .bind(&ts)
    .fetch_one(&state.db)
    .await?;
    if !is_known && distinct >= MAX_DISTINCT {
        return Err(ApiError("too_many_reactions"));
    }

    let created = now_ts();
    let insert = sqlx::query(
        "INSERT INTO reactions (channel_id, ts, user_id, name, created) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(ch_id)
    .bind(&ts)
    .bind(auth.id)
    .bind(&name)
    .bind(&created)
    .execute(&state.db)
    .await;

    match insert {
        Ok(_) => {}
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            return Err(ApiError("already_reacted"));
        }
        Err(e) => return Err(e.into()),
    }

    broadcast(
        &state,
        "reaction_added",
        auth.id,
        (ch_id, &ts, &name, author, &created),
    );
    Ok(Json(json!({ "ok": true })))
}

pub async fn reactions_remove(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<ReactionArgs>,
) -> ApiResult {
    let (ch_id, ts, name, author) = target(&state, &auth, &a).await?;

    // RETURNING, so the frame can name the row that just went away rather than
    // re-reading it.
    let created: Option<String> = sqlx::query_scalar(
        "DELETE FROM reactions
          WHERE channel_id = ? AND ts = ? AND user_id = ? AND name = ?
        RETURNING created",
    )
    .bind(ch_id)
    .bind(&ts)
    .bind(auth.id)
    .bind(&name)
    .fetch_optional(&state.db)
    .await?;

    let created = created.ok_or(ApiError("no_reaction"))?;

    broadcast(
        &state,
        "reaction_removed",
        auth.id,
        (ch_id, &ts, &name, author, &created),
    );
    Ok(Json(json!({ "ok": true })))
}

/// Attach a `reactions` array to every message in the page that has any, the way
/// `mentions::decorate` attaches its sidecar. A message with no reactions gets no
/// key, which is exactly what Slack does.
///
/// Emoji are ordered by when each first appeared on the message, and the users
/// inside one by when they joined it — Slack's order, and the order the web
/// client's pills expect.
///
/// `reaction_ts` runs parallel to `users` and is the gear6 extra described on
/// `broadcast`: one placement token per reactor, so a client can match a live
/// `reaction_removed` frame to the record it fetched here.
pub async fn decorate(db: &SqlitePool, ch_id: i64, msgs: &mut [Value]) -> Result<(), ApiError> {
    if msgs.is_empty() {
        return Ok(());
    }
    let holes = vec!["?"; msgs.len()].join(",");
    let sql = format!(
        "SELECT ts, name, user_id, created FROM reactions
          WHERE channel_id = ? AND ts IN ({holes})
          ORDER BY created ASC, name ASC, user_id ASC"
    );
    let mut q = sqlx::query_as::<_, (String, String, i64, String)>(&sql).bind(ch_id);
    for m in msgs.iter() {
        // Every message here came from `MsgRow::to_json`, so a missing or
        // non-string `ts` is a bug in the caller, not a page without reactions.
        q = q.bind(ts_of(m)?.to_owned());
    }

    // ts -> [(name, [(user, created)])], both in first-seen order, which the
    // ORDER BY above makes chronological.
    type Pill = (String, Vec<(String, String)>);
    let mut by_ts: HashMap<String, Vec<Pill>> = HashMap::new();
    for (ts, name, uid, created) in q.fetch_all(db).await? {
        let pills = by_ts.entry(ts).or_default();
        match pills.iter_mut().find(|(n, _)| *n == name) {
            Some((_, users)) => users.push((user_id(uid), created)),
            None => pills.push((name, vec![(user_id(uid), created)])),
        }
    }
    if by_ts.is_empty() {
        return Ok(());
    }

    for msg in msgs.iter_mut() {
        let Some(pills) = by_ts.get(ts_of(msg)?) else {
            continue;
        };
        let value: Vec<Value> = pills
            .iter()
            .map(|(name, reactors)| {
                let users: Vec<&str> = reactors.iter().map(|(u, _)| u.as_str()).collect();
                let stamps: Vec<&str> = reactors.iter().map(|(_, c)| c.as_str()).collect();
                json!({
                    "name": name,
                    "users": users,
                    "count": users.len(),
                    "reaction_ts": stamps,
                })
            })
            .collect();
        msg.as_object_mut()
            .ok_or(ApiError("internal_error"))?
            .insert("reactions".into(), Value::Array(value));
    }
    Ok(())
}

/// A message's key, or an error — never a silent "" that decorates nothing.
fn ts_of(msg: &Value) -> Result<&str, ApiError> {
    msg["ts"].as_str().ok_or_else(|| {
        eprintln!("message without a string ts: {msg}");
        ApiError("internal_error")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every way of naming 👍 has to reach the same stored value, or the same
    /// reaction splits into pills that can never merge.
    #[test]
    fn every_name_for_an_emoji_resolves_to_the_emoji() {
        for raw in [
            "👍",
            "  👍  ",
            "thumbsup",
            ":thumbsup:",
            "+1",
            ":+1:",
            "ThumbsUp",
        ] {
            assert_eq!(normalize_name(raw).unwrap(), "👍", "{raw}");
        }

        // The canonical entry carries its variation selector, so both spellings of
        // a presentation-variant emoji fold together.
        assert_eq!(normalize_name("❤️").unwrap(), normalize_name("❤").unwrap());
        // Skin tones are their own emoji, in gear6 as in Slack.
        assert_ne!(normalize_name("👍🏽").unwrap(), "👍");

        // An unknown shortcode is a custom emoji, kept as one.
        assert_eq!(normalize_name(":party_parrot:").unwrap(), ":party_parrot:");
        assert_eq!(normalize_name("party_parrot").unwrap(), ":party_parrot:");

        // Empty, colons alone, and anything outside the shortcode charset.
        for raw in [
            "",
            "   ",
            ":",
            "::",
            "thumbs up",
            ":gear 6:",
            &"x".repeat(65),
        ] {
            assert!(normalize_name(raw).is_err(), "{raw:?} must not be a name");
        }
    }
}
