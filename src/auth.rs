//! Username/password registration and login. These endpoints are NOT part of the
//! Slack API — Slack has no such concept — so they live outside `/api/` and simply
//! mint the bearer token that every `/api/*` method then requires.

use axum::Json;
use axum::extract::{FromRequestParts, State};
use axum::http::header;
use axum::http::request::Parts;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::AppState;
use crate::slack::{ApiError, ApiResult, Args, TEAM_ID, now_secs, user_id};

/// Tokens are 128 bits of CSPRNG output, so there is no low-entropy secret to
/// grind — a single SHA-256 is the right primitive. argon2 would be actively
/// wrong here: it runs on every single API call. Passwords are the opposite case
/// and stay on argon2 via `password_auth`.
fn token_hash(token: &str) -> String {
    B64.encode(Sha256::digest(token.as_bytes()))
}

fn new_token() -> String {
    let bytes: [u8; 16] = rand::random();
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("xoxb-{hex}")
}

pub struct Auth {
    pub id: i64,
    pub username: String,
    pub token_sha256: String,
}

impl FromRequestParts<AppState> for Auth {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        // Header only. Slack also permits a `token` body arg, but no current SDK
        // sends it that way, and reading it would mean consuming the body here.
        let token = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(ApiError("not_authed"))?;

        let hash = token_hash(token.trim());
        let row: Option<(i64, String)> = sqlx::query_as(
            "SELECT users.id, users.username FROM tokens
             JOIN users ON users.id = tokens.user_id
             WHERE tokens.token_sha256 = ?",
        )
        .bind(&hash)
        .fetch_optional(&state.db)
        .await?;

        let (id, username) = row.ok_or(ApiError("invalid_auth"))?;
        Ok(Auth { id, username, token_sha256: hash })
    }
}

#[derive(Deserialize)]
pub struct Credentials {
    username: String,
    password: String,
}

fn validate(c: &Credentials) -> Result<(&str, &str), ApiError> {
    if c.username.is_empty()
        || c.username.len() > 32
        || !c.username.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._-".contains(c))
    {
        return Err(ApiError("invalid_username"));
    }
    if c.password.len() < 8 {
        return Err(ApiError("password_too_short"));
    }
    Ok((&c.username, &c.password))
}

pub async fn register(State(state): State<AppState>, Args(c): Args<Credentials>) -> ApiResult {
    let (username, password) = validate(&c)?;

    // argon2 is CPU-bound by design; running it on the async runtime would stall
    // every other request on this worker.
    let password = password.to_owned();
    let hash = tokio::task::spawn_blocking(move || password_auth::generate_hash(&password))
        .await
        .map_err(|_| ApiError("internal_error"))?;

    let res = sqlx::query("INSERT INTO users (username, password_hash, created) VALUES (?, ?, ?)")
        .bind(username)
        .bind(&hash)
        .bind(now_secs())
        .execute(&state.db)
        .await;

    match res {
        Ok(r) => Ok(Json(json!({ "ok": true, "user_id": user_id(r.last_insert_rowid()) }))),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => Err(ApiError("name_taken")),
        Err(e) => Err(e.into()),
    }
}

pub async fn login(State(state): State<AppState>, Args(c): Args<Credentials>) -> ApiResult {
    let (username, password) = validate(&c)?;

    let row: Option<(i64, String)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE username = ?")
            .bind(username)
            .fetch_optional(&state.db)
            .await?;

    // Same generic failure for "no such user" and "wrong password" — the
    // distinction is only useful to someone enumerating accounts.
    let (id, hash) = row.ok_or(ApiError("invalid_auth"))?;
    let password = password.to_owned();
    let ok = tokio::task::spawn_blocking(move || password_auth::verify_password(&password, &hash).is_ok())
        .await
        .map_err(|_| ApiError("internal_error"))?;
    if !ok {
        return Err(ApiError("invalid_auth"));
    }

    let token = new_token();
    sqlx::query("INSERT INTO tokens (token_sha256, user_id, created) VALUES (?, ?, ?)")
        .bind(token_hash(&token))
        .bind(id)
        .bind(now_secs())
        .execute(&state.db)
        .await?;

    Ok(Json(json!({
        "ok": true,
        "token": token,
        "user_id": user_id(id),
        "team_id": TEAM_ID,
    })))
}

pub async fn logout(State(state): State<AppState>, auth: Auth) -> ApiResult {
    sqlx::query("DELETE FROM tokens WHERE token_sha256 = ?")
        .bind(&auth.token_sha256)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}
