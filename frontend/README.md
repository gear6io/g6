# Gear6

Desktop chat shell with:

- Tauri + React + TypeScript + Vite
- Tailwind CSS
- shadcn/ui-ready shared components
- Biome (lint/format/check)
- Feature-driven frontend structure

## App modes

`VITE_G6_APP_MODE` picks which root the build mounts. `pnpm tauri dev` and
`pnpm tauri build` set `cloud` for you (see `src-tauri/tauri.conf.json`);
everything else defaults to `legacy`.

| Mode | Mounts | Talks to |
| --- | --- | --- |
| `cloud` | `src/app/CloudRoot.tsx` | the gear6 backend's `/api/cloud/*` gateway only |
| `local` | `src/app/Gear6Root.tsx` | the gear6 backend's Slack-compatible `/api/*` + `/rtm` |
| `legacy` | the pre-gear6 Nostr/Tauri app shell | the relay |

```sh
VITE_G6_APP_MODE=cloud  pnpm dev     # or: pnpm tauri dev
VITE_G6_APP_MODE=local  pnpm dev
VITE_G6_APP_MODE=legacy pnpm dev     # the default when the var is unset
VITE_G6_APP_MODE=cloud  pnpm build   # or: pnpm tauri build
```

`VITE_GEAR6=1` still means `local`, as a temporary alias. An explicit
`VITE_G6_APP_MODE` overrides it.

Cloud mode needs the backend to have `GEAR6_CLOUD_BASE_URL` set (see the repo
root's `.env.example`); without it the Cloud root renders its configuration
state. The webview never receives a Cloud URL — it only ever calls the backend,
so Cloud itself needs no CORS configuration. The backend does: `pnpm tauri dev`
serves the webview from `:1420`, so run it with
`GEAR6_CORS_ORIGIN=http://localhost:1420`.

## Scripts

- `pnpm dev` - run the web frontend
- `pnpm tauri dev` - run the desktop app
- `pnpm build` - typecheck and build frontend
- `pnpm typecheck` - TypeScript checks
- `pnpm lint` - Biome lint
- `pnpm format` - Biome format (write)
- `pnpm check` - Biome check

## Structure

- `src/shared` - reusable app-wide code (`ui`, `lib`, `styles`)
- `src/features` - feature modules (vertical slices)
- `src/app` - top-level app composition
