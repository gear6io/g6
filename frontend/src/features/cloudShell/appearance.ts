// Light, dark, or whatever the OS says — the whole of appearance in the cloud
// build.
//
// Deliberately not `@/shared/theme/ThemeProvider`: that one carries the legacy
// shell's gradients, per-community accents, sidebar surfaces and Tauri theme
// sync, none of which this window has. All the tokens need is `light` or `dark`
// on the document element, which is what this writes.

export type Appearance = "system" | "light" | "dark";

export const APPEARANCE_STORAGE_KEY = "g6.cloud.appearance";

export const APPEARANCES: readonly { id: Appearance; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

function isAppearance(raw: string | null): raw is Appearance {
  return raw === "system" || raw === "light" || raw === "dark";
}

export function readAppearance(): Appearance {
  try {
    // `typeof` rather than a truthiness check: the render tests run this in
    // node, where `window` is not defined at all.
    if (typeof window === "undefined") {
      return "system";
    }
    const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearance(raw) ? raw : "system";
  } catch {
    // Private mode, or a webview with storage disabled. Not worth a failure:
    // the app still renders, it just cannot remember the choice.
    return "system";
  }
}

/** Resolves `system` against the OS, then writes the class the tokens read. */
export function applyAppearance(appearance: Appearance): void {
  const dark =
    appearance === "dark" ||
    (appearance === "system" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches === true);

  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(dark ? "dark" : "light");
}

export function storeAppearance(appearance: Appearance): void {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
  } catch {
    // Same as above: unremembered, not broken.
  }
}
