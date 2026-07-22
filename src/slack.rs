//! Wire primitives shared by every method handler: the Slack error envelope, the
//! dual-encoding argument extractor, ID rendering, and cursor/ts encoding.

use axum::body::Bytes;
use axum::extract::{FromRequest, Request};
use axum::http::{Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde::de::DeserializeOwned;
use serde_json::json;

pub const TEAM_ID: &str = "T00000001";

pub fn team_name() -> String {
    std::env::var("GEAR6_TEAM_NAME").unwrap_or_else(|_| "gear6".into())
}

/// Slack reports failures in the body, not the status line: every method answers
/// HTTP 200 and the client branches on `ok`. Non-200 is reserved for rate limiting.
#[derive(Debug, Clone, Copy)]
pub struct ApiError(pub &'static str);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (StatusCode::OK, Json(json!({ "ok": false, "error": self.0 }))).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        eprintln!("db error: {e}");
        ApiError("internal_error")
    }
}

pub type ApiResult = Result<Json<serde_json::Value>, ApiError>;

/// Accepts arguments the way the real Slack SDKs send them.
///
/// `slack_sdk` and `@slack/web-api` post `application/x-www-form-urlencoded` by
/// default and switch to JSON for structured args, so both must work. GET has no
/// body at all and carries its args in the query string.
///
/// This consumes the body, so it implements `FromRequest`, not `FromRequestParts`,
/// and must therefore be the LAST parameter of a handler.
pub struct Args<T>(pub T);

impl<T, S> FromRequest<S> for Args<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let bad = || ApiError("invalid_arguments");

        if req.method() == Method::GET {
            let q = req.uri().query().unwrap_or("");
            return serde_urlencoded::from_str(q).map(Args).map_err(|_| bad());
        }

        // Both SDKs append "; charset=utf-8", so match on the media type prefix.
        let is_json = req
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|ct| ct.starts_with("application/json"));

        let body = Bytes::from_request(req, state).await.map_err(|_| bad())?;

        // An argument-less call sends Content-Length: 0 — and slack_sdk labels that
        // empty body `application/json`, which is not valid JSON. Empty means "no
        // arguments" regardless of the declared type; structs whose fields are all
        // Option deserialize fine from an empty query string.
        if body.is_empty() {
            return serde_urlencoded::from_str("").map(Args).map_err(|_| bad());
        }

        if is_json {
            serde_json::from_slice(&body).map(Args).map_err(|_| bad())
        } else {
            serde_urlencoded::from_bytes(&body).map(Args).map_err(|_| bad())
        }
    }
}

pub fn user_id(id: i64) -> String {
    format!("U{id:08}")
}

pub fn channel_id(id: i64) -> String {
    format!("C{id:08}")
}

fn parse_id(s: &str, prefix: char) -> Option<i64> {
    let rest = s.strip_prefix(prefix)?;
    rest.parse().ok()
}

/// A malformed ID is reported as "not found", never as a 400 — Slack surfaces it
/// through the envelope like any other lookup failure.
pub fn parse_user_id(s: &str) -> Result<i64, ApiError> {
    parse_id(s, 'U').ok_or(ApiError("user_not_found"))
}

pub fn parse_channel_id(s: &str) -> Result<i64, ApiError> {
    parse_id(s, 'C').ok_or(ApiError("channel_not_found"))
}

/// Slack's cursors are base64 of `next_ts:<ts>`. Matching the shape keeps them
/// opaque to clients that (correctly) treat them as blobs.
pub fn encode_cursor(ts: &str) -> String {
    B64.encode(format!("next_ts:{ts}"))
}

pub fn decode_cursor(cursor: &str) -> Result<String, ApiError> {
    let bad = ApiError("invalid_cursor");
    let raw = B64.decode(cursor).map_err(|_| bad)?;
    let s = String::from_utf8(raw).map_err(|_| bad)?;
    s.strip_prefix("next_ts:").map(str::to_owned).ok_or(bad)
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// A `ts` above any real message, used to seed the first (unbounded) page of
/// `conversations.history`, which pages backwards through time.
pub const TS_MAX: &str = "9999999999.999999";

pub fn now_ts() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:06}", d.as_secs(), d.subsec_micros())
}

