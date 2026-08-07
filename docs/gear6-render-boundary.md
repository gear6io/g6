# The gear6 render boundary (temporary)

`frontend/src/main.tsx` picks one of two roots at boot and mounts only that one:

| Build                    | Root                       | Loaded from                    |
| ------------------------ | -------------------------- | ------------------------------ |
| gear6 (`VITE_GEAR6=1`)   | `@/app/Gear6Root`          | `@/app/rootSurface`            |
| legacy (flag unset)      | `@/app/LegacyAppRoot`      | `@/app/rootSurface`            |

Both are dynamic imports, so exactly one module graph is ever evaluated. In
gear6 builds `@/app/App` and `@/app/AppShell` are not imported at all — their
router setup, relay subscriptions, desktop notifications, presence/read-state
polling and Tauri-only commands never start. `LegacyAppRoot` is the provider
stack that used to live inline in `main.tsx`; `App.tsx` and `AppShell.tsx`
themselves are untouched.

## Why

The legacy boot chained storage migration → `is_shared_identity` → machine
onboarding → community apply → relay init, none of them with a deadline, and
most of them backed by Tauri commands that gear6's HTTP backend does not
implement. A missing or slow command left the app parked on its loading gate
with no way out. `Gear6Root` replaces that with one step (identity) behind a
hard `BOOT_TIMEOUT_MS` deadline in `@/app/gear6Boot`, and every outcome —
`loading`, `ready`, `error` — is a screen the user can see and retry from.

## This is a stopgap

The gear6 root is a boot screen, not a product. It exists so the app boots into
something recoverable while the real UI is rebuilt on top of the gear6 API.

Before the legacy shell can be reintroduced or deleted, these have to exist on
the gear6 side (each is currently supplied only by `AppShell`):

- **Routing** — `@/app/router` and its route tree, or a gear6 replacement.
- **Channel list and channel view** — `channels.list` / `conversations.history`
  through `@/shared/api/invoke`, plus the composer and send path.
- **Threads, reactions, edits** — the `/rtm` frames already dispatched by
  `@/shared/lib/rtm-client` into `relayClient` have no consumer while the shell
  is unmounted.
- **Read state / unreads** — `useUnreadChannels` is NIP-RS-shaped; gear6 has no
  equivalent endpoint yet.
- **Identity and profile UI** — currently only `users.identity`, shown as text.
- **Search, settings, notifications, huddles, agents** — all shell-mounted
  today, none reachable in gear6 mode.
- **Window chrome** — `StartupWindowDragRegion` is deliberately not mounted, to
  keep the gear6 tree free of Tauri imports.

Anything reintroduced from the legacy tree must be checked against
`@/shared/api/invoke`: unmapped commands there return a benign `[]` and warn
once, so a legacy screen can look alive while silently doing nothing.

## Guardrails

`frontend/src/app/rootSurface.test.mjs` fails if the boundary erodes: it asserts
the gear6 branch resolves without pulling the legacy graph (which cannot even be
imported under the node test loader), that `main.tsx` has no static legacy
import, and that the legacy branch still runs its storage migration.
`frontend/src/app/gear6Boot.test.mjs` asserts boot never hangs and never
rejects.

Deleting this file means the boundary is gone — either the gear6 UI was
finished, or the isolation was undone.
