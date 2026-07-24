import { Gear6Mark } from "@/shared/ui/g6-logo/Gear6Mark";

/**
 * Decorative backdrop for the onboarding landing screen: the corner mark plus
 * the gear animation drifting behind the content.
 */
export function LandingBees() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <span className="absolute left-6 top-12 block w-11">
        <Gear6Mark className="h-auto w-full" />
      </span>
      {/* ponytail: one centred clip replaces the old 38-bee wander/repel field.
          The artwork is opaque raster, so scattering it would read as a grid of
          white tiles rather than a bee swarm. */}
      <img
        alt=""
        className="absolute left-1/2 top-1/2 w-[60vmin] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-10"
        src="/animation.gif"
      />
    </div>
  );
}
