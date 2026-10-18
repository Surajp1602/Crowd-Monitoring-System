"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BrandMark } from "@/components/brand/mark";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { useAlertStream } from "@/hooks/use-live";
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
        <Topbar />
        <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
