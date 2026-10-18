"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentAlerts } from "@/hooks/use-dashboard";
import { alertSeverityBadge, formatAlertType, relativeTime } from "@/lib/format";

export function RecentAlerts({ index = "04" }: { index?: string }) {
  const { data, isLoading, isError } = useRecentAlerts(7);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle index={index}>Recent alerts</CardTitle>
        <Link href="/alerts" className="font-mono text-[11px] uppercase tracking-[0.08em] text-paper-dim hover:text-amber">
          All alerts →
        </Link>
      </CardHeader>
      <CardContent className="flex-1">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        )}
        {isError && <p className="py-6 text-sm text-paper-dim">Alerts need the alert:view permission.</p>}
        {!isLoading && data?.items.length === 0 && (
          <p className="py-8 text-center text-sm text-paper-dim">No alerts. Anomalies appear here the moment they are raised.</p>
        )}
        <ul className="divide-y divide-rule">
          {data?.items.map((alert) => {
            const badge = alertSeverityBadge[alert.severity];
            return (
              <li key={alert.id}>
                <Link
                  href={`/alerts?focus=${alert.id}`}
                  className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:text-amber"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-paper">{alert.title}</p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-paper-faint">
                      {formatAlertType(alert.alert_type)} · {relativeTime(alert.created_at)}
                    </p>
                  </div>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
