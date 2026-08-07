//! A deliberately narrow read-only gateway to G6 Cloud.
//!
//! The desktop webview never learns a Cloud origin: it calls this backend, and
//! this backend calls Cloud. That is the whole point, so there is no generic
//! proxy route, no dynamic upstream URL, and no route-map DSL here — just three
//! fixed GETs whose upstream paths are compiled in.
//!
//! Unlike the Slack-compatible surface next door, `/api/cloud` is NOT Slack
//! shaped: it keeps Cloud's status semantics instead of answering 200 with
//! `{ok: false}`, because Cloud's own contract branches on status + `error.code`
//! and flattening that would throw away the only machine-readable signal.

use std::time::Duration;

use axum::extract::{Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use reqwest::Url;
use serde::Deserialize;
use serde_json::json;

use crate::AppState;
use crate::auth::Auth;

/// Cloud's own default request timeout is 10s and it answers 504 itself. Ours is
/// deliberately longer so that a slow-but-alive Cloud reports its own timeout
/// rather than being masked by ours.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);

/// The webview gets a bounded body or an error. A page of 100 signals is tens of
/// KiB; a megabyte means the upstream is not the API we think it is.
const MAX_BODY: usize = 1024 * 1024;

/// The fixed upstream allowlist. Relative (no leading slash) so a base URL with a
/// path prefix — which a future router in front of Cloud will have — is preserved.
const HEALTHZ: &str = "healthz";
const OPEN_DECISIONS: &str = "v1/open-decisions";
const OPEN_CONSTRAINTS: &str = "v1/open-constraints";

#[derive(Clone)]
pub struct Cloud {
    /// `None` = not configured. The rest of the backend still runs; only this
    /// gateway is unavailable.
    base: Option<Url>,
    client: reqwest::Client,
}

impl Cloud {
    pub fn from_env() -> Self {
        Cloud::new(std::env::var("GEAR6_CLOUD_BASE_URL").ok().as_deref())
    }

    /// Panics on a configured-but-unusable URL, matching `GEAR6_CORS_ORIGIN`: a
    /// typo that silently disables Cloud is worse than a process that refuses to
    /// start and says why. An absent value is not an error.
    pub fn new(base: Option<&str>) -> Self {
        let base = base
            .map(str::trim)
            .filter(|raw| !raw.is_empty())
            .map(|raw| match parse_base(raw) {
                Ok(url) => url,
                Err(why) => panic!("GEAR6_CLOUD_BASE_URL {why}"),
            });

        Cloud {
            base,
            client: reqwest::Client::builder()
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(REQUEST_TIMEOUT)
                // Not followed: a redirect would send this backend's request to an
                // origin nobody configured.
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("reqwest client with no TLS overrides always builds"),
        }
    }

    fn url(&self, path: &str) -> Result<Url, GatewayError> {
        let base = self
            .base
            .as_ref()
            .ok_or_else(GatewayError::not_configured)?;
        base.join(path).map_err(|_| GatewayError::not_configured())
    }
}

/// Absolute http(s), no credentials, no query, no fragment, normalized to a
/// trailing slash so `Url::join` appends instead of replacing the last segment.
fn parse_base(raw: &str) -> Result<Url, &'static str> {
    let mut url = Url::parse(raw).map_err(|_| "must be an absolute URL")?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("must use the http or https scheme");
    }
    if url.host_str().is_none() {
        return Err("must have a host");
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("must not carry credentials");
    }
    if url.query().is_some() {
        return Err("must not carry a query string");
    }
    if url.fragment().is_some() {
        return Err("must not carry a fragment");
    }
    if !url.path().ends_with('/') {
        let with_slash = format!("{}/", url.path());
        url.set_path(&with_slash);
    }
    Ok(url)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/open-decisions", get(open_decisions))
        .route("/v1/open-constraints", get(open_constraints))
}

/// The only three query parameters that reach Cloud. `limit` is a string, not a
/// number: forwarding it verbatim lets Cloud answer its own `400 invalid_limit`
/// instead of this gateway inventing a second, differently-worded rejection.
/// Anything else the webview sends is dropped by serde and never forwarded.
#[derive(Deserialize)]
pub struct ListQuery {
    entity_id: Option<String>,
    limit: Option<String>,
    cursor: Option<String>,
}

