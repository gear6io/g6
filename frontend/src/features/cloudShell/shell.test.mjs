import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CloudShell } from "./CloudShell.tsx";
import { CloudWindowProvider } from "./CloudWindowProvider.tsx";

const here = path.dirname(fileURLToPath(import.meta.url));

function shell() {
  return renderToStaticMarkup(
    React.createElement(CloudWindowProvider, null, React.createElement(CloudShell)),
  );
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
