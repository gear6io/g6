# repos — DEAD CODE (not wired into gear6)

This directory is a **Nostr-native git browser** carried over from the Buzz web
client. It is **not reachable** in gear6: its routes are commented out in
[`../../app/routes.ts`](../../app/routes.ts), so nothing imports these modules
and the bundler tree-shakes them out. The files are kept, not deleted, so a
future forge can revive them.

## What it does

- **`use-repos.ts`** lists repos by querying Nostr `kind:30617` (NIP-34 repo
  announcement) events over a WebSocket via `queryEvents`.
- **`git-client.ts`** browses a repo (tree / log / readme / blob) by cloning
  over a `/git/{owner}/{repo}.git` **smart-HTTP** transport, authenticated with
  **NIP-98** headers, into an in-browser IndexedDB filesystem (isomorphic-git +
  LightningFS).
- **`ui/`** renders the repo list (`ReposPage`), repo detail
  (`RepoDetailPage`), and blob viewer (`RepoBlobViewer`), plus leaf sections.

## Why it's dead here

gear6's backend ([`/src/main.rs`](../../../../src/main.rs)) is a Slack-shaped
REST relay (`/conversations.*`, `/chat.postMessage`, `/rtm.connect`). It serves
**none** of what this feature needs:

- no NIP-01 event stream / `kind:30617` repo announcements,
- no `/git` smart-HTTP transport,
- no NIP-98 auth.

So the pages could only ever render their empty/error state. Rather than ship
broken UI, the feature is unwired and the `/` homepage now renders a neutral
placeholder ([`../../app/routes/index.tsx`](../../app/routes/index.tsx)).

## How to revive it

Once the gear6 relay serves repo announcements (or an equivalent REST endpoint)
**and** a git transport with auth:

1. Uncomment the three `route("/repos"...)` entries in
   [`../../app/routes.ts`](../../app/routes.ts).
2. Point `/` back at `ReposPage` in
   [`../../app/routes/index.tsx`](../../app/routes/index.tsx) (or give repos its
   own route and keep a real homepage).
3. Rebuild — `@tanstack/router-plugin` regenerates `routeTree.gen.ts`.
4. Repoint the data layer: `use-repos.ts` / `use-repo-refs.ts` currently expect
   NIP-01 over WebSocket, and `git-client.ts` expects smart-HTTP + NIP-98 — swap
   these for whatever transport the revived backend exposes.
5. Restore the two `home page` assertions in
   [`../../../tests/e2e/smoke.spec.ts`](../../../tests/e2e/smoke.spec.ts).

## Modules only reachable from this dead feature

`../../shared/lib/nostr-client.ts` and `../../shared/lib/pubkey.ts` are used
**only** by these files now. They're left in place (tree-shaken) for the revive.
`nip98.ts`, `relay-url.ts`, `nostr-signer.ts`, and `buzz-download.ts` in
`shared/lib` are **also used by the live invite feature** — do not treat them as
dead.
