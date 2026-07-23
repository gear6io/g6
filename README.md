# Gear6 — Implementation Gap Map

Snapshot of what is missing or still to be done, mapped 2026-07-23 on branch `fe`.

## Architecture (context for the map)

| Part | What it is | Status |
|---|---|---|
| `src/` | Gear6 backend: Rust/axum Slack-wire-compatible API + `/rtm` WebSocket, SQLite | Working, minimal surface (18 API handlers) |
| `frontend/` | Buzz React/Vite app (full Slack-like feature set, originally nostr-relay + Tauri-IPC backed) | Being rewired to gear6 via `VITE_GEAR6=1` — Phase B (boot) done, Phase D (everything else) pending |
| `frontend/src-tauri/` | Tauri v2 shell | Thin shell only (`lib.rs`); ~50-file former nostr backend orphaned (uncompiled), deletion pass pending |
| `admin-web/` | Buzz OSS admin console copy | Not wired to gear6 |
| `mobile/` | Buzz Flutter app copy | Not wired to gear6 |
| `plans/web-backend-integration.mdx` | Integration plan targeting `web/` | Stale — `web/` was dropped (`cb32f80 chore: drop web`) |

## 1. Backend (`src/`) — missing API surface

Implemented: `auth.test`, `conversations.{list,create,join,history,replies}`, `chat.postMessage`, `users.{list,info,identity,lookupByEmail,conversations,profile.get,profile.set,getPresence,setPresence}`, `rtm.connect`, plus non-Slack `register/login/logout`.

Missing (frontend features need them):

- Messaging: `chat.update`, `chat.delete`, `reactions.add/remove`, typing events, pins, saved items
- Channels: `conversations.open` (DMs), `.leave`, `.archive/.unarchive`, `.setTopic`, `.setPurpose`, `.invite`, `.kick`, `.members`, `.info`, `.rename`
- Files/media: upload, download, thumbnails (no `files.*` at all)
- Search: `search.messages`, user search
- Users: avatar upload, custom status, custom emoji
- Admin: roles, member management, moderation
- Everything agent/workflow/project-shaped (§2) has zero backend surface

## 1b. Feature matrix — frontend features vs backend support

Every feature the frontend ships (`frontend/src/features/*`) against what the gear6 backend (`src/`) provides today:

| Feature | Frontend | Backend status | What backend lacks |
|---|---|---|---|
| Channels (list/create/join) | `channels/` | ✅ Implemented | — |
| Message history + threads | `messages/`, `chat/` | ✅ Implemented | — |
| Post message | `messages/` | ✅ Implemented (`chat.postMessage`) | Frontend not wired to it |
| Presence | `presence/` | ✅ Implemented (derived, socket-based) | — |
| User profiles | `profile/` | ⚠️ Partial (`users.profile.get/set`) | Avatar/image upload |
| Auth / sessions | `onboarding/`, `settings/` | ⚠️ Partial (register/login/logout exist) | No frontend login flow; dev bypass in use |
| Edit / delete message | `messages/` | ❌ Missing | `chat.update`, `chat.delete` |
| Reactions | `messages/` | ❌ Missing | `reactions.add/remove` + rtm event |
| DMs | `messages/`, `home/` | ❌ Missing | `conversations.open`, IM listing |
| Channel management (topic/purpose/rename/archive/leave/invite/kick/roles) | `channels/`, `sidebar/` | ❌ Missing | `conversations.setTopic/.setPurpose/.rename/.archive/.leave/.invite/.kick/.members` |
| File/media upload + download | `messages/` (composer, attachments) | ❌ Missing | `files.*`, storage, thumbnails |
| Search (messages, users) | `search/` | ❌ Missing | `search.messages`, user search |
| Typing indicators | `chat/` | ❌ Missing | typing rtm events |
| Pins / saved items | `messages/` | ❌ Missing | `pins.*`, `stars.*` |
| Custom emoji | `custom-emoji/` | ❌ Missing | `emoji.*` + upload |
| User status (custom status) | `user-status/` | ❌ Missing | status fields + API |
| Notifications / unreads | `notifications/`, `home/` | ❌ Missing | unread counts, read markers, mention badges |
| Reminders | `reminders/` | ❌ Missing | `reminders.*` |
| Communities / workspaces | `communities/`, `community-members/` | ❌ Missing | multi-workspace model (single implicit workspace today) |
| Moderation | `moderation/` | ❌ Missing | roles, bans, reports |
| Channel templates | `channel-templates/` | ❌ Missing | template CRUD |
| Canvas | `channels/` (canvas UI) | ❌ Missing | canvas get/set |
| Agents / personas / teams | `agents/` | ❌ Missing | whole agent domain (CRUD, runtimes, approvals, snapshots, models discovery) |
| Agent memory | `agent-memory/` | ❌ Missing | memory store API |
| Workflows | `workflows/` | ❌ Missing | workflow CRUD + runs + approvals |
| Projects / git (repos, PRs, issues) | `projects/` | ❌ Missing | repo hosting, `/git/*` transport, PR/issue model |
| Pulse (social notes/feed) | `pulse/` | ❌ Missing | notes/feed/likes API |
| Forum | `forum/` | ❌ Missing | forum posts API |
| Huddles (audio) | `huddle/` | ❌ Missing | huddle signaling/media |
| Mesh compute (local LLM) | `mesh-compute/` | ❌ Missing | mesh node lifecycle + model catalog (was desktop-side, stubbed) |
| Local / identity archive | `local-archive/`, `identity-archive/` | ❌ Missing | archive read/write, save subscriptions |
| Invites | `communities/` (invite flows) | ❌ Missing | invite create/claim |
| Link previews | `messages/` | ❌ Missing | unfurl endpoint |

