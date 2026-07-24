/**
 * The static Gear6 mark — the rust-gear artwork as a plain `<img>`. No masks,
 * no SMIL, no scripting, so it paints complete on the very first frame.
 *
 * Unlike the old inline SVG this is raster artwork, so it no longer tints with
 * `currentColor`; callers that passed a text colour just get the artwork's own
 * palette. `object-contain` keeps it undistorted in the non-square boxes some
 * call sites size it into.
 */
export function Gear6Mark({ className }: { className?: string }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={["g6-mark", "block object-contain", className]
        .filter(Boolean)
        .join(" ")}
      src="/rust-gear.avif"
    />
  );
}
