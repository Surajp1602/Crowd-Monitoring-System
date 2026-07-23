"use client";

import { motion } from "framer-motion";
import { Bell, Box, LayoutDashboard, Map, Settings, ShieldAlert, Video } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Cameras", href: "/cameras", icon: Video },
  { label: "Alerts", href: "/alerts", icon: Bell },
  { label: "Facility Map", href: "/map", icon: Map, soon: true },
  { label: "Analytics", href: "/analytics", icon: Box, soon: true },
  { label: "Settings", href: "/settings", icon: Settings, soon: true },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar backdrop-blur-xl md:flex">
      <div className="flex h-16 items-center gap-2 px-6">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <ShieldAlert className="size-4" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-foreground">Crowd Density</p>
          <p className="text-[11px] text-muted-foreground">Control Center</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          const Icon = item.icon;

          if (item.soon) {
            return (
              <div
                key={item.href}
                className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground/50"
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="size-4" />
                  {item.label}
                </span>
                <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[10px]">
                  Soon
                </span>
              </div>
            );
          }

          return (
            <Link key={item.href} href={item.href} className="relative">
              {active && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-md bg-primary/15"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
              <span
                className={cn(
                  "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active ? "text-primary" : "text-sidebar-foreground/80 hover:text-sidebar-foreground"
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-4 text-[11px] text-muted-foreground">
        Enterprise Crowd Density Platform
      </div>
    </aside>
  );
}
