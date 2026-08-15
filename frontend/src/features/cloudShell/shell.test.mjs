import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CloudMiniInbox } from "../cloudInbox/CloudMiniInbox.tsx";
import { CloudShell } from "./CloudShell.tsx";
import { CloudWindowProvider } from "./CloudWindowProvider.tsx";

const here = path.dirname(fileURLToPath(import.meta.url));

function render(Component) {
  return renderToStaticMarkup(
    React.createElement(
      CloudWindowProvider,
      null,
      React.createElement(Component),
    ),
  );
}

function shell() {
  return render(CloudShell);
}

test("the expanded window offers Pulse, Inbox, Settings and a way back", () => {
  const markup = shell();

  assert.match(markup, /data-testid="cloud-shell"/);
  assert.match(markup, />Pulse</);
  assert.match(markup, />Inbox</);
  assert.match(markup, />Settings</);
  assert.match(markup, /aria-label="Return to mini inbox"/);
  // Pulse is the landing view, and the current one is announced as such.
  assert.match(markup, /aria-current="page"[\s\S]{0,900}Pulse/);
  assert.equal(markup.match(/aria-current="page"/g).length, 1);
});

// The rail is 52px of icons, so every destination's name is its accessible name
// and its tooltip rather than a word beside it. A rail row whose only label is
// a picture is a rail row a screen reader announces as "button".
test("every rail destination is named, not only drawn", () => {
  const markup = shell();

  for (const label of ["Pulse", "Inbox", "Settings"]) {
    assert.match(
      markup,
      new RegExp(
        `title="${label}"[\\s\\S]{0,900}<span class="sr-only">${label}</span>`,
      ),
      `${label} should carry both a tooltip and an accessible name`,
    );
  }
});

