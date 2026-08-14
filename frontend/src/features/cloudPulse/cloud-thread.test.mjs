// The Cloud thread reader, rendered the way the cloud window renders it.
//
// This is the test that would have caught two separate failures. The first was
// a blank screen: `markdown.tsx` once reached for the router and Radix's
// tooltip reached for a provider, and a throw in render is a white window. The
// second was quieter — the reader printed `**bold**` and `> quoted` as literal
// characters for a while, because the body was a plain `<p>`. A test that
// renders the real component with cloud-shaped rows notices both.
//
// `ThreadMessages` rather than `CloudThreadConversation` on purpose: the latter
// fetches in an effect, and effects never run under `renderToStaticMarkup`.
import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ThreadMessages } from "./CloudThreadPanel.tsx";
import { toThread } from "./thread.ts";

/** Nested attributes and nanosecond timestamps: the shape Cloud really sends. */
function row(id, iso, message, { ts, threadTs, actor = "U1", kind }) {
  return {
    timestamp: iso,
    data: {
      attribute: {
        g6: {
          actor: { id: actor, kind: "human" },
          ...(kind ? { log: { kind } } : {}),
        },
        slack: {
          channel: { id: "C1" },
          message: { ts },
          thread: { ts: threadTs },
        },
      },
      body: { message },
      id,
      observed_timestamp: Date.parse(iso) * 1e6,
      resource: { g6: { source: { provider: "slack" } } },
      scope: {},
      severity_number: 9,
      severity_text: "INFO",
      span_id: "",
      timestamp: Date.parse(iso) * 1e6,
      trace_id: "d08ee9f6b4d3dffe50e5fe3f5be5d0c3",
    },
  };
}

const ROWS = [
  row("h1", "2026-05-14T01:42:46Z", "Shipping **the rail** today", {
    ts: "100.1",
    threadTs: "100.1",
  }),
  row("r1", "2026-05-14T01:49:54Z", "reproduced on `main`", {
    actor: "U2",
    ts: "100.2",
    threadTs: "100.1",
  }),
];

/** Every formatting affordance the reader is expected to honour, in one body. */
const RICH = [
  row(
    "h1",
    "2026-05-14T01:42:46Z",
    [
      "Could you add your PR to the agenda for the upcoming",
      "[dev meeting](https://docs.example.com/d/15IEwtTx) (9 AM CT)?",
      "",
      "> Appreciate your effort and contributions",
      "",
      "```sh",
      "make review",
      "```",
    ].join("\n"),
    { ts: "100.1", threadTs: "100.1" },
  ),
];

function renderCloudThread(rows) {
  const { head, replies } = toThread(rows);
  const messages = [head, ...replies].filter((message) => message !== null);

  return renderToStaticMarkup(
    React.createElement(ThreadMessages, { messages }),
  );
}

test("a cloud thread renders without the providers only the workspace has", () => {
  // No router, no react-query, no relay, no AppShell context, no composer.
  const markup = renderCloudThread(ROWS);

  assert.match(markup, /U1/, "the head's author is rendered");
  assert.match(markup, /U2/, "the reply's author is rendered");
});

test("markdown in a body is rendered, not escaped or printed as source", () => {
  // Markdown is the module that once reached the router. If it ever silently
  // stops rendering rather than throwing, this is what notices.
  const markup = renderCloudThread(ROWS);

  assert.match(markup, /<strong[^>]*>the rail<\/strong>/);
  assert.match(markup, /<code[^>]*>main<\/code>/);
  assert.doesNotMatch(markup, /\*\*the rail\*\*/, "no literal asterisks");
});

test("links, blockquotes and fenced code all survive the reader", () => {
  const markup = renderCloudThread(RICH);

  assert.match(
    markup,
    /<a [^>]*href="https:\/\/docs\.example\.com\/d\/15IEwtTx"/,
    "a markdown link becomes an anchor",
  );
  assert.doesNotMatch(markup, /\[dev meeting\]/, "no literal link source");
  assert.match(markup, /<blockquote/, "a `>` line becomes a blockquote");
  assert.match(markup, /make review/, "the fenced block keeps its contents");
  assert.doesNotMatch(markup, /```/, "no literal fences");
});

test("the reader offers no way to write back to Slack", () => {
  // Cloud serves landed records and has no write path. A composer here would be
  // a text box that silently discards.
  const markup = renderCloudThread(ROWS);

  assert.doesNotMatch(markup, /data-testid="message-composer"/);
  assert.doesNotMatch(markup, /<textarea/);
});

test("authors are plain, not a popover the cloud window cannot mount", () => {
  const markup = renderCloudThread(ROWS);

  assert.doesNotMatch(markup, /data-testid="user-profile-popover"/);
  assert.doesNotMatch(markup, /<button/);
});
