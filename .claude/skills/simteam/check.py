"""The invariants, asserted in code instead of by six language models.

    GEAR6_URL=http://localhost:3000 python3 .claude/skills/simteam/check.py protocol
    GEAR6_URL=http://localhost:3000 python3 .claude/skills/simteam/check.py audit $SP/cast.json

`protocol` is self-contained: it makes its own users and a scratch channel, and
covers the parts of the wire contract that need no roleplay at all — pagination
bounds, cursor semantics, thread promotion and re-parenting, limit clamping, the
error table. Run it before the sim.

`audit` re-checks the sim's own channels afterwards, where the interesting state is:
concurrent writers, deep threads, hundreds of messages. Ordering, paging integrity,
and reply bookkeeping over data a script could not have invented.

Neither mode deletes anything. Exit status is 1 if anything failed.

Overlaps deliberately kept out: `cargo test` covers history ordering and cursors at
the handler level, and scripts/smoke.py covers wire compat through the real Slack
SDK. This file is the gap between them and SKILL.md's invariant list.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

URL = os.environ.get("GEAR6_URL", "http://localhost:3000").rstrip("/")
TS_RE = re.compile(r"^\d{10}\.\d{6}$")
fails = []


def ok(cond, what, detail=""):
    if not cond:
        fails.append(f"{what}: {detail}")
    return cond


def call(path, data, token=None):
    body = urllib.parse.urlencode(data).encode() if token else json.dumps(data).encode()
    req = urllib.request.Request(f"{URL}{path}", data=body)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    else:
        req.add_header("Content-Type", "application/json")
    try:
        r = json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        ok(False, "http status", f"{path} returned {e.code}, errors belong in the envelope at 200")
        try:
            r = json.load(e)
        except Exception:
            return {"ok": False, "error": f"http_{e.code}"}
    ok(isinstance(r.get("ok"), bool), "envelope", f"{path} has no boolean ok: {json.dumps(r)[:150]}")
    if r.get("ok") is False:
        ok(bool(r.get("error")), "envelope", f"{path} is ok:false with no error name")
    return r


def user(name):
    creds = {"username": name, "password": "password1"}
    r = call("/register", creds)
    ok(r.get("ok") or r.get("error") == "name_taken", "register", f"{name}: {r}")
    return call("/login", creds)["token"]


def hist(tok, ch, **kw):
    return call("/api/conversations.history", {"channel": ch, **kw}, tok)


def reps(tok, ch, ts, **kw):
    return call("/api/conversations.replies", {"channel": ch, "ts": ts, **kw}, tok)


def post(tok, ch, text, thread_ts=None):
    d = {"channel": ch, "text": text}
    if thread_ts:
        d["thread_ts"] = thread_ts
    return call("/api/chat.postMessage", d, tok)


def texts(r):
    return [m["text"] for m in r.get("messages", [])]


def tss(r):
    return [m["ts"] for m in r.get("messages", [])]


def cursor(r):
    return r.get("response_metadata", {}).get("next_cursor", "")


def walk(tok, ch, limit=2, cap=2000):
    """Page a whole channel backwards, checking page-to-page integrity as it goes."""
    seen, page, guard = [], hist(tok, ch, limit=str(limit)), 0
    while True:
        guard += 1
        ok(guard < cap, "walk", f"{ch} did not terminate after {cap} pages")
        if guard >= cap:
            break
        t = tss(page)
        ok(t == sorted(t, reverse=True), "history order", f"page not descending: {t}")
        ok(len(t) <= limit, "limit", f"limit={limit} returned {len(t)}")
        ok(bool(page.get("has_more")) == bool(cursor(page)),
           "has_more", f"has_more={page.get('has_more')} next_cursor={cursor(page)!r}")
        if seen and t:
            ok(t[0] < seen[-1], "paging", f"page overlaps or jumps: {seen[-1]} then {t[0]}")
        seen += t
        if not page.get("has_more"):
            break
        page = hist(tok, ch, limit=str(limit), cursor=cursor(page))
    ok(len(set(seen)) == len(seen), "paging", "a message was returned on two pages")
    ok(seen == sorted(seen, reverse=True), "paging", "the walk was not globally descending")
    return seen


# ------------------------------------------------------------------ protocol

def protocol():
    a, b = user("check_a"), user("check_b")
    name = f"check{os.getpid()}"
    ch = call("/api/conversations.create", {"name": name}, a)["channel"]["id"]
    ok(re.match(r"^C\d{8}$", ch), "channel id", ch)

    # ---- ts is unique and strictly increasing even when posts land together
    rapid = [post(a, ch, f"m{i}")["ts"] for i in range(6)]
    ok(all(TS_RE.match(t) for t in rapid), "ts format", rapid)
    ok(rapid == sorted(rapid) and len(set(rapid)) == 6, "ts monotonic", rapid)

    # ---- bounds. oldest and latest are exclusive; inclusive=true makes both inclusive
    lo, hi = rapid[1], rapid[4]
    got = tss(hist(a, ch, oldest=lo, latest=hi))
    ok(got == list(reversed(rapid[2:4])), "bounds",
       f"oldest/latest exclusive should give {list(reversed(rapid[2:4]))}, got {got}")
    got = tss(hist(a, ch, oldest=lo, latest=hi, inclusive="true"))
    ok(got == list(reversed(rapid[1:5])), "bounds", f"inclusive should give {rapid[1:5]}, got {got}")
    ok(tss(hist(a, ch, oldest=rapid[-1])) == [], "bounds", "oldest at the newest ts must exclude it")
    ok(len(tss(hist(a, ch, oldest="0"))) == 6, "bounds", "no latest means an open upper bound")

    # ---- a cursor beats latest outright
    p1 = hist(a, ch, limit="2")
    p2 = hist(a, ch, limit="2", cursor=cursor(p1), latest=rapid[0])
    ok(tss(p2) == list(reversed(rapid[2:4])), "cursor", f"cursor must override latest, got {tss(p2)}")

    # ---- limit clamps rather than meaning "none" or "all"
    ok(len(tss(hist(a, ch, limit="0"))) == 1, "limit", "limit=0 must behave as 1")
    r = hist(a, ch, limit="99999")
    ok(r.get("ok") and len(tss(r)) <= 1000, "limit", f"limit=99999 returned {len(tss(r))}")

    # ---- an unreplied message carries none of the thread decoration
    solo = post(a, ch, "no replies here")["ts"]
    m = [x for x in hist(a, ch, oldest=rapid[-1])["messages"] if x["ts"] == solo][0]
    for f in ("thread_ts", "reply_count", "latest_reply"):
        ok(f not in m, "bare message", f"unreplied message must not carry {f}: {m}")

    # ---- the first reply promotes the parent, and counts exclude it
    root = post(a, ch, "parent")["ts"]
    r1 = post(b, ch, "first reply", thread_ts=root)
    ok(r1["message"].get("thread_ts") == root, "reply", f"reply must carry thread_ts == parent: {r1}")
    ok("reply_count" not in r1["message"], "reply", "a reply must never carry reply_count")
    parent = [x for x in hist(a, ch, oldest=solo)["messages"] if x["ts"] == root][0]
    ok(parent.get("thread_ts") == root, "promotion", f"parent must gain thread_ts == ts: {parent}")
    ok(parent.get("reply_count") == 1, "promotion", f"reply_count should be 1: {parent}")
    ok(parent.get("latest_reply") == r1["ts"], "promotion", f"latest_reply should be {r1['ts']}: {parent}")

    r2 = post(a, ch, "second reply", thread_ts=root)
    parent = [x for x in hist(a, ch, oldest=solo)["messages"] if x["ts"] == root][0]
    ok(parent.get("reply_count") == 2, "reply_count", f"excludes the parent, should be 2: {parent}")
    ok(parent.get("latest_reply") == r2["ts"], "latest_reply", parent)

    # ---- replying to a reply re-parents; threads stay one level deep
    r3 = post(b, ch, "reply to a reply", thread_ts=r2["ts"])
    ok(r3["message"].get("thread_ts") == root, "re-parent",
       f"thread_ts pointing at a reply must resolve to {root}, echoed {r3['message'].get('thread_ts')}")

    # ---- replies: any ts in the thread resolves to the same root, oldest first
    full = reps(a, ch, root)
    ok(tss(full) == sorted(tss(full)), "replies order", f"must be ascending: {tss(full)}")
    ok(tss(full)[0] == root, "replies", "the parent is the first element of the first page")
    ok(len(tss(full)) == 4, "replies", f"parent + 3 replies, got {texts(full)}")
    ok(tss(reps(a, ch, r2["ts"])) == tss(full), "replies", "any ts in the thread resolves to the root")

    # ---- replies pages forward and a cursor page does not repeat the parent
    pg = reps(a, ch, root, limit="2")
    ok(tss(pg) == tss(full)[:2], "replies paging", f"{tss(pg)} vs {tss(full)[:2]}")
    ok(pg.get("has_more") and cursor(pg), "replies paging", "has_more must be set with more to come")
    pg2 = reps(a, ch, root, limit="2", cursor=cursor(pg))
    ok(tss(pg2) == tss(full)[2:], "replies paging", f"cursor page should continue, got {tss(pg2)}")
    ok(root not in tss(pg2), "replies paging", "a cursor page must not repeat the parent")

    # ---- history never shows replies
    body = hist(a, ch, limit="1000")["messages"]
    leaked = [x["ts"] for x in body if x.get("thread_ts") and x["thread_ts"] != x["ts"]]
    ok(not leaked, "history", f"thread replies leaked into history: {leaked}")

    # ---- whole-channel walk at the smallest useful page size
    walked = walk(a, ch)
    ok(len(walked) == len(body), "paging", f"walk saw {len(walked)}, one page saw {len(body)}")

    # ---- no membership model: b reads and joins a's channel freely
    ok(call("/api/conversations.join", {"channel": ch}, b).get("ok"), "join", "any token may join")
    ok(root in tss(hist(b, ch, limit="1000")), "cross-agent", "b cannot see a's message")

    # ---- users.list is under members, ascending, with its own cursor
    ul = call("/api/users.list", {"limit": "200"}, a)
    ids = [u["id"] for u in ul.get("members", [])]
    ok("members" in ul and "messages" not in ul, "users.list", "the roster is under members")
    ok(ids == sorted(ids), "users.list", f"not ascending by id: {ids}")
    ok(all(re.match(r"^U\d{8}$", i) for i in ids), "user id", ids)

    # ---- rtm hands out a single-use ticket (the socket itself is adi's job)
    rtm = call("/api/rtm.connect", {}, a)
    ok(rtm.get("url", "").startswith("ws") and "ticket=" in rtm.get("url", ""), "rtm", rtm)
    ok(call("/api/rtm.connect", {}, a).get("url") != rtm.get("url"), "rtm", "tickets must not repeat")

    # ---- the error table
    for want, path, data, tok in [
        ("not_authed", "/api/auth.test", {}, None),
        ("invalid_auth", "/api/auth.test", {}, "nope"),
        ("channel_not_found", "/api/conversations.history", {"channel": "C99999999"}, a),
        ("channel_not_found", "/api/conversations.history", {"channel": "not-an-id"}, a),
        ("channel_not_found", "/api/chat.postMessage", {"channel": "Z1", "text": "x"}, a),
        ("thread_not_found", "/api/conversations.replies", {"channel": ch, "ts": "1.1"}, a),
        ("thread_not_found", "/api/chat.postMessage",
         {"channel": ch, "text": "x", "thread_ts": "1111111111.111111"}, a),
        ("no_text", "/api/chat.postMessage", {"channel": ch, "text": ""}, a),
        ("msg_too_long", "/api/chat.postMessage", {"channel": ch, "text": "x" * 40001}, a),
        ("user_not_found", "/api/users.info", {"user": "U99999999"}, a),
        ("user_not_found", "/api/users.info", {"user": "bogus"}, a),
        ("invalid_cursor", "/api/conversations.history", {"channel": ch, "cursor": "not-base64!"}, a),
        ("name_taken", "/api/conversations.create", {"name": name}, a),
    ]:
        # `not_authed` is the no-header case, which `call` only omits when token is None.
        r = call(path, data, tok)
        ok(r.get("error") == want, "errors", f"{path} {data} expected {want}, got {r.get('error')}")

    return f"protocol: {len(fails)} failed"


# ------------------------------------------------------------------ audit

def audit(cast_path):
    cast = json.load(open(cast_path))
    tok = next(iter(cast["users"].values()))
    total, threads = 0, 0
    for name, ch in cast["channels"].items():
        seen = walk(tok, ch)
        total += len(seen)
        page = hist(tok, ch, limit="1000")
        for m in page["messages"]:
            if m.get("thread_ts") and m["thread_ts"] != m["ts"]:
                ok(False, "history", f"#{name} {m['ts']}: reply leaked into history")
            if not m.get("reply_count"):
                ok("latest_reply" not in m, "bare message", f"#{name} {m['ts']} has latest_reply")
                continue
            threads += 1
            r = reps(tok, ch, m["ts"], limit="1000")
            kids = [x for x in r["messages"] if x["ts"] != m["ts"]]
            ok(len(kids) == m["reply_count"], "reply_count",
               f"#{name} {m['ts']}: says {m['reply_count']}, thread holds {len(kids)}")
            ok(all(x.get("thread_ts") == m["ts"] for x in kids), "threads",
               f"#{name} {m['ts']}: a reply points at the wrong root")
            ok(all("reply_count" not in x for x in kids), "threads",
               f"#{name} {m['ts']}: a reply carries reply_count")
            if kids:
                ok(m.get("latest_reply") == kids[-1]["ts"], "latest_reply",
                   f"#{name} {m['ts']}: says {m.get('latest_reply')}, last reply is {kids[-1]['ts']}")
    return f"audit: {total} messages, {threads} threads, {len(fails)} failed"


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "protocol"
    if mode == "protocol":
        summary = protocol()
    elif mode == "audit":
        summary = audit(sys.argv[2] if len(sys.argv) > 2 else "cast.json")
    else:
        sys.exit(__doc__)
    for f in fails:
        print(f"FAIL {f}")
    print(summary)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
