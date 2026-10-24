"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BrandMark } from "@/components/brand/mark";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { useAlertStream } from "@/hooks/use-live";
import { DEMO_MODE } from "@/lib/demo/mode";
import { useAuthStore } from "@/stores/auth-store";

function AlertStream() {
  useAlertStream();
  return null;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const hydrated = useAuthStore((s) => s.hydrated);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (hydrated && !accessToken) {
      router.replace("/login");
    }
  }, [hydrated, accessToken, router]);

  if (!hydrated || !accessToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink">
        <BrandMark size={36} className="animate-pulse text-paper" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-amber focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <AlertStream />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {DEMO_MODE && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-paper-faint md:px-6 lg:px-8">
            <span className="text-amber">Demo</span>
            <span>Recorded from the live pipeline · changes are turned off</span>
            <a
              href="https://github.com/Surajp1602/Crowd-Monitoring-System"
              target="_blank"
              rel="noreferrer"
              className="text-paper-dim underline-offset-2 hover:text-paper hover:underline"
            >
              Source on GitHub
            </a>
          </div>
        )}
        <Topbar />
        <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
