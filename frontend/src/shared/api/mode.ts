// Which app surface this build mounts. Replaces the single-purpose VITE_GEAR6
// switch, because there are now three roots rather than two.
//
// Deliberately NOT derived from `isTauri()`: in the desktop webview `isTauri()`
// is true for every mode, so the decision has to be an explicit build flag.

export type AppMode = "cloud" | "local" | "legacy";

/** The build-time inputs, as a shape a test can hand in. */
export type AppModeEnv = {
  VITE_G6_APP_MODE?: string;
  VITE_GEAR6?: string;
};

const MODES: readonly string[] = ["cloud", "local", "legacy"];

/**
 * `VITE_G6_APP_MODE` decides. `VITE_GEAR6=1` is a temporary compatibility alias
 * for `local`. Anything else — including an unrecognised mode string — keeps
 * today's default, the legacy shell, so a typo can never silently swap the app
 * out from under an existing dev setup.
 */
export function resolveAppMode(env: AppModeEnv): AppMode {
  const explicit = env.VITE_G6_APP_MODE?.trim();
  if (explicit && MODES.includes(explicit)) {
    return explicit as AppMode;
  }
  return env.VITE_GEAR6 === "1" ? "local" : "legacy";
}

// `?? {}` because node (the unit-test runner) has `import.meta` but no `.env`.
export const APP_MODE = resolveAppMode((import.meta.env ?? {}) as AppModeEnv);

/**
 * The Slack-compatible backend adapter. False in cloud mode on purpose: every
 * `USE_HTTP_API` branch is about the local Slack-shaped surface, not about
 * "this build has a backend" — cloud mode has one and uses none of them.
 */
export const USE_HTTP_API = APP_MODE === "local";
