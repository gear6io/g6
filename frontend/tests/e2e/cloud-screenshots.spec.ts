// The five Cloud screens, in both themes, at the sizes they actually ship at.
//
// This exists because there was no way to look at the Cloud surface. The smoke
// project is entirely legacy specs and the bundle it serves is a legacy-mode
// build, so every review of this window until now has been a review of its CSS
// rather than of the window.
//
// Compact is captured at 380x520 because that is `tauri.conf.json`'s startup
// window and `WINDOW_SIZES.compact`. Expanded has no fixed size any more -- it
// fills the monitor's work area -- so it is captured at a plausible one, and the
// only geometry that matters there is the layout's, not the frame's.
import { expect, test, type Page } from "@playwright/test";

import { installCloudGateway } from "../helpers/cloudGateway";

/**
 * Written to a fixed directory rather than only attached to the HTML report, so
 * the five screens can be opened side by side against the mockup without
 * unpacking a report. Gitignored: these are for looking at, not for diffing --
 * pixel baselines on a surface still being designed are a queue of failures
 * that mean "it changed", which everyone learns to re-baseline without reading.
 */
const SCREENS = "test-results/cloud-screens";

const COMPACT = { width: 380, height: 520 };
const EXPANDED = { width: 1440, height: 900 };

const THEMES = ["light", "dark"] as const;

/**
 * The appearance is written before the first paint rather than toggled after
 * it: `applyAppearance` runs on mount, and a screenshot taken during the swap
 * catches whichever half of it landed first.
 */
async function bootCloud(page: Page, theme: "light" | "dark") {
  await installCloudGateway(page);
  await page.addInitScript((value) => {
    window.localStorage.setItem("g6.cloud.appearance", value);
  }, theme);
  await page.goto("/");
  // Readiness resolves through `/api/cloud/healthz` before any surface renders.
  await expect(page.getByTestId("cloud-mini-inbox")).toBeVisible();
}

async function expand(page: Page) {
  await page.setViewportSize(EXPANDED);
  await page.getByRole("button", { name: "Expand to full window" }).click();
  await expect(page.getByTestId("cloud-shell")).toBeVisible();
}

for (const theme of THEMES) {
  test(`compact inbox, ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize(COMPACT);
    await bootCloud(page, theme);

    // The lane counters are the last thing to land, and they are the point of
    // the reclaimed header.
    await expect(page.getByRole("button", { name: /Blocked/ })).toBeVisible();

    await page.screenshot({ path: `${SCREENS}/compact-${theme}.png` });
    await testInfo.attach(`compact-${theme}.png`, {
      path: `${SCREENS}/compact-${theme}.png`,
      contentType: "image/png",
    });

    // One 42px bar with nothing above it: the brand sits inside the top 42px,
    // which is what the reclaimed 54px band was holding.
    const brand = await page.getByRole("heading", { name: "Gear6" }).boundingBox();
    expect(brand?.y).toBeLessThan(42);
  });

  test(`pulse list, ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize(COMPACT);
    await bootCloud(page, theme);
    await expand(page);

    await expect(page.getByRole("button", { name: /Regressed/ }).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Read-state convergence/ }),
    ).toBeVisible();

    await page.screenshot({ path: `${SCREENS}/pulse-${theme}.png` });
    await testInfo.attach(`pulse-${theme}.png`, {
      path: `${SCREENS}/pulse-${theme}.png`,
      contentType: "image/png",
    });

    // Eleven rows in a screen was the whole argument for the row; this asserts
    // the row height that makes it true rather than the count, which depends on
    // the viewport.
    const row = await page
      .getByRole("button", { name: /Read-state convergence/ })
      .boundingBox();
    expect(row?.height).toBeLessThan(56);
  });

  test(`pulse detail, ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize(COMPACT);
    await bootCloud(page, theme);
    await expand(page);

    await page.getByRole("button", { name: /Read-state convergence/ }).click();
    await expect(
      page.getByRole("complementary", { name: /Read-state convergence/ }),
    ).toBeVisible();
    // The panel is where the full rail lives, and the rail needs its timeline.
    await expect(page.getByText("Read-only — Cloud does not post.")).toBeVisible();

    await page.screenshot({ path: `${SCREENS}/pulse-detail-${theme}.png` });
    await testInfo.attach(`pulse-detail-${theme}.png`, {
      path: `${SCREENS}/pulse-detail-${theme}.png`,
      contentType: "image/png",
    });
  });

  test(`pulse search, ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize(COMPACT);
    await bootCloud(page, theme);
    await expand(page);

    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Search Cloud" });
    await expect(palette).toBeVisible();
    await page.keyboard.type("read state");

    // All three scopes answer from one request, so the tab counts land together.
    await expect(palette.getByRole("button", { name: /^Events \d/ })).toBeVisible();

    await page.screenshot({ path: `${SCREENS}/pulse-search-${theme}.png` });
    await testInfo.attach(`pulse-search-${theme}.png`, {
      path: `${SCREENS}/pulse-search-${theme}.png`,
      contentType: "image/png",
    });
  });

  test(`inbox reader, ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize(COMPACT);
    await bootCloud(page, theme);
    await expand(page);

    await page.getByRole("button", { name: "Inbox", exact: true }).click();
    await page
      .getByRole("button", { name: /Gateway rejects kind 44200/ })
      .first()
      .click();

    await expect(page.getByText("Why this is on your list:")).toBeVisible();
    // The footer that keeps the read-only contract visible rather than
    // discovered by pressing something that does nothing.
    await expect(
      page.getByText(/there is no Done and no Snooze/),
    ).toBeVisible();

    await page.screenshot({ path: `${SCREENS}/inbox-${theme}.png` });
    await testInfo.attach(`inbox-${theme}.png`, {
      path: `${SCREENS}/inbox-${theme}.png`,
      contentType: "image/png",
    });
  });
}
