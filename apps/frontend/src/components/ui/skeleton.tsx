import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-ink-3", className)} {...props} />;
}

export { Skeleton };
