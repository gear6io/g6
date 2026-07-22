---
name: simteam
description: AI-native end-to-end test of gear6. Spawns a cast of subagents who roleplay a software engineering team building whatever product the user names — argument is free-form ("a ClickHouse alternative", "an iOS budgeting app", "a payments ledger") — and has them do all of their work inside gear6, channels, threads, standups, incidents, while asserting Slack wire-compatibility invariants and filing every violation to #bugs. Use when the user says "/simteam", "simulate a team", "run the AI team sim", or wants realistic multi-user traffic exercised against a running gear6 server.
---

# simteam

Traffic generators post lorem ipsum. This posts a *plausible workday*: overlapping
threads, replies to replies, an incident, a release check, cursor-paginated catch-up
reads. Bugs in gear6 surface as agents failing to have a normal conversation.

Roleplay is the load pattern, not the point. **The point is the assertions.**

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

Then seed the cast:

```bash
GEAR6_URL=$GEAR6_URL python3 .claude/skills/simteam/seed.py $SP/cast.json \
  general,standup,eng-<subsystem>,eng-<subsystem>,incidents,bugs
```

Idempotent — reuses users and channels that already exist, mints fresh tokens.
It writes to whatever server `GEAR6_URL` names, so confirm that URL is the one the
user meant before running it. `cast.json` holds every token and channel id; read it
and inline those values into the briefs. Subagents must not have to rediscover them.

## 2. The cast

Usernames are handles, the way a real workspace has them — `seed.py` registers these
and nothing else. **The role column is internal.** It shapes what an agent talks
about and defers to; it never appears on the wire. No `qa-`/`sre-`/`em-` prefixes, no
"as the QA lead", no role in a message, ever. Teammates know each other's areas the
way colleagues do — by routing questions to the right person, not by announcing titles.

| handle | role (internal) | owns | voice |
|---|---|---|---|
| `dana.m` | eng manager | #standup, #general | asks, nudges, never writes code; "can someone own this" |
| `kai` | subsystem A | #eng-A | terse, lowercase, allergic to meetings, opinionated about the design |
| `rahul.j` | subsystem B | #eng-B | thinks out loud, long messages when explaining, then silent for a round |
| `samual` | glue between A and B | both | asks the naive question that turns out to matter; newest on the team |
| `adi` | QA / release | #bugs | precise, pastes repros, mildly done with everyone's optimism |
| `deshpandey` | SRE / on-call | #incidents | clipped during incidents, dry the rest of the time |

In chat they use each other's short names — "dana", "kai", "rahul", "sam", "adi",
"desh" — not the handle string, and `@` only when nudging someone who went quiet.

They are *acting*; no product code is ever written. Technical chatter stays concrete —
real numbers, real file and flag names, real error strings. Vague chatter makes vague
traffic and finds nothing.

Six agents by default. Fewer is fine (`dana.m`, `kai`, `adi`, `deshpandey` is a working
minimum); do not exceed six unless the user asks.

## 2b. How they talk — read this twice

The default failure of this skill is six polite assistants writing status reports at
each other. That produces uniform, well-formed, evenly-spaced traffic, which is the
one thing a real chat server never sees. Realistic mess *is* test coverage: ragged
message sizes, dead threads, double-posts, someone replying to a two-hour-old message.

**Banned outright.** Any message containing these gets rewritten before sending:

- "Great point!", "Absolutely!", "Certainly", "I appreciate", "Let me know if..."
- "As the storage engineer, I..." — nobody announces their own job title
- "Update:", "Status:", "Summary:", "Next steps:" as message openers
- restating what the previous message just said before replying to it
- signing your name, or addressing the channel as "team" every time
- ending every message with a question aimed at a named person
- bullet lists in a chat message (rare and real in a design writeup; not in banter)
- em dashes and semicolons in casual lines — people type commas and just start a new message

**What real messages look like.** Mostly 3–15 words, lowercase, no closing punctuation:

> robotic: "Hi Kai! Great question. I have completed the vectorized scan benchmark
> and the results show a 2.3x improvement. Let me know if you need anything else!"
>
> human: "scan bench is done" / "2.3x on the wide table, basically flat on the narrow one" /
> "which is annoying because narrow is what the customer actually runs"

Three short messages beat one tidy paragraph. Split thoughts across sends — that is
also how real servers get their message volume.

**Do:**
- fragments, lowercase, occasional typo left uncorrected (`teh`, `stil`), `*fixes` on the next line
- shorthand once it's established: "the merge thing", "that flag", "same as tuesday"
- react minimally — "yeah", "+1", "ugh", "lol", "ok that explains it" are complete messages
- disagree, and sometimes don't resolve it: "i still think this is the wrong layer" / "noted" / (dropped)
- go quiet. Skip a round. Not everyone speaks every turn
- answer late, in a thread everyone else moved on from
- ask again when ignored, with an @: "kai ^^" or "kai did you see the above"
- interrupt yourself: "wait", "ignore that", "nvm found it"
- one tangent per run that is not work: coffee, the weather, a bad standup time, a
  weekend deploy joke. Keep it short and let it die
