// Appearance, and nothing else yet. Every other settings card in this codebase
// configures a feature the cloud window does not have — relays, communities,
// notifications, agents — so listing them here would be a menu of controls that
// change nothing.
import {
  APPEARANCES,
  type Appearance,
} from "@/features/cloudShell/appearance";
import { useCloudWindow } from "@/features/cloudShell/CloudWindowProvider";

export function CloudSettingsPane() {
  const { appearance, setAppearance } = useCloudWindow();

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 pb-10 pt-7 sm:px-7">
      <h1 className="text-pulse-display font-bold text-pulse-ink">Settings</h1>

      <section className="mt-6 rounded-2xl border border-pulse-hairline p-5">
        <h2 className="text-pulse-title font-semibold text-pulse-ink">Appearance</h2>
        <p className="mt-1 text-pulse-caption text-pulse-ink-mute">
          System follows the operating system's light and dark setting.
        </p>

        <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Appearance">
          {APPEARANCES.map(({ id, label }) => (
            <AppearanceOption
              id={id}
              key={id}
              label={label}
              onSelect={setAppearance}
              selected={appearance === id}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function AppearanceOption({
  id,
  label,
  onSelect,
  selected,
}: {
  id: Appearance;
  label: string;
  onSelect: (next: Appearance) => void;
  selected: boolean;
}) {
  return (
    <button
      aria-checked={selected}
      // Same selected language as the sidebar nav and the Pulse scope pills:
      // one filled aubergine means "this is the one you are on".
      className={[
        "h-8 rounded-full px-5 text-xs font-medium transition-colors",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink",
        selected
          ? "bg-pulse-brand text-pulse-brand-fg"
          : "border border-pulse-hairline text-pulse-ink-mute hover:bg-pulse-surface hover:text-pulse-ink",
      ].join(" ")}
      onClick={() => onSelect(id)}
      role="radio"
      type="button"
    >
      {label}
    </button>
  );
}
