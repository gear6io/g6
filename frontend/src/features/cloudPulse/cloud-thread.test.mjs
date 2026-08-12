// The legacy message renderer, mounted the way the cloud window mounts it.
//
// This is the test that would have caught the blank screen. Rendering
// `MessageThreadPanel` with cloud-shaped props exercises the real row: markdown
// bodies, reaction pills, the action bar, timestamps — every one of which can
// reach for a provider the cloud window does not have. Two did: the router,
// through `markdown.tsx`'s old `useAppNavigation` import, and Radix's tooltip.
// Both threw, and a throw in render is a white window.
import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MessageThreadPanel } from "../messages/ui/MessageThreadPanel.tsx";
import { TooltipProvider } from "../../shared/ui/tooltip.tsx";
import { toThread } from "./thread.ts";

/** Nested attributes and nanosecond timestamps: the shape Cloud really sends. */
function row(id, iso, message, { ts, threadTs, actor = "U1", kind }) {
  return {
    timestamp: iso,
    data: {
      attribute: {
        g6: { actor: { id: actor, kind: "human" }, ...(kind ? { log: { kind } } : {}) },
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

/** Exactly what `CloudThreadPanel` passes: no channel, no writes, no workspace. */
function renderCloudThread(rows) {
  const { head, replies } = toThread(rows);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(MessageThreadPanel, {
          channel: null,
          channelId: null,
          channelName: "",
          disabled: true,
          isFocusMode: false,
          isSending: false,
          layout: "split",
          onCancelReply: () => {},
          onClose: () => {},
          onExpandReplies: () => {},
          onScrollTargetResolved: () => {},
          onSelectReplyTarget: () => {},
          onSend: () => Promise.resolve(),
          replyTargetMessage: null,
          scrollTargetId: null,
          threadHead: head,
          threadReplies: replies.map((message) => ({ message, summary: null })),
          threadTypingPubkeys: [],
          widthPx: 420,
        }),
      ),
    ),
  );
}

test("a cloud thread renders without the providers only the workspace has", () => {
  // No router, no relay, no AppShell context, no composer, no author popover.
  const markup = renderCloudThread(ROWS);

  assert.match(markup, /data-testid="message-thread-head"/);
  assert.match(markup, /U1/, "the head's author is rendered");
});

test("the head's markdown body is rendered, not escaped or dropped", () => {
  // Markdown is the module that reached the router. If it ever silently stops
  // rendering rather than throwing, this is what notices.
  const markup = renderCloudThread(ROWS);

  assert.match(markup, /<p>Shipping <strong[^>]*>the rail<\/strong> today<\/p>/);
});

test("omitting the composer slot leaves no composer to type into", () => {
  // The cloud panel passes no `composerSlot`, because there is no write path
  // back to Slack. A composer here would be a text box that silently discards.
  const markup = renderCloudThread(ROWS);

  assert.doesNotMatch(markup, /data-testid="message-composer"/);
  assert.doesNotMatch(markup, /<textarea/);
});

test("omitting the author slot leaves a plain author, not a broken popover", () => {
  const markup = renderCloudThread(ROWS);

  // The popover renders a button around the avatar and name; without the slot
  // the row falls back to the shape a message with no pubkey already had.
  assert.doesNotMatch(markup, /data-testid="user-profile-popover"/);
});
