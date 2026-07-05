"use client";

import { useMemo } from "react";
import { useStrike } from "@/lib/store";
import { avatarUrl } from "@/lib/social";
import { AuthContext, type AuthValue } from "./AuthContext";

// Prototype auth: a handle-entry sheet, persisted to localStorage. Used when no Privy app id.
export function MockAuthProvider({ children }: { children: React.ReactNode }) {
  const user = useStrike((s) => s.user);
  const openSheet = useStrike((s) => s.openSheet);
  const setUser = useStrike((s) => s.setUser);

  const value = useMemo<AuthValue>(() => {
    const handle = user?.h ?? null;
    return {
      connected: !!handle,
      handle,
      name: handle,
      avatar: handle ? avatarUrl(handle) : null,
      link: handle ? `https://x.com/${handle}` : null,
      address: null, // no embedded wallet in the prototype flow
      login: () => openSheet("x"),
      logout: () => {
        setUser(null);
        try {
          localStorage.removeItem("strike_x");
        } catch {
          /* private mode */
        }
      },
      usingPrivy: false,
    };
  }, [user, openSheet, setUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
