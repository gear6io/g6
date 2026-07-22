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

// Mentions: the server sends tokens in `text` plus a resolved `mentions` sidecar.
const ctx = { mentions: { U00000001: "astha", C00000001: "dev_ops" }, meId: "U00000002" };
const eqm = (raw: string, want: string) => assert.equal(renderText(raw, ctx), want);

eqm("hi <@U00000001>", 'hi <span class="mention">@astha</span>');
eqm("hi <@U00000002>", 'hi <span class="mention me">@U00000002</span>');
// No sidecar entry and no inline label: the id is all there is to show.
eqm("<@U00000009>", '<span class="mention">@U00000009</span>');
eqm("<@U00000009|ghost>", '<span class="mention">@ghost</span>');
eqm("<!here>", '<span class="mention broadcast">@here</span>');
// Channel tokens are stored bare; the sidecar name wins over any label an SDK froze in.
eqm("<#C00000001>", '<span class="mention channel" data-channel="C00000001">#dev_ops</span>');
eqm(
  "<#C00000001|old_name>",
  '<span class="mention channel" data-channel="C00000001">#dev_ops</span>',
);
// The pill is stashed like a code span, so the _italic_ pass cannot eat the name.
assert.ok(!renderText("<#C00000001|dev_ops>", ctx).includes("<em>"));
// A token inside a code span stays literal.
eqm("`<@U00000001>`", "<code>&lt;@U00000001&gt;</code>");
// Sidecar names are data, not markup.
assert.equal(
  renderText("<@U00000003>", { mentions: { U00000003: "<img src=x>" } }),
  '<span class="mention">@&lt;img src=x&gt;</span>',
);

assert.equal(avatarOf("piyush", "U00000001").color, avatarOf("piyush", "U00000001").color);
assert.notEqual(avatarOf("a", "U00000001").color, avatarOf("b", "U00000002").color);

console.log("format.check.ts ok");
