import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter/wght.css";
import "@/shared/styles/globals.css";
import { selectRootLoader } from "@/app/rootSurface";
import { rtm } from "@/shared/lib/rtm-client";
import { USE_HTTP_API } from "@/shared/api/mode";

// Boot the backend connection the moment the app loads (fire-and-forget).
rtm.connect();

type E2eWindow = Window & {
  __GEAR6_E2E__?: unknown;
};

const E2E_DEFAULT_PUBKEY = "deadbeef".repeat(8);
const E2E_COMMUNITY_ID = "e2e-default-community";
const ONBOARDING_COMPLETION_STORAGE_KEY_PREFIX = "g6-onboarding-complete.v1:";
const DEV_STATE_RESET_PARAM = "resetDevState";

function resetDevWebviewStateFromUrl() {
  if (!import.meta.env.DEV) {
    return;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get(DEV_STATE_RESET_PARAM) !== "1") {
    return;
  }

  // WebKit groups every Gear6 binary under one disk directory, but storage is
  // isolated by origin. Clearing here resets only this dev server's origin;
  // deleting the shared WebKit directory would also destroy installed-app state.
  window.localStorage.clear();
  window.sessionStorage.clear();
  url.searchParams.delete(DEV_STATE_RESET_PARAM);
  window.history.replaceState(window.history.state, "", url);
}

function configureDevE2eBridgeFromUrl() {
  if (!import.meta.env.DEV) {
    return;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get("e2e") !== "mock") {
    return;
  }

  const e2eWindow = window as E2eWindow;
  e2eWindow.__GEAR6_E2E__ ??= { mode: "mock" };

  const community = {
    addedAt: new Date().toISOString(),
    id: E2E_COMMUNITY_ID,
    name: "E2E Test",
    relayUrl: "ws://localhost:3000",
  };
  window.localStorage.setItem("g6-communities", JSON.stringify([community]));
  window.localStorage.setItem("g6-active-community-id", E2E_COMMUNITY_ID);
  window.localStorage.setItem(
    `${ONBOARDING_COMPLETION_STORAGE_KEY_PREFIX}${E2E_DEFAULT_PUBKEY}`,
    "true",
  );
}

async function installE2eBridgeIfConfigured() {
  // The mock bridge is compiled only into dev and explicit E2E builds. A
  // pre-bootstrap global alone must never activate mock IPC in production.
  if (
    !(import.meta.env.DEV || import.meta.env.MODE === "e2e") ||
    !(window as E2eWindow).__GEAR6_E2E__
  ) {
    return;
  }

  const { maybeInstallE2eTauriMocks } = await import("@/testing/e2eBridge");
  maybeInstallE2eTauriMocks();
}

async function bootstrap() {
  resetDevWebviewStateFromUrl();
  configureDevE2eBridgeFromUrl();
  await installE2eBridgeIfConfigured();

  // The render boundary: gear6 builds get their own minimal root, legacy
  // builds get the pre-gear6 provider stack (and its storage migration).
  // Neither tree is imported by the other — see `@/app/rootSurface`.
  const Root = await selectRootLoader(USE_HTTP_API)();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
}

void bootstrap();
