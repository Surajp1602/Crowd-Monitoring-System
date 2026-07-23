import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  loading,
  tone = "default",
  suffix,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  loading?: boolean;
  tone?: "default" | "critical" | "success";
  suffix?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-16" />
          ) : (
            <p
              className={cn(
                "mt-1 text-2xl font-semibold tracking-tight",
                tone === "critical" && "text-severity-critical",
                tone === "success" && "text-severity-moderate"
              )}
            >
              {value}
              {suffix && <span className="ml-1 text-sm font-normal text-muted-foreground">{suffix}</span>}
            </p>
          )}
        </div>
        <div
          className={cn(
            "flex size-9 items-center justify-center rounded-lg",
            tone === "critical" ? "bg-severity-critical/15 text-severity-critical" : "bg-primary/15 text-primary"
          )}
        >
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}
