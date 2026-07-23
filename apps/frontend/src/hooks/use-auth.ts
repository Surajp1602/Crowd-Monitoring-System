"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import type { User } from "@/lib/types";

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
}

interface GuestResponse {
  access_token: string;
  token_type: string;
  expires_in_minutes: number;
}

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (params: { email: string; password: string }) =>
      apiFetch<LoginResponse>("/api/v1/auth/login", {
        method: "POST",
        body: params,
        skipAuth: true,
      }),
    onSuccess: (data) => {
      setSession({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        user: data.user,
      });
    },
  });
}

export function useGuestLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: () =>
      apiFetch<GuestResponse>("/api/v1/auth/guest", { method: "POST", skipAuth: true }),
    onSuccess: (data) => {
      setSession({ accessToken: data.access_token });
    },
  });
}

export function useLogout() {
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();
  return () => {
    logout();
    router.replace("/login");
  };
}
