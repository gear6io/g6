"""Seed a simteam run: register the cast, create the channels, dump tokens.

    GEAR6_URL=http://localhost:3000 python3 .claude/skills/simteam/seed.py <out.json> [chan,chan,...]

Channels default to a generic set; pass a comma list to name them after whatever the
team is supposedly building.

Writes {"url":..., "users":{name: token}, "channels":{name: C0000000N}} to <out.json>.
Idempotent: re-running against a live db reuses existing users and channels.
Talks to a server that is already running; it never starts one.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

URL = os.environ.get("GEAR6_URL", "http://localhost:3000").rstrip("/")

# Handles only. Roles live in SKILL.md and stay off the wire — a username that spells
# out someone's job is the tell that this is a simulation. The spread of shapes
# (bare, dotted, underscored, digits, hyphen) is deliberate: it exercises the whole
# username charset the server accepts.
CAST = ["dana.m", "kai", "rahul.j", "samual", "adi", "deshpandey"]
CHANNELS = ["general", "standup", "eng-core", "eng-api", "incidents", "bugs"]
PASSWORD = "password1"


def call(path, data, token=None):
    body = urllib.parse.urlencode(data).encode() if token else json.dumps(data).encode()
    req = urllib.request.Request(f"{URL}{path}", data=body)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    else:
        req.add_header("Content-Type", "application/json")
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return json.load(e)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "cast.json"
    wanted = sys.argv[2].split(",") if len(sys.argv) > 2 else CHANNELS
    users = {}
    for name in CAST:
        r = call("/register", {"username": name, "password": PASSWORD})
        assert r.get("ok") or r.get("error") == "name_taken", (name, r)
        r = call("/login", {"username": name, "password": PASSWORD})
        assert r.get("ok"), (name, r)
        users[name] = r["token"]

    lead = users[CAST[0]]
    channels = {}
    for name in wanted:
        r = call("/api/conversations.create", {"name": name}, lead)
        if not r.get("ok"):
            assert r.get("error") == "name_taken", (name, r)
            listed = call("/api/conversations.list", {"limit": "200"}, lead)
            channels.update({c["name"]: c["id"] for c in listed["channels"]})
            continue
        channels[name] = r["channel"]["id"]
    missing = [c for c in wanted if c not in channels]
    assert not missing, missing
    channels = {c: channels[c] for c in wanted}  # drop channels this run did not ask for

    json.dump({"url": URL, "users": users, "channels": channels}, open(out, "w"), indent=1)
    print(f"seeded {len(users)} users, {len(channels)} channels -> {out}")
    for name in CAST:
        print(f"  {name:9} {users[name]}")
    for name in wanted:
        print(f"  #{name:9} {channels[name]}")


if __name__ == "__main__":
    main()
