"use client";

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentAlerts } from "@/hooks/use-dashboard";
import { alertSeverityBadge, formatAlertType, relativeTime } from "@/lib/format";

export function RecentAlerts() {
  const { data, isLoading } = useRecentAlerts(8);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}

        {!isLoading && data?.items.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <AlertTriangle className="size-6 opacity-40" />
            No alerts yet. The anomaly detection pipeline lands in a later phase.
          </div>
        )}

        {data?.items.map((alert) => {
          const badge = alertSeverityBadge[alert.severity];
          return (
            <div
              key={alert.id}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.03]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{alert.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatAlertType(alert.alert_type)} · {relativeTime(alert.created_at)}
                </p>
              </div>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
