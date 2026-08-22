// Cloud-only settings. The development user is session state shared by every
// user-scoped Cloud read; appearance is the only persisted choice here.
import { ChevronDown } from "lucide-react";

import { userLabel } from "@/features/cloudInbox/inbox";
import {
  CAN_LIST_USERS,
  type Load,
} from "@/features/cloudInbox/useCloudInbox";
import { APPEARANCES, type Appearance } from "@/features/cloudShell/appearance";
import { useCloudWindow } from "@/features/cloudShell/CloudWindowProvider";
import type { CloudUser } from "@/shared/api/cloudGateway/types";
import { Button } from "@/shared/ui/button";

export function CloudSettingsPane() {
  const { appearance, inbox, setAppearance } = useCloudWindow();

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 pb-10 pt-7 sm:px-7">
      <h1 className="text-pulse-display font-bold text-pulse-ink">Settings</h1>

      <section className="g6-pulse-elevated mt-6 rounded-2xl border border-pulse-hairline bg-pulse-surface/45 p-5">
        <h2 className="text-pulse-title font-semibold text-pulse-ink">
          Appearance
        </h2>
        <p className="mt-1 text-pulse-caption text-pulse-ink-mute">
          System follows the operating system's light and dark setting.
        </p>

        <div
          className="mt-3 flex gap-2"
          role="radiogroup"
          aria-label="Appearance"
        >
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

      {CAN_LIST_USERS ? (
        <section className="g6-pulse-elevated mt-4 rounded-2xl border border-pulse-hairline bg-pulse-surface/45 p-5">
          <h2 className="text-pulse-title font-semibold text-pulse-ink">
            Development user
          </h2>
          <p className="mt-1 text-pulse-caption text-pulse-ink-mute">
            Choose the account used for all user-scoped Cloud data, including
            actions and overview counts.
          </p>

          <DevelopmentUserControl
            onRetry={inbox.retryUsers}
            onSelect={inbox.select}
            selected={inbox.selected}
            users={inbox.users}
          />
        </section>
      ) : null}
    </div>
  );
}

function DevelopmentUserControl({
  onRetry,
  onSelect,
  selected,
  users,
}: {
  onRetry: () => void;
  onSelect: (accountId: string) => void;
  selected: string | null;
  users: Load<CloudUser[]>;
}) {
  if (users.status === "loading") {
    return (
      <p className="mt-3 text-sm text-pulse-ink-mute" role="status">
        Loading users…
      </p>
    );
  }
  if (users.status === "error") {
    return (
      <div className="mt-3" role="alert">
        <p className="text-sm text-pulse-error">
          Could not load users: {users.message}
        </p>
        <Button className="mt-3" onClick={onRetry} size="sm" variant="outline">
          Retry
        </Button>
      </div>
    );
  }
  if (!selected || users.value.length === 0) {
    return (
      <p className="mt-3 text-sm text-pulse-ink-mute">
        No users found in this Cloud dataset.
      </p>
    );
  }

  return (
    <label className="mt-3 block max-w-sm text-xs font-medium text-pulse-ink-mute">
      View as user
      <span className="relative mt-1.5 block">
        <select
          aria-label="View as user"
          className="h-9 w-full appearance-none rounded-md border border-pulse-hairline bg-pulse-surface px-3 pr-9 text-sm text-pulse-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink"
          onChange={(event) => onSelect(event.target.value)}
          value={selected}
        >
          {users.value.map((user) => (
            <option key={user.provider_id} value={user.provider_id}>
              {userLabel(user)}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-pulse-ink-mute"
        />
      </span>
    </label>
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
      // one filled cobalt means "this is the one you are on".
      className={[
        "h-8 rounded-full px-5 text-xs font-medium transition-[background-color,border-color,color,transform] active:scale-[0.98]",
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