impl ListQuery {
    fn apply(&self, url: &mut Url) {
        let pairs = [
            ("entity_id", &self.entity_id),
            ("limit", &self.limit),
            // Opaque by contract: passed back exactly as received, never decoded,
            // stored, or regenerated.
            ("cursor", &self.cursor),
        ];
        // `query_pairs_mut` leaves a bare `?` behind even when nothing is
        // appended, so it is only entered when there is something to append.
        if pairs.iter().all(|(_, value)| value.is_none()) {
            return;
        }
        let mut q = url.query_pairs_mut();
        for (key, value) in pairs {
            if let Some(value) = value {
                q.append_pair(key, value);
            }
        }
    }
}

/// Readiness only, so it stays unauthenticated: it reveals whether a service is
/// up and nothing else, and the Cloud root has to be able to boot before this
/// backend has any notion of a logged-in local user.
async fn healthz(State(state): State<AppState>) -> Response {
    match relay_healthz(&state).await {
        Ok(res) => res,
        Err(e) => e.into_response(),
    }
}

async fn relay_healthz(state: &AppState) -> Result<Response, GatewayError> {
    let url = state.cloud.url(HEALTHZ)?;
    let res = send(state, HEALTHZ, url).await?;
    let status = res.status();

    // Cloud answers readiness in plain text: 200 "ok" or 503 "read model unavailable".
    if !matches!(status.as_u16(), 200 | 503) || !content_type_is(&res, "text/plain") {
        log(HEALTHZ, "invalid_response", Some(status));
        return Err(GatewayError::invalid_response());
    }

    let body = body_capped(HEALTHZ, res).await?;
    Ok((
        StatusCode::from_u16(status.as_u16()).expect("200 or 503"),
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        body,
    )
        .into_response())
}

async fn open_decisions(
    State(state): State<AppState>,
    _auth: Auth,
    Query(query): Query<ListQuery>,
) -> Response {
    relay_list(state, OPEN_DECISIONS, query).await
}

async fn open_constraints(
    State(state): State<AppState>,
    _auth: Auth,
    Query(query): Query<ListQuery>,
) -> Response {
    relay_list(state, OPEN_CONSTRAINTS, query).await
}

async fn relay_list(state: AppState, path: &'static str, query: ListQuery) -> Response {
    match list(&state, path, query).await {
        Ok(res) => res,
        Err(e) => e.into_response(),
    }
}

async fn list(
    state: &AppState,
    path: &'static str,
    query: ListQuery,
) -> Result<Response, GatewayError> {
    let mut url = state.cloud.url(path)?;
    query.apply(&mut url);

    let res = send(state, path, url).await?;
    let status = res.status();

    // Cloud emits 504 from middleware above its handlers, so it is the one
    // response with no body — and it is Cloud's timeout, not ours, so it must not
    // be relabelled `cloud_timeout`.
    if status.as_u16() == 504 {
        log(path, "upstream_timeout", Some(status));
        return Ok(StatusCode::GATEWAY_TIMEOUT.into_response());
    }

    // 200 bodies and the 400/503 error envelopes are all JSON, and all three are
    // relayed byte-for-byte: `error.code` and `error.message` are Cloud's
    // contract with the client, not something to translate on the way through.
    if !matches!(status.as_u16(), 200 | 400 | 503) || !content_type_is(&res, "application/json") {
        log(path, "invalid_response", Some(status));
        return Err(GatewayError::invalid_response());
    }

    let body = body_capped(path, res).await?;
    if serde_json::from_slice::<serde_json::Value>(&body).is_err() {
        log(path, "malformed_json", Some(status));
        return Err(GatewayError::invalid_response());
    }
    if status.as_u16() != 200 {
        log(path, "upstream_error", Some(status));
    }

    Ok((
        StatusCode::from_u16(status.as_u16()).expect("200, 400 or 503"),
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response())
}

/// The single outbound path. Nothing inbound rides along: no `Authorization`, no
/// cookies, no request body, no desktop-supplied actor id — only the URL built
/// from the compiled-in allowlist.
async fn send(
    state: &AppState,
    path: &'static str,
    url: Url,
) -> Result<reqwest::Response, GatewayError> {
    let res = state.cloud.client.get(url).send().await.map_err(|e| {
        if e.is_timeout() {
            log(path, "timeout", None);
            GatewayError::timeout()
        } else if e.is_redirect() {
            log(path, "redirect", None);
            GatewayError::redirect()
        } else {
            log(path, "unreachable", None);
            GatewayError::unreachable()
        }
    })?;

    // With `Policy::none()` reqwest returns the 3xx rather than erroring on it.
    if res.status().is_redirection() {
        log(path, "redirect", Some(res.status()));
        return Err(GatewayError::redirect());
    }
    Ok(res)
}

fn content_type_is(res: &reqwest::Response, want: &str) -> bool {
    res.headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.trim_start().to_ascii_lowercase().starts_with(want))
}

