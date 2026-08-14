//! A deliberately narrow read-only gateway to G6 Cloud.
//!
//! The desktop webview never learns a Cloud origin: it calls this backend, and
//! this backend calls Cloud. That is the whole point, so there is no generic
//! proxy route and no route-map DSL here — just a handful of fixed routes whose
//! upstream paths are compiled in. One path, the milestone timeline, carries an
//! id in it; that id is checked against Cloud's own 32-hex entity shape before
//! the URL is built, so the only runtime input to an upstream path is 32
//! characters from a fixed alphabet.
//!
//! One route is a POST, and it is still a read: `v1/extractions/resolve` takes a
//! signal reference, a depth and a cursor, which do not fit a query string. It is
//! the only route whose request body crosses this gateway, and it crosses capped
//! and otherwise untouched — see `resolve_extraction`.
//!
//! The actor-scoped routes take the viewer as a query parameter and this
//! backend turns it into `X-G6-Actor-ID` on the way out. The browser never
//! sends that header, so it never has to be in the CORS allowlist.
//!
//! Unlike the Slack-compatible surface next door, `/api/cloud` is NOT Slack
//! shaped: it keeps Cloud's status semantics instead of answering 200 with
//! `{ok: false}`, because Cloud's own contract branches on status + `error.code`
//! and flattening that would throw away the only machine-readable signal.

use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
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
const ACTIONS: &str = "v1/actions";
const OVERVIEW: &str = "v1/overview";
const MILESTONES: &str = "v1/milestones";
const ATTENTION: &str = "v1/attention";
const SEARCH: &str = "v1/search";
/// The one upstream path built at runtime rather than compiled in. This constant
/// is the label the logs and the allowlist reason about; the concrete path is
/// assembled in `milestone_timeline` from an id validated against
/// `MILESTONE_ID_LEN` hex characters first, so no request-supplied text can add
/// a segment, a query, or a traversal to it.
const MILESTONE_TIMELINE: &str = "v1/milestones/{id}/timeline";
const EXTRACTIONS_RESOLVE: &str = "v1/extractions/resolve";
#[cfg(debug_assertions)]
const DEV_USERS: &str = "v1/dev/users";

/// The resolve request is `{provider, reference, depth, limit, cursor}` — a few
/// hundred bytes at most. The cap is enforced here rather than upstream so a
/// large body is refused before it becomes an outbound request.
const MAX_RESOLVE_BODY: usize = 4 * 1024;

/// The header Cloud reads the viewer from. Written here, from a validated query
/// value, and never copied from anything the webview sent.
const ACTOR_HEADER: &str = "X-G6-Actor-ID";

/// Cloud's own `X-G6-Actor-ID` schema is `minLength: 1, maxLength: 128`.
const MAX_ACTOR_LEN: usize = 128;

/// Cloud's entity id: exactly 32 lowercase hex characters.
const MILESTONE_ID_LEN: usize = 32;

/// The JSON statuses this gateway relays byte-for-byte. 400 and 503 are Cloud's
/// own error envelopes; anything else is a response the gateway does not accept.
const JSON_STATUSES: &[u16] = &[200, 400, 503];

/// The milestone routes add the two Cloud uses to say something true about an
/// id: `404 milestone_not_found`, and `410 milestone_merged` for an identity the
/// lattice folded into another. Relaying them keeps the client able to tell a
/// typo from a merge; swallowing them into `cloud_invalid_response` would not.
const MILESTONE_STATUSES: &[u16] = &[200, 400, 404, 410, 503];

/// Resolve answers `404 signal_not_found` for a reference that names nothing (or
/// names it under the wrong provider), and `500 extraction_failed` for a read
/// that broke. Both are envelopes the client branches on, so both are relayed.
const RESOLVE_STATUSES: &[u16] = &[200, 400, 404, 500, 503];

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
    let routes = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/actions", get(actions))
        .route("/v1/overview", get(overview))
        .route("/v1/milestones", get(milestones))
        .route("/v1/attention", get(attention))
        .route("/v1/search", get(search))
        .route(
            "/v1/milestones/{milestone_id}/timeline",
            get(milestone_timeline),
        )
        .route("/v1/extractions/resolve", post(resolve_extraction));

    // Compiled out of release builds, exactly as Cloud gates its own copy: the
    // route enumerates the tenant's people, handles and emails, and a config
    // flag would still ship the code in the production binary.
    #[cfg(debug_assertions)]
    let routes = routes.route("/v1/dev/users", get(dev_users));

    routes
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
    let res = send(state, HEALTHZ, url, None, None).await?;
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

/// `/v1/milestones` has its own sort and its own cursor shape, so it gets its
/// own parameter set: `entity_id` means nothing on a list of entities, and
/// forwarding it would be a filter Cloud rejects.
///
/// The filters are strings and are not validated here, matching [`TimelineQuery`]:
/// Cloud answers its own `invalid_query`, `invalid_status`, `invalid_quiet_days`
/// and `invalid_counts`, and a second validator on this side could only reword
/// the same rejection — or accept a value Cloud will not.
#[derive(Deserialize)]
pub struct MilestoneListQuery {
    limit: Option<String>,
    cursor: Option<String>,
    q: Option<String>,
    status: Option<String>,
    quiet_days: Option<String>,
    counts: Option<String>,
    has_no_activity: Option<String>,
}

