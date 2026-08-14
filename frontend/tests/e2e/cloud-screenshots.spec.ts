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
const EXPANDED_MIN = { width: 960, height: 640 };

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

async function expand(page: Page, size = EXPANDED) {
  await page.setViewportSize(size);
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
    const brand = await page
      .getByRole("heading", { name: "Gear6" })
      .boundingBox();
    expect(brand?.y).toBeLessThan(42);
  });

  test(`pulse list, ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize(COMPACT);
    await bootCloud(page, theme);
    await expand(page);

    await expect(
      page.getByRole("button", { name: /Regressed/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Read-state convergence/ }),
    ).toBeVisible();
    await expect(page.getByText("Sort: Last observed ▾")).toBeVisible();

    const searchBox = await page
      .getByRole("button", { name: /Search milestones/ })
      .boundingBox();
    const timeWindow = await page
      .getByRole("group", { name: "Timeline window" })
      .boundingBox();
    expect(timeWindow?.x).toBeGreaterThan(
      (searchBox?.x ?? 0) + (searchBox?.width ?? 0) + 300,
    );

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
    await expect(
      page.getByText("Read-only — Cloud does not post."),
    ).toBeVisible();
    // The detail reader opens on the newest stage, as the mockup does.
    await expect(page.getByText(/Gateway rejected kind 44200/)).toBeVisible();

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
    await expect(
      palette.getByRole("button", { name: /^Events \d/ }),
    ).toBeVisible();

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
    await expect(page.getByTestId("cloud-thread-conversation")).toBeVisible();
    await expect(
      page.getByText(/Gateway is rejecting kind 44200/),
    ).toBeVisible();
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

    await page.setViewportSize(EXPANDED_MIN);
    await expect(page.getByTestId("cloud-inbox-facets")).toBeHidden();
    expect(
      (await page.getByTestId("cloud-inbox-list").boundingBox())?.width,
    ).toBe(300);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(EXPANDED_MIN.width);

    await page.screenshot({ path: `${SCREENS}/inbox-min-${theme}.png` });
    await testInfo.attach(`inbox-min-${theme}.png`, {
      path: `${SCREENS}/inbox-min-${theme}.png`,
      contentType: "image/png",
    });
  });

  test(`minimum expanded width, ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize(COMPACT);
    await bootCloud(page, theme);
    await expand(page, EXPANDED_MIN);

    await page.getByRole("button", { name: /Read-state convergence/ }).click();
    const detail = page.getByRole("complementary", {
      name: /Read-state convergence/,
    });
    await expect(detail).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(EXPANDED_MIN.width);

    const detailBox = await detail.boundingBox();
    expect(detailBox?.x).toBeGreaterThanOrEqual(0);
    expect((detailBox?.x ?? 0) + (detailBox?.width ?? 0)).toBeLessThanOrEqual(
      EXPANDED_MIN.width,
    );

    await detail.getByRole("button", { name: "Close detail" }).click();
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Search Cloud" });
    await palette.getByRole("textbox").fill("read state");
    await palette
      .getByRole("option", { name: /Gateway rejected kind 44200/ })
      .click();
    const conversation = page.getByTestId("cloud-thread-panel");
    await expect(conversation).toBeVisible();

    const conversationBox = await conversation.boundingBox();
    expect(conversationBox?.x).toBeGreaterThanOrEqual(0);
    expect(
      (conversationBox?.x ?? 0) + (conversationBox?.width ?? 0),
    ).toBeLessThanOrEqual(EXPANDED_MIN.width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(EXPANDED_MIN.width);

    await page.screenshot({ path: `${SCREENS}/expanded-min-${theme}.png` });
    await testInfo.attach(`expanded-min-${theme}.png`, {
      path: `${SCREENS}/expanded-min-${theme}.png`,
      contentType: "image/png",
    });
  });
}

test("Pulse views, windows and repeated search stay coherent", async ({
  page,
}) => {
  await page.setViewportSize(COMPACT);
  await bootCloud(page, "light");
  await expand(page);

  await page.getByRole("button", { name: "Moved today" }).click();
  await expect(
    page.getByRole("button", { name: /Agent observer frames/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Managed agent readiness/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Local archive seeding/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Read-state convergence/ }),
  ).toHaveCount(0);

  const sevenDayTimeline = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname.endsWith("/timeline") &&
      url.searchParams.get("from") === "2026-08-08" &&
      url.searchParams.get("to") === "2026-08-14"
    );
  });
  await page.getByRole("button", { name: "7d" }).click();
  await sevenDayTimeline;
  await expect(page.getByText("Last 7 days")).toBeVisible();

  const searchMilestone = async (term: string, name: RegExp) => {
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Search Cloud" });
    await palette.getByRole("textbox").fill(term);
    await palette.getByRole("option", { name }).click();
  };

  // This result is outside the default attention statuses. Selecting it must
  // reset stale facets and open the exact hit, not merely copy its title.
  await searchMilestone("theme tokens", /Theme tokens/);
  await expect(
    page.getByRole("complementary", { name: /Theme tokens/ }),
  ).toBeVisible();

  // A second search starts while the first query is still applied.
  await searchMilestone("agent observer", /Agent observer frames/);
  await expect(
    page.getByRole("complementary", { name: /Agent observer frames/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(page.getByRole("button", { name: "Clear filter" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: /Theme tokens/ }),
  ).toBeVisible();

  // Selecting the same search hit again is still a command even though its
  // query text equals the previous search command's text.
  await searchMilestone("agent observer", /Agent observer frames/);
  await expect(
    page.getByRole("complementary", { name: /Agent observer frames/ }),
  ).toBeVisible();
});
