/**
 * The static Gear6 mark — the app icon's own artwork, inline. No masks, no
 * SMIL, no scripting, so it paints complete on the very first frame, and no
 * network request either.
 *
 * It draws the tile, not just the letters: every call site puts this next to
 * the wordmark as a miniature app icon, so it carries its own cobalt ground.
 * The mesh wash the real icon has is dropped here — at 16–20px it is invisible,
 * and a flat fill keeps this free of gradient ids that would collide if two
 * instances ever mounted.
 *
 * Colours are Design.md's `{colors.surface-cobalt}` and `{colors.canvas-bone}`.
 * Geometry matches `docs/design/gear6-app-icon.html`.
 */
export function Gear6Mark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={["g6-mark", "block", className].filter(Boolean).join(" ")}
      role="presentation"
      viewBox="-84 -84 168 168"
    >
      <rect x="-84" y="-84" width="168" height="168" fill="#2451b8" />
      <g
        fill="none"
        stroke="#f1efe9"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="12"
      >
        <g transform="translate(-25,0)">
          <path d="M 22.52,13 A 26,26 0 1 1 22.52,-13" />
          <path d="M 6,0 L 22.52,0 L 22.52,13" />
        </g>
        <g transform="translate(36,0)">
          <circle cx="0" cy="11" r="15" />
          {/* One arc landing on the bowl's leftmost point, where both tangents
              are vertical — that is what keeps the shoulder join seamless. */}
          <path d="M 7,-26 A 42.11,42.11 0 0 0 -15,11" />
        </g>
      </g>
    </svg>
  );
}
