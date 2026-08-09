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
      <h1 className="text-[22px] font-semibold text-foreground">Settings</h1>

      <section className="mt-6 rounded-[14px] border border-border p-5">
        <h2 className="text-sm font-semibold text-foreground">Appearance</h2>
        <p className="mt-1 text-xs text-muted-foreground">
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
      className={[
        "h-8 rounded-md px-3 text-xs font-medium transition-colors",
        "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        selected
          ? "bg-muted text-foreground"
          : "border border-border text-muted-foreground hover:bg-muted/60",
      ].join(" ")}
      onClick={() => onSelect(id)}
      role="radio"
      type="button"
    >
      {label}
    </button>
  );
}
