"use client";

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { useAlerts } from "@/hooks/use-alerts";
import { alertSeverityBadge, formatAlertType, relativeTime } from "@/lib/format";

export default function AlertsPage() {
  const { data, isLoading } = useAlerts();

  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Anomaly and system alerts across every camera and zone."
      />

      <Card>
        <CardContent className="p-4">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {!isLoading && data?.items.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertTriangle className="size-8 text-muted-foreground" />
              <div>
                <p className="font-medium">No alerts yet</p>
                <p className="text-sm text-muted-foreground">
                  The anomaly detection pipeline (panic, stampede, intrusion, and more) lands in a
                  later phase and will populate this feed automatically.
                </p>
              </div>
            </div>
          )}

          {!isLoading && data && data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alert</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Raised</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((alert) => {
                  const badge = alertSeverityBadge[alert.severity];
                  return (
                    <TableRow key={alert.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{alert.title}</p>
                          {alert.description && (
                            <p className="text-xs text-muted-foreground">{alert.description}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatAlertType(alert.alert_type)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="capitalize text-muted-foreground">
                        {alert.status.replace("_", " ")}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {relativeTime(alert.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
