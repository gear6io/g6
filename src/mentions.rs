//! Slack's mention tokens: `<@U00000001>`, `<#C00000001|general>`, `<!here>`.
//!
//! The grammar lives on the server so every client gets it for free — the web app
//! and any `slack_sdk` bot alike. Plain `@name` is encoded once, on write; readers
//! get the tokens verbatim in `text` (that is the wire format) plus a resolved
//! `mentions` sidecar, so nobody has to hold a roster to render a name.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};
use sqlx::SqlitePool;

use crate::slack::{ApiError, channel_id, user_id};

/// `@here` and friends address people without naming them, so they resolve to
/// nothing and need no lookup.
const BROADCASTS: [&str; 3] = ["here", "channel", "everyone"];

/// What a plain `@name` may contain. Usernames are validated against this set in
/// `auth.rs` and channel names are lowercased on create, so a candidate is folded
/// to lowercase before lookup — `@Astha` still finds `astha`.
fn is_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')
}

/// Every `@name` / `#name` that starts at a word boundary, as (byte range, sigil,
/// folded name). The boundary is what keeps `a@b.com` an email address.
///
/// ponytail: no markdown parsing, so a mention inside a code span encodes too.
/// Lift code spans out first if that ever actually bites.
fn candidates(text: &str) -> Vec<(std::ops::Range<usize>, char, String)> {
    let mut out = Vec::new();
    let mut at_boundary = true;
    for (i, c) in text.char_indices() {
        if at_boundary && (c == '@' || c == '#') {
            let start = i + 1;
            let mut end = text[start..]
                .find(|c: char| !is_name_char(c))
                .map_or(text.len(), |n| start + n);
            // "ping @astha." ends a sentence; it does not name a user called "astha.".
            while end > start && matches!(&text[end - 1..end], "." | "-" | "_") {
                end -= 1;
            }
            if end > start {
                out.push((i..end, c, text[start..end].to_lowercase()));
            }
        }
        at_boundary = c.is_whitespace();
    }
    out
}

/// Name -> id for the names that exist. Table and column are literals from the
/// call sites below; only the values are ever bound.
async fn ids_by_name(
    db: &SqlitePool,
    table: &str,
    col: &str,
    names: &HashSet<String>,
) -> Result<HashMap<String, i64>, ApiError> {
    if names.is_empty() {
        return Ok(HashMap::new());
    }
    let holes = vec!["?"; names.len()].join(",");
    let sql = format!("SELECT {col}, id FROM {table} WHERE {col} IN ({holes})");
    let mut q = sqlx::query_as::<_, (String, i64)>(&sql);
    for n in names {
        q = q.bind(n);
    }
    Ok(q.fetch_all(db).await?.into_iter().collect())
}

/// Rewrite plain `@name` / `#name` / `@here` into Slack tokens. Names that match
/// nothing are left exactly as they were typed.
///
/// ponytail: a channel name outside `is_name_char` never linkifies —
/// `conversations.create` only trims and lowercases, so `my chan` is creatable.
/// Tighten the create-time validation rather than the scanner here.
pub async fn encode(db: &SqlitePool, text: &str) -> Result<String, ApiError> {
    let found = candidates(text);
    if found.is_empty() {
        return Ok(text.to_owned());
    }

    let pick = |sigil: char| -> HashSet<String> {
        found
            .iter()
            .filter(|(_, s, n)| *s == sigil && !(sigil == '@' && BROADCASTS.contains(&n.as_str())))
            .map(|(_, _, n)| n.clone())
            .collect()
    };
    let users = ids_by_name(db, "users", "username", &pick('@')).await?;
    let channels = ids_by_name(db, "channels", "name", &pick('#')).await?;

    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for (range, sigil, name) in found {
        let token = match sigil {
            '@' if BROADCASTS.contains(&name.as_str()) => format!("<!{name}>"),
            '@' => match users.get(&name) {
                Some(id) => format!("<@{}>", user_id(*id)),
                None => continue,
            },
            _ => match channels.get(&name) {
                Some(id) => format!("<#{}|{}>", channel_id(*id), name),
                None => continue,
            },
        };
        out.push_str(&text[last..range.start]);
        out.push_str(&token);
        last = range.end;
    }
    out.push_str(&text[last..]);
    Ok(out)
}

/// The ids named by the tokens in one message, in order. `<!here>` resolves to
/// nothing, so it is skipped.
fn token_ids(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find('<') {
        rest = &rest[open + 1..];
        let Some(close) = rest.find('>') else { break };
        let id = rest[..close].split('|').next().unwrap_or("");
        if let Some(id) = id.strip_prefix('@').or_else(|| id.strip_prefix('#'))
            && !id.is_empty()
        {
            out.push(id);
        }
        rest = &rest[close + 1..];
    }
    out
}

