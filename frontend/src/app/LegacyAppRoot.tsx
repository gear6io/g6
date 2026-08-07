// The pre-gear6 provider stack, unchanged — lifted out of `main.tsx` so it can
// be loaded lazily behind the render boundary in `@/app/rootSurface`. Nothing
// here is imported in gear6 builds.
import { App } from "@/app/App";
import { CommunitiesProvider } from "@/features/communities/useCommunities";
import { CommunityOnboardingProvider } from "@/features/onboarding/communityOnboarding";
import { NostrBindConsentDialog } from "@/features/profile/ui/NostrBindConsentDialog";
import { UpdaterProvider } from "@/features/settings/hooks/UpdaterProvider";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";
import { EmojiBurstProvider } from "@/shared/ui/EmojiBurstProvider";
import { PoofBurstProvider } from "@/shared/ui/PoofBurstProvider";
import { Toaster } from "@/shared/ui/sonner";
import { TooltipProvider } from "@/shared/ui/tooltip";

export function LegacyAppRoot() {
  return (
    <CommunitiesProvider>
      <CommunityOnboardingProvider>
        <ThemeProvider defaultTheme="g6">
          <TooltipProvider delayDuration={300}>
            <EmojiBurstProvider>
              <PoofBurstProvider>
                <UpdaterProvider>
                  <App />
                  <NostrBindConsentDialog />
                </UpdaterProvider>
                <Toaster />
              </PoofBurstProvider>
            </EmojiBurstProvider>
          </TooltipProvider>
        </ThemeProvider>
      </CommunityOnboardingProvider>
    </CommunitiesProvider>
  );
}
