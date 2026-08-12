import * as React from "react";

const EMPTY_KNOWN_AGENT_PUBKEYS: ReadonlySet<string> = new Set();

export const KnownAgentPubkeysContext = React.createContext<
  ReadonlySet<string>
>(EMPTY_KNOWN_AGENT_PUBKEYS);

/**
 * The community-scoped "known agent pubkeys" baseline: locally managed agents
 * ∪ relay-registered agents, normalised via `normalizePubkey`. Home-feed agent
 * activity is intentionally excluded: it is a display category, not an
 * authenticated agent-identity source.
 *
 * Every surface that decides whether a pubkey belongs to an agent — the
 * config-nudge trust gate, bot avatars/popovers, agent mention pills — must
 * share this baseline. Surfaces previously derived their own sets from
 * different source subsets, so the same event could pass the trust gate on
 * one screen and fail it on another.
 *
 * Surface-local signals stay additive on top: merge channel-member roles or
 * a profile lookup's `isAgent` flags at the call site (or check
 * `profiles[normalizePubkey(pk)]?.isAgent` per pubkey). They can only widen
 * the baseline, never diverge from it.
 *
 * Reads content-stable context published by `KnownAgentPubkeysProvider` —
 * consumers add no query observers and re-render only when membership
 * actually changes, so the set is safe as a memo/comparator dependency in
 * render-hot consumers. Outside the provider (unit tests, stray surfaces)
 * this degrades gracefully to the empty set; surfaces still fold in their
 * local `isAgent` profile flags.
 *
 * The consumer lives apart from its provider because it has no data layer to
 * carry: reading a context is free, while `KnownAgentPubkeysProvider` imports
 * the agent queries and, through them, the Tauri command bridge. Message rows
 * are rendered by the cloud window, which must not evaluate that graph — see
 * `docs/gear6-render-boundary.md`.
 */
export function useKnownAgentPubkeys(): ReadonlySet<string> {
  return React.useContext(KnownAgentPubkeysContext);
}
