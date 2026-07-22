"""Drive gear6 with the real Slack SDK.

This is the only check that actually proves wire compatibility: it exercises
form-encoding, the ok/error envelope, ID rendering, thread semantics and cursor
pagination through code we did not write.

    cargo run &
    python3 scripts/smoke.py
"""

import os
import sys
import requests
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

B = os.environ.get("GEAR6_URL", "http://localhost:3000")
CREDS = {"username": "smoke", "password": "password1"}

r = requests.post(f"{B}/register", json=CREDS).json()
assert r["ok"] or r["error"] == "name_taken", r
tok = requests.post(f"{B}/login", json=CREDS).json()["token"]

c = WebClient(token=tok, base_url=f"{B}/api/")  # trailing slash is required

me = c.auth_test()
assert me["user"] == "smoke", me
assert me["user_id"].startswith("U"), me

name = f"general{os.getpid()}"
ch = c.conversations_create(name=name)["channel"]["id"]
assert ch.startswith("C"), ch
assert any(x["id"] == ch for x in c.conversations_list()["channels"])
c.conversations_join(channel=ch)

root = c.chat_postMessage(channel=ch, text="hello")["ts"]
c.chat_postMessage(channel=ch, text="a reply", thread_ts=root)
c.chat_postMessage(channel=ch, text="another reply", thread_ts=root)

hist = c.conversations_history(channel=ch)["messages"]
assert len(hist) == 1, f"replies must not appear in history: {hist}"
assert hist[0]["reply_count"] == 2, hist[0]
assert hist[0]["latest_reply"] > root, hist[0]

rep = c.conversations_replies(channel=ch, ts=root)["messages"]
assert len(rep) == 3, rep
assert [m["ts"] for m in rep] == sorted(m["ts"] for m in rep), "replies are oldest-first"

# three separate posts, newest first, walked one page at a time by the SDK's own paginator
for i in range(3):
    c.chat_postMessage(channel=ch, text=f"page{i}")
seen = [m["text"] for page in c.conversations_history(channel=ch, limit=1) for m in page["messages"]]
assert seen[0] == "page2", f"history must be newest-first, got {seen}"
assert "page0" in seen and "hello" in seen, seen

users = c.users_list()["members"]
assert any(u["name"] == "smoke" for u in users), users
assert c.users_info(user=me["user_id"])["user"]["name"] == "smoke"

rtm = c.rtm_connect()
assert rtm["url"].startswith("ws") and "ticket=" in rtm["url"], rtm
assert rtm["self"]["id"] == me["user_id"], rtm

# errors arrive as HTTP 200 with ok:false, which is what the SDK turns into SlackApiError
for kwargs, want in [
    (dict(channel="C99999999"), "channel_not_found"),
    (dict(channel=ch, cursor="not-base64!"), "invalid_cursor"),
]:
    try:
        c.conversations_history(**kwargs)
        sys.exit(f"expected {want}, got success")
    except SlackApiError as e:
        assert e.response.status_code == 200, e.response.status_code
        assert e.response["error"] == want, e.response["error"]

try:
    WebClient(token="xoxb-bogus", base_url=f"{B}/api/").auth_test()
    sys.exit("expected invalid_auth")
except SlackApiError as e:
    assert e.response["error"] == "invalid_auth", e.response["error"]

print("smoke ok")
