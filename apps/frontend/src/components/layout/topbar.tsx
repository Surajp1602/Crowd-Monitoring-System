"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LogOut, Menu, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Wordmark } from "@/components/brand/mark";
import { NavLinks } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/hooks/use-auth";
import { useLiveStatus } from "@/hooks/use-live";
import type { LiveStatus } from "@/lib/live-types";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  supervisor: "Supervisor",
  security_officer: "Security officer",
  viewer: "Viewer",
  guest: "Guest",
};

const LIVE_LABEL: Record<LiveStatus, { text: string; tone: string }> = {
  idle: { text: "Standby", tone: "bg-paper-faint" },
  connecting: { text: "Connecting", tone: "bg-severity-busy" },
  open: { text: "Live", tone: "bg-severity-moderate" },
  reconnecting: { text: "Reconnecting", tone: "bg-severity-busy" },
  offline: { text: "Offline", tone: "bg-severity-critical" },
};

let clockText = "--:--:--";

function subscribeToSeconds(callback: () => void) {
  const tick = () => {
    clockText = new Date().toLocaleTimeString([], { hour12: false });
    callback();
  };
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}

function Clock() {
  const time = useSyncExternalStore(
    subscribeToSeconds,
    () => clockText,
    () => "--:--:--"
  );
  return <span className="num hidden text-xs text-paper-dim md:inline">{time}</span>;
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/70 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-rule bg-ink data-[state=open]:animate-in data-[state=open]:slide-in-from-left">
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <div className="flex h-14 items-center justify-between px-5">
            <Wordmark />
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close navigation">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-4">
            <NavLinks onNavigate={() => setOpen(false)} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Topbar() {
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const isGuest = useAuthStore((s) => s.isGuest);
  const logout = useLogout();
  const live = LIVE_LABEL[useLiveStatus()];

  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "GU";

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-rule bg-ink/95 px-4 backdrop-saturate-150 md:px-6">
      <MobileNav />
      <div className="lg:hidden">
        <Wordmark />
      </div>

      <div className="ml-auto flex items-center gap-4">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-paper-dim" aria-live="polite">
          <span className={cn("size-1.5 rounded-full", live.tone)} />
          {live.text}
        </span>
        <Clock />
        <span className="hidden h-5 w-px bg-rule md:block" />
        {isGuest && (
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.08em] text-amber sm:inline">
            Read-only guest
          </span>
        )}
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-[4px] bg-ink-3 font-mono text-[11px] text-paper">
            {initials}
          </span>
          <div className="hidden leading-tight sm:block">
            <p className="text-[13px] text-paper">{user?.full_name ?? "Guest"}</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-paper-faint">
              {role ? (ROLE_LABELS[role] ?? role) : "session"}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={logout} aria-label="Sign out" title="Sign out">
          <LogOut />
        </Button>
      </div>
    </header>
  );
}
