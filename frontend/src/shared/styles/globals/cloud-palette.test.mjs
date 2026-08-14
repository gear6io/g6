import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const design = readFileSync(
  new URL("../../../../../Design.md", import.meta.url),
  "utf8",
);
const theme = readFileSync(new URL("./theme.css", import.meta.url), "utf8");

const EXPECTED = {
  light: {
    brand: "#2451b8",
    "brand-ink": "#2148a5",
    "brand-press": "#3163d0",
    "brand-fg": "#ffffff",
    "brand-mute": "#b8c6e8",
    "brand-tint": "#3a63c4",
    surface: "#f1efe9",
    "surface-alt": "#e6ecf9",
    canvas: "#fcfbf8",
    ink: "#1a1c22",
    "ink-mute": "#61646f",
    hairline: "#e1ddd5",
    link: "#2451b8",
    error: "#a8503a",
    warning: "#7b5a17",
    success: "#2a6f54",
  },
  dark: {
    brand: "#3a67cf",
    "brand-ink": "#9fb6ef",
    "brand-press": "#4b79e0",
    "brand-fg": "#ffffff",
    "brand-mute": "#b8c6e8",
    "brand-tint": "#6c80bb",
    surface: "#1f2027",
    "surface-alt": "#272a35",
    canvas: "#16171d",
    ink: "#e1e2e9",
    "ink-mute": "#989cab",
    hairline: "#32343f",
    link: "#8fb0f0",
    error: "#e58f78",
    warning: "#dab060",
    success: "#57c096",
  },
};

function block(start, end) {
  const from = theme.indexOf(start);
  const to = theme.indexOf(end, from);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing end marker for ${start}`);
  return theme.slice(from, to);
}

function tokenValue(source, token) {
  return source
    .match(new RegExp(`--g6-pulse-${token}:\\s*([^;]+);`))?.[1]
    .trim();
}

test("Cloud palette matches Design.md in light and dark", () => {
  const light = block("/* Cloud uses Design.md", "  .dark {");
  const dark = block("/* Dark rendering is a tuned companion", "  }");

  for (const [mode, source] of [
    ["light", light],
    ["dark", dark],
  ]) {
    for (const [token, value] of Object.entries(EXPECTED[mode])) {
      assert.equal(tokenValue(source, token), value, `${mode} ${token}`);
      assert.match(
        design,
        new RegExp(value, "i"),
        `${value} must come from Design.md`,
      );
    }
  }

  for (const retired of [
    "#4a154b",
    "#611f69",
    "#f4ede4",
    "#f9f0ff",
    "#262a3d",
  ]) {
    assert.doesNotMatch(light + dark, new RegExp(retired, "i"));
  }
});
