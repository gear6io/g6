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

# A bot writes plain "@smoke"; the server linkifies it. This is the whole reason
# the mention grammar lives server-side instead of in the web client.
m = c.chat_postMessage(channel=ch, text=f"ping @smoke in #{name}")["message"]
assert m["text"] == f"ping <{'@' + me['user_id']}> in <#{ch}>", m["text"]
assert m["mentions"][me["user_id"]] == "smoke", m
assert m["mentions"][ch] == name, m

users = c.users_list()["members"]
assert any(u["name"] == "smoke" for u in users), users
assert c.users_info(user=me["user_id"])["user"]["name"] == "smoke"

# The SDK form-encodes `profile` as a JSON *string*, which is the shape the web
# client never sends and therefore the one only this script can catch.
email = f"smoke+{os.getpid()}@example.com"
prof = c.users_profile_set(profile={"display_name": "Smoke Test", "title": "SRE", "email": email})
assert prof["profile"]["display_name"] == "Smoke Test", prof["profile"]
assert prof["profile"]["title"] == "SRE", prof["profile"]

c.users_profile_set(name="status_emoji", value=":coffee:")
prof = c.users_profile_get()["profile"]
assert prof["status_emoji"] == ":coffee:", prof
assert prof["display_name"] == "Smoke Test", "a single-field set must not clear the rest"
assert c.users_info(user=me["user_id"])["user"]["profile"]["title"] == "SRE"

assert c.users_lookupByEmail(email=email)["user"]["id"] == me["user_id"]

c.users_setPresence(presence="away")
pres = c.users_getPresence(user=me["user_id"])  # the SDK requires `user`, even for yourself
assert pres["presence"] == "away", pres
assert pres["manual_away"] is True, pres
c.users_setPresence(presence="auto")

# The SDK sends booleans as 1/0, not true/false — a real trap for the arg extractor.
roster = c.users_list(presence=True)["members"]
assert all(u["presence"] in ("active", "away") for u in roster), roster

assert c.users_identity()["user"]["name"] == "Smoke Test"
assert any(x["id"] == ch for x in c.users_conversations()["channels"])

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