// Search is chrome: Pulse, the inbox and anything added later all need it, so it
// sits in the window bar at every width rather than inside one view.
test("the window bar carries search and names the view under it", () => {
  const markup = shell();

  assert.match(markup, /Search milestones, events, people/);
  assert.match(markup, /⌘K/);
  assert.match(
    markup,
    /<span class="shrink-0[^"]*font-semibold[^"]*">Pulse<\/span>/,
  );
  assert.match(markup, /aria-label="Timeline window" class="ml-auto/);
  for (const days of [7, 30, 90]) {
    assert.match(markup, new RegExp(`>${days}d<`));
  }
  assert.match(markup, /aria-pressed="true"[^>]*>30d</);
});

// The native chrome is now a lone close dot at x=14, y=13 — minimize and zoom
// are hidden in src-tauri's `hide_minimize_and_zoom`. Compact clears it with
// `pl-9` on a 42px bar; the expanded window clears it with the rail's own
// `pt-[42px]`, because the rail runs to the window's top edge rather than
// starting under a bar.
test("the compact window brands itself and clears the lone close dot", () => {
  const markup = render(CloudMiniInbox);

  // One brand per window. `class="g6-mark`, not the asset path: React also
  // emits a `<link rel="preload">` for the artwork, which is not a second brand.
  assert.equal(markup.match(/class="g6-mark/g).length, 1);
  assert.equal(markup.match(/>Gear6</g).length, 1);
  assert.ok(markup.includes("pl-9"), "the brand should clear the dot at 36px");
  assert.ok(
    !markup.includes("pl-[68px]") && !markup.includes("pl-[40px]"),
    "neither obsolete clearance should come back",
  );
});

// The expanded window does not repeat the brand. The rail is navigation, the
// window bar names the view, and an app that says its own name on every screen
// is using a row of pixels to tell you what you already opened.
test("the expanded window is nav, not a second masthead", () => {
  const markup = shell();

  assert.doesNotMatch(markup, /class="g6-mark/);
  assert.match(markup, /class="flex w-\[52px\][^"]*pt-\[42px\]"/);
});

// The 54px of empty header was the close dot's old y=25 plus its clearance, and
// it cost a whole action row in a 520px window. One bar, and the first content
// under it.
test("the compact header is one 42px bar with nothing above it", () => {
  const markup = render(CloudMiniInbox);

  assert.match(markup, /<header class="g6-pulse-chrome flex h-\[42px\]/);
  assert.ok(
    !markup.includes("pt-[54px]"),
    "the reclaimed band should not come back as padding",
  );
});

test("the compact window keeps its own controls beside the brand", () => {
  const markup = render(CloudMiniInbox);

  for (const label of ["Expand to full window", "Inbox options"]) {
    assert.match(markup, new RegExp(`aria-label="${label}"`));
  }
  // The pin reads out whichever action it offers, so either label is the button.
  assert.match(markup, /aria-label="(Unpin window|Keep window on top)"/);
});

// `thread.ts` reuses the erased TimelineMessage type, not the legacy renderer.
const CLOUD_TYPE_IMPORTS = ["@/features/messages/types"];

test("the cloud surfaces never reach into the legacy tree", () => {
  const dirs = ["cloudShell", "cloudPulse", "cloudInbox", "cloudSearch"].map(
    (name) => path.join(here, "..", name),
  );

  const banned =
    /@\/app\/(App|AppShell|LegacyAppRoot|router|routes)|@\/features\/(pulse|channels|messages|agents|communities|huddle|forum|projects|workflows)\/|@tanstack\/react-router|@\/shared\/api\/invoke|rtm-client/;

  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir)) {
      if (!/\.tsx?$/.test(file)) {
        continue;
      }
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      // Blanked before the scan rather than excepted in the pattern: the ban
      // stays a single readable regex, and an import one character off an
      // allowed specifier still trips it.
      const scanned = CLOUD_TYPE_IMPORTS.reduce(
        (text, allowed) => text.split(allowed).join(""),
        source,
      );
      assert.ok(
        !banned.test(scanned),
        // The whole reason this window has its own shell: cloud builds must not
        // evaluate the legacy module graph. See docs/gear6-render-boundary.md.
        `${file} imports from the legacy tree`,
      );
    }
  }
});

/**
 * Follows runtime `import` edges from a module and returns every legacy
 * specifier reachable from it.
 *
 * The per-file scan above only reads the cloud directories, so it cannot see a
 * legacy dependency two modules deep. `import type` is skipped: types are
 * erased and never evaluate their module.
 */
function legacyReachableFrom(entry) {
  // `@/app/navigation` is named too: `useAppNavigation` is the router by
  // another path, and it is what a message body reaches for.
  const banned =
    /@\/app\/(App|AppShell|LegacyAppRoot|router|routes|navigation)|@tanstack\/react-router|@\/shared\/api\/invoke|rtm-client/;
  const srcDir = path.join(here, "..", "..");

  // Relative specifiers resolve too, so an indirect import cannot evade the
  // same boundary check applied to an aliased one.
  const resolve = (specifier, importer) => {
    let base;
    if (specifier.startsWith("@/")) {
      base = path.join(srcDir, specifier.slice(2));
    } else if (specifier.startsWith(".")) {
      base = path.resolve(path.dirname(importer), specifier);
    } else {
      return null;
    }
    return (
      [
        base + ".tsx",
        base + ".ts",
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
      ].find((file) => fs.existsSync(file)) ?? null
    );
  };

  const leaks = [];
  const seen = new Set([entry]);
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /(?:^|\n)import\s+(type\s+)?[^;]*?\s+from\s+"([^"]+)"/gs,
    )) {
      if (match[1]) {
        continue;
      }
      const specifier = match[2];
      if (banned.test(specifier)) {
        leaks.push(`${path.relative(srcDir, file)} imports ${specifier}`);
        continue;
      }
      const next = resolve(specifier, file);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return leaks;
}