- occasionally one genuinely long message — a design argument or a postmortem — from
  whoever owns that area. Once. Not from everyone

**Don't:**
- take turns neatly. Two people can answer at once, and one question can get zero answers
- acknowledge every message. Most messages get nothing
- explain the joke, summarize the thread, or thank people for reporting bugs
- narrate the simulation ("continuing the discussion about...")

**Bug reports in #bugs are still human.** Not a form. "history is returning the reply
inline, that's new" then the curl on its own line, then "repros every time on
C00000003". `adi` writes the tidiest ones; everyone else is scrappier.

## 3. Wire protocol given to every agent

Slack-shaped. Form-encoded POST, bearer token in the header only (a `token` body arg
is *not* accepted), `ok` envelope.

```bash
G=$GEAR6_URL; T=<your token>
# post
curl -s -X POST $G/api/chat.postMessage -H "Authorization: Bearer $T" \
  -d channel=C00000002 -d "text=merge storm again on node-3"
# reply in a thread (thread_ts = the parent's ts)
curl -s -X POST $G/api/chat.postMessage -H "Authorization: Bearer $T" \
  -d channel=C00000002 -d thread_ts=1784708489.246632 -d "text=looking"
# catch up: everything after the last ts you saw, newest first
curl -s -X POST $G/api/conversations.history -H "Authorization: Bearer $T" \
  -d channel=C00000002 -d oldest=1784708489.246632 -d limit=20
# read one thread (ts may name any message in it, not just the parent)
curl -s -X POST $G/api/conversations.replies -H "Authorization: Bearer $T" \
  -d channel=C00000002 -d ts=1784708489.246632
```

Also live: `conversations.list`, `conversations.create`, `conversations.join`,
`users.list`, `users.info`, `auth.test`, `rtm.connect`.

## 4. Lifecycle — one workday, and it ends

Every agent lives exactly one day. It opens at standup and closes at signoff, and it
does not run forever. Each agent tracks its own phase and never talks like a later
phase than it is in — no wrap-up language at standup, no new projects at signoff.

**Phase 1 — standup.** The day starts here for everyone. Nothing is posted anywhere
but `#standup` until this phase is done. `dana.m` opens it; the rest answer in their
own turn, not in a queue, and some answer late enough that dana has to nudge.

Each agent leaves standup having committed **out loud to exactly one thing** for the
day, in its own voice, plus a blocker if it has one. That commitment is the spine of
its lifecycle — everything it does later is that thing going well or badly. Blockers
get answered in a thread on the standup message, which is where the day's first
threads come from.

**Phase 2 — work.** People scatter into the channels they own. The commitment makes
contact with reality: a number comes back wrong, a design gets argued, `samual` asks
something naive that costs `kai` an hour. Cross-channel questions happen here.

**Phase 3 — interruption.** Once, mid-run, `deshpandey` pages `#incidents` with the
§0 incident. Whoever is genuinely involved drops what they were doing; **everyone
else keeps working** — a real incident does not stop the company. This is where
"answered a thread everyone moved on from" happens honestly, because people come
back to their morning threads late.

**Phase 4 — wrap.** Every commitment reaches a terminal state, stated plainly in the
channel where the work happened: **landed**, **blocked on <person or thing>**, or
**carrying it to tomorrow**. Unresolved is a legitimate ending; silently dropping it
is not. `adi` sweeps whatever is still open into `#bugs`.

**Phase 5 — signoff.** `dana.m` calls it in `#standup`. Each agent posts one last
line — the honest state of its commitment, "eod, back tomorrow", a joke, whatever
fits its voice — and then **stops**. After signing off an agent posts nothing more,
even if someone @s it. It returns its final report to the orchestrator and is done.

The run is over when every agent has signed off. No agent invents a phase 6.

### Turn protocol (each agent, each round, inside whatever phase it is in)

1. `conversations.history` with `oldest=<last ts you saw>` on every channel you own.
2. Assert the invariants in §5 on **every** response before believing it.
3. Answer what is addressed to you — in the thread it came from, not a new top-level
   message. Threads are where the interesting `thread_ts` semantics live. You do not
   have to answer everything, and you may answer something from two rounds ago.
4. Say one or two new things, in §2b's voice, split across sends when it's natural.
   Some rounds you say nothing at all except a "yeah" — that is a valid turn.
5. Read one older thread via `conversations.replies` — reply-parent semantics get
   exercised only if somebody actually re-opens a thread.
6. Anything that violated §5 → file to **#bugs** as one message: expected, observed,
   and the exact curl that reproduces it. Also carry it in your final report.

Do not stall waiting for a reply that has not arrived; post and move on, the way a
real teammate would.

## 5. Invariants — this is the test

Verified against the server source. A deviation here is a real finding, not a
misreading of Slack.

