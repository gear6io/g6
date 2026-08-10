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
  // The sidebar is a real separator, not a decorative line.
  assert.match(markup, /role="separator"[\s\S]{0,200}tabindex="0"/i);
});

// Both window modes sit under the same native chrome, and that chrome is now a
// lone close dot — minimize and zoom are hidden in src-tauri's
// `hide_minimize_and_zoom`. The brand moves into the space the other two dots
// used to hold, at the same inset in both modes.
const BRAND_INSET = "pl-[40px]";

test("the brand clears the lone close dot at the same inset in both modes", () => {
  for (const [mode, markup] of [
    ["expanded", shell()],
    ["compact", render(CloudMiniInbox)],
  ]) {
    // One brand per window: a second mark would mean the compact header leaked
    // into the expanded sidebar or vice versa.
    // `class="g6-mark`, not the asset path: React also emits a `<link
    // rel="preload">` for the artwork, which is not a second brand.
    assert.equal(
      markup.match(/class="g6-mark/g).length,
      1,
      `${mode} should show exactly one Gear6 mark`,
    );
    assert.equal(
      markup.match(/>Gear6</g).length,
      1,
      `${mode} should show exactly one Gear6 wordmark`,
    );
    // The inset is written as one number, so this catches a regression back to
    // the three-button 68px clearance without re-deriving container padding.
    assert.ok(
      markup.includes(BRAND_INSET),
      `${mode} should inset the brand by 40px`,
    );
    assert.ok(
      !markup.includes("pl-[68px]"),
      `${mode} should not keep the obsolete three-button clearance`,
    );
  }
});

test("the compact window keeps its own controls beside the brand", () => {
  const markup = render(CloudMiniInbox);

  for (const label of ["Open Pulse", "Inbox options"]) {
    assert.match(markup, new RegExp(`aria-label="${label}"`));
  }
  // The pin reads out whichever action it offers, so either label is the button.
  assert.match(markup, /aria-label="(Unpin window|Keep window on top)"/);
});

test("the cloud surfaces never reach into the legacy tree", () => {
  const dirs = ["cloudShell", "cloudPulse", "cloudInbox"].map((name) =>
    path.join(here, "..", name),
  );

  const banned =
    /@\/app\/(App|AppShell|LegacyAppRoot|router|routes)|@\/features\/(pulse|channels|messages|agents|communities|huddle|forum|projects|workflows)\/|@tanstack\/react-router|@\/shared\/api\/invoke|rtm-client/;

  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir)) {
      if (!/\.tsx?$/.test(file)) {
        continue;
      }
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      assert.ok(
        !banned.test(source),
        // The whole reason this window has its own shell: cloud builds must not
        // evaluate the legacy module graph. See docs/gear6-render-boundary.md.
        `${file} imports from the legacy tree`,
      );
    }
  }
});
