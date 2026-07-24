import type { ReactNode } from "react";

export function GradientLayer() {
  return (
    <div
      aria-hidden="true"
      className="g6-theme-gradient-layer pointer-events-none absolute inset-0 -z-10"
      data-g6-gradient-layer
    >
      <div
        className="g6-theme-gradient-layer-light absolute inset-0 opacity-0"
        data-g6-gradient="light"
      />
      <div
        className="g6-theme-gradient-layer-dark absolute inset-0 opacity-0"
        data-g6-gradient="dark"
      />
    </div>
  );
}

export function ContentSurface({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative z-10 mb-2 ml-px mr-2 mt-px flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background shadow-content-edge"
      data-g6-content-surface
    >
      {children}
    </div>
  );
}
