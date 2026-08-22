// The ⌘K palette. Chrome rather than a page feature: Pulse, the inbox and
// anything added later all need to find a milestone, so it lives in the window
// bar at every width and opens from one keystroke anywhere in the window.
//
// One request, not three. `/v1/search` reads milestones, rail events and people
// together because the scope tabs show counts, and three round trips would draw
// three counts from three instants. Under `scope: "all"` the array lengths *are*
// the tab counts — there is no separate count field for them to disagree with,
// so the tabs are computed from the rows they filter to.
//
// Searching "read state" should find the day the gateway rejected 44200, not
// only the milestone whose title contains those words. That is what the events
// scope is for, and it is the expensive one: the source text carries no index,
// so Cloud bounds the scan. These are the best hits, not every hit, and the
// footer says so rather than implying exhaustiveness.
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { search } from "@/shared/api/cloudGateway/client";
import type {
  Milestone,
  MilestoneStatus,
  Person,
  SearchEvent,
  SearchResponse,
  SearchScope,
} from "@/shared/api/cloudGateway/types";

/** Per collection, not across them: a scope matching nothing costs the others nothing. */
const LIMIT = 6;

/**
 * Long enough that typing a word is one request rather than five, short enough
 * that the list has landed by the time you stop to read it. The events scan is
 * the expensive one, which is the reason this is not shorter.
 */
const DEBOUNCE_MS = 200;

/** Cloud rejects a longer `q` with `400 invalid_query` rather than truncating. */
const MAX_QUERY = 200;

/** What Enter does, decided by the caller. The palette navigates nowhere itself. */
export type SearchHit =
  | { kind: "milestone"; milestone: Milestone }
  | { kind: "event"; event: SearchEvent };

type Results =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; value: SearchResponse }
  | { status: "error"; message: string };

const STATUS_WORD: Record<MilestoneStatus, string> = {
  regression: "regressed",
  dependency: "at risk",
  progress: "on track",
  neutral: "observed",
};

const STATUS_DOT: Record<MilestoneStatus, string> = {
  regression: "bg-pulse-error",
  dependency: "bg-pulse-warning",
  progress: "bg-pulse-success",
  neutral: "bg-pulse-ink-mute",
};

const SCOPES: readonly { id: SearchScope; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "milestones", label: "Milestones" },
  { id: "events", label: "Events" },
  { id: "people", label: "People" },
];

/**
 * The matched run, marked in place. Case-insensitive because Cloud's `q` is,
 * and the first occurrence only: a row is one line, and a second mark on the
 * same word reads as two different matches.
 */
