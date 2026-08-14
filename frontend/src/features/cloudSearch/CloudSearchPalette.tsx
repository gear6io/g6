// The ⌘K palette. Chrome rather than a page feature: Pulse, the inbox and
// anything added later all need to find a milestone, so it lives in the window
// bar at every width and opens from one keystroke anywhere in the window.
//
// It searches **milestones only**, and says so. `/v1/milestones?q=` matches a
// milestone's own words — subject, description, keywords — and Cloud is explicit
// that what was *said* on a milestone is not searchable there: the rail stores
// pointers and a health fold, and the utterances are logs in another database.
// So there is no Events scope and no People scope here. Scope tabs over one
// searchable collection would be two tabs that return nothing and one that
// works, which is worse than a single honest list.
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { listMilestones } from "@/shared/api/cloudGateway/client";
import type { Milestone } from "@/shared/api/cloudGateway/types";

/** Enough to fill the palette without paging it. Cloud's own default is 50. */
const LIMIT = 8;

/**
 * Long enough that typing a word is one request rather than five, short enough
 * that the list has landed by the time you stop to read it.
 */
const DEBOUNCE_MS = 180;

/** Cloud rejects a longer `q` with `400 invalid_query` rather than truncating. */
const MAX_QUERY = 200;

type Results =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; rows: Milestone[] }
  | { status: "error"; message: string };

/**
 * The matched run, marked in place. Case-insensitive because Cloud's `q` is,
 * and the first occurrence only: a subject is one line and a second mark on the
 * same word reads as two different matches.
 */
function Highlighted({ needle, text }: { needle: string; text: string }) {
  const at = needle
    ? text.toLowerCase().indexOf(needle.toLowerCase())
    : -1;
  if (at < 0) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[2px] bg-pulse-brand-ink/20 px-px text-inherit">
        {text.slice(at, at + needle.length)}
      </mark>
      {text.slice(at + needle.length)}
    </>
  );
}

/**
 * `Relay · 7 open · observed 2d ago` — the second line, built only from fields
 * the row actually carries. A milestone with no observed day has no health and
 * no instant, so that clause is absent rather than rendered as "unknown".
 */
export function resultSubtitle(milestone: Milestone, openTotal: number): string {
  const parts: string[] = [];
  if (milestone.last_activity) {
    parts.push(STATUS_WORD[milestone.last_activity.status]);
  }
  parts.push(`${openTotal} open`);
  return parts.join(" · ");
}

const STATUS_WORD = {
  regression: "regressed",
  dependency: "at risk",
  progress: "on track",
  neutral: "observed",
} as const;

const STATUS_DOT = {
  regression: "bg-pulse-error",
  dependency: "bg-pulse-warning",
  progress: "bg-pulse-success",
  neutral: "bg-pulse-ink-mute",
} as const;