/// Bump a ts by one microsecond, preserving the fixed width that makes string
/// ordering work. Used to break ties when two messages land in the same
/// microsecond, or when the wall clock jumps backwards.
pub fn ts_succ(ts: &str) -> String {
    let (secs, micros) = ts.split_once('.').unwrap_or((ts, "0"));
    let secs: u64 = secs.parse().unwrap_or(0);
    let micros: u32 = micros.parse().unwrap_or(0);
    if micros >= 999_999 {
        format!("{}.{:06}", secs + 1, 0)
    } else {
        format!("{}.{:06}", secs, micros + 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use serde::Deserialize;

    #[derive(Deserialize, Debug, PartialEq)]
    struct Sample {
        channel: String,
        limit: Option<u32>,
        inclusive: Option<bool>,
    }

    #[derive(Deserialize, Debug, PartialEq)]
    struct NoArgs {
        cursor: Option<String>,
    }

    async fn extract(req: Request) -> Result<Sample, ApiError> {
        Args::<Sample>::from_request(req, &()).await.map(|a| a.0)
    }

    // Every handler downstream assumes all three shapes work; a silent failure
    // here surfaces much later as something that looks like an auth bug.
    #[tokio::test]
    async fn args_accepts_query_form_and_json() {
        let want = Sample { channel: "C1".into(), limit: Some(5), inclusive: Some(true) };

        let get = Request::builder()
            .method(Method::GET)
            .uri("/api/x?channel=C1&limit=5&inclusive=true")
            .body(Body::empty())
            .unwrap();
        assert_eq!(extract(get).await.unwrap(), want);

        let form = Request::builder()
            .method(Method::POST)
            .uri("/api/x")
            .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded; charset=utf-8")
            .body(Body::from("channel=C1&limit=5&inclusive=true"))
            .unwrap();
        assert_eq!(extract(form).await.unwrap(), want);

        let json = Request::builder()
            .method(Method::POST)
            .uri("/api/x")
            .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
            .body(Body::from(r#"{"channel":"C1","limit":5,"inclusive":true}"#))
            .unwrap();
        assert_eq!(extract(json).await.unwrap(), want);

        let missing = Request::builder()
            .method(Method::GET)
            .uri("/api/x")
            .body(Body::empty())
            .unwrap();
        assert!(extract(missing).await.is_err());
    }

    /// slack_sdk sends an argument-less call as Content-Length: 0 labelled
    /// `application/json` — an empty body that is not valid JSON. Regression test
    /// for every no-arg method (auth.test, users.list, rtm.connect...).
    #[tokio::test]
    async fn args_accepts_empty_body_labelled_json() {
        let req = Request::builder()
            .method(Method::POST)
            .uri("/api/x")
            .header(header::CONTENT_TYPE, "application/json;charset=utf-8")
            .body(Body::empty())
            .unwrap();
        let got = Args::<NoArgs>::from_request(req, &()).await.map(|a| a.0);
        assert_eq!(got.unwrap(), NoArgs { cursor: None });
    }

    #[test]
    fn ids_and_cursors_round_trip() {
        assert_eq!(user_id(1), "U00000001");
        assert_eq!(channel_id(42), "C00000042");
        assert_eq!(parse_channel_id("C00000042").unwrap(), 42);
        assert!(parse_channel_id("U00000042").is_err());
        assert!(parse_channel_id("nonsense").is_err());

        let ts = "1739812345.000200";
        assert_eq!(decode_cursor(&encode_cursor(ts)).unwrap(), ts);
        assert!(decode_cursor("not-base64!").is_err());
    }

    #[test]
    fn ts_succ_keeps_width_and_order() {
        assert_eq!(ts_succ("1739812345.000200"), "1739812345.000201");
        assert_eq!(ts_succ("1739812345.999999"), "1739812346.000000");
        // the whole scheme rests on this
        assert!(ts_succ("1739812345.000200").as_str() > "1739812345.000200");
        assert!(now_ts().as_str() < TS_MAX);
    }
}
