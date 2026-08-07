import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { cloudBootState, runCloudBoot } from "./cloudBoot.ts";
import { CloudBootSurface, CloudRoot } from "./CloudRoot.tsx";
import { loadCloudRoot, selectRootLoader } from "./rootSurface.ts";

const appDir = path.dirname(fileURLToPath(import.meta.url));

function render(state) {
  return renderToStaticMarkup(
    React.createElement(CloudBootSurface, { onRetry: () => {}, state }),
  );
}

test("cloud mode boots the cloud root", async () => {
  assert.equal(selectRootLoader("cloud"), loadCloudRoot);
  assert.equal(await loadCloudRoot(), CloudRoot);
});

test("gateway codes collapse into the four failure states", () => {
  const cases = {
    cloud_not_configured: "configuration",
    cloud_unreachable: "unavailable",
    cloud_not_ready: "unavailable",
    cloud_timeout: "timeout",
    cloud_redirect: "invalid-response",
    cloud_invalid_response: "invalid-response",
    // An unknown code is still a state, never a blank screen.
    something_new: "invalid-response",
  };
  for (const [code, status] of Object.entries(cases)) {
    assert.deepEqual(
      cloudBootState({ ready: false, code, message: "why" }),
      { status, message: "why" },
      code,
    );
  }
  assert.deepEqual(cloudBootState({ ready: true }), { status: "ready" });
});

test("the boot never rejects, even when the client throws", async () => {
  const state = await runCloudBoot(async () => {
    throw new Error("boom");
  });
  assert.deepEqual(state, { status: "invalid-response", message: "boom" });
});

test("the surface renders connecting and ready", () => {
  const connecting = render({ status: "connecting" });
  assert.match(connecting, /data-testid="cloud-root-connecting"/);
  assert.match(connecting, /role="status"/);
  assert.doesNotMatch(connecting, /cloud-root-retry/);

  const ready = render({ status: "ready" });
  assert.match(ready, /data-testid="cloud-root-ready"/);
  assert.match(ready, /Gear6 Cloud is ready/);
  assert.doesNotMatch(ready, /cloud-root-retry/);
});

test("every failure state is diagnostic and retryable", () => {
  for (const status of [
    "configuration",
    "unavailable",
    "timeout",
    "invalid-response",
  ]) {
    const html = render({ status, message: `detail for ${status}` });
    assert.match(html, new RegExp(`data-testid="cloud-root-${status}"`));
    assert.match(html, new RegExp(`detail for ${status}`));
    assert.match(html, /data-testid="cloud-root-retry"/, status);
  }
});

test("cloud mode mounts readiness only, and starts no RTM or legacy shell", () => {
  const rootSource = fs.readFileSync(path.join(appDir, "CloudRoot.tsx"), "utf8");
  assert.ok(
    !/rtm-client|relayClient|@\/app\/(App|AppShell|Gear6Root)/.test(rootSource),
    "CloudRoot must not reach into RTM, the relay client or another shell",
  );
  assert.ok(
    !/shared\/api\/(invoke|http|eventAdapter)/.test(rootSource),
    "CloudRoot must not route through the Slack-compatible adapter",
  );

  const mainSource = fs.readFileSync(path.join(appDir, "../main.tsx"), "utf8");
  const staticImports = [...mainSource.matchAll(/^import .*?"(.*?)";$/gms)].map(
    (match) => match[1],
  );
  assert.ok(
    !staticImports.some((specifier) => /rtm-client/.test(specifier)),
    "main.tsx must not statically import the RTM client",
  );
  assert.match(
    mainSource,
    /APP_MODE === "local"[\s\S]*rtm-client/,
    "RTM stays gated to local mode",
  );

  // This release renders readiness and nothing else.
  const surface = render({ status: "ready" });
  assert.doesNotMatch(surface, /decision|constraint|action|overview/i);
});
