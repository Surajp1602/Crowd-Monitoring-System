import {
  Activity,
  Bell,
  BellRing,
  ChartColumn,
  Cctv,
  LayoutGrid,
  Map,
  Server,
  SlidersHorizontal,
  Users,
  Video,
} from "lucide-react";
import { Perm } from "@/lib/permissions";

export interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Shown only when the session holds this permission. */
  permission?: string;
  /** Hidden for guest sessions even when the permission is present. */
  staffOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { label: "Overview", href: "/dashboard", icon: LayoutGrid },
      { label: "Live cameras", href: "/live", icon: Cctv, permission: Perm.CAMERA_VIEW },
      { label: "Facility map", href: "/map", icon: Map, permission: Perm.MAP_VIEW },
      { label: "Alerts", href: "/alerts", icon: Bell, permission: Perm.ALERT_VIEW },
      { label: "Analytics", href: "/analytics", icon: ChartColumn, permission: Perm.ANALYTICS_VIEW },
    ],
  },
  {
    label: "Operate",
    items: [
      { label: "Cameras", href: "/cameras", icon: Video, permission: Perm.CAMERA_VIEW },
      { label: "Notifications", href: "/notifications", icon: BellRing, permission: Perm.NOTIFICATION_MANAGE },
      { label: "System health", href: "/system", icon: Activity, permission: Perm.ANALYTICS_VIEW, staffOnly: true },
      { label: "AI settings", href: "/settings", icon: SlidersHorizontal, permission: Perm.SETTINGS_MANAGE },
      { label: "Users", href: "/users", icon: Users, permission: Perm.USER_MANAGE },
    ],
  },
];

export const SERVER_ICON = Server;

export function visibleNav(permissions: string[], isGuest: boolean, implemented: Set<string>): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        implemented.has(item.href) &&
        (!item.permission || permissions.includes(item.permission)) &&
        !(item.staffOnly && isGuest)
    ),
  })).filter((g) => g.items.length > 0);
}

/** Routes that exist so far; the nav never links to a page that isn't built. */
export const IMPLEMENTED_ROUTES = new Set(["/dashboard", "/live", "/map", "/alerts", "/cameras", "/notifications"]);
