// The shape half of a status. Colour is the other half, and never the only one:
// wherever this appears, the status name appears with it or in the accessible
// label of the control it sits in.
import { Link, Minus, TrendingDown, TrendingUp } from "lucide-react";

import type { MilestoneStatus } from "@/shared/api/cloudGateway/types";

const ICONS: Record<MilestoneStatus, typeof Minus> = {
  progress: TrendingUp,
  dependency: Link,
  regression: TrendingDown,
  neutral: Minus,
};

export function StatusIcon({
  className,
  status,
}: {
  className?: string;
  status: MilestoneStatus;
}) {
  const Icon = ICONS[status];
  return <Icon aria-hidden="true" className={className} />;
}
