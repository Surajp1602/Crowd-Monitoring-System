import type { AlertSeverity, CameraStatus } from "@/lib/types";

export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export const cameraStatusBadge: Record<CameraStatus, { label: string; variant: "success" | "warning" | "destructive" | "muted" }> = {
  online: { label: "Online", variant: "success" },
  starting: { label: "Starting", variant: "warning" },
  offline: { label: "Offline", variant: "muted" },
  error: { label: "Error", variant: "destructive" },
  disabled: { label: "Disabled", variant: "muted" },
};

export const alertSeverityBadge: Record<
  AlertSeverity,
  { label: string; variant: "outline" | "warning" | "high" | "critical" }
> = {
  low: { label: "Low", variant: "outline" },
  medium: { label: "Medium", variant: "warning" },
  high: { label: "High", variant: "high" },
  critical: { label: "Critical", variant: "critical" },
};

export function formatAlertType(type: string): string {
  return type
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}
