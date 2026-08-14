// Rasterise the SVG masters with the Chromium the repo already has for
// Playwright. Each PNG is rendered at its own size rather than downscaled from
// one master, so the round caps stay crisp and the <32px cut can differ.
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [, , masterDir, jobsFile] = process.argv;
const jobs = JSON.parse(readFileSync(jobsFile, "utf8"));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });

const cache = new Map();
function master(name) {
  if (!cache.has(name)) {
    cache.set(name, readFileSync(resolve(masterDir, name), "utf8"));
  }
  return cache.get(name);
}

for (const { svg, size, out } of jobs) {
  const source = master(svg)
    .replace('width="168"', `width="${size}"`)
    .replace('height="168"', `height="${size}"`);

  await page.setContent(
    `<!doctype html><meta charset="utf-8">` +
      `<style>html,body{margin:0;padding:0;background:transparent}` +
      `svg{display:block}</style>${source}`,
    { waitUntil: "load" },
  );
  const el = await page.$("svg");
  mkdirSync(dirname(out), { recursive: true });
  const buf = await el.screenshot({ omitBackground: true, type: "png" });
  writeFileSync(out, buf);
  console.log(`${size.toString().padStart(4)}  ${out}`);
}

await browser.close();