/// `/v1/attention`'s four thresholds. No actor: the tiles are whole-tenant.
#[derive(Deserialize)]
pub struct AttentionQuery {
    since_days: Option<String>,
    blocked_days: Option<String>,
    quiet_days: Option<String>,
    closed_days: Option<String>,
}

/// `/v1/search`'s query, scope, and per-collection cap.
///
/// `q` is required upstream and is **not** defaulted here: a gateway that turned
/// an absent query into some value would turn Cloud's `400 missing_query` into a
/// read of every collection.
#[derive(Deserialize)]
pub struct SearchQuery {
    q: Option<String>,
    scope: Option<String>,
    limit: Option<String>,
}

/// The timeline's two date bounds. Strings, deliberately: Cloud answers its own
/// `400 invalid_date_range` for a loose or impossible date, and a second
/// validator here would only produce a differently-worded rejection for the same
/// input — or, worse, accept a date Cloud does not.
#[derive(Deserialize)]
pub struct TimelineQuery {
    from: Option<String>,
    to: Option<String>,
}

/// Appends only the named pairs, and only when at least one is present:
/// `query_pairs_mut` leaves a bare `?` behind otherwise.
fn append_pairs(url: &mut Url, pairs: &[(&str, &Option<String>)]) {
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

impl MilestoneListQuery {
    fn apply(&self, url: &mut Url) {
        append_pairs(
            url,
            &[
                ("limit", &self.limit),
                ("cursor", &self.cursor),
                ("q", &self.q),
                ("status", &self.status),
                ("quiet_days", &self.quiet_days),
                ("counts", &self.counts),
                ("has_no_activity", &self.has_no_activity),
            ],
        );
    }
}

impl AttentionQuery {
    fn apply(&self, url: &mut Url) {
        append_pairs(
            url,
            &[
                ("since_days", &self.since_days),
                ("blocked_days", &self.blocked_days),
                ("quiet_days", &self.quiet_days),
                ("closed_days", &self.closed_days),
            ],
        );
    }
}

impl SearchQuery {
    fn apply(&self, url: &mut Url) {
        append_pairs(
            url,
            &[
                ("q", &self.q),
                ("scope", &self.scope),
                ("limit", &self.limit),
            ],
        );
    }
}

impl TimelineQuery {
    fn apply(&self, url: &mut Url) {
        append_pairs(url, &[("from", &self.from), ("to", &self.to)]);
    }
}

/// No actor header on either milestone route: the counts are whole-tenant and a
/// milestone's history is the same history for every viewer.
async fn milestones(
    State(state): State<AppState>,
    _auth: Auth,
    Query(query): Query<MilestoneListQuery>,
) -> Response {
    let relayed = async {
        let mut url = state.cloud.url(MILESTONES)?;
        query.apply(&mut url);
        relay(&state, MILESTONES, url, None, None, MILESTONE_STATUSES).await
    };
    match relayed.await {
        Ok(res) => res,
        Err(e) => e.into_response(),
    }
}

/// The attention strip and the search palette. Both are whole-tenant reads with
/// plain query strings, so neither needs the actor header nor the runtime-path
/// handling `milestone_timeline` has: the upstream path is compiled in and the
/// only runtime input is a query string `Url` encodes.
async fn attention(
    State(state): State<AppState>,
    _auth: Auth,
    Query(query): Query<AttentionQuery>,
) -> Response {
    let relayed = async {
        let mut url = state.cloud.url(ATTENTION)?;
        query.apply(&mut url);
        relay(&state, ATTENTION, url, None, None, JSON_STATUSES).await
    };
    match relayed.await {
        Ok(res) => res,
        Err(e) => e.into_response(),
    }
}

async fn search(
    State(state): State<AppState>,
    _auth: Auth,
    Query(query): Query<SearchQuery>,
) -> Response {
    let relayed = async {
        let mut url = state.cloud.url(SEARCH)?;
        query.apply(&mut url);
        relay(&state, SEARCH, url, None, None, JSON_STATUSES).await
    };
    match relayed.await {
        Ok(res) => res,
        Err(e) => e.into_response(),
    }
}

async fn milestone_timeline(
    State(state): State<AppState>,
    _auth: Auth,
    Path(milestone_id): Path<String>,
    Query(query): Query<TimelineQuery>,
) -> Response {
    let relayed = async {
        // Validated before the path exists, so an id that is not Cloud's own
        // entity shape never becomes part of an outbound URL.
        if !is_milestone_id(&milestone_id) {
            return Err(GatewayError::invalid_milestone_id());
        }
        let mut url = state
            .cloud
            .url(&format!("v1/milestones/{milestone_id}/timeline"))?;
        query.apply(&mut url);
        relay(&state, MILESTONE_TIMELINE, url, None, None, MILESTONE_STATUSES).await
    };
    match relayed.await {
        Ok(res) => res,
        Err(e) => e.into_response(),
    }
}

/// The one route that carries a request body, and the body is forwarded
/// byte-for-byte rather than parsed and re-serialised.
///
/// Deliberately not validated here. Cloud's schema is `deny_unknown_fields` and
/// it answers its own `400 invalid_body`, `400 invalid_depth_for_reference` and
/// `400 invalid_cursor`; a second validator on this side could only produce a
/// differently-worded rejection for the same input — or, worse, accept a shape
/// Cloud will not. Same reasoning as `TimelineQuery` above.
///
/// What *is* enforced here is the size, before any outbound request exists: this
/// gateway will not turn an unbounded webview upload into an unbounded upstream
/// POST. No actor header — a landed record reads the same for every viewer.
async fn resolve_extraction(State(state): State<AppState>, _auth: Auth, body: Bytes) -> Response {
    let relayed = async {
        if body.len() > MAX_RESOLVE_BODY {
            log(EXTRACTIONS_RESOLVE, "oversized_request", None);
            return Err(GatewayError::request_too_large());
        }
        let url = state.cloud.url(EXTRACTIONS_RESOLVE)?;
        relay(
            &state,
            EXTRACTIONS_RESOLVE,
            url,
            None,
            Some(body),
            RESOLVE_STATUSES,
        )
        .await
    };
    match relayed.await {
        Ok(res) => res,
        Err(e) => e.into_response(),
    }
}

/// Exactly 32 lowercase hex characters — Cloud's `^[0-9a-f]{32}$`. Uppercase is
/// rejected rather than lowercased: a client sending it is not reading the same
/// contract, and normalising input is how a validator starts accepting things
/// the upstream will not.
fn is_milestone_id(raw: &str) -> bool {
    raw.len() == MILESTONE_ID_LEN
        && raw
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The viewer, as the webview is allowed to express it: a query value, not a
/// header. `Option` rather than a required field so a missing parameter is this
/// module's `400 invalid_actor` instead of Axum's own rejection body.
#[derive(Deserialize)]
pub struct ActorQuery {
    account_id: Option<String>,
}

impl ActorQuery {
    /// The one place a browser-supplied string becomes an outbound header.
    /// Rejecting rather than sanitising: a value that is not a header is not a
    /// Cloud account id either, so there is nothing to salvage.
    fn header(&self) -> Result<HeaderValue, GatewayError> {
        let raw = self.account_id.as_deref().unwrap_or_default();
        if raw.is_empty() || raw.len() > MAX_ACTOR_LEN {
            return Err(GatewayError::invalid_actor());
        }
        HeaderValue::from_str(raw).map_err(|_| GatewayError::invalid_actor())
    }
}

async fn actions(
    State(state): State<AppState>,
    _auth: Auth,
    Query(query): Query<ActorQuery>,
) -> Response {
    relay_actor(state, ACTIONS, query).await
}

async fn overview(
    State(state): State<AppState>,
    _auth: Auth,
    Query(query): Query<ActorQuery>,
) -> Response {
    relay_actor(state, OVERVIEW, query).await
}

async fn relay_actor(state: AppState, path: &'static str, query: ActorQuery) -> Response {
    match actor_scoped(&state, path, query).await {
        Ok(res) => res,
        Err(e) => e.into_response(),
    }
}

async fn actor_scoped(
    state: &AppState,
    path: &'static str,
    query: ActorQuery,
) -> Result<Response, GatewayError> {
    // Validated before the URL is built, so an invalid account never reaches
    // Cloud at all. The rejection names the parameter, never its value.
    let actor = query.header()?;
    let url = state.cloud.url(path)?;
    relay(state, path, url, Some(actor), None, JSON_STATUSES).await
}

/// Development only, and unparameterised: the list is capped upstream at 1000
/// rows and does not page.
#[cfg(debug_assertions)]
async fn dev_users(State(state): State<AppState>, _auth: Auth) -> Response {
    let relayed = async {
        let url = state.cloud.url(DEV_USERS)?;
        relay(&state, DEV_USERS, url, None, None, JSON_STATUSES).await
    };
    match relayed.await {
        Ok(res) => res,
        Err(e) => e.into_response(),
    }
}

/// The shared JSON pass-through: same bodyless 504 and the same byte-for-byte
/// relay for every route that answers JSON. `allowed` is the route's accepted
/// status set — every one of them is a Cloud answer with a JSON envelope the
/// client branches on, and anything outside it is `cloud_invalid_response`.
async fn relay(
    state: &AppState,
    path: &'static str,
    url: Url,
    actor: Option<HeaderValue>,
    body: Option<Bytes>,
    allowed: &[u16],
) -> Result<Response, GatewayError> {
    let res = send(state, path, url, actor, body).await?;
    let status = res.status();

    // Cloud emits 504 from middleware above its handlers, so it is the one
    // response with no body — and it is Cloud's timeout, not ours, so it must not
    // be relabelled `cloud_timeout`.
    if status.as_u16() == 504 {
        log(path, "upstream_timeout", Some(status));
        return Ok(StatusCode::GATEWAY_TIMEOUT.into_response());
    }

    // 200 bodies and Cloud's error envelopes are all JSON, and all of them are
    // relayed byte-for-byte: `error.code` and `error.message` are Cloud's
    // contract with the client, not something to translate on the way through.
    if !allowed.contains(&status.as_u16()) || !content_type_is(&res, "application/json") {
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
        StatusCode::from_u16(status.as_u16()).expect("an allowed upstream status"),
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response())
}

/// The single outbound path. Almost nothing inbound rides along: no
/// `Authorization`, no cookies, no desktop-supplied header — only the URL built
/// from the compiled-in allowlist, plus the one actor header this gateway
/// constructs itself from a validated query value.
///
/// `body` is the one exception, and it is an exception by route rather than by
/// request: only `v1/extractions/resolve` passes `Some`, and only after capping
/// it. `None` sends a GET with no body at all, which is every other route.
async fn send(
    state: &AppState,
    path: &'static str,
    url: Url,
    actor: Option<HeaderValue>,
    body: Option<Bytes>,
) -> Result<reqwest::Response, GatewayError> {
    let mut request = match body {
        Some(body) => state
            .cloud
            .client
            .post(url)
            .header(header::CONTENT_TYPE, "application/json")
            .body(body),
        None => state.cloud.client.get(url),
    };
    if let Some(actor) = actor {
        request = request.header(ACTOR_HEADER, actor);
    }
    let res = request.send().await.map_err(|e| {
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
/// Bounded on purpose: a handful of codes, all safe to show a user.
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

    /// The account the webview named cannot become a header. Deliberately says
    /// nothing about the value: it is user input echoed back into a log or a
    /// toast otherwise.
    fn invalid_actor() -> Self {
        GatewayError {
            status: StatusCode::BAD_REQUEST,
            code: "invalid_actor",
            message: "account_id must be a non-empty header-safe value of at most 128 bytes",
        }
    }

    /// The milestone the webview named is not Cloud's entity shape. Says nothing
    /// about the value, for the same reason `invalid_actor` does not.
    fn invalid_milestone_id() -> Self {
        GatewayError {
            status: StatusCode::BAD_REQUEST,
            code: "invalid_milestone_id",
            message: "milestone_id must be 32 lowercase hexadecimal characters",
        }
    }

    /// The webview sent a resolve body larger than any valid one. Refused before
    /// an outbound request exists, so this gateway never forwards an upload it
    /// has not bounded.
    fn request_too_large() -> Self {
        GatewayError {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            code: "request_too_large",
            message: "the request body exceeds the gateway's limit for this route",
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
            cloud.url(ACTIONS).unwrap().as_str(),
            "https://router.example.com/cloud/v1/actions"
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

    /// The allowlist is the whole point: a parameter this gateway does not name is not forwarded,
    /// whatever the webview attached to the request.
    ///
    /// `status` is a *milestone* filter here — Cloud's health vocabulary — and is forwarded
    /// unvalidated, like every other filter on this route. A value Cloud does not accept comes back
    /// as Cloud's own `400 invalid_status`; rejecting it here would only reword that.
    #[test]
    fn only_the_allowlisted_parameters_are_forwarded() {
        let query: MilestoneListQuery = serde_urlencoded::from_str(
            "status=regression&limit=1000&cursor=abc%3D%3D&token=xoxb-secret&actor=U1",
        )
        .unwrap();
        let mut url = Url::parse("http://cloud/v1/milestones").unwrap();
        query.apply(&mut url);

        assert_eq!(
            url.query().unwrap(),
            "limit=1000&cursor=abc%3D%3D&status=regression"
        );

        // Every filter the list route has, and nothing else.
        let full: MilestoneListQuery = serde_urlencoded::from_str(
            "q=read+state&status=regression&quiet_days=14&counts=true&has_no_activity=false\
             &token=xoxb-secret&entity_id=deadbeef",
        )
        .unwrap();
        let mut url = Url::parse("http://cloud/v1/milestones").unwrap();
        full.apply(&mut url);
        let seen = url.query().unwrap();
        assert!(seen.contains("q=read+state"), "{seen}");
        assert!(seen.contains("quiet_days=14"), "{seen}");
        assert!(seen.contains("counts=true"), "{seen}");
        assert!(seen.contains("has_no_activity=false"), "{seen}");
        assert!(!seen.contains("token"), "{seen}");
        assert!(!seen.contains("entity_id"), "{seen}");
    }

    /// Both new routes are registered, reach their compiled-in upstream path, and send no viewer —
    /// what is regressing and what a word matches are the same answers for everyone.
    ///
    /// A parameter allowlist test cannot catch a route that was never added to the router, which is
    /// the failure this one exists for.
    #[tokio::test]
    async fn the_attention_and_search_routes_reach_cloud_with_no_viewer() {
        let (base, seen) = mock_cloud(json_body(200, PAGE)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        for (uri, upstream) in [
            (
                "/api/cloud/v1/attention?since_days=1&account_id=U024BE7LH",
                "/v1/attention?since_days=1",
            ),
            (
                "/api/cloud/v1/search?q=read+state&scope=events&account_id=U024BE7LH",
                "/v1/search?q=read+state&scope=events",
            ),
        ] {
            let (status, _, _) = get(&app, uri, Some(&token)).await;
            assert_eq!(status, StatusCode::OK, "{uri}");

            let (seen_uri, headers) = seen.last();
            assert_eq!(seen_uri, upstream);
            assert!(headers.get("x-g6-actor-id").is_none(), "no actor identity");
            assert!(
                headers.get(header::AUTHORIZATION).is_none(),
                "no inbound auth"
            );
        }
    }

    /// The two whole-tenant routes forward their own thresholds and nothing else.
    ///
    /// `q` is not defaulted when absent: a gateway that invented one would turn Cloud's
    /// `400 missing_query` into a read of every collection.
    #[test]
    fn the_attention_and_search_routes_forward_only_their_own_parameters() {
        let a: AttentionQuery = serde_urlencoded::from_str(
            "since_days=1&blocked_days=5&quiet_days=14&closed_days=7&account_id=U1&token=x",
        )
        .unwrap();
        let mut url = Url::parse("http://cloud/v1/attention").unwrap();
        a.apply(&mut url);
        assert_eq!(
            url.query().unwrap(),
            "since_days=1&blocked_days=5&quiet_days=14&closed_days=7"
        );

        let s: SearchQuery =
            serde_urlencoded::from_str("q=read+state&scope=events&limit=8&actor=U1").unwrap();
        let mut url = Url::parse("http://cloud/v1/search").unwrap();
        s.apply(&mut url);
        assert_eq!(url.query().unwrap(), "q=read+state&scope=events&limit=8");

        let empty: SearchQuery = serde_urlencoded::from_str("").unwrap();
        let mut url = Url::parse("http://cloud/v1/search").unwrap();
        empty.apply(&mut url);
        assert_eq!(url.query(), None, "no bare ? and no invented q");
    }

    fn actor(query: &str) -> Result<String, &'static str> {
        let parsed: ActorQuery = serde_urlencoded::from_str(query).unwrap();
        parsed
            .header()
            .map(|v| v.to_str().unwrap().to_owned())
            .map_err(|e| e.code)
    }

    #[test]
    fn only_a_header_safe_account_becomes_an_actor() {
        assert_eq!(actor("account_id=U024BE7LH").unwrap(), "U024BE7LH");
        assert_eq!(
            actor(&format!("account_id={}", "U".repeat(MAX_ACTOR_LEN))).unwrap(),
            "U".repeat(MAX_ACTOR_LEN)
        );

        assert_eq!(actor("").unwrap_err(), "invalid_actor", "missing");
        assert_eq!(actor("account_id=").unwrap_err(), "invalid_actor", "empty");
        assert_eq!(
            actor(&format!("account_id={}", "U".repeat(MAX_ACTOR_LEN + 1))).unwrap_err(),
            "invalid_actor",
            "oversized"
        );
        // A header split is the reason this is validated rather than trusted.
        assert_eq!(
            actor("account_id=U1%0d%0aX-Evil%3A+1").unwrap_err(),
            "invalid_actor",
            "crlf"
        );
        assert_eq!(
            actor("account_id=U%00").unwrap_err(),
            "invalid_actor",
            "nul"
        );
    }

    #[test]
    fn absent_parameters_are_omitted_rather_than_sent_empty() {
        let query: MilestoneListQuery = serde_urlencoded::from_str("").unwrap();
        let mut url = Url::parse("http://cloud/v1/milestones").unwrap();
        query.apply(&mut url);
        assert_eq!(url.query(), None);
    }

    // ---- integration: the real router against a mock upstream ----

    /// What the mock upstream saw. Assertions about what is *not* forwarded need
    /// the received request, not just the relayed response.
    #[derive(Clone, Default)]
    struct Seen(Arc<Mutex<Vec<(String, HeaderMap, Vec<u8>)>>>);

    impl Seen {
        fn last(&self) -> (String, HeaderMap) {
            let (uri, headers, _) = self.0.lock().unwrap().last().cloned().expect("a request");
            (uri, headers)
        }

        /// The bytes the upstream received. Only `v1/extractions/resolve` sends
        /// any; on every other route this asserts the absence.
        fn last_body(&self) -> Vec<u8> {
            self.0.lock().unwrap().last().cloned().expect("a request").2
        }

        fn count(&self) -> usize {
            self.0.lock().unwrap().len()
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
                let headers = req.headers().clone();
                let body = axum::body::to_bytes(req.into_body(), usize::MAX)
                    .await
                    .unwrap_or_default()
                    .to_vec();
                recorder.0.lock().unwrap().push((uri, headers, body));
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

    async fn post_json(
        app: &Router,
        uri: &str,
        token: Option<&str>,
        body: &str,
    ) -> (StatusCode, String, String) {
        let mut req = Request::post(uri).header(header::CONTENT_TYPE, "application/json");
        if let Some(t) = token {
            req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
        }
        let res = app
            .clone()
            .oneshot(req.body(Body::from(body.to_owned())).unwrap())
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
            "/api/cloud/v1/milestones?cursor=AbC%3D&limit=50&nope=1",
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
        assert_eq!(uri, "/v1/milestones?limit=50&cursor=AbC%3D");
        assert!(
            headers.get(header::AUTHORIZATION).is_none(),
            "no inbound auth"
        );
        assert!(headers.get(header::COOKIE).is_none(), "no cookies");
        assert!(headers.get("x-g6-actor-id").is_none(), "no actor identity");
    }

    #[tokio::test]
    async fn list_routes_require_the_existing_backend_auth() {
        let (base, seen) = mock_cloud(json_body(200, PAGE)).await;
        let app = gateway(Some(&base)).await;

        for uri in [
            "/api/cloud/v1/actions?account_id=U024BE7LH",
            "/api/cloud/v1/overview?account_id=U024BE7LH",
            "/api/cloud/v1/milestones",
            "/api/cloud/v1/milestones/0123456789abcdef0123456789abcdef/timeline",
        ] {
            let (status, _, body) = get(&app, uri, None).await;
            // The `Auth` extractor rejects Slack-style, before this module is reached.
            assert_eq!(status, StatusCode::OK, "{uri}");
            assert!(body.contains("not_authed"), "{uri}: {body}");
        }
        assert!(seen.0.lock().unwrap().is_empty(), "nothing reached Cloud");
    }

    #[tokio::test]
    async fn the_actor_reaches_cloud_as_a_header_and_never_as_a_query() {
        let (base, seen) = mock_cloud(json_body(200, PAGE)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        for (uri, upstream) in [
            ("/api/cloud/v1/actions?account_id=U024BE7LH", "/v1/actions"),
            (
                "/api/cloud/v1/overview?account_id=U024BE7LH",
                "/v1/overview",
            ),
        ] {
            let (status, _, _) = get(&app, uri, Some(&token)).await;
            assert_eq!(status, StatusCode::OK, "{uri}");

            let (seen_uri, headers) = seen.last();
            assert_eq!(seen_uri, upstream, "the account is not forwarded as query");
            assert_eq!(headers["x-g6-actor-id"], "U024BE7LH");
            assert!(
                headers.get(header::AUTHORIZATION).is_none(),
                "no inbound auth"
            );
            assert!(headers.get(header::COOKIE).is_none(), "no cookies");
        }
    }

    const MILESTONE_ID: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn a_milestone_id_is_only_cloud_s_own_entity_shape() {
        assert!(is_milestone_id(MILESTONE_ID));

        assert!(!is_milestone_id(""), "empty");
        assert!(!is_milestone_id(&MILESTONE_ID[1..]), "31 characters");
        assert!(!is_milestone_id(&format!("{MILESTONE_ID}0")), "33");
        assert!(
            !is_milestone_id(&MILESTONE_ID.to_uppercase()),
            "uppercase is rejected, not normalised"
        );
        assert!(!is_milestone_id("g123456789abcdef0123456789abcdef"), "hex");
        // The reason the check exists: nothing may add a segment or a query.
        assert!(!is_milestone_id("../../v1/dev/users0123456789abcde"));
        assert!(!is_milestone_id("0123456789abcdef0123456789abcd?x"));
    }

    #[test]
    fn the_milestone_routes_forward_only_their_own_parameters() {
        // `entity_id` means nothing on a list of entities and `account_id` is the actor the
        // milestone routes deliberately never send. Neither reaches Cloud.
        let list: MilestoneListQuery =
            serde_urlencoded::from_str("limit=12&cursor=AbC%3D&entity_id=deadbeef&account_id=U1")
                .unwrap();
        let mut url = Url::parse("http://cloud/v1/milestones").unwrap();
        list.apply(&mut url);
        assert_eq!(url.query().unwrap(), "limit=12&cursor=AbC%3D");

        let timeline: TimelineQuery =
            serde_urlencoded::from_str("from=2026-07-10&to=2026-08-08&limit=1000").unwrap();
        let mut url = Url::parse("http://cloud/v1/milestones/x/timeline").unwrap();
        timeline.apply(&mut url);
        assert_eq!(url.query().unwrap(), "from=2026-07-10&to=2026-08-08");

        let empty: TimelineQuery = serde_urlencoded::from_str("").unwrap();
        let mut url = Url::parse("http://cloud/v1/milestones/x/timeline").unwrap();
        empty.apply(&mut url);
        assert_eq!(url.query(), None, "no bare ? when nothing was asked for");
    }

    #[tokio::test]
    async fn the_milestone_routes_send_no_viewer_at_all() {
        let (base, seen) = mock_cloud(json_body(200, PAGE)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        for (uri, upstream) in [
            (
                "/api/cloud/v1/milestones?limit=12&account_id=U024BE7LH",
                "/v1/milestones?limit=12",
            ),
            (
                &format!(
                    "/api/cloud/v1/milestones/{MILESTONE_ID}/timeline?from=2026-07-10&account_id=U1"
                ),
                &format!("/v1/milestones/{MILESTONE_ID}/timeline?from=2026-07-10"),
            ),
        ] {
            let (status, _, _) = get(&app, uri, Some(&token)).await;
            assert_eq!(status, StatusCode::OK, "{uri}");

            let (seen_uri, headers) = seen.last();
            assert_eq!(seen_uri, upstream);
            // A milestone's history is the same history for every viewer, so the
            // account the webview offered is dropped rather than forwarded.
            assert!(headers.get("x-g6-actor-id").is_none(), "no actor identity");
            assert!(
                headers.get(header::AUTHORIZATION).is_none(),
                "no inbound auth"
            );
        }
    }

    #[tokio::test]
    async fn a_milestone_id_that_is_not_the_entity_shape_never_reaches_cloud() {
        let (base, seen) = mock_cloud(json_body(200, PAGE)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        for id in [
            MILESTONE_ID.to_uppercase(),
            MILESTONE_ID[1..].to_owned(),
            format!("{MILESTONE_ID}0"),
            "g123456789abcdef0123456789abcdef".to_owned(),
            "%2e%2e%2f%2e%2e%2fv1%2fdev%2fusers%2f0123".to_owned(),
        ] {
            let (status, _, body) = get(
                &app,
                &format!("/api/cloud/v1/milestones/{id}/timeline"),
                Some(&token),
            )
            .await;

            assert_eq!(status, StatusCode::BAD_REQUEST, "{id}");
            assert!(body.contains("invalid_milestone_id"), "{body}");
            // Never the value: it is user input echoed into a log or a toast.
            assert!(!body.contains(&id), "{body}");
        }
        assert!(seen.0.lock().unwrap().is_empty(), "nothing reached Cloud");
    }

    #[tokio::test]
    async fn a_missing_or_merged_milestone_is_relayed_rather_than_flattened() {
        for (upstream, envelope) in [
            (
                404u16,
                r#"{"error":{"code":"milestone_not_found","message":"no such milestone"}}"#,
            ),
            (
                410,
                r#"{"error":{"code":"milestone_merged","message":"merged into another identity"}}"#,
            ),
        ] {
            let (base, _) = mock_cloud(json_body(upstream, envelope)).await;
            let app = gateway(Some(&base)).await;
            let token = token(&app).await;

            let (status, content_type, got) = get(
                &app,
                &format!("/api/cloud/v1/milestones/{MILESTONE_ID}/timeline"),
                Some(&token),
            )
            .await;

            // The client tells a typo from a merge by these two, so neither may
            // become `cloud_invalid_response` on the way through.
            assert_eq!(status.as_u16(), upstream);
            assert_eq!(content_type, "application/json");
            assert_eq!(got, envelope);
        }
    }

    #[tokio::test]
    async fn an_inbox_route_still_rejects_a_status_only_milestones_may_answer() {
        let (base, _) = mock_cloud(json_body(410, r#"{"error":{"code":"gone"}}"#)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        let (status, _, body) = get(
            &app,
            "/api/cloud/v1/actions?account_id=U024BE7LH",
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert!(body.contains("cloud_invalid_response"), "{body}");
    }

    #[tokio::test]
    async fn a_browser_supplied_actor_header_is_not_the_one_forwarded() {
        let (base, seen) = mock_cloud(json_body(200, PAGE)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        let res = app
            .clone()
            .oneshot(
                Request::get("/api/cloud/v1/actions?account_id=U024BE7LH")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .header(ACTOR_HEADER, "U-SOMEONE-ELSE")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(seen.last().1["x-g6-actor-id"], "U024BE7LH");
    }

    #[tokio::test]
    async fn an_unusable_account_is_rejected_before_cloud_is_called() {
        let (base, seen) = mock_cloud(json_body(200, PAGE)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        for uri in [
            "/api/cloud/v1/actions",
            "/api/cloud/v1/actions?account_id=",
            "/api/cloud/v1/actions?account_id=U1%0d%0aX-Evil%3A%201",
            "/api/cloud/v1/overview?account_id=",
        ] {
            let (status, _, body) = get(&app, uri, Some(&token)).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
            assert!(body.contains("invalid_actor"), "{uri}: {body}");
            assert!(
                !body.contains("X-Evil"),
                "{uri}: the rejected value is not echoed back"
            );
        }
        assert!(seen.0.lock().unwrap().is_empty(), "nothing reached Cloud");
    }

    #[tokio::test]
    async fn the_development_user_directory_is_relayed_unparameterised() {
        let (base, seen) = mock_cloud(json_body(200, PAGE)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        let (status, _, got) = get(&app, "/api/cloud/v1/dev/users?limit=5", Some(&token)).await;

        // Present because the test profile is a debug build; a release binary
        // has no such route and answers 404.
        assert_eq!(status, StatusCode::OK);
        assert_eq!(got, PAGE);

        let (uri, headers) = seen.last();
        assert_eq!(uri, "/v1/dev/users", "no paging, no forwarded query");
        assert!(
            headers.get("x-g6-actor-id").is_none(),
            "the directory has no viewer"
        );
    }

    const RESOLVE_REQUEST: &str = r#"{"provider":"slack","reference":{"type":"trace","id":"0123456789abcdef0123456789abcdef"},"depth":"context","limit":50}"#;
    const RESOLVE_REPLY: &str = r#"{"type":"raw","data":{"results":[{"queryName":"extraction","nextCursor":"","rows":[]}]}}"#;

    #[tokio::test]
    async fn the_resolve_body_reaches_cloud_byte_for_byte() {
        let (base, seen) = mock_cloud(json_body(200, RESOLVE_REPLY)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        let (status, content_type, got) = post_json(
            &app,
            "/api/cloud/v1/extractions/resolve",
            Some(&token),
            RESOLVE_REQUEST,
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert!(content_type.starts_with("application/json"), "{content_type}");
        assert_eq!(got, RESOLVE_REPLY);

        let (uri, headers) = seen.last();
        assert_eq!(uri, "/v1/extractions/resolve", "no query string is added");
        // Not re-serialised: Cloud's schema is `deny_unknown_fields` and its own
        // 400 is the contract, so a round trip through serde here could only
        // change what Cloud sees.
        assert_eq!(
            String::from_utf8(seen.last_body()).unwrap(),
            RESOLVE_REQUEST
        );
        assert!(
            headers.get("x-g6-actor-id").is_none(),
            "a landed record reads the same for every viewer"
        );
        assert!(
            headers.get(header::AUTHORIZATION).is_none(),
            "the desktop's own bearer token does not ride along"
        );
    }

    #[tokio::test]
    async fn an_oversized_resolve_body_never_becomes_an_outbound_request() {
        let (base, seen) = mock_cloud(json_body(200, RESOLVE_REPLY)).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        let huge = format!(r#"{{"cursor":"{}"}}"#, "A".repeat(MAX_RESOLVE_BODY));
        let (status, _, body) = post_json(
            &app,
            "/api/cloud/v1/extractions/resolve",
            Some(&token),
            &huge,
        )
        .await;

        assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
        assert!(body.contains("request_too_large"), "{body}");
        assert_eq!(seen.count(), 0, "nothing reached Cloud");
    }

    #[tokio::test]
    async fn resolve_relays_the_statuses_only_it_can_answer() {
        // `404 signal_not_found` is how Cloud says a reference names nothing, or
        // names it under the other provider. It is not this gateway's failure.
        for (upstream, code) in [
            (404u16, "signal_not_found"),
            (500, "extraction_failed"),
            (400, "unsupported_reference_type"),
        ] {
            let body: &'static str = Box::leak(
                format!(r#"{{"error":{{"code":"{code}","message":"no"}}}}"#).into_boxed_str(),
            );
            let (base, _) = mock_cloud(json_body(upstream, body)).await;
            let app = gateway(Some(&base)).await;
            let token = token(&app).await;

            let (status, _, got) = post_json(
                &app,
                "/api/cloud/v1/extractions/resolve",
                Some(&token),
                RESOLVE_REQUEST,
            )
            .await;

            assert_eq!(status.as_u16(), upstream, "{code}");
            assert!(got.contains(code), "{code}: {got}");
        }
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

            let (status, _, got) = get(&app, "/api/cloud/v1/milestones", Some(&token)).await;
            assert_eq!(status.as_u16(), upstream);
            assert_eq!(got, body);
        }
    }

    #[tokio::test]
    async fn an_upstream_504_stays_a_bodyless_504() {
        let (base, _) = mock_cloud(|| StatusCode::GATEWAY_TIMEOUT.into_response()).await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        let (status, _, body) = get(&app, "/api/cloud/v1/milestones", Some(&token)).await;
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
                    "http://elsewhere.example.com/v1/milestones",
                )],
            )
                .into_response()
        })
        .await;
        let app = gateway(Some(&base)).await;
        let token = token(&app).await;

        let (status, _, body) = get(&app, "/api/cloud/v1/milestones", Some(&token)).await;
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

        let (status, _, body) = get(&app, "/api/cloud/v1/milestones", Some(&token)).await;
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

        let (status, _, body) = get(&app, "/api/cloud/v1/milestones", Some(&token)).await;
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
            "/api/cloud/livez",
            "/api/cloud/v1/milestones/1",
            "/api/cloud/",
            // Cloud 2.0 deleted the two-class routes. They are not relayed to an
            // upstream that would only answer 404 for them either.
            "/api/cloud/v1/open-decisions",
            "/api/cloud/v1/open-constraints",
        ] {
            let (status, _, _) = get(&app, uri, Some(&token)).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{uri} must not be proxied");
        }
        assert!(seen.0.lock().unwrap().is_empty(), "nothing reached Cloud");
    }
}
