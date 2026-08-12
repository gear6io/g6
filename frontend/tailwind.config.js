/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      // Sub-`text-xs` ramp for meta text (timestamps, count badges, tracking
      // labels) and tiny glyphs. Defined in rem so Cmd +/- zoom — which scales
      // the root <html> font-size — keeps scaling them. Do NOT reintroduce
      // arbitrary `text-[…rem]` / `text-[…px]` literals; the px-text guard
      // rejects them. Stock scale picks up from here: xs (12px), sm (14px)…
      fontSize: {
        "2xs": "0.6875rem", // 11px — meta-text workhorse (timestamps, badges)
        "3xs": "0.5rem", // 8px — tiny glyphs / micro labels
        badge: "0.625rem", // 10px — compact status badges
        // 40px — onboarding page titles (tightened tracking for large display type)
        title: ["2.5rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        // 36px — the backup-step private key, shown large in monospace
        "nsec-key": ["2.25rem", { lineHeight: "1.3" }],
        // Cloud Pulse brand ramp (Design.md). Tracking is baked in because the
        // brand's whole typographic character is the tracking: negative on
        // display, positive on the all-caps tiers. A size without its tracking
        // is off-brand, so they are not separable utilities.
        // Tracking runs negative on display and turns positive by the caps
        // tiers — the ramp is monotonic in size and in tracking, which is the
        // whole point: one fixed letter-spacing would be wrong at both ends.
        "pulse-display": ["2rem", { lineHeight: "1.25", letterSpacing: "-0.256px" }],
        "pulse-heading": ["1.5rem", { lineHeight: "1.33", letterSpacing: "-0.096px" }],
        "pulse-title": ["1.125rem", { lineHeight: "1.56", letterSpacing: "-0.0216px" }],
        // 1.55 leading, not Tailwind's stock 1.5. Design.md states body leading
        // explicitly, so `text-base` is off-brand by a hair everywhere it lands.
        "pulse-body": ["1rem", { lineHeight: "1.55", letterSpacing: "0" }],
        "pulse-caption": ["0.875rem", { lineHeight: "1.43", letterSpacing: "0.1px" }],
        "pulse-cap": ["0.9rem", { lineHeight: "1", letterSpacing: "0.144px" }],
        "pulse-eyebrow": ["0.75rem", { lineHeight: "1", letterSpacing: "0.96px" }],
      },
      boxShadow: {
        "content-edge": "-1px -1px 0 0 hsl(var(--sidebar-border) / 0.45)",
        // Edge + elevation for a surface anchored to the right of the content
        // area, whose only exposed edge faces left. Tailwind's stock shadows are
        // all y-offset, so they cast almost nothing sideways — `shadow-xl` on a
        // left-facing edge is nearly invisible. Both layers run -x so they wrap
        // the surface's rounded left corners: the hairline draws the boundary
        // (and carries dark mode, where a black shadow reads as nothing), the
        // soft layer carries the lift. A left-only `border` can't do this job —
        // it tapers out at each corner instead of turning it.
        "panel-left":
          "-1px 0 0 0 hsl(var(--border) / 0.8), -16px 0 32px -12px rgb(0 0 0 / 0.18)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      spacing: {
        4.5: "1.125rem",
      },
      fontFamily: {
        sans: [
          '"Inter Variable"',
          "Inter",
          '"Avenir Next"',
          '"Segoe UI"',
          "sans-serif",
        ],
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          active: "hsl(var(--sidebar-active))",
          "active-foreground": "hsl(var(--sidebar-active-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        status: {
          added: "var(--status-added)",
          deleted: "var(--status-deleted)",
          modified: "var(--status-modified)",
        },
        warning: {
          DEFAULT: "var(--ui-warning)",
          bg: "var(--ui-warning-bg)",
        },
        // The Cloud window runs its own brand palette (Design.md) rather than
        // the Catppuccin tokens above, which the theme picker rewrites at
        // runtime across 64 Shiki themes. Cloud is deliberately outside that:
        // the brand is fixed, so the window does not recolour per theme.
        // Scoped to the cloud* features on purpose; the legacy app keeps the
        // tokens above.
        //
        // `brand` is a fill. `brand-ink` is text/border/ring. They are the same
        // hex in light and diverge sharply in dark — see theme.css for why.
        pulse: {
          brand: "var(--g6-pulse-brand)",
          "brand-ink": "var(--g6-pulse-brand-ink)",
          press: "var(--g6-pulse-brand-press)",
          "brand-fg": "var(--g6-pulse-brand-fg)",
          "brand-mute": "var(--g6-pulse-brand-mute)",
          tint: "var(--g6-pulse-brand-tint)",
          surface: "var(--g6-pulse-surface)",
          "surface-alt": "var(--g6-pulse-surface-alt)",
          canvas: "var(--g6-pulse-canvas)",
          ink: "var(--g6-pulse-ink)",
          "ink-mute": "var(--g6-pulse-ink-mute)",
          hairline: "var(--g6-pulse-hairline)",
          link: "var(--g6-pulse-link)",
          error: "var(--g6-pulse-error)",
          warning: "var(--g6-pulse-warning)",
          success: "var(--g6-pulse-success)",
        },
      },
    },
  },
  plugins: [],
};
