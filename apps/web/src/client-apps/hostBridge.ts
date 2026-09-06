import type { AppBotConversationTarget } from "@dmwork/appbot";

export interface AppsBootstrap {
  bridgeVersion: 1;
  featureId: "apps";
  session: {
    uid: string;
    token: string;
    name: string;
    email?: string;
    provider: string;
    apiOrigin: string;
  };
  space: { id: string; name: string };
  appearance: { theme: "light" | "dark"; locale: "zh-CN" | "en-US" };
}

export type AppsHostCommand =
  | { type: "spaceChanged"; space: { id: string; name: string } }
  | {
      type: "appearanceChanged";
      theme: "light" | "dark";
      locale: "zh-CN" | "en-US";
    }
  | { type: "reload" }
  | { type: "suspend" }
  | { type: "resume" }
  | { type: "hostVisibilityChanged"; visible: boolean }
  | { type: "sessionRevoked" };

export interface OctoBuddyAppsBridge {
  getBootstrap(): Promise<AppsBootstrap>;
  reportReady(state: {
    bridgeVersion: 1;
    spaceId: string;
    rendererVersion: string;
  }): Promise<void>;
  reportAuthExpired(reason: string): void;
  reportFatalError(error: { message: string; stack?: string }): void;
  openConversation(target: AppBotConversationTarget): Promise<void>;
  onCommand(callback: (command: AppsHostCommand) => void): () => void;
}

declare global {
  interface Window {
    octoBuddyApps?: OctoBuddyAppsBridge;
  }
}

export function requireAppsHostBridge(): OctoBuddyAppsBridge {
  const bridge = window.octoBuddyApps;
  if (!bridge) throw new Error("octoBuddy apps bridge is unavailable");
  return bridge;
}
