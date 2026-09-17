import type { QuickMuteState } from "../../Components/NavRail/QuickMuteStore";

export interface NotificationPreferencesData {
  /** Additive v1 fields are ignored; changes to required fields or semantics need a new version. */
  version: 1;
  desktopNotifications: boolean;
  soundNotifications: boolean;
  quickMuteScope: "popup" | "all";
}

export interface HostNotificationProvider {
  getPreferences(): Promise<unknown>;
}

export interface NotificationDecision {
  playSound: boolean;
  showPopup: boolean;
  isCurrent?(): boolean;
}

interface ProviderContext {
  provider: HostNotificationProvider;
  disposed: boolean;
}

let currentContext: ProviderContext | undefined;

export function installNotificationProvider(provider: HostNotificationProvider): () => void {
  const context: ProviderContext = { provider, disposed: false };
  currentContext = context;
  // Retain a disposed context so this Client page never falls back to Web
  // notification defaults after logout. Older cleanup cannot revoke a new one.
  return () => { context.disposed = true; };
}

export function hasNotificationProvider(): boolean {
  return currentContext !== undefined;
}

function isValidPreferences(value: unknown): value is NotificationPreferencesData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prefs = value as Record<string, unknown>;
  return prefs.version === 1 &&
    typeof prefs.desktopNotifications === "boolean" &&
    typeof prefs.soundNotifications === "boolean" &&
    (prefs.quickMuteScope === "popup" || prefs.quickMuteScope === "all");
}

export async function resolveNotificationPolicy(): Promise<
  (NotificationPreferencesData & { isCurrent(): boolean }) | null
> {
  const context = currentContext;
  if (!context) return null;
  const isCurrent = () => currentContext === context && !context.disposed;
  if (!isCurrent()) throw new Error("Notification provider disposed");
  const value = await context.provider.getPreferences();
  if (!isCurrent()) throw new Error("Notification provider disposed");
  if (!isValidPreferences(value)) throw new Error("Invalid host notification preferences");
  return {
    version: value.version,
    desktopNotifications: value.desktopNotifications,
    soundNotifications: value.soundNotifications,
    quickMuteScope: value.quickMuteScope,
    isCurrent,
  };
}

export async function getHostNotificationDecision(
  readPause: () => Promise<QuickMuteState>,
): Promise<NotificationDecision | null> {
  if (!hasNotificationProvider()) return null;
  try {
    const policy = await resolveNotificationPolicy();
    const pause = await readPause();
    if (!policy?.isCurrent()) return { playSound: false, showPopup: false };
    return {
      showPopup: policy.desktopNotifications && !pause.active,
      playSound: policy.soundNotifications && (!pause.active || policy.quickMuteScope === "popup"),
      isCurrent: policy.isCurrent,
    };
  } catch {
    return { playSound: false, showPopup: false };
  }
}
