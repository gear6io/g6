import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Gear6BootSurface, Gear6Root } from "./Gear6Root.tsx";
import {
  loadGear6Root,
  loadLegacyRoot,
  selectRootLoader,
} from "./rootSurface.ts";

const appDir = path.dirname(fileURLToPath(import.meta.url));

test("gear6 mode boots the replacement root", async () => {
  assert.equal(selectRootLoader(true), loadGear6Root);
  assert.equal(await loadGear6Root(), Gear6Root);
});

test("gear6 mode never pulls in the legacy shell", async () => {
  // Loading the legacy tree in node fails outright (App -> onboarding assets ->
  // .png, which the test loader cannot resolve). So the previous test resolving
  // at all is the proof: the gear6 branch imported none of it. Belt and braces,
  // the boundary must also stay dynamic — a static `@/app/App` import in
  // main.tsx would evaluate the shell's module graph in every build.
  const mainSource = fs.readFileSync(path.join(appDir, "../main.tsx"), "utf8");
  const staticImports = [...mainSource.matchAll(/^import .*?"(.*?)";$/gms)].map(
    (match) => match[1],
  );

  const legacyImport = staticImports.find((specifier) =>
    /app\/(App|AppShell|LegacyAppRoot)/.test(specifier),
  );
  assert.equal(
    legacyImport,
    undefined,
    "main.tsx must not statically import the legacy shell",
  );

  const surfaceSource = fs.readFileSync(
    path.join(appDir, "Gear6Root.tsx"),
    "utf8",
  );
  assert.ok(
    !/@\/app\/(App|AppShell)/.test(surfaceSource),
    "Gear6Root must not reach into the legacy shell",
  );
});

test("non-gear6 mode still boots the existing app", () => {
  // Compared by identity rather than invoked: calling it would mount the legacy
  // provider stack, which is exactly what this build is supposed to keep doing
  // and what node cannot import.
  assert.equal(selectRootLoader(false), loadLegacyRoot);

  const loaderSource = fs.readFileSync(
    path.join(appDir, "rootSurface.ts"),
    "utf8",
  );
  assert.match(loaderSource, /import\("@\/app\/LegacyAppRoot"\)/);
  assert.match(
    loaderSource,
    /migrateLegacyCommunityStorageBeforeRender\(\)/,
    "legacy boot keeps its storage migration",
  );
});

test("boot failures render a retryable error, not a loading gate", () => {
  const html = renderToStaticMarkup(
    React.createElement(Gear6BootSurface, {
      onRetry: () => {},
      state: { status: "error", message: "backend unreachable" },
    }),
  );

  assert.match(html, /data-testid="gear6-root-error"/);
  assert.match(html, /data-testid="gear6-root-retry"/);
  assert.match(html, /backend unreachable/);
  assert.doesNotMatch(html, /gear6-root-loading/);
});

test("the boot surface renders a loading and a ready state", () => {
  const loading = renderToStaticMarkup(
    React.createElement(Gear6BootSurface, {
      onRetry: () => {},
      state: { status: "loading" },
    }),
  );
  assert.match(loading, /data-testid="gear6-root-loading"/);
  assert.match(loading, /role="status"/);

  const ready = renderToStaticMarkup(
    React.createElement(Gear6BootSurface, {
      onRetry: () => {},
      state: { status: "ready", pubkey: "u-dev", displayName: "dev" },
    }),
  );
  assert.match(ready, /data-testid="gear6-root-ready"/);
  assert.match(ready, /u-dev/);
  // The legacy shell's own markers must never appear on this surface.
  assert.doesNotMatch(ready, /g6-huddle-shell|data-huddle-open/);
});
