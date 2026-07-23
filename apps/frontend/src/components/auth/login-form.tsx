"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "framer-motion";
import { Eye, EyeOff, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useGuestLogin, useLogin } from "@/hooks/use-auth";

export function LoginForm() {
  const router = useRouter();
  const login = useLogin();
  const guestLogin = useGuestLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login.mutateAsync({ email, password });
      toast.success("Welcome back");
      router.replace("/dashboard");
    } catch (err) {
      const message = err instanceof ApiError ? String(err.detail ?? err.message) : "Login failed";
      toast.error(message);
    }
  }

  async function handleGuest() {
    try {
      await guestLogin.mutateAsync();
      toast.success("Continuing as guest");
      router.replace("/dashboard");
    } catch {
      toast.error("Could not start a guest session");
    }
  }

  return (
    <TabsPrimitive.Root defaultValue="authority" className="w-full">
      <TabsPrimitive.List className="mb-6 grid grid-cols-2 rounded-lg border border-border bg-white/[0.03] p-1 text-sm">
        <TabsPrimitive.Trigger
          value="authority"
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md py-2 text-muted-foreground transition-colors",
            "data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
          )}
        >
          <ShieldCheck className="size-3.5" />
          Authority
        </TabsPrimitive.Trigger>
        <TabsPrimitive.Trigger
          value="guest"
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md py-2 text-muted-foreground transition-colors",
            "data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
          )}
        >
          <UserRound className="size-3.5" />
          Guest
        </TabsPrimitive.Trigger>
      </TabsPrimitive.List>

      <TabsPrimitive.Content value="authority">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@ccd-platform.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </TabsPrimitive.Content>

      <TabsPrimitive.Content value="guest">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Browse live cameras, the facility map, and analytics in read-only mode. No account
            required — guest sessions expire automatically and cannot manage cameras, alerts, or
            users.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={handleGuest}
            disabled={guestLogin.isPending}
          >
            {guestLogin.isPending ? "Starting session..." : "Continue as guest"}
          </Button>
        </motion.div>
      </TabsPrimitive.Content>
    </TabsPrimitive.Root>
  );
}
