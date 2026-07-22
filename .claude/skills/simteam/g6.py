"""The simteam agent's client. Compact in, compact out, invariants checked in code.

    G6_CAST=$SP/cast.json python3 .claude/skills/simteam/g6.py <handle> <cmd> ...

    catchup                  every channel you own, only what's new since last call
    post   <chan> <text>     -> ts
    reply  <ts>   <text>     channel inferred from what you've seen
    thread <ts>              one thread, oldest first
    channels                 what you own

Two jobs. It renders responses as lines instead of JSON, which is most of what an
agent would otherwise spend its context on. And it asserts the wire invariants on
every response it touches, in code, so no agent has to hold forty rules in its head
and eyeball them. Violations go to <cast>.violations.jsonl and, once per distinct
finding, to #bugs.

Per-handle state (last-seen ts, ts->channel) lives beside the cast file so six of
these can run at once without clobbering each other.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

CAST_PATH = os.environ.get("G6_CAST", "cast.json")
TS_RE = re.compile(r"^\d{10}\.\d{6}$")
UID_RE = re.compile(r"^U\d{8}$")
CID_RE = re.compile(r"^C\d{8}$")

cast = json.load(open(CAST_PATH))
URL = cast["url"].rstrip("/")
CHANNELS = cast["channels"]                       # name -> C0000000N
BY_ID = {v: k for k, v in CHANNELS.items()}
violations = []


# ------------------------------------------------------------------ state

def state_path(handle):
    return f"{CAST_PATH}.{handle}.state"


def load_state(handle):
    try:
        return json.load(open(state_path(handle)))
    except FileNotFoundError:
        return {"seen": {}, "ts_channel": {}, "watch": {}}


def save_state(handle, st):
    json.dump(st, open(state_path(handle), "w"))


# ------------------------------------------------------------------ transport

def call(path, data, token):
    req = urllib.request.Request(f"{URL}{path}", data=urllib.parse.urlencode(data).encode())
    req.add_header("Authorization", f"Bearer {token}")
    try:
        r = json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        # An HTTP error status is itself a violation: Slack reports failure in the
        # envelope at 200. Still try to parse, so the caller sees the error name.
        bad(path, data, "http_status", f"HTTP {e.code}, expected 200 with ok:false")
        try:
            r = json.load(e)
        except Exception:
            return {"ok": False, "error": f"http_{e.code}"}
    check_envelope(path, data, r)
    return r


def bad(endpoint, args, check, msg):
    """`check` names the rule, `msg` describes this instance. One broken rule hits
    every message in a page, so #bugs is deduped on the rule and the log keeps both."""
    violations.append({"endpoint": endpoint, "args": args, "check": check, "violation": msg})


def curl(endpoint, args):
    body = " ".join(f'-d "{k}={v}"' for k, v in args.items())
    return f'curl -s -X POST $GEAR6_URL{endpoint} -H "Authorization: Bearer $T" {body}'


def flush(token):
    """Record findings, and surface each distinct one to #bugs exactly once."""
    if not violations:
        return
    path = f"{CAST_PATH}.violations.jsonl"
    # ponytail: dedupe by re-reading the log. Two agents racing can double-post one
    # finding to #bugs; the jsonl is still correct and dedupe in the report is cheap.
    seen = set()
    try:
        for line in open(path):
            v = json.loads(line)
            seen.add((v["endpoint"], v["check"]))
    except FileNotFoundError:
        pass
    with open(path, "a") as f:
        for v in violations:
            f.write(json.dumps(v) + "\n")
    for v in violations:
        key = (v["endpoint"], v["check"])
        if key in seen:
            continue
        seen.add(key)
        print(f"VIOLATION {v['endpoint']}: {v['violation']}", file=sys.stderr)
        if "bugs" in CHANNELS:
            text = f"{v['endpoint']} {v['violation']}\n{curl(v['endpoint'], v['args'])}"
            urllib.request.urlopen(
                urllib.request.Request(
                    f"{URL}/api/chat.postMessage",
                    data=urllib.parse.urlencode({"channel": CHANNELS["bugs"], "text": text}).encode(),
                    headers={"Authorization": f"Bearer {token}"},
                )
            ).read()


# ------------------------------------------------------------------ invariants

def check_envelope(endpoint, args, r):
    if not isinstance(r.get("ok"), bool):
        bad(endpoint, args, "envelope", f"no boolean ok in response: {json.dumps(r)[:200]}")
    elif not r["ok"] and not r.get("error"):
        bad(endpoint, args, "envelope", "ok:false with no error name")


