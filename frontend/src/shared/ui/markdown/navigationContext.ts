import * as React from "react";

/**
 * The two destinations a message body can send the reader to: a channel (a
 * `#channel` mention or a message permalink) and the agents screen (importing a
 * snapshot from a link).
 *
 * Injected rather than imported, for the same reason `MessageRow` takes its
 * author popover as a prop: the real implementation is `useAppNavigation`,
 * which is the TanStack router, and `useLocation` *throws* outside a
 * `RouterProvider` — it cannot be made safe by adding a provider, because
 * `RouterProvider` renders a route tree rather than children. Importing it here
 * put the router in the module graph of every surface that renders a message,
 * and the cloud window renders messages with no router at all.
 *
 * The default is inert, which is the honest behavior where there is nowhere to
 * go: a channel mention renders as text and does not pretend to be a link.
 * `MarkdownNavigationProvider` supplies the real one inside the legacy shell.
 *
 * Signatures mirror `useAppNavigation`'s, minus its return value — markdown
 * only ever fires these and ignores the promise.
 */
export type MarkdownNavigation = {
  goChannel: (
    channelId: string,
    options?: {
      agentSession?: string;
      autoSend?: string;
      messageId?: string;
      replace?: boolean;
      threadRootId?: string | null;
    },
  ) => void;
  goAgents: () => void;
};

const INERT_MARKDOWN_NAVIGATION: MarkdownNavigation = {
  goAgents: () => {},
  goChannel: () => {},
};

export const MarkdownNavigationContext =
  React.createContext<MarkdownNavigation>(INERT_MARKDOWN_NAVIGATION);

export function useMarkdownNavigation(): MarkdownNavigation {
  return React.useContext(MarkdownNavigationContext);
}
