import { RecoveryScreen } from "./RecoveryScreen";

export function RelaunchRequiredScreen() {
  return (
    <RecoveryScreen
      testId="relaunch-required"
      title="Restart Gear6 to finish recovery"
      body="Your identity was updated. Gear6 needs to restart so syncing and agents run under it."
    />
  );
}