/// Rendered id -> display name, one query per kind for the whole batch.
async fn names_by_id(db: &SqlitePool, ids: &HashSet<&str>) -> Result<HashMap<String, String>, ApiError> {
    let split = |prefix: char| -> Vec<i64> {
        ids.iter()
            .filter_map(|s| s.strip_prefix(prefix))
            .filter_map(|n| n.parse().ok())
            .collect()
    };

    let mut out = HashMap::new();
    for (table, col, prefix, render) in [
        ("users", "username", 'U', user_id as fn(i64) -> String),
        ("channels", "name", 'C', channel_id as fn(i64) -> String),
    ] {
        let wanted = split(prefix);
        if wanted.is_empty() {
            continue;
        }
        let holes = vec!["?"; wanted.len()].join(",");
        let sql = format!("SELECT id, {col} FROM {table} WHERE id IN ({holes})");
        let mut q = sqlx::query_as::<_, (i64, String)>(&sql);
        for id in &wanted {
            q = q.bind(id);
        }
        out.extend(q.fetch_all(db).await?.into_iter().map(|(id, name)| (render(id), name)));
    }
    Ok(out)
}

/// Attach a `mentions` object to every message that has any. Slack only decorates
/// a message with what applies to it, so a mention-free message gets no key.
pub async fn decorate(db: &SqlitePool, msgs: &mut [Value]) -> Result<(), ApiError> {
    let text_of = |m: &Value| m["text"].as_str().unwrap_or("").to_owned();
    let texts: Vec<String> = msgs.iter().map(text_of).collect();

    let ids: HashSet<&str> = texts.iter().flat_map(|t| token_ids(t)).collect();
    if ids.is_empty() {
        return Ok(());
    }
    let names = names_by_id(db, &ids).await?;

    for (msg, text) in msgs.iter_mut().zip(&texts) {
        let found: Map<String, Value> = token_ids(text)
            .into_iter()
            .filter_map(|id| names.get(id).map(|n| (id.to_owned(), Value::from(n.as_str()))))
            .collect();
        if !found.is_empty()
            && let Some(o) = msg.as_object_mut()
        {
            o.insert("mentions".into(), Value::Object(found));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    /// One connection: every pooled connection to `sqlite::memory:` gets its own
    /// private database, so migrations would vanish between calls.
    async fn db() -> SqlitePool {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&db).await.unwrap();
        sqlx::query("INSERT INTO users (id, username, password_hash, created) VALUES (1, 'astha', '', 0)")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO channels (id, name, creator_id, created) VALUES (1, 'dev_ops', 1, 0)")
            .execute(&db)
            .await
            .unwrap();
        db
    }

    #[tokio::test]
    async fn encodes_known_names_only() {
        let db = db().await;
        let enc = |s: &'static str| {
            let db = db.clone();
            async move { encode(&db, s).await.unwrap() }
        };

        assert_eq!(enc("hi @astha").await, "hi <@U00000001>");
        assert_eq!(enc("@astha").await, "<@U00000001>");
        assert_eq!(enc("see #dev_ops now").await, "see <#C00000001|dev_ops> now");
        assert_eq!(enc("@astha and #dev_ops").await, "<@U00000001> and <#C00000001|dev_ops>");
        assert_eq!(enc("@here").await, "<!here>");
        assert_eq!(enc("@channel @everyone").await, "<!channel> <!everyone>");
        // Case folds, sentence punctuation is not part of the name.
        assert_eq!(enc("ping @Astha.").await, "ping <@U00000001>.");

        // Left alone: unknown names, mid-word sigils, bare sigils.
        assert_eq!(enc("hi @nobody").await, "hi @nobody");
        assert_eq!(enc("mail a@b.com").await, "mail a@b.com");
        assert_eq!(enc("issue #42 and @").await, "issue #42 and @");
        assert_eq!(enc("no mentions here").await, "no mentions here");

        // Already-encoded text must survive a second pass unchanged.
        assert_eq!(enc("hi <@U00000001>").await, "hi <@U00000001>");
    }

    #[tokio::test]
    async fn decorates_with_resolved_names() {
        let db = db().await;
        let mut msgs = vec![
            json!({ "text": "hi <@U00000001> in <#C00000001|dev_ops>" }),
            json!({ "text": "nothing to see" }),
            json!({ "text": "<@U00000009> left the team" }),
            json!({ "text": "<!here> heads up" }),
        ];
        decorate(&db, &mut msgs).await.unwrap();

        assert_eq!(msgs[0]["mentions"], json!({ "U00000001": "astha", "C00000001": "dev_ops" }));
        assert!(msgs[1].get("mentions").is_none(), "no mentions means no key");
        assert!(msgs[2].get("mentions").is_none(), "a deleted id resolves to nothing");
        assert!(msgs[3].get("mentions").is_none(), "broadcasts name nobody");
    }
}
