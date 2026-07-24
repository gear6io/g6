import { useState } from "react";

import { Gear6Mark } from "./Gear6Mark";

/**
 * The animated Gear6 mark, used by the loading gates. A plain `<img>` of the
 * gear animation: GIF playback is driven by the image decoder rather than the
 * main thread, so it keeps running while boot work (bundle eval, first React
 * render) hogs the thread — exactly the window in which a loading gate is on
 * screen.
 *
 * GIF playback cannot be paused from CSS, so reduced motion falls back to the
 * static {@link Gear6Mark} instead of a media query.
 */
export function FlappingBee({ className }: { className?: string }) {
  // ponytail: read once at mount, no matchMedia listener — a mid-session flip
  // of the OS setting won't re-render. Add a listener if that ever matters.
  const [reduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  if (reduced) {
    return <Gear6Mark className={className} />;
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className={["g6-mark", "block object-contain", className]
        .filter(Boolean)
        .join(" ")}
      src="/animation.gif"
    />
  );
}
