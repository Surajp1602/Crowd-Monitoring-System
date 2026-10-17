import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em]",
  {
    variants: {
      variant: {
        default: "border-amber/40 text-amber",
        secondary: "border-transparent bg-ink-3 text-paper-dim",
        outline: "border-rule-strong text-paper-dim",
        success: "border-severity-moderate/35 text-severity-moderate",
        warning: "border-severity-busy/35 text-severity-busy",
        high: "border-severity-high/40 text-severity-high",
        destructive: "border-severity-critical/45 text-severity-critical",
        critical: "border-transparent bg-severity-critical font-semibold text-ink",
        muted: "border-rule text-paper-faint",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