function Highlighted({ needle, text }: { needle: string; text: string }) {
  const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
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
 * `regressed · 7 open` — built only from fields the row carries. A milestone
 * with no observed day has no health and no instant, so that clause is absent
 * rather than rendered as "unknown".
 */
export function resultSubtitle(
  milestone: Milestone,
  openTotal: number,
): string {
  const parts: string[] = [];
  if (milestone.last_activity) {
    parts.push(STATUS_WORD[milestone.last_activity.status]);
  }
  parts.push(`${openTotal} open`);
  return parts.join(" · ");
}

/** `named on 3 milestones · 4 open` — a person's standing, which is all Cloud serves. */
export function personStanding(person: Person): string {
  const named = `named on ${person.milestones} milestone${person.milestones === 1 ? "" : "s"}`;
  return `${named} · ${person.open_actions} open`;
}

function openTotal(milestone: Milestone): number {
  return Object.values(milestone.open).reduce((sum, count) => sum + count, 0);
}

/** The scoped rows, in the order they are drawn and arrowed through. */
function hitsFor(value: SearchResponse, scope: SearchScope): SearchHit[] {
  const hits: SearchHit[] = [];
  if (scope === "all" || scope === "milestones") {
    for (const milestone of value.milestones) {
      hits.push({ kind: "milestone", milestone });
    }
  }
  if (scope === "all" || scope === "events") {
    for (const event of value.events) {
      hits.push({ kind: "event", event });
    }
  }
  return hits;
}

function ResultRow({
  children,
  glyph,
  onSelect,
  selected,
  subtitle,
}: {
  children: React.ReactNode;
  glyph: React.ReactNode;
  onSelect: () => void;
  selected: boolean;
  subtitle: string;
}) {
  return (
    <li>
      <button
        aria-selected={selected}
        className={`grid w-full grid-cols-[18px_1fr] items-center gap-2.5 px-4 py-1.5 text-left ${
          selected ? "bg-pulse-surface-alt" : ""
        }`}
        onClick={onSelect}
        role="option"
        type="button"
      >
        <span className="justify-self-center">{glyph}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm text-pulse-ink">
            {children}
          </span>
          <span className="mt-px block truncate text-xs text-pulse-ink-mute">
            {subtitle}
          </span>
        </span>
      </button>
    </li>
  );
}

function Group({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <>
      <p className="px-4 pb-1 pt-2.5 text-xs font-bold uppercase tracking-wider text-pulse-ink-mute">
        {label}
      </p>
      <ul>{children}</ul>
    </>
  );
}

export function CloudSearchPalette({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (hit: SearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [results, setResults] = useState<Results>({ status: "idle" });
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const term = query.trim();

  useEffect(() => {
    if (!term) {
      // Cloud rejects an empty `q` with `400 missing_query` rather than reading
      // every collection whole, so the empty state is never a request.
      setResults({ status: "idle" });
      return;
    }
    let cancelled = false;
    setResults({ status: "loading" });
    const timer = setTimeout(() => {
      search({ q: term, limit: LIMIT })
        .then((value) => {
          if (!cancelled) {
            setActive(0);
            setResults({ status: "ready", value });
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

  const value = results.status === "ready" ? results.value : null;
  const hits = value ? hitsFor(value, scope) : [];
  const people =
    value && (scope === "all" || scope === "people") ? value.people : [];

  const move = useCallback(
    (delta: number) => {
      setActive((current) =>
        // Wraps: eight rows is a ring rather than a page, and arrowing off the
        // end to reach the first row should be one keystroke.
        hits.length === 0 ? 0 : (current + delta + hits.length) % hits.length,
      );
    },
    [hits.length],
  );

  const cycleScope = useCallback((back: boolean) => {
    setScope((current) => {
      const at = SCOPES.findIndex((entry) => entry.id === current);
      const next = (at + (back ? -1 : 1) + SCOPES.length) % SCOPES.length;
      return SCOPES[next].id;
    });
    setActive(0);
  }, []);

  // Tab counts are the array lengths, per the response's own contract.
  const counted = (id: SearchScope): number | null => {
    if (!value) {
      return null;
    }
    if (id === "all") {
      return (
        value.milestones.length + value.events.length + value.people.length
      );
    }
    return value[id].length;
  };

  return (
    // The scrim is inside the window, not over the page: this is a window
    // overlay, and a fixed one would sit over the traffic light too.
    <div
      className="absolute inset-0 z-50 flex justify-center bg-pulse-ink/30 pt-[76px] backdrop-blur-[2px]"
      onClick={onClose}
      // biome-ignore lint/a11y/useKeyWithClickEvents: the dialog below owns the
      // keyboard; this element only catches a click outside it, and Escape
      // already closes from anywhere in the palette.
      role="presentation"
    >
      <div
        aria-label="Search Cloud"
        aria-modal="true"
        className="g6-pulse-elevated flex max-h-[520px] w-[620px] max-w-[calc(100%-60px)] flex-col self-start overflow-hidden rounded-2xl border border-pulse-hairline bg-pulse-canvas"
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
          if (event.key === "Tab") {
            event.preventDefault();
            cycleScope(event.shiftKey);
          }
          if (event.key === "Enter" && hits[active]) {
            event.preventDefault();
            onSelect(hits[active]);
          }
        }}
        role="dialog"
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-pulse-hairline px-4 py-3">
          <Search
            aria-hidden="true"
            className="size-4 shrink-0 text-pulse-ink-mute"
          />
          <input
            aria-label="Search milestones, events and people"
            autoCapitalize="none"
            autoCorrect="off"
            className="min-w-0 flex-1 bg-transparent text-base text-pulse-ink outline-hidden placeholder:text-pulse-ink-mute"
            maxLength={MAX_QUERY}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search milestones, events, people"
            ref={inputRef}
            spellCheck={false}
            type="text"
            value={query}
          />
        </div>

        <div className="flex shrink-0 gap-1.5 border-b border-pulse-hairline px-3 py-2">
          {SCOPES.map(({ id, label }) => {
            const count = counted(id);
            return (
              <button
                aria-pressed={scope === id}
                className={`rounded-full border px-3 py-0.5 text-xs font-bold transition-[background-color,border-color,color,transform] active:scale-[0.98] ${
                  scope === id
                    ? "border-pulse-brand bg-pulse-brand text-pulse-brand-fg"
                    : "border-pulse-hairline text-pulse-ink-mute hover:border-pulse-brand-ink hover:text-pulse-ink"
                }`}
                key={id}
                onClick={() => {
                  setScope(id);
                  setActive(0);
                }}
                type="button"
              >
                {label}
                {count === null ? "" : ` ${count}`}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {results.status === "idle" ? (
            <p className="px-4 py-3 text-xs text-pulse-ink-mute">
              Milestones match their subject, description and keywords. Events
              match what was said on the source record.
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

          {value && hits.length === 0 && people.length === 0 ? (
            <p className="px-4 py-3 text-xs text-pulse-ink-mute">
              Nothing matches “{term}” in this scope.
            </p>
          ) : null}

          {value &&
          (scope === "all" || scope === "milestones") &&
          value.milestones.length > 0 ? (
            <Group label="Milestones">
              {value.milestones.map((milestone, index) => (
                <ResultRow
                  glyph={
                    <span
                      aria-hidden="true"
                      className={`block size-2 rounded-full ${
                        milestone.last_activity
                          ? STATUS_DOT[milestone.last_activity.status]
                          : "bg-pulse-ink-mute opacity-50"
                      }`}
                    />
                  }
                  key={milestone.id}
                  onSelect={() => onSelect({ kind: "milestone", milestone })}
                  selected={
                    hits[active]?.kind === "milestone" && index === active
                  }
                  subtitle={resultSubtitle(milestone, openTotal(milestone))}
                >
                  <Highlighted needle={term} text={milestone.subject} />
                </ResultRow>
              ))}
            </Group>
          ) : null}

          {value &&
          (scope === "all" || scope === "events") &&
          value.events.length > 0 ? (
            <Group label="Events">
              {value.events.map((event) => (
                <ResultRow
                  glyph={
                    <span
                      aria-hidden="true"
                      className="block size-1.5 rounded-full bg-pulse-ink-mute"
                    />
                  }
                  key={event.id}
                  onSelect={() => onSelect({ kind: "event", event })}
                  selected={
                    hits[active]?.kind === "event" &&
                    (hits[active] as { event: SearchEvent }).event.id ===
                      event.id
                  }
                  // The milestone's title is deliberately not on this row —
                  // Cloud serves the id rather than a denormalized copy that
                  // could disagree with the one above. Provider and instant are
                  // what the record itself carries.
                  subtitle={[event.provider, event.occurred_at.slice(0, 10)]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  <Highlighted needle={term} text={event.summary} />
                </ResultRow>
              ))}
            </Group>
          ) : null}

          {/* People are shown, not opened. Cloud serves a person's standing and
              a prefix of their milestone ids, but no route lists a person's
              milestones — so a row here answers "who is on this and how much do
              they owe" and stops there rather than being a button that goes
              somewhere approximate. */}
          {people.length > 0 ? (
            <>
              <p className="px-4 pb-1 pt-2.5 text-xs font-bold uppercase tracking-wider text-pulse-ink-mute">
                People
              </p>
              <ul>
                {people.map((person) => (
                  <li
                    className="grid grid-cols-[18px_1fr] items-center gap-2.5 px-4 py-1.5"
                    key={person.provider_id}
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-[18px] place-items-center rounded-[3px] bg-pulse-brand text-3xs font-bold text-pulse-brand-fg"
                    >
                      {(person.display_name || person.handle)
                        .slice(0, 1)
                        .toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-pulse-ink">
                        <Highlighted
                          needle={term}
                          text={person.display_name || person.handle}
                        />
                      </span>
                      <span className="mt-px block truncate text-xs text-pulse-ink-mute">
                        {personStanding(person)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <p
          aria-live="polite"
          className="shrink-0 border-t border-pulse-hairline bg-pulse-surface/30 px-4 py-1.5 text-xs text-pulse-ink-mute"
        >
          {value
            ? `${hits.length} openable · ↑↓ navigate · ↵ open · ⇥ scope · esc close`
            : "↑↓ navigate · ↵ open · ⇥ scope · esc close"}
          {value && value.events.length > 0
            ? " · event matches are the best hits, not every hit"
            : ""}
        </p>
      </div>
    </div>
  );
}

/**
 * ⌘K anywhere in the window. Not a hotkey library: one listener on one
 * combination is smaller than the import that would replace it.
 *
 * `metaKey || ctrlKey` so the same key works on a Linux build.
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
