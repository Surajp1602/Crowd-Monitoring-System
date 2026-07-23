"use client";

import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  supervisor: "Supervisor",
  security_officer: "Security Officer",
  viewer: "Viewer",
  guest: "Guest",
};

export function Topbar() {
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const isGuest = useAuthStore((s) => s.isGuest);
  const logout = useLogout();

  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "GU";

  return (
    <header className="flex h-16 shrink-0 items-center justify-end border-b border-border px-6">
      <div className="flex items-center gap-3">
        {isGuest && (
          <Badge variant="secondary" className="hidden sm:inline-flex">
            Guest Mode — read only
          </Badge>
        )}
        {role && (
          <Badge variant="outline" className="hidden sm:inline-flex">
            {ROLE_LABELS[role] ?? role}
          </Badge>
        )}
        <div className="flex items-center gap-2">
          <Avatar>
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="hidden leading-tight sm:block">
            <p className="text-sm font-medium">{user?.full_name ?? "Guest"}</p>
            <p className="text-xs text-muted-foreground">{user?.email ?? "guest session"}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={logout} title="Log out">
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
