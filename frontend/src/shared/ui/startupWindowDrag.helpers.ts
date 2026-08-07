export type WindowDragPoint = { x: number; y: number };

/**
 * Where the window goes for a pointer now at `pointer`, given the window origin
 * and pointer position recorded when the drag started. All four values are in
 * macOS points (CSS pixels), which are uniform across displays — physical
 * pixels are not, so a two-display setup with mixed scale factors would break
 * the arithmetic halfway across.
 */
export function windowDragTarget(
  origin: WindowDragPoint,
  pointerOrigin: WindowDragPoint,
  pointer: WindowDragPoint,
): WindowDragPoint {
  return {
    x: origin.x + (pointer.x - pointerOrigin.x),
    y: origin.y + (pointer.y - pointerOrigin.y),
  };
}
