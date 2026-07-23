import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { decodeAccessToken } from "@/lib/jwt";
import type { User } from "@/lib/types";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  role: string | null;
  isGuest: boolean;
  permissions: string[];
  hydrated: boolean;
  setSession: (params: { accessToken: string; refreshToken?: string; user?: User }) => void;
  setAccessToken: (accessToken: string) => void;
  hasPermission: (code: string) => boolean;
  logout: () => void;
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      role: null,
      isGuest: false,
      permissions: [],
      hydrated: false,
      setSession: ({ accessToken, refreshToken, user }) => {
        const claims = decodeAccessToken(accessToken);
        set({
          accessToken,
          refreshToken: refreshToken ?? get().refreshToken,
          user: user ?? get().user,
          role: claims?.role ?? null,
          isGuest: claims?.is_guest ?? false,
          permissions: claims?.permissions ?? [],
        });
      },
      setAccessToken: (accessToken) => {
        const claims = decodeAccessToken(accessToken);
        set({
          accessToken,
          role: claims?.role ?? get().role,
          isGuest: claims?.is_guest ?? get().isGuest,
          permissions: claims?.permissions ?? get().permissions,
        });
      },
      hasPermission: (code) => get().permissions.includes(code),
      logout: () =>
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          role: null,
          isGuest: false,
          permissions: [],
        }),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "ccd-auth",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    }
  )
);
