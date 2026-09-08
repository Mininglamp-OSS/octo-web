import React, { createContext, useContext } from "react";
import type { AppBotHostCapabilities } from "./types";

const AppBotHostContext = createContext<AppBotHostCapabilities | null>(null);

export function AppBotHostProvider({
  host,
  children,
}: {
  host: AppBotHostCapabilities;
  children: React.ReactNode;
}) {
  return (
    <AppBotHostContext.Provider value={host}>
      {children}
    </AppBotHostContext.Provider>
  );
}

export function useAppBotHost(): AppBotHostCapabilities {
  const host = useContext(AppBotHostContext);
  if (!host) {
    throw new Error("useAppBotHost must be used within AppBotHostProvider");
  }
  return host;
}
