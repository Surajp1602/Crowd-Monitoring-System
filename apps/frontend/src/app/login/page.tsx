"use client";

import { motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoginForm } from "@/components/auth/login-form";
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, oklch(0.35 0.1 250 / 0.4), transparent 40%), radial-gradient(circle at 80% 80%, oklch(0.3 0.12 200 / 0.3), transparent 45%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="glass-panel relative w-full max-w-sm rounded-2xl p-8 shadow-2xl shadow-black/40"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <ShieldAlert className="size-6" />
          </div>
          <h1 className="text-lg font-semibold">Crowd Density Platform</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to the surveillance control center
          </p>
        </div>

        <LoginForm />
      </motion.div>
    </div>
  );
}
