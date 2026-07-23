// Single switch that re-points the buzz frontend at the gear6 backend instead
// of the (removed) nostr/Tauri backend. Set VITE_GEAR6=1 at dev/build time.
//
// This is deliberately NOT `!isTauri()`: in the desktop webview `isTauri()` is
// true, yet we still want gear6, so the decision must be an explicit build flag.
export const USE_HTTP_API = import.meta.env.VITE_GEAR6 === "1";
