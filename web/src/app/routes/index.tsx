import { createFileRoute } from "@tanstack/react-router";

import gear6AppIcon from "@/assets/app-icon@3x.png";

// The `/` homepage. Previously this rendered the Buzz repo browser
// (features/repos/ui/ReposPage), but that feature is dead code in gear6 — the
// backend serves no Nostr kind:30617 events or git smart-HTTP. Until the real
// gear6 chat UI lands, `/` shows this neutral placeholder. To revive repos, see
// web/src/features/repos/README.md.
function HomePage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-[#F3F3F3] px-4 py-16 text-center dark:bg-[#171717]">
      <div className="flex w-full max-w-xl flex-col items-center px-6 py-10 sm:px-12 sm:py-12">
        <div
          className="h-16 w-16 overflow-hidden bg-black"
          style={{ borderRadius: "22.37%" }}
        >
          <img alt="gear6" className="h-full w-full" src={gear6AppIcon} />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-black dark:text-white">
          gear6
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-black/60 dark:text-white/60">
          Your workspace is being set up. Check back soon.
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: HomePage,
});
