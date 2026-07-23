mod api;
mod auth;
mod mentions;
mod slack;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{MethodFilter, get, on, post};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::Value;
use sqlx::SqlitePool;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

const TICKET_TTL: Duration = Duration::from_secs(30);

pub fn public_url() -> String {
    std::env::var("GEAR6_PUBLIC_URL").unwrap_or_else(|_| "http://localhost:3000/".into())
}

pub fn public_ws_url() -> String {
    std::env::var("GEAR6_WS_URL").unwrap_or_else(|_| "ws://localhost:3000".into())
}

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub tx: broadcast::Sender<Value>,
    /// One-shot handoff from `rtm.connect` to the websocket. Browsers cannot set
    /// headers on a ws handshake, so something has to travel in the URL — and it
    /// must not be the long-lived bearer token, which would then leak into proxy
    /// logs and browser history.
    tickets: Arc<Mutex<HashMap<String, (i64, Instant)>>>,
    /// user_id -> (live rtm sockets, manually away). Presence is derived, not
    /// stored: a user is active when a socket is open and they have not said otherwise.
    ///
    /// ponytail: in-process, exactly like `tx`. A second node needs Redis for both.
    presence: Arc<Mutex<HashMap<i64, (usize, bool)>>>,
}

impl AppState {
    pub fn new(db: SqlitePool) -> Self {
        AppState {
            db,
            tx: broadcast::channel(256).0,
            tickets: Arc::new(Mutex::new(HashMap::new())),
            presence: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// (open sockets, manually away) — the raw pair, for `users.getPresence`.
    pub fn presence_state(&self, user_id: i64) -> (usize, bool) {
        self.presence.lock().unwrap().get(&user_id).copied().unwrap_or((0, false))
    }

    pub fn presence_of(&self, user_id: i64) -> &'static str {
        match self.presence_state(user_id) {
            (n, false) if n > 0 => "active",
            _ => "away",
        }
    }

    pub fn set_manual_away(&self, user_id: i64, away: bool) {
        self.presence.lock().unwrap().entry(user_id).or_default().1 = away;
    }

    pub fn broadcast_presence(&self, user_id: i64) {
        let _ = self.tx.send(serde_json::json!({
            "type": "presence_change",
            "user": slack::user_id(user_id),
            "presence": self.presence_of(user_id),
        }));
    }

    pub fn mint_ticket(&self, user_id: i64) -> String {
        let bytes: [u8; 16] = rand::random();
        let ticket: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let mut t = self.tickets.lock().unwrap();
        t.retain(|_, (_, issued)| issued.elapsed() < TICKET_TTL);
        t.insert(ticket.clone(), (user_id, Instant::now()));
        ticket
    }

    fn take_ticket(&self, ticket: &str) -> Option<i64> {
        let mut t = self.tickets.lock().unwrap();
        match t.remove(ticket) {
            Some((user_id, issued)) if issued.elapsed() < TICKET_TTL => Some(user_id),
            _ => None,
        }
    }
}

pub fn app(state: AppState) -> Router {
    // MethodFilter has a const `or`; it deliberately does not implement BitOr.
    let both = MethodFilter::GET.or(MethodFilter::POST);

    let api = Router::new()
        .route("/auth.test", on(both, api::auth_test))
        .route("/conversations.list", on(both, api::conversations_list))
        .route("/conversations.create", on(both, api::conversations_create))
        .route("/conversations.join", on(both, api::conversations_join))
        .route("/conversations.history", on(both, api::conversations_history))
        .route("/conversations.replies", on(both, api::conversations_replies))
        .route("/chat.postMessage", on(both, api::chat_post_message))
        .route("/users.list", on(both, api::users_list))
        .route("/users.info", on(both, api::users_info))
        .route("/users.identity", on(both, api::users_identity))
        .route("/users.lookupByEmail", on(both, api::users_lookup_by_email))
        .route("/users.conversations", on(both, api::users_conversations))
        .route("/users.profile.get", on(both, api::users_profile_get))
        .route("/users.profile.set", on(both, api::users_profile_set))
        .route("/users.getPresence", on(both, api::users_get_presence))
        .route("/users.setPresence", on(both, api::users_set_presence))
        .route("/rtm.connect", on(both, api::rtm_connect));

    Router::new()
        // Not Slack API surface — Slack has no username/password concept.
        .route("/register", post(auth::register))
        .route("/login", post(auth::login))
        .route("/logout", post(auth::logout))
        .route("/rtm", get(rtm_ws))
        .nest("/api", api)
        .layer(cors())
        .with_state(state)
}

/// The web client is served from a different origin in development (the Vite dev
/// server). A single configured origin rather than `Any`: these endpoints read the
/// `Authorization` header, and `Any` would let any page on the internet spend a
/// user's token.
fn cors() -> CorsLayer {
    let origin = std::env::var("GEAR6_CORS_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:5173".into())
        .parse::<HeaderValue>()
        .expect("GEAR6_CORS_ORIGIN is not a valid header value");

    CorsLayer::new()
        .allow_origin(origin)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
}

#[derive(Deserialize)]
struct TicketQuery {
    ticket: Option<String>,
}

async fn rtm_ws(
    State(state): State<AppState>,
    Query(q): Query<TicketQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    match q.ticket.as_deref().and_then(|t| state.take_ticket(t)) {
        Some(user_id) => ws.on_upgrade(move |socket| rtm_socket(socket, state, user_id)),
        None => (StatusCode::UNAUTHORIZED, "invalid_ticket").into_response(),
    }
}

/// Ties a user's presence to the lifetime of one socket. It is a guard rather than
/// a pair of calls because the socket loop below returns from six different places,
/// including the error paths — `Drop` is the only thing that covers all of them.
///
/// Only the 0<->1 transitions broadcast, so three open tabs are one `presence_change`.
struct PresenceGuard {
    state: AppState,
    user_id: i64,
}

impl PresenceGuard {
    fn new(state: AppState, user_id: i64) -> Self {
        let first = {
            let mut p = state.presence.lock().unwrap();
            let entry = p.entry(user_id).or_default();
            entry.0 += 1;
            entry.0 == 1
        };
        if first {
            state.broadcast_presence(user_id);
        }
        PresenceGuard { state, user_id }
    }
}

impl Drop for PresenceGuard {
    fn drop(&mut self) {
        let last = {
            let mut p = self.state.presence.lock().unwrap();
            let entry = p.entry(self.user_id).or_default();
            entry.0 = entry.0.saturating_sub(1);
            entry.0 == 0
        };
        if last {
            self.state.broadcast_presence(self.user_id);
        }
    }
}

async fn rtm_socket(socket: WebSocket, state: AppState, user_id: i64) {
    let _presence = PresenceGuard::new(state.clone(), user_id);
    let (mut sink, mut stream) = socket.split();
    let mut rx = state.tx.subscribe();

    if sink.send(Message::text(r#"{"type":"hello"}"#)).await.is_err() {
        return;
    }

    // ponytail: single-process broadcast — every event goes to every socket and the
    // client filters by channel. Fine to a few thousand sockets on one node. Swap tx
    // for Redis pubsub if this ever runs as more than one process.
    loop {
        tokio::select! {
            event = rx.recv() => match event {
                Ok(event) => {
                    if sink.send(Message::text(event.to_string())).await.is_err() {
                        return;
                    }
                }
                // Slow consumer: keep the socket. The client can backfill through
                // conversations.history rather than lose the connection.
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    eprintln!("rtm socket lagged, dropped {n} events");
                }
                Err(broadcast::error::RecvError::Closed) => return,
            },
            incoming = stream.next() => match incoming {
                // The socket is one-way; posting is HTTP. Only the keepalive matters.
                Some(Ok(Message::Text(t))) => {
                    let is_ping = serde_json::from_str::<Value>(&t)
                        .ok()
                        .and_then(|v| v.get("type").and_then(Value::as_str).map(str::to_owned))
                        .as_deref()
                        == Some("ping");
                    if is_ping && sink.send(Message::text(r#"{"type":"pong"}"#)).await.is_err() {
                        return;
                    }
                }
                Some(Ok(_)) => {}
                Some(Err(_)) | None => return,
            },
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://gear6.db?mode=rwc".into());
    let db = SqlitePool::connect(&url).await?;
    sqlx::migrate!().run(&db).await?;

    if auth::auth_disabled() {
        eprintln!("WARNING: GEAR6_DISABLE_AUTH is set — unauthenticated requests resolve as the 'dev' user");
    }

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".into());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    println!("gear6 listening on {}", listener.local_addr()?);
    axum::serve(listener, app(AppState::new(db))).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, header};
    use sqlx::sqlite::SqlitePoolOptions;
    use tower::ServiceExt;

    async fn test_app() -> Router {
        // Every pooled connection to `sqlite::memory:` gets its OWN private
        // database, so migrations would vanish between calls. Hence one connection.
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&db).await.unwrap();
        app(AppState::new(db))
    }

    /// Post form-encoded, the way the real SDKs do.
    async fn call(app: &Router, uri: &str, token: Option<&str>, body: &str) -> Value {
        post(app, uri, token, "application/x-www-form-urlencoded; charset=utf-8", body).await
    }

    /// Post JSON, the way the web client does. Structured args (`profile`) arrive as
    /// objects here and as JSON *strings* through `call` — both paths must work.
    async fn call_json(app: &Router, uri: &str, token: Option<&str>, body: &str) -> Value {
        post(app, uri, token, "application/json", body).await
    }

    async fn post(
        app: &Router,
        uri: &str,
        token: Option<&str>,
        content_type: &str,
        body: &str,
    ) -> Value {
        let mut req =
            Request::builder().method("POST").uri(uri).header(header::CONTENT_TYPE, content_type);
        if let Some(t) = token {
            req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
        }
        let res = app
            .clone()
            .oneshot(req.body(Body::from(body.to_owned())).unwrap())
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::OK,
            "{uri} must answer 200; Slack reports errors in the body"
        );
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn end_to_end() {
        let app = test_app().await;
        let creds = "username=astha&password=password1";

        let r = call(&app, "/register", None, creds).await;
        assert_eq!(r["ok"], true, "{r}");
        assert_eq!(r["user_id"], "U00000001");
        assert_eq!(call(&app, "/register", None, creds).await["error"], "name_taken");

        let token = call(&app, "/login", None, creds).await["token"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(token.starts_with("xoxb-"));

        // auth is enforced, and reports failure inside a 200 body
        assert_eq!(call(&app, "/api/auth.test", None, "").await["error"], "not_authed");
        assert_eq!(
            call(&app, "/api/auth.test", Some("xoxb-bogus"), "").await["error"],
            "invalid_auth"
        );
        assert_eq!(call(&app, "/api/auth.test", Some(&token), "").await["user"], "astha");

        let t = Some(token.as_str());
        let ch = call(&app, "/api/conversations.create", t, "name=general").await["channel"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(ch, "C00000001");
        assert_eq!(
            call(&app, "/api/conversations.create", t, "name=general").await["error"],
            "name_taken"
        );

        let root = call(&app, "/api/chat.postMessage", t, &format!("channel={ch}&text=hello")).await
            ["ts"]
            .as_str()
            .unwrap()
            .to_owned();
        let reply = call(
            &app,
            "/api/chat.postMessage",
            t,
            &format!("channel={ch}&text=a+reply&thread_ts={root}"),
        )
        .await;
        assert_eq!(reply["message"]["thread_ts"], root.as_str());

        // replying to a reply re-parents onto the real root
        let deep = call(
            &app,
            "/api/chat.postMessage",
            t,
            &format!("channel={ch}&text=deeper&thread_ts={}", reply["ts"].as_str().unwrap()),
        )
        .await;
        assert_eq!(deep["message"]["thread_ts"], root.as_str(), "threads stay one level deep");

        // history excludes replies and decorates the parent
        let hist = call(&app, "/api/conversations.history", t, &format!("channel={ch}")).await;
        assert_eq!(hist["messages"].as_array().unwrap().len(), 1);
        assert_eq!(hist["messages"][0]["reply_count"], 2);
        assert_eq!(hist["has_more"], false);

        // replies returns parent + both replies, oldest first
        let rep =
            call(&app, "/api/conversations.replies", t, &format!("channel={ch}&ts={root}")).await;
        let msgs = rep["messages"].as_array().unwrap().clone();
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0]["ts"], root.as_str());
        assert!(msgs[0]["ts"].as_str().unwrap() < msgs[1]["ts"].as_str().unwrap());

        // any message in the thread resolves to the same thread
        let via_reply = call(
            &app,
            "/api/conversations.replies",
            t,
            &format!("channel={ch}&ts={}", msgs[2]["ts"].as_str().unwrap()),
        )
        .await;
        assert_eq!(via_reply["messages"].as_array().unwrap().len(), 3);

        // mentions are linkified on write and resolved on read
        let m = call(
            &app,
            "/api/chat.postMessage",
            t,
            &format!("channel={ch}&text=hi+@astha+in+%23general"),
        )
        .await;
        // No `|name` label in the stored text: names are resolved from the sidecar at read time.
        assert_eq!(m["message"]["text"], "hi <@U00000001> in <#C00000001>");
        assert_eq!(m["message"]["mentions"]["U00000001"], "astha");
        assert_eq!(m["message"]["mentions"]["C00000001"], "general");

        let hist = call(&app, "/api/conversations.history", t, &format!("channel={ch}&limit=1")).await;
        assert_eq!(hist["messages"][0]["mentions"]["U00000001"], "astha");

        assert_eq!(
            call(&app, "/api/conversations.history", t, "channel=C99999999").await["error"],
            "channel_not_found"
        );
        assert_eq!(
            call(&app, "/api/chat.postMessage", t, &format!("channel={ch}")).await["error"],
            "no_text"
        );
    }

    #[tokio::test]
    async fn user_profile_presence_and_email() {
        let app = test_app().await;
        let creds = "username=astha&password=password1&email=Astha%40Example.com";
        assert_eq!(call(&app, "/register", None, creds).await["ok"], true);
        call(&app, "/register", None, "username=bo&password=password1").await;
        assert_eq!(
            call(&app, "/register", None, "username=zed&password=password1&email=astha%40example.com")
                .await["error"],
            "email_taken",
            "the email index must be distinguishable from the username one"
        );
        assert_eq!(
            call(&app, "/register", None, "username=zed&password=password1&email=nonsense").await
                ["error"],
            "invalid_email"
        );

        let token = call(&app, "/login", None, creds).await["token"].as_str().unwrap().to_owned();
        let t = Some(token.as_str());

        // Registration seeds real_name from the username, leaves display_name empty
        // (clients fall back), and folds the address.
        let me = call(&app, "/api/users.info", t, "user=U00000001").await;
        assert_eq!(me["user"]["real_name"], "astha");
        assert_eq!(me["user"]["profile"]["display_name"], "");
        assert_eq!(me["user"]["profile"]["email"], "astha@example.com");

        // Form-encoded: `profile` is a JSON string. This is what slack_sdk sends.
        let set = call(
            &app,
            "/api/users.profile.set",
            t,
            "profile=%7B%22display_name%22%3A%22Astha+J%22%2C%22title%22%3A%22SRE%22%7D",
        )
        .await;
        assert_eq!(set["profile"]["display_name"], "Astha J", "{set}");
        assert_eq!(set["profile"]["title"], "SRE");

        // JSON: `profile` is an object. This is what the web client sends.
        let set = call_json(&app, "/api/users.profile.set", t, r#"{"profile":{"status_text":"lunch"}}"#).await;
        assert_eq!(set["profile"]["status_text"], "lunch");

        // A single name/value pair leaves every other field alone.
        call(&app, "/api/users.profile.set", t, "name=status_emoji&value=%3Acoffee%3A").await;
        let got = call(&app, "/api/users.profile.get", t, "").await;
        assert_eq!(got["profile"]["status_emoji"], ":coffee:");
        assert_eq!(got["profile"]["display_name"], "Astha J");
        assert_eq!(got["profile"]["status_text"], "lunch");

        for (body, want) in [
            ("name=is_admin&value=true", "invalid_profile"),
            ("name=status_emoji&value=coffee", "invalid_profile"),
            ("name=email&value=nonsense", "invalid_email"),
            ("user=U00000002&name=title&value=nope", "cannot_update_admin_user"),
        ] {
            assert_eq!(call(&app, "/api/users.profile.set", t, body).await["error"], want, "{body}");
        }

        assert_eq!(
            call(&app, "/api/users.lookupByEmail", t, "email=ASTHA%40example.com").await["user"]["id"],
            "U00000001",
            "lookup folds the needle the same way storage folded the hay"
        );
        assert_eq!(
            call(&app, "/api/users.lookupByEmail", t, "email=nobody%40example.com").await["error"],
            "users_not_found"
        );

        // No rtm socket in a oneshot test, so presence is away and connection_count is 0.
        let pres = call(&app, "/api/users.getPresence", t, "").await;
        assert_eq!(pres["presence"], "away");
        assert_eq!(pres["connection_count"], 0);
        assert_eq!(pres["manual_away"], false);
        call(&app, "/api/users.setPresence", t, "presence=away").await;
        assert_eq!(call(&app, "/api/users.getPresence", t, "").await["manual_away"], true);
        assert_eq!(
            call(&app, "/api/users.getPresence", t, "user=U00000002").await.get("manual_away"),
            None,
            "someone else's presence detail is not ours to read"
        );
        assert_eq!(
            call(&app, "/api/users.setPresence", t, "presence=sideways").await["error"],
            "invalid_presence"
        );

        let plain = call(&app, "/api/users.list", t, "").await;
        assert!(plain["members"][0].get("presence").is_none(), "presence is opt-in");
        assert_eq!(call(&app, "/api/users.list", t, "presence=true").await["members"][0]["presence"], "away");

        assert_eq!(call(&app, "/api/users.identity", t, "").await["user"]["name"], "Astha J");
        call(&app, "/api/conversations.create", t, "name=general").await;
        assert_eq!(
            call(&app, "/api/users.conversations", t, "").await["channels"][0]["id"],
            "C00000001"
        );
    }

    #[tokio::test]
    async fn history_is_newest_first_and_cursor_walks_backward() {
        let app = test_app().await;
        let creds = "username=astha&password=password1";
        call(&app, "/register", None, creds).await;
        let token = call(&app, "/login", None, creds).await["token"]
            .as_str()
            .unwrap()
            .to_owned();
        let t = Some(token.as_str());
        call(&app, "/api/conversations.create", t, "name=general").await;

        let mut sent = vec![];
        for i in 0..3 {
            let r =
                call(&app, "/api/chat.postMessage", t, &format!("channel=C00000001&text=m{i}"))
                    .await;
            sent.push(r["ts"].as_str().unwrap().to_owned());
        }
        assert!(
            sent[0] < sent[1] && sent[1] < sent[2],
            "ts must increase even when three posts land in the same microsecond"
        );

        let p1 = call(&app, "/api/conversations.history", t, "channel=C00000001&limit=1").await;
        assert_eq!(p1["messages"][0]["text"], "m2", "history is newest first");
        assert_eq!(p1["has_more"], true);

        let cursor = p1["response_metadata"]["next_cursor"].as_str().unwrap().to_owned();
        assert!(!cursor.is_empty());
        let p2 = call(
            &app,
            "/api/conversations.history",
            t,
            &format!("channel=C00000001&limit=1&cursor={cursor}"),
        )
        .await;
        assert_eq!(p2["messages"][0]["text"], "m1", "cursor walks backward in time");

        let p3 = call(
            &app,
            "/api/conversations.history",
            t,
            &format!(
                "channel=C00000001&limit=1&cursor={}",
                p2["response_metadata"]["next_cursor"].as_str().unwrap()
            ),
        )
        .await;
        assert_eq!(p3["messages"][0]["text"], "m0");
        assert_eq!(p3["has_more"], false);
        assert_eq!(p3["response_metadata"]["next_cursor"], "");

        assert_eq!(
            call(&app, "/api/conversations.history", t, "channel=C00000001&cursor=not-base64!")
                .await["error"],
            "invalid_cursor"
        );
    }
}