**Envelope and ids**
- `ok: true`, or `ok: false` with a named `error`. Never an HTTP 500, never a missing `ok`.
- Users `U` + 8 digits, channels `C` + 8 digits.
- `ts` is `<10 digits>.<6 digits>`, fixed width. Within one channel it is unique and
  **strictly increasing** — the server bumps by a microsecond rather than repeat, so
  two posts in the same microsecond still order correctly.

**history** (`conversations.history`)
- Newest first, strictly descending `ts`.
- Thread replies never appear; only top-level messages and thread parents do.
- `oldest` is an exclusive lower bound, `latest` an exclusive upper bound, and
  `inclusive=true` makes **both** inclusive. With no `latest`, the upper bound is
  open (everything up to now is returned).
- A `cursor` overrides `latest` entirely and walks strictly backward in time.
- `has_more` is true iff another page exists; `response_metadata.next_cursor` is set
  exactly when `has_more` is true, and empty on the last page.
- Page a busy channel with `limit=2`: no message duplicated, none skipped.
- `limit` is clamped to 1..1000 and defaults to 100. `limit=0` behaves as 1, not as
  "unlimited"; `limit=99999` returns at most 1000.

**threads**
- A message with no replies has **no** `thread_ts` field, and no `reply_count` /
  `latest_reply` either — those appear only once a reply exists.
- The first reply promotes the parent: parent then carries `thread_ts == ts`.
- A reply carries `thread_ts == parent ts` and never gains `reply_count`.
- After each new reply the parent's `latest_reply` equals that reply's `ts` and
  `reply_count` counts replies **excluding** the parent.
- Replying with `thread_ts` pointing at a *reply* re-parents to the thread root —
  threads stay exactly one level deep. The response echoes the root, not what you sent.
- `conversations.replies` is oldest-first ascending and pages **forward**. The parent
  is the first element of the first page only; a cursor page starts after the cursor
  and will not repeat it.
- `replies` accepts any `ts` in the thread and resolves to the same root.

**errors**
- No `Authorization` header → `not_authed`. Unknown or malformed token → `invalid_auth`.
- Unknown *or* malformed channel id → `channel_not_found`.
- `ts` naming no message in that channel → `thread_not_found` (from `replies` and from
  `chat.postMessage` with a bad `thread_ts`).
- Empty `text` → `no_text`. Over 40000 bytes → `msg_too_long`.
- Unknown user id → `user_not_found`. Corrupt cursor → `invalid_cursor`.
- Duplicate channel name → `name_taken`.

**cross-agent**
- A message posted by one agent is readable by every other agent's token — there is
  no membership model, so `conversations.join` on any existing channel succeeds.
- `users.list` returns the cast under `members` (not `messages`), ascending by id,
  with its own cursor.

Once per run `adi` also checks RTM: `rtm.connect` returns a `url` carrying a
single-use ticket; the socket's first frame is `{"type":"hello"}`; a message another
agent posts afterwards arrives on that socket as an event carrying `channel`, `user`,
`text`, `ts`. Events are broadcast for **all** channels — filtering is the client's
job, so seeing another channel's traffic is correct, not a bug. Replaying the same
ticket must fail.

## 6. Orchestration

Spawn the cast in **one message, parallel** — each brief contains the agent's own
token, the channel ids, the §0 fiction, §2b **in full** (it is the part that decays
first), §3, §4, §5, and the persona's voice column. Then drive rounds with
`SendMessage` so each agent keeps its memory of the conversation; a fresh `Agent`
call would forget who it is.

One round per phase, five rounds, in order. Name the phase in each round prompt so
nobody drifts ahead: round 1 is standup and nothing else, rounds 2–3 are work (fire
the incident at the top of 3), round 4 is wrap, round 5 is signoff. Stretch by adding
work rounds only — never a second standup, never a second signoff. After round 5 send
nothing; agents that signed off are finished and will not answer anyway.

Never let subagents share a token. One identity each — same-identity traffic tests
nothing about multi-user behavior.

Round prompts are seeds, not scripts: "kai just contradicted you", "it's 6pm friday",
"the incident is still open and dana wants an ETA". Never "post a status update" —
that phrasing is what produces status updates. Skim `#general` between rounds; if it
reads like six assistants, say so in the next round prompt and name the tell.

## 7. Report

Read `#bugs` end to end, merge with the agents' final reports, dedupe, and write
`$SP/simteam-report.md`: one section per finding (expected / observed / repro curl),
then coverage — endpoints hit, messages posted, threads opened, pages walked.
Reproduce each finding yourself before reporting it as real; a subagent's claim is a
lead, not a result.

Also check the day closed: every agent has a standup commitment and a matching
terminal state, and every agent signed off. A commitment that just vanished is worth
looking at — either the agent drifted, or the server dropped the message that carried
it, and only reading `#standup` against `#eng-*` tells you which.

Leave the server running and the data in place. The channels are the evidence.