/// Streamed rather than `bytes()`: a `Content-Length` the upstream can lie about
/// (or omit) is not a limit, so the cap has to be enforced as bytes arrive.
async fn body_capped(
    path: &'static str,
    mut res: reqwest::Response,
) -> Result<Vec<u8>, GatewayError> {
    let mut buf = Vec::new();
    loop {
        let chunk = match res.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => return Ok(buf),
            Err(e) if e.is_timeout() => {
                log(path, "timeout", None);
                return Err(GatewayError::timeout());
            }
            Err(_) => {
                log(path, "unreachable", None);
                return Err(GatewayError::unreachable());
            }
        };
        if buf.len() + chunk.len() > MAX_BODY {
            log(path, "oversized_body", None);
            return Err(GatewayError::invalid_response());
        }
        buf.extend_from_slice(&chunk);
    }
}

/// Category, status and route only. Never the response body (Cloud's own docs
/// say its internal errors carry SQL, schema names and datastore credentials),
/// never this backend's tokens, never a future actor identity.
fn log(route: &str, category: &str, status: Option<reqwest::StatusCode>) {
    match status {
        Some(status) => eprintln!("cloud gateway: {category} route=/{route} upstream={status}"),
        None => eprintln!("cloud gateway: {category} route=/{route}"),
    }
}

/// A failure of *this* gateway, as opposed to a Cloud response being relayed.
/// Bounded on purpose: five codes, all safe to show a user.
#[derive(Debug)]
pub struct GatewayError {
    status: StatusCode,
    code: &'static str,
    message: &'static str,
}

impl GatewayError {
    fn not_configured() -> Self {
        GatewayError {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "cloud_not_configured",
            message: "this gear6 backend has no G6 Cloud upstream configured",
        }
    }

    fn unreachable() -> Self {
        GatewayError {
            status: StatusCode::BAD_GATEWAY,
            code: "cloud_unreachable",
            message: "G6 Cloud could not be reached",
        }
    }

    fn timeout() -> Self {
        GatewayError {
            status: StatusCode::GATEWAY_TIMEOUT,
            code: "cloud_timeout",
            message: "G6 Cloud did not answer in time",
        }
    }

    fn redirect() -> Self {
        GatewayError {
            status: StatusCode::BAD_GATEWAY,
            code: "cloud_redirect",
            message: "G6 Cloud redirected; the gateway does not follow redirects",
        }
    }

    fn invalid_response() -> Self {
        GatewayError {
            status: StatusCode::BAD_GATEWAY,
            code: "cloud_invalid_response",
            message: "G6 Cloud returned a response the gateway could not accept",
        }
    }
}