def check_message(endpoint, args, m, *, in_thread=None):
    """Shape checks that hold for any message, from any endpoint."""
    ts = m.get("ts", "")
    if not TS_RE.match(ts):
        bad(endpoint, args, "ts_format", f"ts {ts!r} is not <10 digits>.<6 digits>")
    if not UID_RE.match(m.get("user", "")):
        bad(endpoint, args, "user_id", f"user {m.get('user')!r} is not U + 8 digits")
    has_count, has_latest = "reply_count" in m, "latest_reply" in m
    if has_count != has_latest:
        bad(endpoint, args, "thread_fields", f"{ts}: reply_count and latest_reply must appear together")
    if has_count:
        if m["reply_count"] < 1:
            bad(endpoint, args, "reply_count", f"{ts}: reply_count {m['reply_count']} on a decorated message")
        if m.get("thread_ts") != ts:
            bad(endpoint, args, "promotion", f"{ts}: parent with replies must carry thread_ts == ts")
        if has_latest and not (m["latest_reply"] > ts):
            bad(endpoint, args, "latest_reply", f"{ts}: latest_reply {m['latest_reply']} is not after the parent")
    if in_thread is not None and m.get("thread_ts") != in_thread:
        bad(endpoint, args, "thread_ts", f"{ts}: in thread {in_thread} but thread_ts is {m.get('thread_ts')!r}")


def check_page(endpoint, args, r, *, descending):
    if not r.get("ok"):
        return
    msgs = r.get("messages", [])
    ts = [m.get("ts", "") for m in msgs]
    ordered = sorted(ts, reverse=descending)
    if ts != ordered or len(set(ts)) != len(ts):
        bad(endpoint, args, "order", f"messages not strictly {'descending' if descending else 'ascending'}: {ts}")
    cur = r.get("response_metadata", {}).get("next_cursor", "")
    if bool(r.get("has_more")) != bool(cur):
        bad(endpoint, args, "has_more", f"has_more={r.get('has_more')} but next_cursor={cur!r}")


# ------------------------------------------------------------------ rendering

def render(m, names):
    """One message, one line. mentions come back encoded; put the names back."""
    text = m.get("text", "")
    for mid, name in (m.get("mentions") or {}).items():
        text = text.replace(f"<@{mid}>", f"@{name}").replace(f"<#{mid}>", f"#{name}")
    text = text.replace("\n", " / ")
    who = names.get(m.get("user"), m.get("user", "?"))
    mark = f" [{m['reply_count']} replies]" if m.get("reply_count") else ""
    return f"  {m['ts']}  {who:10} {text}{mark}"


def roster(token):
    r = call("/api/users.list", {"limit": "200"}, token)
    members = r.get("members", [])
    if not isinstance(members, list):
        bad("/api/users.list", {}, "users_list", "members is not a list")
        return {}
    ids = [u["id"] for u in members]
    if ids != sorted(ids):
        bad("/api/users.list", {}, "users_list", f"members not ascending by id: {ids}")
    return {u["id"]: u["name"] for u in members}


# ------------------------------------------------------------------ commands

WATCH_MAX = 12


def watch(st, root, ch, last):
    """Follow a thread. history alone will never show you a reply: the parent's ts
    does not move, so once you have seen it, `oldest` excludes it forever."""
    st.setdefault("watch", {})[root] = {"ch": ch, "last": last}
    for old in sorted(st["watch"])[:-WATCH_MAX]:
        del st["watch"][old]


def cmd_catchup(handle, token, owns, st, names):
    out = []
    for name in owns:
        ch = CHANNELS[name]
        args = {"channel": ch, "limit": "20"}
        if st["seen"].get(ch):
            args["oldest"] = st["seen"][ch]
        ep = "/api/conversations.history"
        r = call(ep, args, token)
        if not r.get("ok"):
            out.append(f"#{name}  ERROR {r.get('error')}")
            continue
        check_page(ep, args, r, descending=True)
        msgs = r["messages"]
        for m in msgs:
            check_message(ep, args, m)
            if m.get("thread_ts") and m["thread_ts"] != m["ts"]:
                bad(ep, args, "history_leak", f"{m['ts']}: thread reply leaked into history")
            st["ts_channel"][m["ts"]] = ch
            if m.get("reply_count"):
                watch(st, m["ts"], ch, m["ts"])
        if not msgs:
            continue
        st["seen"][ch] = msgs[0]["ts"]
        out.append(f"#{name}")
        out.extend(render(m, names) for m in reversed(msgs))  # oldest first reads better

    for root, w in sorted(st.get("watch", {}).items()):
        if BY_ID.get(w["ch"]) not in owns:
            continue
        args = {"channel": w["ch"], "ts": root, "limit": "50"}
        ep = "/api/conversations.replies"
        r = call(ep, args, token)
        if not r.get("ok"):
            continue
        check_page(ep, args, r, descending=False)
        fresh = [m for m in r["messages"] if m["ts"] > w["last"]]
        for m in fresh:
            check_message(ep, args, m, in_thread=root)
            st["ts_channel"][m["ts"]] = w["ch"]
        if not fresh:
            continue
        w["last"] = fresh[-1]["ts"]
        out.append(f"#{BY_ID.get(w['ch'], w['ch'])} thread {root}")
        out.extend(render(m, names) for m in fresh)
    return "\n".join(out) or "(nothing new)"