/**
 * What the expanded window is allowed to pull in behind `markdown.tsx`, and why
 * each one is inert here.
 *
 * The thread reader renders message bodies through the workspace's `Markdown`,
 * which is the whole point — reimplementing markdown, links, code highlighting
 * and media for the cloud window would be a lookalike that drifts. Four of its
 * imports sit in the legacy graph, and every one of them is behind a prop the
 * cloud reader does not pass:
 *
 * - `MarkdownVideoPlayer` reaches `MessageComposer` for frame-accurate video
 *   comments, mounted only when `canComment` — which needs `videoReviewContext`.
 * - `UserProfilePopover` wraps a mention chip only when `opensProfile`, which
 *   needs a pubkey resolved through `mentionPubkeysByName`.
 * - `config-nudge-attachment` renders only when `configNudgeAuthorPubkey` is
 *   set, which for third-party content it must never be.
 * - `shared/api/tauri` is an IPC wrapper evaluated at import; the cloud window
 *   is a Tauri window, so `invoke` is there.
 *
 * So none of them can throw in render, which is the failure this file exists to
 * catch. The list stays exact rather than becoming a regex: a fifth leak, or a
 * newly renderable fourth, still fails here.
 */
const MARKDOWN_LEGACY_EDGES = [
  "features/agents/useOpenAgentActivity.ts imports @/app/navigation/useAppNavigation",
  "features/messages/lib/useLinkEditor.tsx imports @/app/navigation/useAppNavigation",
  "features/profile/ui/UserProfilePopover.tsx imports @/app/navigation/useAppNavigation",
  "shared/api/tauri.ts imports @/shared/api/invoke",
  "shared/ui/config-nudge-attachment.tsx imports @/app/AppShellContext",
];

test("nothing the cloud window evaluates pulls the router or the relay in behind it", () => {
  // The compact window renders no messages at all, so it stays strictly clean.
  assert.deepEqual(
    legacyReachableFrom(path.join(here, "../cloudInbox/CloudMiniInbox.tsx")),
    [],
    "the mini inbox reaches the legacy graph",
  );

  assert.deepEqual(
    [...new Set(legacyReachableFrom(path.join(here, "CloudShell.tsx")))].sort(),
    MARKDOWN_LEGACY_EDGES,
    "the expanded window's legacy dependencies changed",
  );
});

test("the cloud reader passes none of the props that would wake the legacy imports", () => {
  // The allowlist above is only safe while these stay unpassed. A comment
  // cannot enforce that, so this does: each prop is the gate that keeps one
  // legacy subtree from ever rendering in a window that has no router.
  const reader = fs.readFileSync(
    path.join(here, "../cloudPulse/CloudThreadPanel.tsx"),
    "utf8",
  );

  for (const prop of [
    "videoReviewContext",
    "mentionPubkeysByName",
    "configNudgeAuthorPubkey",
  ]) {
    assert.ok(
      !new RegExp(`^\\s*${prop}=`, "m").test(reader),
      `CloudThreadPanel passes ${prop}, which makes a legacy subtree renderable`,
    );
  }
});

test("markdown takes its navigation injected, so a message body never needs a router", () => {
  // The regression this pins: `markdown.tsx` called `useAppNavigation`, whose
  // `useLocation` throws outside a `RouterProvider` — and a `RouterProvider`
  // cannot be added around it, because it renders a route tree rather than
  // children. Every cloud message body crashed the window to a blank screen.
  const markdown = fs.readFileSync(
    path.join(here, "..", "..", "shared", "ui", "markdown.tsx"),
    "utf8",
  );

  assert.ok(
    !/useAppNavigation/.test(markdown),
    "markdown must read navigation from context, not import the router",
  );
  assert.match(markdown, /useMarkdownNavigation/);
});

test("the profile popover stays on the legacy side of the message renderer", () => {
  // The one seam holding the allowlist above open. If `MessageRow` ever imports
  // the popover directly again, the cloud window starts evaluating the router,
  // and the guard above would still pass because it only reads cloud files.
  const row = fs.readFileSync(
    path.join(here, "..", "messages", "ui", "MessageRow.tsx"),
    "utf8",
  );

  assert.ok(
    !/^import .*UserProfilePopover/m.test(row),
    "MessageRow must take its author popover as a prop, not import it",
  );
  assert.match(row, /authorSlot\?: MessageAuthorSlot/);
});
