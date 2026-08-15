// What was actually said, beside the event that mentions it.
//
// A Pulse event row is Cloud's one-line reading of a record. This panel is the
// record itself: the Slack thread it sits in, or the GitHub issue or pull
// request it belongs to, fetched from Cloud and rendered as the compact reader
// the Cloud mockup specifies. The same body sits inline in the action reader and
// in the event side panel, so those two paths cannot drift apart.
//
// Read-only by construction: Cloud serves landed records and has no write path
// back to Slack, so no affordance implies one.
import { ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { toThread } from "@/features/cloudPulse/thread";
import type { TimelineMessage } from "@/features/messages/types";
import {
  CloudGatewayError,
  resolveExtraction,
} from "@/shared/api/cloudGateway/client";
import type { RawRow, TimelineEvent } from "@/shared/api/cloudGateway/types";
import { Markdown } from "@/shared/ui/markdown";
import { ProviderIcon, hasProviderIcon } from "@/shared/ui/ProviderIcon";
import { TooltipProvider } from "@/shared/ui/tooltip";

/** Cloud accepts 1..100 and pages the rest; a thread longer than this is rare. */
const PAGE_SIZE = 50;

type Provider = "github" | "slack";

/**
 * The two `POST /v1/extractions/resolve` will not answer for. Checked as a
 * denylist rather than an allowlist of `slack | github` because Cloud commonly
 * returns `provider: ""` on a timeline event even when the record resolves
 * perfectly well — every event in the current dataset does. An allowlist reads
 * safer and silently refuses every row.
 */
const UNRESOLVABLE = new Set(["jira", "notion"]);

/**
 * Whether this event's conversation can be shown in place.
 *
 * The thread id is what actually decides it. The provider is only consulted to
 * rule out the two sources with no resolver at all; an empty provider is not
 * one of those, it is an unstated one.
 */
export function canOpenThread(event: TimelineEvent): boolean {
  return Boolean(event.thread_id) && !UNRESOLVABLE.has(event.provider);
}

/**
 * Which provider to ask first.
 *
 * `resolve` demands one explicitly and will not infer it — a Slack request must
 * not return a GitHub record merely because the ids collided — but the timeline
 * event often does not carry one, so it has to be guessed and then corrected.
 * The event's own link is the only hint available; absent that, Slack is the
 * common case.
 */
function providerOrder(event: TimelineEvent): readonly Provider[] {
  if (event.provider === "github" || event.provider === "slack") {
    return [event.provider];
  }
  return event.url?.includes("github.com")
    ? ["github", "slack"]
    : ["slack", "github"];
}

/**
 * The conversation, and which provider actually held it — the cursor is bound
 * to that provider, so paging has to ask the same one.
 *
 * A wrong guess costs one extra request and nothing else: Cloud answers
 * `404 signal_not_found` for an id that is not that provider's, which is
 * exactly the "try the other one" signal. Any other failure is real and is
 * raised rather than retried.
 */
async function resolveThread(
  event: TimelineEvent,
  cursor?: string,
  only?: Provider,
): Promise<{ loaded: Loaded }> {
  const order = only ? [only] : providerOrder(event);
  let lastError: unknown;

  for (const provider of order) {
    try {
      const response = await resolveExtraction({
        cursor,
        depth: "context",
        limit: PAGE_SIZE,
        provider,
        reference: { id: event.thread_id as string, type: "trace" },
      });
      const [result] = response.data.results;
      return {
        loaded: {
          nextCursor: result.nextCursor,
          provider,
          rows: result.rows,
          warning: response.warning?.message ?? null,
        },
      };
    } catch (err) {
      if (
        err instanceof CloudGatewayError &&
        err.code === "signal_not_found" &&
        order.length > 1
      ) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

type Loaded = {
  rows: RawRow[];
  /** Empty when the conversation is complete. */
  nextCursor: string;
  /** Whichever provider answered. The cursor is bound to it. */
  provider: Provider;
  /** Cloud's own note when the answer is degraded but still useful. */
  warning: string | null;
};

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; loaded: Loaded };

function useConversation(event: TimelineEvent) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [paging, setPaging] = useState(false);

  useEffect(() => {
    if (!canOpenThread(event)) {
      return;
    }
    let live = true;
    setState({ status: "loading" });

    resolveThread(event)
      .then(({ loaded }) => {
        if (live) {
          setState({ loaded, status: "ready" });
        }
      })
      .catch((err: unknown) => {
        if (live) {
          setState({
            message: err instanceof Error ? err.message : String(err),
            status: "error",
          });
        }
      });

    return () => {
      live = false;
    };
  }, [attempt, event]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  /**
   * The next page, appended. A button rather than an infinite scroller: the
   * panel is a reference, not a feed, and a scroll-triggered fetch inside a
   * virtualized list fights the list's own anchoring.
   */
  const loadMore = useCallback(() => {
    if (state.status !== "ready" || !state.loaded.nextCursor) {
      return;
    }
    const { nextCursor, provider } = state.loaded;
    setPaging(true);
    resolveThread(event, nextCursor, provider)
      .then(({ loaded }) => {
        setState((current) =>
          current.status === "ready"
            ? {
                loaded: {
                  ...loaded,
                  rows: [...current.loaded.rows, ...loaded.rows],
                },
                status: "ready",
              }
            : current,
        );
      })
      .catch(() => {
        // The records already on screen are still true. A failed page is not a
        // reason to throw away the ones that arrived.
      })
      .finally(() => setPaging(false));
  }, [event, state]);

  return { loadMore, paging, retry, state };
}

function Header({ event }: { event: TimelineEvent }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {/* Cloud leaves `provider` empty on most timeline events, so the mark is
          omitted rather than reserving a blank 16px box for it. */}
      {hasProviderIcon(event.provider) ? (
        <span
          aria-label={event.provider}
          className="flex size-4 shrink-0 items-center justify-center text-pulse-ink-mute"
          title={event.provider}
        >
          <ProviderIcon className="size-4" provider={event.provider} />
        </span>
      ) : null}
      <span className="truncate text-sm font-semibold">
        {event.summary || "Conversation"}
      </span>
      {/* The way out to the source, kept even though the records are rendered
          here: this panel shows what landed, and the source is where you go to
          act on it. */}
      {event.url ? (
        <a
          className="shrink-0 rounded p-1 text-pulse-link hover:bg-pulse-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink"
          href={event.url}
          rel="noreferrer noopener"
          target="_blank"
        >
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">
            {event.provider ? `Open in ${event.provider}` : "Open the source"}
          </span>
        </a>
      ) : null}
    </span>
  );
}

function Notice({
  action,
  message,
  onAction,
}: {
  action?: string;
  message: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2 p-6">
      <p className="text-xs text-pulse-ink-mute">{message}</p>
      {action && onAction ? (
        <button
          className="rounded-full border border-pulse-brand-ink px-3 py-1.5 text-2xs font-bold text-pulse-brand-ink hover:bg-pulse-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink"
          onClick={onAction}
          type="button"
        >
          {action}
        </button>
      ) : null}
    </div>
  );
}

export function CloudThreadPanel({
  event,
  onClose,
  widthPx,
}: {
  event: TimelineEvent;
  onClose: () => void;
  widthPx: number;
}) {
  return (
    <aside
      className="flex shrink-0 flex-col overflow-hidden bg-pulse-canvas"
      data-testid="cloud-thread-panel"
      style={{ width: widthPx }}
    >
      <header className="flex min-h-[52px] shrink-0 items-center gap-3 border-b border-pulse-hairline px-4">
        <Header event={event} />
        <button
          aria-label="Close conversation"
          className="ml-auto shrink-0 rounded-md p-1.5 text-pulse-ink-mute transition-colors hover:bg-pulse-surface-alt hover:text-pulse-ink focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
        <CloudThreadConversation event={event} />
      </div>
      <p className="shrink-0 border-t border-pulse-hairline px-[18px] py-2 text-xs text-pulse-ink-mute">
        Read-only — open the source to reply or resolve.
      </p>
    </aside>
  );
}

function initials(author: string): string {
  const words = author.trim().split(/\s+/).filter(Boolean);
  return (
    words.length > 1
      ? `${words[0][0]}${words.at(-1)?.[0]}`
      : words[0]?.slice(0, 2) || "?"
  ).toUpperCase();
}

function ConversationSkeleton() {
  return (
    <div aria-label="Loading conversation" className="space-y-4" role="status">
      {["w-4/5", "w-2/3", "w-3/4"].map((width) => (
        <div className="grid grid-cols-[26px_1fr] gap-2.5" key={width}>
          <span className="size-[26px] rounded-md bg-pulse-surface-alt animate-pulse motion-reduce:animate-none" />
          <span
            className={`h-10 rounded-md bg-pulse-surface-alt animate-pulse motion-reduce:animate-none ${width}`}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The records themselves.
 *
 * Split out from `CloudThreadConversation` because that one fetches, and an
 * effect never runs under `renderToStaticMarkup` — the fold is testable, and so
 * is this, but the two joined together are not.
 *
 * Bodies go through `Markdown` unconditionally, the same way `MessageRow` treats
 * every workspace message. Cloud hands us Slack's `text` verbatim (its mapper
 * copies the field and stops), so what arrives is whatever the author typed:
 * usually real markdown, sometimes plain prose that markdown leaves alone.
 * Sniffing for markers first would only add a heuristic that can be wrong.
 *
 * The `TooltipProvider` is load-bearing, not decoration. A masked link — the
 * `[dev meeting](https://…)` shape that GitHub and Slack notifications are made
 * of — renders `MaskedLinkTooltip`, which reveals the real destination on hover
 * so a reader can see where "click here" goes before clicking. Radix throws
 * outright without a provider above it, and a throw in render is a white
 * window; the cloud shell mounts no provider of its own, so this one carries
 * its own. Disabling the tooltip instead would be the wrong trade: these links
 * are third-party content, which is precisely when the destination should stay
 * auditable.
 */
export function ThreadMessages({ messages }: { messages: TimelineMessage[] }) {
  return (
    <TooltipProvider>
      <ol>
        {messages.map((message, index) => (
          <li
            className={`grid grid-cols-[26px_1fr] gap-2.5 py-2 ${index === 0 ? "-mx-2 rounded-lg bg-pulse-surface-alt px-2" : ""}`}
            key={message.id}
          >
            <span
              aria-hidden="true"
              className={`grid size-[26px] place-items-center rounded-md text-badge font-bold text-pulse-brand-fg ${index % 2 === 0 ? "bg-pulse-brand" : "bg-pulse-tint"}`}
            >
              {initials(message.author)}
            </span>
            <div className="min-w-0">
              <p className="flex items-baseline gap-2">
                <b className="truncate text-xs font-bold text-pulse-ink">
                  {message.author}
                </b>
                <time className="shrink-0 text-badge tabular-nums text-pulse-ink-mute">
                  {message.time}
                </time>
              </p>
              {/* No `whitespace-pre-wrap`: `remarkBreaks` already turns single
                newlines into breaks, and both together double the spacing.
                No `configNudgeAuthorPubkey` either — these bodies are
                third-party content, which is exactly what that prop must not
                be trusted with. */}
              <Markdown
                className="mt-0.5 max-w-full text-xs leading-relaxed text-pulse-ink"
                content={message.body}
              />
            </div>
          </li>
        ))}
      </ol>
    </TooltipProvider>
  );
}

/** The Cloud-native, read-only thread body used by both event and action readers. */
export function CloudThreadConversation({ event }: { event: TimelineEvent }) {
  const { loadMore, paging, retry, state } = useConversation(event);
  const thread = useMemo(
    () => (state.status === "ready" ? toThread(state.loaded.rows) : null),
    [state],
  );

  if (state.status === "loading") {
    return <ConversationSkeleton />;
  }
  if (state.status === "error") {
    return (
      <Notice
        action="Retry"
        message={`This conversation could not be read. ${state.message}`}
        onAction={retry}
      />
    );
  }

  const messages = thread
    ? [thread.head, ...thread.replies].filter((message) => message !== null)
    : [];
  const sourceDate = messages[0]?.createdAt
    ? new Date(messages[0].createdAt * 1000)
    : new Date(event.occurred_at);
  const date = Number.isNaN(sourceDate.getTime())
    ? ""
    : sourceDate.toLocaleDateString([], { day: "numeric", month: "short" });

  return (
    <section
      aria-label="Source conversation"
      data-testid="cloud-thread-conversation"
    >
      <div className="mb-1.5 flex items-center gap-2 text-pulse-eyebrow font-bold uppercase tracking-wider text-pulse-ink-mute">
        <span>Source conversation</span>
        <span aria-hidden="true" className="h-px flex-1 bg-pulse-hairline" />
        {date || event.provider ? (
          <span className="font-normal normal-case tracking-normal">
            {[date, event.provider].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </div>

      {state.loaded.warning ? (
        <p className="mb-2 text-xs text-pulse-ink-mute" role="status">
          {state.loaded.warning}
        </p>
      ) : null}
      {messages.length === 0 ? (
        <p className="py-3 text-xs text-pulse-ink-mute">
          No readable messages were returned for this conversation.
        </p>
      ) : (
        <ThreadMessages messages={messages} />
      )}

      {state.loaded.nextCursor ? (
        <button
          className="mt-2 rounded-full border border-pulse-brand-ink px-3 py-1 text-2xs font-bold text-pulse-brand-ink hover:bg-pulse-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink"
          disabled={paging}
          onClick={loadMore}
          type="button"
        >
          {paging ? "Loading…" : "Load earlier records"}
        </button>
      ) : null}
    </section>
  );
}
