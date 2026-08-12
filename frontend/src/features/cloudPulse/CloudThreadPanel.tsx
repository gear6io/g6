// What was actually said, beside the event that mentions it.
//
// A Pulse event row is Cloud's one-line reading of a record. This panel is the
// record itself: the Slack thread it sits in, or the GitHub issue or pull
// request it belongs to, fetched from Cloud and rendered by the same
// `MessageThreadPanel` the legacy workspace uses. Reusing that component rather
// than writing a lookalike is the whole point — markdown, reaction pills, media
// attachments and day grouping are already right there and stay in step.
//
// Read-only by construction: no `onSend`, no `onToggleReaction`, no edit or
// delete. Cloud serves landed records and has no write path back to Slack, so
// every affordance that would imply one is simply not passed.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { toThread } from "@/features/cloudPulse/thread";
import { MessageThreadPanel } from "@/features/messages/ui/MessageThreadPanel";
import { MessageThreadPanelSkeleton } from "@/features/messages/ui/MessageThreadPanelSkeleton";
import {
  CloudGatewayError,
  resolveExtraction,
} from "@/shared/api/cloudGateway/client";
import type { RawRow, TimelineEvent } from "@/shared/api/cloudGateway/types";
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

/**
 * One client per mount, and a deliberately inert one.
 *
 * `MessageRow` reaches for react-query through `useReactionHandler`,
 * `useMessageEmoji` and `useKnownAgentPubkeys`. Those hooks read a workspace
 * that does not exist in the cloud window, so their queries fail — and this is
 * the configuration that makes failing the correct outcome rather than a retry
 * storm: one attempt, cached forever, empty result, read-only row. Cheaper than
 * teaching three hooks to be optional.
 */
function inertQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
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
  const { loadMore, paging, retry, state } = useConversation(event);
  // Recreated only when the panel remounts, never per render: a fresh client on
  // every render would discard the caches the rows just filled.
  const [queryClient] = useState(inertQueryClient);

  const thread = useMemo(
    () => (state.status === "ready" ? toThread(state.loaded.rows) : null),
    [state],
  );

  if (state.status === "loading") {
    return (
      <MessageThreadPanelSkeleton
        isFocusMode={false}
        onClose={onClose}
        widthPx={widthPx}
      />
    );
  }

  if (state.status === "error") {
    return (
      <aside
        className="flex shrink-0 flex-col overflow-hidden bg-pulse-surface"
        data-testid="cloud-thread-panel"
        style={{ width: widthPx }}
      >
        <div className="flex h-[54px] items-center justify-between px-4">
          <Header event={event} />
          <button
            aria-label="Close conversation"
            className="rounded p-1 text-pulse-ink-mute hover:bg-pulse-surface-alt"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>
        <Notice
          action="Retry"
          message={`This conversation could not be read. ${state.message}`}
          onAction={retry}
        />
      </aside>
    );
  }

  const { head, replies } = thread ?? { head: null, replies: [] };

  return (
    // Both are plain context providers with no legacy graph behind them. The
    // tooltip one is not optional: Radix throws outright without it, and the
    // action bar and timestamps inside a row both use tooltips.
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div data-testid="cloud-thread-panel">
          {state.loaded.warning ? (
            // Cloud says the answer is partial, not wrong. The records it did
            // return are still shown, with its own words above them.
            <p className="px-4 py-2 text-2xs text-pulse-ink-mute" role="status">
              {state.loaded.warning}
            </p>
          ) : null}
          <MessageThreadPanel
            channel={null}
            channelId={null}
            // Used as the composer placeholder, which is disabled here anyway;
            // the event's own summary is the truest thing to call this.
            channelName={event.summary}
            // Every write path is deliberately absent, so the composer has nothing
            // to submit into and the action bar has nothing to offer.
            disabled
            headerLeading={<Header event={event} />}
            isFocusMode={false}
            isSending={false}
            layout="split"
            onCancelReply={NOOP}
            onClose={onClose}
            onExpandReplies={NOOP}
            onScrollTargetResolved={NOOP}
            onSelectReplyTarget={NOOP}
            onSend={NEVER_SENDS}
            replyTargetMessage={null}
            scrollTargetId={null}
            threadHead={head}
            threadReplies={replies.map((message) => ({
              message,
              summary: null,
            }))}
            threadTypingPubkeys={EMPTY}
            toolbarExtraActions={
              state.loaded.nextCursor ? (
                <button
                  className="rounded-full border border-pulse-brand-ink px-3 py-1 text-2xs font-bold text-pulse-brand-ink hover:bg-pulse-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink"
                  disabled={paging}
                  onClick={loadMore}
                  type="button"
                >
                  {paging ? "Loading…" : "Load earlier records"}
                </button>
              ) : null
            }
            widthPx={widthPx}
          />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/** Module-level so they are stable references and never re-memoize a row. */
const EMPTY: string[] = [];
const NOOP = () => {};
const NEVER_SENDS = () => Promise.resolve();
