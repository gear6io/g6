// Self-check for the mrkdwn renderer, the only non-trivial logic in format.ts.
// Run: node src/format.check.ts
import assert from "node:assert/strict";
import { renderText, avatarOf } from "./format.ts";

const eq = (raw: string, want: string) => assert.equal(renderText(raw), want);

// Escaping happens before anything else, so no authored markup survives.
eq("<img src=x onerror=alert(1)>", "&lt;img src=x onerror=alert(1)&gt;");
eq("a & b", "a &amp; b");

eq("*bold*", "<strong>bold</strong>");
eq("_it_", "<em>it</em>");
eq("~no~", "<del>no</del>");
eq("`x`", "<code>x</code>");
eq("```\nline\n```", "<pre>line</pre>");

// Emphasis must not fire inside code spans.
eq("`a*b*c`", "<code>a*b*c</code>");

// Plain digits used to collide with the code-span placeholder.
eq("I have 3 apples", "I have 3 apples");
eq("`x` and 0 and `y`", "<code>x</code> and 0 and <code>y</code>");

// A forged placeholder in the input is stripped, not resolved.
eq("\u00000\u0000 `real`", "0 <code>real</code>");

eq(
  "see https://x.dev/a",
  'see <a href="https://x.dev/a" target="_blank" rel="noopener noreferrer">https://x.dev/a</a>',
);
eq("one\ntwo", "one<br>two");

// Unmatched markers stay literal rather than eating the rest of the message.
eq("2 * 3 * 4", "2 * 3 * 4");
eq("snake_case_name", "snake_case_name");

assert.equal(avatarOf("piyush", "U00000001").color, avatarOf("piyush", "U00000001").color);
assert.notEqual(avatarOf("a", "U00000001").color, avatarOf("b", "U00000002").color);

console.log("format.check.ts ok");
