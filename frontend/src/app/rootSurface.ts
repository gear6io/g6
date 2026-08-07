// The boot-time render boundary between the three app surfaces.
//
// Every root is loaded dynamically and exactly one of them is ever evaluated:
// in cloud or local mode `@/app/App` and `@/app/AppShell` are never imported,
// so their router setup, relay subscriptions, desktop notifications and
// unsupported Tauri commands never run. A static import of any root would
// defeat that, which is why this module holds loaders instead of components.
//
// TEMPORARY — see docs/gear6-render-boundary.md.
import type { ComponentType } from "react";

import type { AppMode } from "@/shared/api/mode";

export async function loadCloudRoot(): Promise<ComponentType> {
  const { CloudRoot } = await import("@/app/CloudRoot");
  return CloudRoot;
}

export async function loadGear6Root(): Promise<ComponentType> {
  const { Gear6Root } = await import("@/app/Gear6Root");
  return Gear6Root;
}

export async function loadLegacyRoot(): Promise<ComponentType> {
  // The legacy providers read community storage during their first render, so
  // the migration has to finish before the root is handed back. It stays on
  // this side of the boundary: gear6 mode does not run it, and therefore never
  // waits on it.
  const [{ LegacyAppRoot }, { migrateLegacyCommunityStorageBeforeRender }] =
    await Promise.all([
      import("@/app/LegacyAppRoot"),
      import("@/features/communities/legacyCommunityStorage"),
    ]);
  await migrateLegacyCommunityStorageBeforeRender();
  return LegacyAppRoot;
}

export function selectRootLoader(mode: AppMode): () => Promise<ComponentType> {
  switch (mode) {
    case "cloud":
      return loadCloudRoot;
    case "local":
      return loadGear6Root;
    case "legacy":
      return loadLegacyRoot;
  }
}
