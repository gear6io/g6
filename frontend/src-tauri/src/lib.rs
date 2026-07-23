// Thin Tauri shell for gear6.
//
// The buzz frontend now talks to the gear6 backend directly from the webview
// (HTTP + /rtm websocket) when built with VITE_GEAR6=1, so the desktop side no
// longer needs the nostr command handlers or relay backend. This shell's only
// job is to open the window and load the webview. The former ~50-file nostr
// backend still lives in src/ but is orphaned (unreferenced by this crate root,
// so never compiled); it is deleted in a later cleanup pass.

use tauri::{Listener, Manager};
use tauri_plugin_window_state::StateFlags;

const INITIAL_RENDER_READY_EVENT: &str = "initial-render-ready";

fn reveal_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Focus the existing window when a duplicate instance launches.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Visibility is excluded: the reveal plugin below shows the
                // window after saved geometry is restored and the first frame
                // has rendered, so the config's `visible: false` holds until then.
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(
            tauri::plugin::Builder::<_, ()>::new("initial-window-reveal")
                .on_webview_ready(|webview| {
                    if webview.label() != "main" {
                        return;
                    }
                    let app = webview.window().app_handle().clone();
                    // Reveal as soon as the frontend signals its first render…
                    let ready_app = app.clone();
                    app.once(INITIAL_RENDER_READY_EVENT, move |_| {
                        reveal_main_window(&ready_app);
                    });
                    // …with a timeout fallback so the window can never stay
                    // hidden if that event never arrives. reveal is idempotent.
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(5));
                        reveal_main_window(&app);
                    });
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Updater is intentionally not registered: it requires a signing
        // `pubkey` in tauri.conf.json and is release-only. The frontend already
        // tolerates its absence in dev (as in the original OSS dev build).
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
