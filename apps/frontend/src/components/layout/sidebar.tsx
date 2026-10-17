"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/brand/mark";
import { IMPLEMENTED_ROUTES, visibleNav } from "@/components/layout/nav";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const permissions = useAuthStore((s) => s.permissions);
  const isGuest = useAuthStore((s) => s.isGuest);
  const groups = visibleNav(permissions, isGuest, IMPLEMENTED_ROUTES);

  return (
    <nav className="flex flex-col gap-6" aria-label="Main">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="eyebrow mb-2 px-3">{group.label}</p>
          <ul className="flex flex-col gap-px">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname?.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-[4px] px-3 py-[7px] text-[13.5px] transition-colors duration-150",
                      active ? "bg-ink-3 text-paper" : "text-paper-dim hover:bg-ink-2 hover:text-paper"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-amber transition-opacity",
                        active ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <Icon className={cn("size-[15px]", active ? "text-amber" : "text-paper-faint group-hover:text-paper-dim")} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-rule bg-ink lg:flex">
      <div className="flex h-14 items-center px-5">
        <Link href="/dashboard" aria-label="CCD overview">
          <Wordmark />
        </Link>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 py-5">
        <NavLinks />
      </div>
      <div className="border-t border-rule px-5 py-4">
        <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.08em] text-paper-faint">
          Crowd density mapping
          <br />& anomaly detection
        </p>
      </div>
    </aside>
  );
}
