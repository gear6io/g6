import * as React from "react";

import {
  useManagedAgentsQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import { mergeKnownAgentPubkeys } from "@/features/agents/knownAgentPubkeys";
import { KnownAgentPubkeysContext } from "@/features/agents/knownAgentPubkeysContext";
import { useStableSet } from "@/shared/hooks/useStableReference";

// Re-exported so the many existing importers keep working. New consumers should
// import from `knownAgentPubkeysContext` directly: this module pulls the agent
// queries and the Tauri bridge in behind it.
export { useKnownAgentPubkeys } from "@/features/agents/knownAgentPubkeysContext";

/**
 * Owns the app's only React Query subscription to the known-agent source
 * queries and publishes the merged set over context.
 *
 * The subscription lives here — not in `useKnownAgentPubkeys` — on purpose.
 * Consumers include every mounted `MessageRow`; if each consumer held its own
 * query observers, every batch of row mounts (channel switch, thread panel
 * open, load-older) would find short-staleTime data stale and re-trigger
 * fetches via `refetchOnMount`, including the deliberately relaxed
 * whole-profile-set `listRelayAgents` relay query. And each source-query data
 * churn (managed agents poll at 5s while an agent runs) would re-render every
 * row before `useStableSet` could bail. With the single subscription here,
 * query churn re-renders only this provider — `children` is referentially
 * stable, so nothing cascades — and context consumers re-render only when the
 * published set's identity changes, which `useStableSet` restricts to actual
 * membership change.
 *
 * Mounted once per community inside `AppReady` (under the community-keyed
 * `CommunityQueryProvider` remount boundary), so the observers tear down and
 * re-create on community switch without a `resetCommunityState()` entry.
 */
export function KnownAgentPubkeysProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const managedAgents = useManagedAgentsQuery().data;
  const relayAgents = useRelayAgentsQuery().data;

  const merged = React.useMemo(
    () => mergeKnownAgentPubkeys(managedAgents, relayAgents),
    [managedAgents, relayAgents],
  );
  const stable = useStableSet(merged);

  return (
    <KnownAgentPubkeysContext.Provider value={stable}>
      {children}
    </KnownAgentPubkeysContext.Provider>
  );
}
