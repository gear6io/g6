---
name: simteam
description: AI-native end-to-end test of gear6. Spawns a cast of subagents who roleplay a software engineering team building whatever product the user names — argument is free-form ("a ClickHouse alternative", "an iOS budgeting app", "a payments ledger") — and has them do all of their work inside gear6, channels, threads, standups, incidents, while a script asserts Slack wire-compatibility invariants against everything they produce. Use when the user says "/simteam", "simulate a team", "run the AI team sim", or wants realistic multi-user traffic exercised against a running gear6 server.
---

# simteam

Traffic generators post lorem ipsum. This posts a *plausible workday*: overlapping
threads, replies to replies, an incident, a release check, cursor-paginated catch-up
reads. Bugs in gear6 surface as agents failing to have a normal conversation.

Division of labour: **the agents generate messy concurrent state, `check.py` asserts
the contract.** Nothing that a script can decide is left to a language model. The
agents do the one thing a script cannot fake — six identities writing at each other
at once, in threads, out of order, over hours.

This skill does not start, restart, or stop anything. It talks to a gear6 that is
already running and leaves it running.

## 0. The argument

Whatever the user passed after `/simteam` is what the team is building. Free-form:
`a ClickHouse alternative`, `an iOS budgeting app`, `a payments ledger`, `a k8s
operator`. Nothing downstream is hardcoded to one product.

From that argument derive, before spawning anyone:

- a product name the team says out loud (invent one; no team says "the project")
- 2–3 subsystems that map to the two engineer channels, named like real channels
  (`eng-storage` / `eng-query`, `eng-ios` / `eng-sync`, `eng-ledger` / `eng-api`)
- a sprint with one thing landing, one thing regressing, one thing not started
- one incident `deshpandey` can page mid-run, plausible for *this* product
- the domain shorthand these people would use without expanding: part merges and
  sort keys, or `didFinishLaunching` and TestFlight builds, or double-entry and
  reconciliation drift

If no argument is given, ask what they're building rather than defaulting.

## 1. Preflight

`GEAR6_URL` (default `http://localhost:3000`) must already answer:

```bash
curl -s -X POST $GEAR6_URL/api/auth.test    # {"error":"not_authed","ok":false} == healthy
```

Anything else — connection refused, `internal_error`, HTML — stop and tell the user
what came back. Do not start a server, do not touch their database, do not guess
another port. `internal_error` on `/register` usually means migrations never ran
against the db file the server opened; that is theirs to fix.

Then the protocol suite, before any traffic muddies the water:

```bash
GEAR6_URL=$GEAR6_URL python3 .claude/skills/simteam/check.py protocol
```

This is the invariant list, asserted in code — pagination bounds, cursor semantics,
thread promotion and re-parenting, limit clamping, the error table. Failures here are
findings; report them and ask whether to continue. Don't re-verify any of it by hand
later, and don't restate its rules to the agents.

Then seed the cast:

```bash
GEAR6_URL=$GEAR6_URL python3 .claude/skills/simteam/seed.py $SP/cast.json \
  general,standup,eng-<subsystem>,eng-<subsystem>,incidents,bugs
```

Channel order matters — `seed.py` assigns ownership by position. Idempotent: reuses
users and channels that already exist, mints fresh tokens. It writes to whatever
server `GEAR6_URL` names, so confirm that URL is the one the user meant.

`cast.json` holds the tokens, the channel ids, and who owns what. **Agents read it
through `g6.py`; you never inline any of it into a brief.**

## 2. The cast

Usernames are handles, the way a real workspace has them. **The role column is
internal.** It shapes what an agent talks about and defers to; it never appears on the
wire. No `qa-`/`sre-`/`em-` prefixes, no "as the QA lead", no role in a message, ever.

| handle | role (internal) | owns | voice |
|---|---|---|---|
| `dana.m` | eng manager | #standup, #general | asks, nudges, never writes code; "can someone own this" |
| `kai` | subsystem A | #eng-A | terse, lowercase, allergic to meetings, opinionated about the design |
| `rahul.j` | subsystem B | #eng-B | thinks out loud, long messages when explaining, then silent for a round |
| `samual` | glue between A and B | both | asks the naive question that turns out to matter; newest on the team |
| `adi` | QA / release | #bugs | precise, pastes repros, mildly done with everyone's optimism |
| `deshpandey` | SRE / on-call | #incidents | clipped during incidents, dry the rest of the time |

Six agents by default. Fewer is fine (`dana.m`, `kai`, `adi`, `deshpandey` is a
working minimum); do not exceed six unless the user asks.

## 3. Orchestration

Spawn all six in **one message, parallel**, every one of them on **Haiku** —
`model: "haiku"` on each `Agent` call, always, whatever model this session is running.
Roleplay and a four-verb CLI are not frontier work, and six agents × five rounds is
where the entire cost of this skill lives.

The brief is a file, not prose you write out. Each spawn prompt is short — everything
below and nothing else:

```
You are <handle> on a software team. Read .claude/skills/simteam/agent.md now;
it is your voice, your client, and your day. Follow it exactly.

export G6_CAST=$SP/cast.json    (use this on every g6.py call)
you are:   <handle>
your voice: <the voice column, verbatim>
the team is building: <product name and one line of §0 fiction>
your channels: run `g6.py <handle> channels`
this round: PHASE 1, standup, and nothing else.
```

Never let two subagents share a handle. One identity each — same-identity traffic
tests nothing about multi-user behavior.

Then drive rounds with `SendMessage` so each agent keeps its memory of the
conversation; a fresh `Agent` call would forget who it is. One round per phase, five
rounds, in order, naming the phase each time so nobody drifts ahead: round 1 standup,
rounds 2–3 work (fire the incident at the top of 3), round 4 wrap, round 5 signoff.
Stretch by adding work rounds only — never a second standup, never a second signoff.
After round 5 send nothing; agents that signed off will not answer anyway.

Round prompts are seeds, not scripts: "kai just contradicted you", "it's 6pm friday",
"the incident is still open and dana wants an ETA". Never "post a status update" —
that phrasing is what produces status updates. Skim `#general` between rounds; if it
reads like six assistants, say so in the next round prompt and name the tell.

## 4. Report

```bash
GEAR6_URL=$GEAR6_URL python3 .claude/skills/simteam/check.py audit $SP/cast.json
cat $SP/cast.json.violations.jsonl
```

`audit` re-checks ordering, paging integrity and reply bookkeeping over the messy
state the sim actually produced; the jsonl is what `g6.py` caught live, mid-run.
Together they are the findings. Reproduce each one yourself before reporting it as
real, then write `$SP/simteam-report.md`: one section per finding (expected /
observed / repro curl), then coverage — messages posted, threads opened, pages walked
(all three come out of `audit`).

Also check the day closed: every agent has a standup commitment and a matching
terminal state, and every agent signed off. A commitment that just vanished is worth
looking at — either the agent drifted, or the server dropped the message that carried
it, and only reading `#standup` against `#eng-*` tells you which.

Once per run, ask `adi` to check RTM by hand, since `check.py` has no websocket
client: `rtm.connect` returns a `url` carrying a single-use ticket; the socket's first
frame is `{"type":"hello"}`; a message another agent posts afterwards arrives as an
event carrying `channel`, `user`, `text`, `ts`. Events are broadcast for **all**
channels — filtering is the client's job, so seeing another channel's traffic is
correct, not a bug. Replaying the same ticket must fail.

Leave the server running and the data in place. The channels are the evidence.
