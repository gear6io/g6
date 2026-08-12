import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  MarkdownNavigationContext,
  type MarkdownNavigation,
} from "@/shared/ui/markdown/navigationContext";

/**
 * Gives message bodies somewhere to navigate to.
 *
 * This is the router half of `@/shared/ui/markdown`, kept on the legacy side of
 * the render boundary. `markdown.tsx` used to call `useAppNavigation` itself,
 * which meant the router was in the module graph of everything that renders a
 * message — including the cloud window, where `useLocation` throws outright and
 * took the whole surface down with it.
 *
 * Mount it once, inside the router. Without it markdown falls back to the inert
 * default and channel mentions render as plain text.
 */
export function MarkdownNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { goAgents, goChannel } = useAppNavigation();

  const navigation = React.useMemo<MarkdownNavigation>(
    () => ({
      goAgents: () => {
        void goAgents();
      },
      goChannel: (channelId, options) => {
        void goChannel(channelId, options);
      },
    }),
    [goAgents, goChannel],
  );

  return (
    <MarkdownNavigationContext.Provider value={navigation}>
      {children}
    </MarkdownNavigationContext.Provider>
  );
}