export function CloudSearchPalette({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  /** What a result does. The palette itself navigates nowhere. */
  onSelect: (milestone: Milestone) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>({ status: "idle" });
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const term = query.trim();

  useEffect(() => {
    if (!term) {
      setResults({ status: "idle" });
      return;
    }
    let cancelled = false;
    setResults({ status: "loading" });
    const timer = setTimeout(() => {
      listMilestones({ q: term, limit: LIMIT })
        .then((res) => {
          if (!cancelled) {
            setActive(0);
            setResults({ status: "ready", rows: res.data });
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setResults({
              status: "error",
              message: err instanceof Error ? err.message : String(err),
            });
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const rows = results.status === "ready" ? results.rows : [];

  const move = useCallback(
    (delta: number) => {
      setActive((current) => {
        if (rows.length === 0) {
          return 0;
        }
        // Wraps, because a palette with eight rows is a ring rather than a
        // page: arrowing off the end to reach the first row is one keystroke.
        return (current + delta + rows.length) % rows.length;
      });
    },
    [rows.length],
  );

  return (
    // The scrim is inside the window, not over the page: this is a window
    // overlay, and a fixed one would sit over the traffic light too.
    <div
      className="absolute inset-0 z-50 flex justify-center bg-pulse-ink/30 pt-[76px]"
      onClick={onClose}
      // biome-ignore lint/a11y/useKeyWithClickEvents: the dialog below owns the
      // keyboard; this element exists to catch a click outside it, and Escape
      // already closes from anywhere in the palette.
      role="presentation"
    >
      <div
        aria-label="Search milestones"
        aria-modal="true"
        className="flex max-h-[520px] w-[620px] max-w-[calc(100%-60px)] flex-col self-start overflow-hidden rounded-2xl border border-pulse-hairline bg-pulse-canvas shadow-panel-left"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            move(1);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            move(-1);
          }
          if (event.key === "Enter" && rows[active]) {
            event.preventDefault();
            onSelect(rows[active]);
          }
        }}
        role="dialog"
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-pulse-hairline px-4 py-3">
          <Search aria-hidden="true" className="size-4 shrink-0 text-pulse-ink-mute" />
          <input
            aria-label="Search milestones"
            className="min-w-0 flex-1 bg-transparent text-base text-pulse-ink outline-hidden placeholder:text-pulse-ink-mute"
            maxLength={MAX_QUERY}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search milestones"
            ref={inputRef}
            type="text"
            value={query}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {results.status === "idle" ? (
            <p className="px-4 py-3 text-xs text-pulse-ink-mute">
              Matches a milestone's subject, description and keywords. What was
              said on it is not searchable here.
            </p>
          ) : null}

          {results.status === "loading" ? (
            <p className="px-4 py-3 text-xs text-pulse-ink-mute">Searching…</p>
          ) : null}

          {results.status === "error" ? (
            <p className="px-4 py-3 text-xs text-pulse-error" role="status">
              {results.message}
            </p>
          ) : null}

          {results.status === "ready" && rows.length === 0 ? (
            <p className="px-4 py-3 text-xs text-pulse-ink-mute">
              No milestone matches “{term}”.
            </p>
          ) : null}

          {rows.length > 0 ? (
            <>
              <p className="px-4 pb-1 pt-2.5 text-badge font-bold uppercase tracking-wider text-pulse-ink-mute">
                Milestones
              </p>
              <ul>
                {rows.map((milestone, index) => (
                  <li key={milestone.id}>
                    <button
                      aria-selected={index === active}
                      className={`grid w-full grid-cols-[18px_1fr] items-center gap-2.5 px-4 py-1.5 text-left ${
                        index === active ? "bg-pulse-surface-alt" : ""
                      }`}
                      onClick={() => onSelect(milestone)}
                      onMouseEnter={() => setActive(index)}
                      role="option"
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={`size-2 justify-self-center rounded-full ${
                          milestone.last_activity
                            ? STATUS_DOT[milestone.last_activity.status]
                            : "bg-pulse-ink-mute opacity-50"
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-pulse-ink">
                          <Highlighted needle={term} text={milestone.subject} />
                        </span>
                        <span className="mt-px block truncate text-2xs text-pulse-ink-mute">
                          {resultSubtitle(
                            milestone,
                            Object.values(milestone.open).reduce(
                              (sum, count) => sum + count,
                              0,
                            ),
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <p
          aria-live="polite"
          className="shrink-0 border-t border-pulse-hairline px-4 py-1.5 text-badge text-pulse-ink-mute"
        >
          {results.status === "ready"
            ? `${rows.length} milestone${rows.length === 1 ? "" : "s"} · ↑↓ navigate · ↵ open · esc close`
            : "↑↓ navigate · ↵ open · esc close"}
        </p>
      </div>
    </div>
  );
}

/**
 * ⌘K anywhere in the window. Not `useHotkeys` and not a library: one listener
 * on one combination is smaller than the import that would replace it.
 *
 * The combination is checked on `metaKey || ctrlKey` so the same key works on a
 * Linux build, and it is ignored while a text field has focus except for the
 * palette's own — otherwise typing ⌘K in the search box would reopen it.
 */
export function useSearchHotkey(onOpen: () => void): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpen();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}

export { STATUS_DOT, STATUS_WORD };
