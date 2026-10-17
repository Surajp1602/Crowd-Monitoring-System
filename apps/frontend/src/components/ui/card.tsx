import * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("panel", className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-start justify-between gap-3 px-5 pb-3 pt-4", className)} {...props} />;
}

/** Numbered mono label, e.g. index="02" → "02 — RECENT ALERTS". */
function CardTitle({
  className,
  index,
  children,
  ...props
}: React.ComponentProps<"h3"> & { index?: string }) {
  return (
    <h3 className={cn("eyebrow", className)} {...props}>
      {index && <span className="text-amber">{index}</span>}
      {index && <span className="mx-1.5 text-paper-faint/60">—</span>}
      {children}
    </h3>
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-xs text-paper-dim", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center border-t border-rule px-5 py-3", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