impl IntoResponse for GatewayError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({ "error": { "code": self.code, "message": self.message } })),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::body::Body;
    use axum::http::{HeaderMap, Request};
    use sqlx::sqlite::SqlitePoolOptions;
    use tower::ServiceExt;

    use super::*;

    fn base(raw: &str) -> Result<String, &'static str> {
        parse_base(raw).map(|u| u.to_string())
    }

    #[test]
    fn base_url_is_normalized_to_a_trailing_slash() {
        assert_eq!(
            base("http://localhost:47694").unwrap(),
            "http://localhost:47694/"
        );
        assert_eq!(
            base("https://cloud.example.com/g6").unwrap(),
            "https://cloud.example.com/g6/"
        );
        assert_eq!(
            base("https://cloud.example.com/g6/").unwrap(),
            "https://cloud.example.com/g6/"
        );
    }

    #[test]
    fn base_url_rejects_anything_that_would_change_where_we_call() {
        assert!(base("localhost:47694").is_err(), "relative");
        assert!(base("ftp://cloud.example.com").is_err(), "scheme");
        assert!(base("file:///etc/passwd").is_err(), "scheme");
        assert!(
            base("http://user:pw@cloud.example.com").is_err(),
            "credentials"
        );
        assert!(base("http://cloud.example.com/?a=1").is_err(), "query");
        assert!(base("http://cloud.example.com/#frag").is_err(), "fragment");
    }

    #[test]
    fn a_path_prefix_survives_the_join() {
        let cloud = Cloud::new(Some("https://router.example.com/cloud"));
        assert_eq!(
            cloud.url(OPEN_DECISIONS).unwrap().as_str(),
            "https://router.example.com/cloud/v1/open-decisions"
        );
    }

    #[test]
    fn missing_configuration_is_not_a_panic() {
        assert!(Cloud::new(None).base.is_none());
        assert!(Cloud::new(Some("  ")).base.is_none());
    }

    #[test]
    #[should_panic(expected = "GEAR6_CLOUD_BASE_URL must use the http or https scheme")]
    fn a_configured_but_unusable_url_fails_at_startup() {
        Cloud::new(Some("ftp://cloud.example.com"));
    }

    #[test]
    fn only_the_three_allowlisted_parameters_are_forwarded() {
        let query: ListQuery = serde_urlencoded::from_str(
            "entity_id=0123456789abcdef0123456789abcdef&limit=1000&cursor=abc%3D%3D&token=xoxb-secret&actor=U1",
        )
        .unwrap();
        let mut url = Url::parse("http://cloud/v1/open-decisions").unwrap();
        query.apply(&mut url);

        assert_eq!(
            url.query().unwrap(),
            "entity_id=0123456789abcdef0123456789abcdef&limit=1000&cursor=abc%3D%3D"
        );
    }

    #[test]
    fn absent_parameters_are_omitted_rather_than_sent_empty() {
        let query: ListQuery = serde_urlencoded::from_str("").unwrap();
        let mut url = Url::parse("http://cloud/v1/open-decisions").unwrap();
        query.apply(&mut url);
        assert_eq!(url.query(), None);
    }

    // ---- integration: the real router against a mock upstream ----

    /// What the mock upstream saw. Assertions about what is *not* forwarded need
    /// the received request, not just the relayed response.
    #[derive(Clone, Default)]
    struct Seen(Arc<Mutex<Vec<(String, HeaderMap)>>>);

    impl Seen {
        fn last(&self) -> (String, HeaderMap) {
            self.0.lock().unwrap().last().cloned().expect("a request")
        }
    }

    /// Serve `reply` for every path on an ephemeral port, recording each request.
    async fn mock_cloud<F>(reply: F) -> (String, Seen)
    where
        F: Fn() -> Response + Clone + Send + Sync + 'static,
    {
        let seen = Seen::default();
        let recorder = seen.clone();
        let router = Router::new().fallback(move |req: Request<Body>| {
            let reply = reply.clone();
            let recorder = recorder.clone();
            async move {
                let uri = req.uri().to_string();
                recorder
                    .0
                    .lock()
                    .unwrap()
                    .push((uri, req.headers().clone()));
                reply()
            }
        });

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        (format!("http://{addr}"), seen)
    }

    async fn gateway(base: Option<&str>) -> Router {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&db).await.unwrap();
        let mut state = AppState::new(db);
        state.cloud = Cloud::new(base);
        crate::app(state)
    }

    /// A real bearer token: the list routes run the existing `Auth` extractor,
    /// and `GEAR6_DISABLE_AUTH` is not set under `cargo test`.
    async fn token(app: &Router) -> String {
        let creds = "username=astha&password=password1";
        for path in ["/register", "/login"] {
            let res = app
                .clone()
                .oneshot(
                    Request::post(path)
                        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
                        .body(Body::from(creds))
                        .unwrap(),
                )
                .await
                .unwrap();
            let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
                .await
                .unwrap();
            let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            if let Some(t) = json["token"].as_str() {
                return t.to_owned();
            }
        }
        panic!("login returned no token");
    }

    async fn get(app: &Router, uri: &str, token: Option<&str>) -> (StatusCode, String, String) {
        let mut req = Request::get(uri);
        if let Some(t) = token {
            req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
        }
        let res = app
            .clone()
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let content_type = res
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            content_type,
            String::from_utf8_lossy(&bytes).into_owned(),
        )
    }

    fn text(status: u16, body: &'static str) -> impl Fn() -> Response + Clone {
        move || {
            (
                StatusCode::from_u16(status).unwrap(),
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                body,
            )
                .into_response()
        }
    }

    fn json_body(status: u16, body: &'static str) -> impl Fn() -> Response + Clone {
        move || {
            (
                StatusCode::from_u16(status).unwrap(),
                [(header::CONTENT_TYPE, "application/json")],
                body,
            )
                .into_response()
        }
    }

    const PAGE: &str = r#"{"data":[],"page":{"limit":50,"next_cursor":"AbC="},"generated_at":"2026-01-01T00:00:00Z"}"#;

    #[tokio::test]
    async fn healthz_relays_plain_text_readiness_both_ways() {
        for (upstream, body) in [(200u16, "ok"), (503, "read model unavailable")] {
            let (base, _) = mock_cloud(text(upstream, body)).await;
            let app = gateway(Some(&base)).await;

            let (status, content_type, got) = get(&app, "/api/cloud/healthz", None).await;
            assert_eq!(status.as_u16(), upstream);
            assert!(content_type.starts_with("text/plain"), "{content_type}");
            assert_eq!(got, body);
        }
    }

    #[tokio::test]
    async fn a_list_page_is_relayed_verbatim_with_only_allowlisted_query() {
        let (base, seen) = mock_cloud(json_body(200, PAGE)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        let (status, content_type, got) = get(
            &app,
            "/api/cloud/v1/open-decisions?cursor=AbC%3D&limit=50&nope=1",
            Some(&token),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(content_type, "application/json");
        assert_eq!(
            got, PAGE,
            "the page body is not rewritten on the way through"
        );

        let (uri, headers) = seen.last();
        assert_eq!(uri, "/v1/open-decisions?limit=50&cursor=AbC%3D");
        assert!(
            headers.get(header::AUTHORIZATION).is_none(),
            "no inbound auth"
        );
        assert!(headers.get(header::COOKIE).is_none(), "no cookies");
        assert!(headers.get("x-g6-actor-id").is_none(), "no actor identity");
    }

    #[tokio::test]
    async fn open_constraints_has_its_own_upstream_path() {
        let (base, seen) = mock_cloud(json_body(200, PAGE)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        get(&app, "/api/cloud/v1/open-constraints", Some(&token)).await;
        assert_eq!(seen.last().0, "/v1/open-constraints");
    }

    #[tokio::test]
    async fn list_routes_require_the_existing_backend_auth() {
        let (base, seen) = mock_cloud(json_body(200, PAGE)).await;
        let app = gateway(Some(&base)).await;

        let (status, _, body) = get(&app, "/api/cloud/v1/open-decisions", None).await;
        // The `Auth` extractor rejects Slack-style, before this module is reached.
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("not_authed"), "{body}");
        assert!(seen.0.lock().unwrap().is_empty(), "nothing reached Cloud");
    }

    #[tokio::test]
    async fn cloud_error_envelopes_keep_their_status_and_code() {
        for (upstream, body) in [
            (
                400u16,
                r#"{"error":{"code":"invalid_cursor","message":"cursor is malformed"}}"#,
            ),
            (
                503,
                r#"{"error":{"code":"read_model_unavailable","message":"the read model is not reachable"}}"#,
            ),
        ] {
            let (base, _) = mock_cloud(json_body(upstream, body)).await;
            let app = gateway(Some(&base)).await;
            let token = token(&app).await;

            let (status, _, got) = get(&app, "/api/cloud/v1/open-decisions", Some(&token)).await;
            assert_eq!(status.as_u16(), upstream);
            assert_eq!(got, body);
        }
    }

    #[tokio::test]
    async fn an_upstream_504_stays_a_bodyless_504() {
        let (base, _) = mock_cloud(|| StatusCode::GATEWAY_TIMEOUT.into_response()).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        let (status, _, body) = get(&app, "/api/cloud/v1/open-decisions", Some(&token)).await;
        assert_eq!(status, StatusCode::GATEWAY_TIMEOUT);
        assert_eq!(body, "", "Cloud's own timeout carries no envelope");
    }

    #[tokio::test]
    async fn a_redirect_is_a_gateway_failure_not_a_hop() {
        let (base, _) = mock_cloud(|| {
            (
                StatusCode::FOUND,
                [(
                    header::LOCATION,
                    "http://elsewhere.example.com/v1/open-decisions",
                )],
            )
                .into_response()
        })
        .await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        let (status, _, body) = get(&app, "/api/cloud/v1/open-decisions", Some(&token)).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert!(body.contains("cloud_redirect"), "{body}");
    }

    async fn assert_invalid_response<F>(name: &str, reply: F)
    where
        F: Fn() -> Response + Clone + Send + Sync + 'static,
    {
        let (base, _) = mock_cloud(reply).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        let (status, _, body) = get(&app, "/api/cloud/v1/open-decisions", Some(&token)).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY, "{name}");
        assert!(body.contains("cloud_invalid_response"), "{name}: {body}");
    }

    #[tokio::test]
    async fn malformed_and_mistyped_bodies_are_rejected() {
        assert_invalid_response("malformed json", json_body(200, "{not json")).await;
        assert_invalid_response("wrong content type", text(200, "ok")).await;
        assert_invalid_response("unexpected status", json_body(500, "{}")).await;
    }

    #[tokio::test]
    async fn an_oversized_body_is_refused_rather_than_relayed() {
        let big: &'static str = Box::leak(format!("\"{}\"", "x".repeat(MAX_BODY)).into_boxed_str());
        let (base, _) = mock_cloud(json_body(200, big)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        let (status, _, body) = get(&app, "/api/cloud/v1/open-decisions", Some(&token)).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert!(body.contains("cloud_invalid_response"), "{body}");
    }

    #[tokio::test]
    async fn an_unreachable_upstream_is_502_not_a_hang() {
        // Bound and drop, so the port is one nothing is listening on.
        let addr = {
            let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            l.local_addr().unwrap()
        };
        let app = gateway(Some(&format!("http://{addr}"))).await;

        let (status, _, body) = get(&app, "/api/cloud/healthz", None).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert!(body.contains("cloud_unreachable"), "{body}");
    }

    #[tokio::test]
    async fn without_configuration_cloud_is_503_and_the_rest_of_the_backend_is_fine() {
        let app = gateway(None).await;

        let (status, _, body) = get(&app, "/api/cloud/healthz", None).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(body.contains("cloud_not_configured"), "{body}");

        // The Slack-compatible surface is untouched by the gateway's absence.
        let (status, _, body) = get(&app, "/api/users.list", Some(&token(&app).await)).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"ok\":true"), "{body}");
    }

    #[tokio::test]
    async fn the_allowlist_is_the_whole_route_surface() {
        let (base, seen) = mock_cloud(json_body(200, PAGE)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        for uri in [
            "/api/cloud/v1/actions",
            "/api/cloud/v1/overview",
            "/api/cloud/livez",
            "/api/cloud/v1/open-decisions/1",
            "/api/cloud/",
        ] {
            let (status, _, _) = get(&app, uri, Some(&token)).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{uri} must not be proxied");
        }
        assert!(seen.0.lock().unwrap().is_empty(), "nothing reached Cloud");
    }
}
