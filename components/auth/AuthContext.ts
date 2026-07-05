"use client";

import { createContext, useContext } from "react";

// Unified auth surface the app consumes. Backed by Privy (real 𝕏 OAuth + an EVM embedded wallet
// on Avalanche) when a Privy app id is configured, or by the prototype handle-entry flow otherwise.
export interface AuthValue {
  connected: boolean;
  handle: string | null; // 𝕏 username (no @)
  name: string | null; // 𝕏 display name
  avatar: string | null; // profile image url
  link: string | null; // https://x.com/<handle>
  address: string | null; // Privy embedded EVM wallet (0x…)
  login: () => void;
  logout: () => void;
  usingPrivy: boolean;
}

export const AuthContext = createContext<AuthValue>({
  connected: false,
  handle: null,
  name: null,
  avatar: null,
  link: null,
  address: null,
  login: () => {},
  logout: () => {},
  usingPrivy: false,
});

export const useAuth = () => useContext(AuthContext);
