// Thin Tauri shell for gear6.
//
// The g6 frontend now talks to the gear6 backend directly from the webview
// (HTTP + /rtm websocket) when built with VITE_GEAR6=1, so the desktop side no
// longer needs the nostr command handlers or relay backend. This shell's only
// job is to open the window and load the webview. The former ~50-file nostr
// backend still lives in src/ but is orphaned (unreferenced by this crate root,
// so never compiled); it is deleted in a later cleanup pass.

use tauri::{Listener, Manager};

const INITIAL_RENDER_READY_EVENT: &str = "initial-render-ready";

/// This window cannot usefully be minimized or zoomed — it is a fixed-size panel
/// that collapses to a mini inbox instead — so only the close dot is left on the
/// macOS traffic lights. Hiding is visual: Cmd-M, the Window menu and resizing
/// all still work, and a failure here is cosmetic, never a reason not to launch.
#[cfg(target_os = "macos")]
fn hide_minimize_and_zoom(app: &tauri::AppHandle) {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let ns_window = match window.ns_window() {
        Ok(ptr) => ptr.cast::<NSWindow>(),
        Err(error) => {
            eprintln!("leaving the native window controls as they are: {error}");
            return;
        }
    };
    // SAFETY: `ns_window()` returns the live NSWindow backing this webview
    // window, and `setup` runs on the main thread, where AppKit views belong.
    let ns_window: &NSWindow = unsafe { &*ns_window };
    for button in [
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ] {
        if let Some(button) = ns_window.standardWindowButton(button) {
            button.setHidden(true);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn hide_minimize_and_zoom(_app: &tauri::AppHandle) {}

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
        // No window-state plugin: geometry comes from tauri.conf.json alone. It
        // used to restore the saved size/position, which meant a leftover
        // maximized 1600x1200 from the pre-cloud shell overrode the configured
        // panel size on every launch.
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
        .setup(|app| {
            hide_minimize_and_zoom(app.handle());
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Updater is intentionally not registered: it requires a signing
        // `pubkey` in tauri.conf.json and is release-only. The frontend already
        // tolerates its absence in dev (as in the original OSS dev build).
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