## 2. Frontend gear6 adapter (`frontend/src/shared/api/gear6/invoke.ts`) — "Phase D"

~160 distinct Tauri commands invoked across the app; **6 mapped** (`is_shared_identity`, `get_default_relay_url`, `get_channels`, `get_identity`, `get_profile`, `apply_workspace`). All others return `[]` + console warning. Unmapped, by domain:

- **Messaging**: `get_channel_window`, `search_messages`, `edit_message`, `delete_message`, `add_reaction`, `remove_reaction`, `open_dm`, `hide_dm`, `download_file`
- **Channels**: `create_channel`, `update_channel`, `delete_channel`, `join_channel`, `leave_channel`, `archive_channel`, `unarchive_channel`, `set_channel_topic`, `set_channel_purpose`, `add_channel_members`, `remove_channel_member`, `change_channel_member_role`, `get_channel_details`, `ensure_starter_channels`, `get_canvas`, `set_canvas`
- **Channel templates**: `create/update/delete/list/duplicate_channel_template`
- **Media**: `upload_media`, `upload_media_bytes`, `pick_and_upload_media`, `pick_and_upload_image`, `fetch_media_bytes`, `download_image`, `save_png_data_url`, `copy_image_to_clipboard`, `fetch_link_preview_title`, `fetch_workspace_icon`
- **Users/profiles/presence**: `update_profile`, `get_user_profile`, `get_users_batch`, `search_users`, `get_presence`, `get_contact_list`, `set_contact_list`
- **Identity/auth**: `sign_out`, `import_identity`, `persist_current_identity`, `archive_identity`, `unarchive_identity`, `get_nsec`, `sign_event`, `create_auth_event`, `nip44_encrypt_to_self`, `nip44_decrypt_from_self`, `sign_nostr_identity_binding`, `start_pairing`, `confirm_pairing_sas`, `cancel_pairing`
- **Agents/personas/teams**: `list_personas`, `create/update/delete_persona`, `set_persona_active`, `list_teams`, `create/update/delete_team`, `list_managed_agents`, `start/stop_managed_agent`, `*_managed_agent_runtime`, `reconcile_managed_agent_runtimes`, `get/set_global_agent_config`, `get_agent_models`, `discover_agent_models`, `discover_backend_providers`, `discover_acp_providers`, `connect_acp_runtime`, `probe_backend_provider`, `get_agent_memory`, `get_agent_config_surface`, `put_agent_session_config`, `export_agent_snapshot`, `export_team_snapshot`, `encode_agent_snapshot_for_send`, `fetch_snapshot_bytes`, `grant_approval`, `deny_approval`, `get_run_approvals`, `reconcile_inbound_persona_event`, `set_agent_managed_profiles`, `list_relay_agents`
- **Workflows**: `create/update/delete_workflow`, `get_workflow`, `get_workflow_runs`, `get_channel_workflows`, `get_channels_workflows`
- **Social/pulse/forum**: `publish_note`, `get_note`, `get_feed`, `get_global_notes`, `get_user_notes`, `get_liked_notes`, `get_forum_posts`, `get_event`
- **Relay/membership/moderation**: `list_relay_members`, `add_relay_member`, `remove_relay_member`, `change_relay_member_role`, `get_my_relay_membership`, `relay_requires_membership`, `get_relay_self`, `get_relay_ws_url`, `get_relay_http_url`
- **Archive**: `archive_events`, `read_archived_events`, `create/delete_save_subscription`, `merge_save_subscription_kinds`, `remove_save_subscription_kind`, `observer_archive_default_enabled`, `agent_metric_archive_default_enabled`, `decrypt_observer_event`, `build_observer_control_event`, `index_observer_channel_id`
- **Projects/git**: `clone_project_repository`, `get_project_repo_diff`, `validate_repos_dir`, `get_git_identity`, `sign_project_pull_request_review_request`, `publish_project_pull_request_merged_status`, `resolve_oa_owner`
- **Mesh LLM**: `mesh_start_node`, `mesh_stop_node`, `mesh_node_status`, `mesh_installed_models`, `mesh_model_catalog`
- **Desktop/system**: `set_window_vibrancy`, `set_prevent_sleep_active`, `get_os_idle_seconds`, `copy_text_to_clipboard`, `is_auto_update_supported`, `get_baked_build_env`, `get_baked_build_env_keys`

