//! The Slack Web API method handlers for users, profiles, presence and auth.
//! Channels live in `channels`, messages and what hangs off them in `messages`.
//!
//! Every handler returns HTTP 200 and reports failure inside the body via
//! `ApiError`. Handler signatures put `Args<T>` last because it consumes the body.

use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sqlx::FromRow;

use crate::AppState;
use crate::auth::{Auth, normalize_email};
use crate::slack::{
    ApiError, ApiResult, Args, TEAM_ID, decode_cursor, encode_cursor, lenient_bool, now_secs,
    parse_user_id, team_name, user_id,
};

const DEFAULT_LIMIT: u32 = 100;
const MAX_LIMIT: u32 = 1000;

/// Shared with `channels`, which pages the same way.
pub(crate) fn clamp_limit(limit: Option<u32>) -> u32 {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

/// Fetch one extra row to learn whether another page exists, then drop it.
/// Cheaper and simpler than a second COUNT(*) query.
pub(crate) fn paginate<T>(mut rows: Vec<T>, limit: u32) -> (Vec<T>, bool) {
    let has_more = rows.len() > limit as usize;
    rows.truncate(limit as usize);
    (rows, has_more)
}

pub(crate) fn metadata(next_cursor: Option<String>) -> Value {
    json!({ "next_cursor": next_cursor.unwrap_or_default() })
}

// ---------------------------------------------------------------- users, auth, rtm

#[derive(FromRow)]
pub struct UserRow {
    id: i64,
    username: String,
    updated: i64,
    display_name: String,
    real_name: String,
    title: String,
    status_text: String,
    status_emoji: String,
    status_expiration: i64,
    email: Option<String>,
}

pub const USER_COLS: &str = "id, username, updated, display_name, real_name,
     title, status_text, status_emoji, status_expiration, email";

impl UserRow {
    /// Slack's profile object. No `image_*`: the backend stores no avatars, and the
    /// web client derives initials and a colour from the id (`avatarOf` in format.ts).
    ///
    /// The `_normalized` twins are copies. They exist because real bots read them.
    fn profile(&self) -> Value {
        json!({
            "display_name": self.display_name,
            "display_name_normalized": self.display_name,
            "real_name": self.real_name,
            "real_name_normalized": self.real_name,
            "title": self.title,
            "status_text": self.status_text,
            "status_emoji": self.status_emoji,
            "status_expiration": self.status_expiration,
            "email": self.email,
        })
    }

    /// What a client shows when it has room for exactly one name. Same fallback
    /// order Slack uses, kept on the server so bots do not each reinvent it.
    fn label(&self) -> &str {
        [&self.display_name, &self.real_name, &self.username]
            .into_iter()
            .find(|s| !s.is_empty())
            .unwrap()
    }

    pub fn to_json(&self) -> Value {
        json!({
            "id": user_id(self.id),
            "team_id": TEAM_ID,
            "name": self.username,
            "real_name": self.real_name,
            "deleted": false,
            "is_bot": false,
            "updated": self.updated,
            "profile": self.profile(),
        })
    }
}

pub async fn load_user(state: &AppState, id: i64) -> Result<UserRow, ApiError> {
    sqlx::query_as(&format!("SELECT {USER_COLS} FROM users WHERE id = ?"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError("user_not_found"))
}

#[derive(Deserialize)]
pub struct UsersListArgs {
    cursor: Option<String>,
    limit: Option<u32>,
    /// Slack's (deprecated, but still honoured) flag. Worth keeping: without it a
    /// fresh client shows nobody as active until the first `presence_change` lands.
    #[serde(default, deserialize_with = "lenient_bool")]
    presence: Option<bool>,
}

pub async fn users_list(
    State(state): State<AppState>,
    _auth: Auth,
    Args(a): Args<UsersListArgs>,
) -> ApiResult {
    let limit = clamp_limit(a.limit);
    let after: i64 = match a.cursor.as_deref().filter(|c| !c.is_empty()) {
        Some(c) => decode_cursor(c)?
            .parse()
            .map_err(|_| ApiError("invalid_cursor"))?,
        None => 0,
    };

    let rows: Vec<UserRow> = sqlx::query_as(&format!(
        "SELECT {USER_COLS} FROM users WHERE id > ? ORDER BY id ASC LIMIT ?"
    ))
    .bind(after)
    .bind(limit + 1)
    .fetch_all(&state.db)
    .await?;

    let (rows, has_more) = paginate(rows, limit);
    let next = has_more.then(|| encode_cursor(&rows.last().map_or(0, |r| r.id).to_string()));
    let members: Vec<Value> = rows
        .iter()
        .map(|r| {
            let mut v = r.to_json();
            if a.presence.unwrap_or(false) {
                v.as_object_mut()
                    .unwrap()
                    .insert("presence".into(), json!(state.presence_of(r.id)));
            }
            v
        })
        .collect();
    Ok(Json(json!({
        "ok": true,
        "members": members,
        "response_metadata": metadata(next),
    })))
}

#[derive(Deserialize)]
pub struct UserArg {
    user: Option<String>,
}

impl UserArg {
    /// Every `users.*` method that takes a `user` defaults to the caller.
    fn or_self(&self, auth: &Auth) -> Result<i64, ApiError> {
        match self.user.as_deref().filter(|u| !u.is_empty()) {
            Some(u) => parse_user_id(u),
            None => Ok(auth.id),
        }
    }
}

pub async fn users_info(
    State(state): State<AppState>,
    _auth: Auth,
    Args(a): Args<UserArg>,
) -> ApiResult {
    let id = parse_user_id(a.user.as_deref().unwrap_or(""))?;
    Ok(Json(
        json!({ "ok": true, "user": load_user(&state, id).await?.to_json() }),
    ))
}

#[derive(Deserialize)]
pub struct EmailArg {
    email: Option<String>,
}

pub async fn users_lookup_by_email(
    State(state): State<AppState>,
    _auth: Auth,
    Args(a): Args<EmailArg>,
) -> ApiResult {
    // Addresses are stored folded, so fold the needle too rather than adding a
    // COLLATE that would also silently disable the unique index.
    let email = normalize_email(a.email.as_deref().unwrap_or(""))?;
    let row: Option<UserRow> =
        sqlx::query_as(&format!("SELECT {USER_COLS} FROM users WHERE email = ?"))
            .bind(&email)
            .fetch_optional(&state.db)
            .await?;
    let user = row.ok_or(ApiError("users_not_found"))?;
    Ok(Json(json!({ "ok": true, "user": user.to_json() })))
}

// ---------------------------------------------------------------- profile

pub async fn users_profile_get(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<UserArg>,
) -> ApiResult {
    let user = load_user(&state, a.or_self(&auth)?).await?;
    Ok(Json(json!({ "ok": true, "profile": user.profile() })))
}

/// Settable profile fields and their maximum length in characters. The column names
/// below come from this table — literals — and never from the request; only values
/// are ever bound. Same discipline as `ids_by_name` in messages/mentions.rs.
const SETTABLE: [(&str, usize); 7] = [
    ("display_name", 80),
    ("real_name", 80),
    ("title", 80),
    ("status_text", 100),
    ("status_emoji", 100),
    ("status_expiration", 20),
    ("email", 255),
];

#[derive(Deserialize)]
pub struct ProfileSetArgs {
    user: Option<String>,
    profile: Option<Value>,
    name: Option<String>,
    value: Option<String>,
}

/// Slack accepts a whole `profile` object or a single `name`/`value` pair, and the
/// SDKs use both. Form-encoded callers send `profile` as a JSON *string*, JSON
/// callers send it as an object, so both shapes have to be unwrapped here.
fn submitted(a: &ProfileSetArgs) -> Result<Map<String, Value>, ApiError> {
    let bad = ApiError("invalid_profile");
    match (&a.profile, &a.name) {
        (Some(p), _) => {
            let parsed;
            let obj = match p {
                Value::String(s) => {
                    parsed = serde_json::from_str(s).map_err(|_| bad)?;
                    &parsed
                }
                other => other,
            };
            obj.as_object().cloned().ok_or(bad)
        }
        (None, Some(name)) => Ok([(name.clone(), json!(a.value.clone().unwrap_or_default()))]
            .into_iter()
            .collect()),
        (None, None) => Err(bad),
    }
}

/// Whitelist, coerce and validate, returning (column, bound value) pairs.
///
/// Everything binds as `Option<String>`: SQLite's INTEGER affinity converts
/// `status_expiration` on the way in, and an empty email must land as NULL so the
/// partial unique index does not treat two blank addresses as a collision.
fn validated(fields: Map<String, Value>) -> Result<Vec<(&'static str, Option<String>)>, ApiError> {
    let bad = ApiError("invalid_profile");
    let mut out = Vec::new();

    for (key, v) in fields {
        let (col, max) = SETTABLE.iter().find(|(c, _)| *c == key).ok_or(bad)?;
        let val = match v {
            Value::String(s) => s.trim().to_owned(),
            Value::Number(n) => n.to_string(),
            Value::Null => String::new(),
            _ => return Err(bad),
        };
        if val.chars().count() > *max {
            return Err(bad);
        }

        let bound = match *col {
            // Slack stores the shortcode, never the glyph.
            "status_emoji" if !val.is_empty() && !is_shortcode(&val) => return Err(bad),
            "status_expiration" if val.is_empty() => Some("0".into()),
            "status_expiration" if val.parse::<i64>().is_err() => return Err(bad),
            "email" if val.is_empty() => None,
            "email" => Some(normalize_email(&val)?),
            _ => Some(val),
        };
        out.push((*col, bound));
    }

    if out.is_empty() {
        return Err(bad);
    }
    Ok(out)
}

fn is_shortcode(s: &str) -> bool {
    s.len() > 2 && s.starts_with(':') && s.ends_with(':') && !s[1..s.len() - 1].contains(':')
}

pub async fn users_profile_set(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<ProfileSetArgs>,
) -> ApiResult {
    // Slack needs an admin scope to write someone else's profile, and gear6 has no
    // roles model, so nobody has it.
    //
    // ponytail: add `is_admin` to `users` if that ever changes.
    if let Some(u) = a.user.as_deref().filter(|u| !u.is_empty())
        && parse_user_id(u)? != auth.id
    {
        return Err(ApiError("cannot_update_admin_user"));
    }

    let cols = validated(submitted(&a)?)?;
    let assignments = cols
        .iter()
        .map(|(c, _)| format!("{c} = ?"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("UPDATE users SET {assignments}, updated = ? WHERE id = ?");
    let mut q = sqlx::query(&sql);
    for (_, v) in &cols {
        q = q.bind(v.clone());
    }

    match q.bind(now_secs()).bind(auth.id).execute(&state.db).await {
        Ok(_) => {}
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            return Err(ApiError("email_taken"));
        }
        Err(e) => return Err(e.into()),
    }

    let user = load_user(&state, auth.id).await?;
    let _ = state
        .tx
        .send(json!({ "type": "user_change", "user": user.to_json() }));
    Ok(Json(
        json!({ "ok": true, "username": user.username, "profile": user.profile() }),
    ))
}

// ---------------------------------------------------------------- presence

pub async fn users_get_presence(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<UserArg>,
) -> ApiResult {
    let id = a.or_self(&auth)?;
    let presence = state.presence_of(id);

    // Slack tells you the details of your own presence and nobody else's.
    if id != auth.id {
        return Ok(Json(json!({ "ok": true, "presence": presence })));
    }
    let (connections, manual_away) = state.presence_state(id);
    Ok(Json(json!({
        "ok": true,
        "presence": presence,
        "online": connections > 0,
        "auto_away": connections == 0,
        "manual_away": manual_away,
        "connection_count": connections,
    })))
}

#[derive(Deserialize)]
pub struct PresenceArg {
    presence: Option<String>,
}

pub async fn users_set_presence(
    State(state): State<AppState>,
    auth: Auth,
    Args(a): Args<PresenceArg>,
) -> ApiResult {
    let away = match a.presence.as_deref() {
        Some("away") => true,
        Some("auto") => false,
        _ => return Err(ApiError("invalid_presence")),
    };
    state.set_manual_away(auth.id, away);
    state.broadcast_presence(auth.id);
    Ok(Json(json!({ "ok": true })))
}

pub async fn auth_test(auth: Auth) -> ApiResult {
    Ok(Json(json!({
        "ok": true,
        "url": crate::public_url(),
        "team": team_name(),
        "user": auth.username,
        "team_id": TEAM_ID,
        "user_id": user_id(auth.id),
    })))
}

/// The OpenID-flavoured cousin of `auth.test`: the same identity, shaped the way
/// "Sign in with Slack" clients expect it.
pub async fn users_identity(State(state): State<AppState>, auth: Auth) -> ApiResult {
    let user = load_user(&state, auth.id).await?;
    Ok(Json(json!({
        "ok": true,
        "user": { "id": user_id(user.id), "name": user.label(), "email": user.email },
        "team": { "id": TEAM_ID, "name": team_name() },
    })))
}

pub async fn rtm_connect(State(state): State<AppState>, auth: Auth) -> ApiResult {
    let ticket = state.mint_ticket(auth.id);
    Ok(Json(json!({
        "ok": true,
        "url": format!("{}/rtm?ticket={}", crate::public_ws_url(), ticket),
        "self": { "id": user_id(auth.id), "name": auth.username },
        "team": { "id": TEAM_ID, "name": team_name(), "domain": team_name() },
    })))
}
