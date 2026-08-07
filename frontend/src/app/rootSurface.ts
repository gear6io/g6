// The boot-time render boundary between gear6 and the legacy nostr-era UI.
//
// Both roots are loaded dynamically and exactly one of them is ever evaluated:
// in gear6 mode `@/app/App` and `@/app/AppShell` are never imported, so their
// router setup, relay subscriptions, desktop notifications and unsupported
// Tauri commands never run. A static import of either root would defeat that,
// which is why this module holds loaders instead of components.
//
// TEMPORARY — see docs/gear6-render-boundary.md.
import type { ComponentType } from "react";

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

export function selectRootLoader(
  useHttpApi: boolean,
): () => Promise<ComponentType> {
  return useHttpApi ? loadGear6Root : loadLegacyRoot;
}