Decision needed per command: map to gear6 endpoint (needs backend work, §1), keep as desktop-only Tauri command (re-registered in shell), or drop the feature in gear6 mode.

## 3. Real-time (`/rtm`) — wire-up incomplete

- `frontend/src/shared/lib/rtm-client.ts` connects and pings, but `onmessage` only `console.log`s — no UI consumes events (messages/presence never reach the timeline or query cache)
- `relayClientSession.ts` in gear6 mode silently drops all outbound frames — no gear6-event → buzz-model translation layer exists yet
- Backend broadcasts every event to every socket (client-side filtering); no per-socket channel/visibility filtering — private-channel events reach all connected users
- No replay/backfill on reconnect (intended path: `conversations.history`; not implemented)
- Scaling markers (`ponytail:` in `src/main.rs`): in-process `broadcast::channel` + presence map → Redis pub/sub needed for >1 node

## 4. Auth — dev bypass only

- Backend `GEAR6_DISABLE_AUTH` resolves every request to the `dev` user; real register/login/logout exist and are tested but unused
- No login UI in `frontend/`; `gear6/http.ts` and `rtm-client.ts` send no `Authorization` header ("add token handling once a real login flow exists")
- Multi-user therefore not usable end-to-end despite backend support

## 5. `frontend/src-tauri/` cleanup + desktop features

- Orphaned former nostr backend (~50 files: `app_state.rs`, `relay.rs`, `migration.rs`, `secret_store.rs`, `commands/*`, `managed_agents/*`, `huddle/`, `mesh_llm/`, `nostr_convert.rs`, …) unreferenced by `lib.rs` — deletion pass pending (noted in `lib.rs` header)
- Updater plugin not registered (needs release signing `pubkey` in `tauri.conf.json`)
- `mesh_llm_stubs.rs` returns "mesh-llm feature not enabled" for all mesh commands
- Desktop conveniences lost with the thin shell (vibrancy, prevent-sleep, PTT shortcut, OS idle, clipboard image) — need re-registration or gear6-mode alternatives if kept

## 6. In-code TODOs

- `frontend/src-tauri/src/commands/workflows.rs:126,259` — `TODO(workflow-runs)`: run reconstruction returns empty array
- `frontend/src-tauri/src/commands/media.rs:355` — `TODO(v2)`: stream large video to relay instead of buffering in RAM
- `frontend/src-tauri/src/commands/global_agent_config.rs:305` — busy/mid-turn deferral not implemented
- `frontend/src-tauri/src/managed_agents/restore.rs:163` — three sweeps walk the PID table independently
- `frontend/src-tauri/src/managed_agents/config_bridge/goose.rs:17` — hardcoded field extraction pending goose schema
- `mobile/lib/features/profile/presence_cache_provider.dart:43` — `TODO(presence)`: relay `presence:true` filter
- `frontend/src/features/settings/ui/NotificationSettingsCard.tsx:182` — "Coming soon" setting
- `frontend/src/features/notifications/lib/sound.ts:52` — notification sound emitter missing

## 7. Sibling apps — unwired

- `admin-web/`: talks to the old Buzz admin API; no gear6 adapter
- `mobile/`: Flutter app still nostr-relay-shaped; no gear6 adapter
- `rtm-client.ts` duplicated between (dropped) `web/` and `frontend/`; extract to a shared package when a third consumer appears

## 8. Docs/config debt

- `plans/web-backend-integration.mdx` references dropped `web/` — stale, superseded by the `frontend/` (buzz) integration
- `frontend/.env` untracked, `tauri.conf.json` locally modified for dev launching — dev setup undocumented