def resolve_channel(ts, token, st, owns):
    """Which channel is this ts in? Cache first, then probe the channels you own."""
    if ts in st["ts_channel"]:
        return st["ts_channel"][ts]
    for name in owns:
        ch = CHANNELS[name]
        if call("/api/conversations.replies", {"channel": ch, "ts": ts, "limit": "1"}, token).get("ok"):
            st["ts_channel"][ts] = ch
            return ch
    return None


def cmd_post(handle, token, st, chan, text, thread_ts=None):
    ch = CHANNELS.get(chan, chan)
    args = {"channel": ch, "text": text}
    if thread_ts:
        args["thread_ts"] = thread_ts
    ep = "/api/chat.postMessage"
    r = call(ep, args, token)
    if not r.get("ok"):
        return f"ERROR {r.get('error')}"
    if not TS_RE.match(r.get("ts", "")):
        bad(ep, args, "ts_format", f"posted ts {r.get('ts')!r} is not <10 digits>.<6 digits>")
    if r.get("channel") != ch:
        bad(ep, args, "echo_channel", f"echoed channel {r.get('channel')!r}, posted to {ch}")
    if thread_ts:
        # Replying to a reply re-parents to the root, so the echo may differ from
        # what we sent — but it must be a real ts at or before it, never absent.
        got = r.get("message", {}).get("thread_ts")
        if not got:
            bad(ep, args, "reply_thread_ts", "reply came back with no thread_ts")
        elif got > thread_ts:
            bad(ep, args, "reparent", f"thread_ts {got} is later than the {thread_ts} we replied to")
        if got:
            watch(st, got, ch, r["ts"])
    st["ts_channel"][r["ts"]] = ch
    return r["ts"]


def cmd_thread(handle, token, st, owns, ts, names):
    ch = resolve_channel(ts, token, st, owns)
    if not ch:
        return f"ERROR no message {ts} in {', '.join(owns)}"
    args = {"channel": ch, "ts": ts, "limit": "50"}
    ep = "/api/conversations.replies"
    r = call(ep, args, token)
    if not r.get("ok"):
        return f"ERROR {r.get('error')}"
    check_page(ep, args, r, descending=False)
    msgs = r["messages"]
    if not msgs:
        bad(ep, args, "empty_thread", "thread resolved but came back empty")
        return "(empty)"
    root = msgs[0]["ts"]
    check_message(ep, args, msgs[0])
    for m in msgs[1:]:
        check_message(ep, args, m, in_thread=root)
        if "reply_count" in m:
            bad(ep, args, "reply_count", f"{m['ts']}: a reply must never carry reply_count")
        st["ts_channel"][m["ts"]] = ch
    watch(st, root, ch, msgs[-1]["ts"])
    return f"#{BY_ID.get(ch, ch)} thread {root}\n" + "\n".join(render(m, names) for m in msgs)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    handle, cmd, rest = sys.argv[1], sys.argv[2], sys.argv[3:]
    if handle not in cast["users"]:
        sys.exit(f"unknown handle {handle}; cast is {', '.join(cast['users'])}")
    token = cast["users"][handle]
    owns = cast.get("owns", {}).get(handle) or list(CHANNELS)
    st = load_state(handle)

    if cmd == "channels":
        print(" ".join(owns))
        return

    names = roster(token)
    if cmd == "catchup":
        print(cmd_catchup(handle, token, owns, st, names))
    elif cmd == "post":
        print(cmd_post(handle, token, st, rest[0], rest[1]))
    elif cmd == "reply":
        ts = rest[0]
        ch = resolve_channel(ts, token, st, owns)
        if not ch:
            print(f"ERROR no message {ts} in {', '.join(owns)}")
        else:
            print(cmd_post(handle, token, st, ch, rest[1], thread_ts=ts))
    elif cmd == "thread":
        print(cmd_thread(handle, token, st, owns, rest[0], names))
    else:
        sys.exit(f"unknown command {cmd}")

    save_state(handle, st)
    flush(token)


if __name__ == "__main__":
    main()
