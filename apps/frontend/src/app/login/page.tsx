"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { ContourField } from "@/components/brand/contour-field";
import { Wordmark } from "@/components/brand/mark";
import { useAuthStore } from "@/stores/auth-store";

export default function LoginPage() {
  const router = useRouter();
  const hydrated = useAuthStore((s) => s.hydrated);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (hydrated && accessToken) {
      router.replace("/dashboard");
    }
  }, [hydrated, accessToken, router]);

  return (
    <div className="grid min-h-screen bg-ink lg:grid-cols-12">
      <section className="grain relative hidden overflow-hidden border-r border-rule lg:col-span-7 lg:flex lg:flex-col lg:justify-between">
        <ContourField className="absolute inset-0 h-full w-full" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-ink via-ink/85 to-transparent" />
        <div className="relative p-10">
          <Wordmark />
        </div>
        <div className="relative max-w-xl p-10">
          <p className="eyebrow mb-4">
            <span className="text-amber">01</span>
            <span className="mx-1.5 opacity-60">—</span>Control center
          </p>
          <h1 className="display text-[clamp(2.4rem,4.2vw,4rem)] text-paper">
            Read the crowd
            <br />
            before it moves.
          </h1>
          <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-paper-dim">
            Live density on every floor, people counted per zone, and anomalies such as surges,
            counter-flow and restricted-area entry flagged the moment the cameras see them.
          </p>
        </div>
      </section>

      <section className="relative flex flex-col justify-center overflow-hidden px-6 py-12 sm:px-12 lg:col-span-5 lg:px-16">
        {/* Phones keep the signature: a strip of the contour field above the form. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[38%] lg:hidden" aria-hidden="true">
          <ContourField className="h-full w-full opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-ink/60 to-ink" />
        </div>
        <div className="relative mb-10 lg:hidden">
          <Wordmark />
        </div>
        <div className="relative w-full max-w-sm">
          <p className="eyebrow mb-3">Sign in</p>
          <h2 className="display mb-8 text-3xl text-paper">Operator access</h2>
          <LoginForm />
        </div>
      </section>
    </div>
  );
}
