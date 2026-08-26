import { VOICE_PROTOCOL_VERSION } from "./VoiceProtocol";

export type VoiceShortcut = "alt-right" | "shift-right" | "shift-left" | "disabled";
export type VoiceSpeakingMode = "toggle" | "hold";
export type VoiceOs = "windows" | "macos";

export interface VoiceSettings {
  enabled: boolean;
  consent?: { protocolVersion: string; ackedAt: string | null; migratedFrom?: "legacy-space-setting" };
  shortcutWindows: VoiceShortcut;
  shortcutMacos: VoiceShortcut;
  speakingMode: VoiceSpeakingMode;
  microphoneDeviceId: string;
  localEnabled: boolean;
  localTimeoutMs: number;
  localProbeUrl: string;
  localTranscribeUrl: string;
}

export const VOICE_SETTINGS_KEY = "octo.voice-input.v1";
export { VOICE_PROTOCOL_VERSION };
// This migration used to share the marker written by the /voice/config path.
// Keep the old marker untouched, but use a source-specific marker so users who
// opened v1.14.0 before /voice/local-config was imported are still migrated.
const LEGACY_LOCAL_CONFIG_MIGRATION = "legacy-local-config-migrated";
const LOCAL_SETTINGS_USER_CONFIGURED = "local-settings-user-configured";
const LEGACY_SPACE_SETTING_MIGRATION = "legacy-space-setting-migrated";
const USER_SETTINGS_MARKER = "user-configured";
const legacySpaceMigrationKey = (spaceId: string) => `${storageKey}.${LEGACY_SPACE_SETTING_MIGRATION}.${encodeURIComponent(spaceId)}`;

export const VOICE_SETTINGS_DEFAULTS: VoiceSettings = {
  enabled: false,
  shortcutWindows: "alt-right",
  shortcutMacos: "alt-right",
  speakingMode: "toggle",
  microphoneDeviceId: "",
  localEnabled: false,
  localTimeoutMs: 10000,
  localProbeUrl: "http://localhost:8787/",
  localTranscribeUrl: "http://localhost:8787/v1/voice/transcribe",
};

const defaults = VOICE_SETTINGS_DEFAULTS;

const validShortcuts = new Set<VoiceShortcut>(["alt-right", "shift-right", "shift-left", "disabled"]);
const validModes = new Set<VoiceSpeakingMode>(["toggle", "hold"]);
const listeners = new Set<(settings: VoiceSettings) => void>();
const microphonePermissionListeners = new Set<(permission: PermissionState) => void>();
let microphonePermission: PermissionState = "prompt";
let microphonePermissionStatus: PermissionStatus | null = null;
let microphonePermissionUndetectable = false;
const microphonePermissionChangeHandler = () => {
  const state = microphonePermissionStatus?.state;
  if (state) setMicrophonePermission(state);
};

export function setMicrophonePermission(permission: PermissionState): void {
  microphonePermission = permission;
  microphonePermissionListeners.forEach((listener) => listener(permission));
}

export function getMicrophonePermission(): PermissionState { return microphonePermission; }

export function isMicrophonePermissionUndetectable(): boolean { return microphonePermissionUndetectable; }

export function subscribeMicrophonePermission(listener: (permission: PermissionState) => void): () => void {
  microphonePermissionListeners.add(listener);
  return () => microphonePermissionListeners.delete(listener);
}

export async function refreshMicrophonePermission(): Promise<PermissionState> {
  if (!navigator.mediaDevices?.getUserMedia || !navigator.permissions?.query) {
    microphonePermissionUndetectable = true;
    setMicrophonePermission(microphonePermission);
    return microphonePermission;
  }
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    microphonePermissionStatus?.removeEventListener?.("change", microphonePermissionChangeHandler);
    microphonePermissionStatus = status;
    microphonePermissionUndetectable = false;
    microphonePermissionStatus.addEventListener?.("change", microphonePermissionChangeHandler);
    microphonePermissionChangeHandler();
    return microphonePermission;
  } catch {
    microphonePermissionUndetectable = true;
    setMicrophonePermission(microphonePermission);
    return microphonePermission;
  }
}

function normalizeLocalUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

let storageKey = VOICE_SETTINGS_KEY;

function hasExplicitLocalSettings(): boolean {
  try {
    if (window.localStorage.getItem(`${storageKey}.${LOCAL_SETTINGS_USER_CONFIGURED}`) === "1") return true;
    if (window.localStorage.getItem(`${storageKey}.${USER_SETTINGS_MARKER}`) !== "1") return false;
    const stored = JSON.parse(window.localStorage.getItem(storageKey) || "null") as Partial<VoiceSettings> | null;
    return Boolean(stored && (
      stored.localEnabled === true ||
      (typeof stored.localTimeoutMs === "number" && stored.localTimeoutMs !== defaults.localTimeoutMs) ||
      (typeof stored.localProbeUrl === "string" && stored.localProbeUrl !== defaults.localProbeUrl) ||
      (typeof stored.localTranscribeUrl === "string" && stored.localTranscribeUrl !== defaults.localTranscribeUrl)
    ));
  } catch {
    return false;
  }
}

function hasCompletedOrSkippedLocalMigration(): boolean {
  return window.localStorage.getItem(`${storageKey}.${LEGACY_LOCAL_CONFIG_MIGRATION}`) === "1" || hasExplicitLocalSettings();
}

function read(key = storageKey): VoiceSettings {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null") as Partial<VoiceSettings> | null;
    if (!value || typeof value !== "object") return { ...defaults };
    return {
      ...defaults,
      ...value,
      enabled: value.enabled === true && value.consent?.protocolVersion === VOICE_PROTOCOL_VERSION,
      shortcutWindows: validShortcuts.has(value.shortcutWindows as VoiceShortcut) ? value.shortcutWindows! : defaults.shortcutWindows,
      shortcutMacos: validShortcuts.has(value.shortcutMacos as VoiceShortcut) ? value.shortcutMacos! : defaults.shortcutMacos,
      speakingMode: validModes.has(value.speakingMode as VoiceSpeakingMode) ? value.speakingMode! : defaults.speakingMode,
      localTimeoutMs: typeof value.localTimeoutMs === "number" && value.localTimeoutMs > 0 ? value.localTimeoutMs : defaults.localTimeoutMs,
      microphoneDeviceId: typeof value.microphoneDeviceId === "string" ? value.microphoneDeviceId : "",
      localEnabled: value.localEnabled === true,
      localProbeUrl: normalizeLocalUrl(value.localProbeUrl, defaults.localProbeUrl),
      localTranscribeUrl: normalizeLocalUrl(value.localTranscribeUrl, defaults.localTranscribeUrl),
    };
  } catch {
    return { ...defaults };
  }
}

let current = read();

export const voiceSettingsStore = {
  get(): VoiceSettings { return { ...current }; },
  set(patch: Partial<VoiceSettings>, options: { internal?: boolean } = {}): VoiceSettings {
    const previous = current;
    const next = {
      ...current,
      ...patch,
      localProbeUrl: patch.localProbeUrl === undefined ? current.localProbeUrl : normalizeLocalUrl(patch.localProbeUrl, current.localProbeUrl),
      localTranscribeUrl: patch.localTranscribeUrl === undefined ? current.localTranscribeUrl : normalizeLocalUrl(patch.localTranscribeUrl, current.localTranscribeUrl),
    };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      if (!options.internal) {
        window.localStorage.setItem(`${storageKey}.${USER_SETTINGS_MARKER}`, "1");
        if (Object.keys(patch).some((key) => key === "localEnabled" || key === "localTimeoutMs" || key === "localProbeUrl" || key === "localTranscribeUrl")) {
          window.localStorage.setItem(`${storageKey}.${LOCAL_SETTINGS_USER_CONFIGURED}`, "1");
        }
      }
      current = next;
      listeners.forEach((listener) => listener({ ...current }));
      return { ...current };
    } catch (error) {
      current = previous;
      throw error;
    }
  },
  acknowledge(protocolVersion = VOICE_PROTOCOL_VERSION): VoiceSettings {
    return this.set({ consent: { protocolVersion, ackedAt: new Date().toISOString() } });
  },
  reset(): VoiceSettings {
    current = { ...defaults };
    try {
      window.localStorage.removeItem(storageKey);
      window.localStorage.setItem(`${storageKey}.${USER_SETTINGS_MARKER}`, "1");
      window.localStorage.setItem(`${storageKey}.${LOCAL_SETTINGS_USER_CONFIGURED}`, "1");
    } catch { /* unavailable storage */ }
    listeners.forEach((listener) => listener({ ...current }));
    return { ...current };
  },
  setUserId(userId: string): VoiceSettings {
    storageKey = userId ? `${VOICE_SETTINGS_KEY}.${encodeURIComponent(userId)}` : VOICE_SETTINGS_KEY;
    current = read();
    listeners.forEach((listener) => listener({ ...current }));
    return { ...current };
  },
  needsLocalConfigMigration(): boolean {
    try {
      return !hasCompletedOrSkippedLocalMigration();
    } catch {
      return true;
    }
  },
  migrateServerConfig(config: {
    local_enabled?: boolean;
    local_timeout_ms?: number;
    local_probe_url?: string;
    local_transcribe_url?: string;
  }): VoiceSettings {
    try {
      if (window.localStorage.getItem(`${storageKey}.${LEGACY_LOCAL_CONFIG_MIGRATION}`) === "1") return { ...current };
      if (hasExplicitLocalSettings()) {
        window.localStorage.setItem(`${storageKey}.${LEGACY_LOCAL_CONFIG_MIGRATION}`, "1");
        return { ...current };
      }
      const patch: Partial<VoiceSettings> = {};
      if (typeof config.local_enabled === "boolean") patch.localEnabled = config.local_enabled;
      if (typeof config.local_timeout_ms === "number" && config.local_timeout_ms > 0) patch.localTimeoutMs = config.local_timeout_ms;
      if (config.local_probe_url) patch.localProbeUrl = config.local_probe_url;
      if (config.local_transcribe_url) patch.localTranscribeUrl = config.local_transcribe_url;
      if (Object.keys(patch).length > 0) current = this.set(patch, { internal: true });
      window.localStorage.setItem(`${storageKey}.${LEGACY_LOCAL_CONFIG_MIGRATION}`, "1");
    } catch { /* migration must not block voice input */ }
    return { ...current };
  },
  migrateLegacySpaceSetting(voiceInputEnabled: number, spaceId: string): VoiceSettings {
    try {
      const hasUserScopedStorage = storageKey !== VOICE_SETTINGS_KEY;
      const stored = JSON.parse(window.localStorage.getItem(storageKey) || "null") as Partial<VoiceSettings> | null;
      const hasExplicitVoicePreference = Boolean(stored && (
        stored.consent ||
        stored.enabled === true ||
        stored.shortcutWindows !== defaults.shortcutWindows ||
        stored.shortcutMacos !== defaults.shortcutMacos ||
        stored.speakingMode !== defaults.speakingMode ||
        Boolean(stored.microphoneDeviceId)
      ));
      const migrationKey = legacySpaceMigrationKey(spaceId);
      const hasUserSettings = window.localStorage.getItem(`${storageKey}.${USER_SETTINGS_MARKER}`) === "1";
      if (!hasUserScopedStorage || !spaceId || voiceInputEnabled !== 1 || hasUserSettings || hasExplicitVoicePreference || window.localStorage.getItem(migrationKey) === "1") {
        return { ...current };
      }
      current = this.set({
        enabled: true,
        // The legacy server flag is an existing opt-in, not a new consent interaction.
        consent: { protocolVersion: VOICE_PROTOCOL_VERSION, ackedAt: null, migratedFrom: "legacy-space-setting" },
        shortcutWindows: "shift-left",
        shortcutMacos: "shift-left",
        speakingMode: "hold",
      }, { internal: true });
      window.localStorage.setItem(migrationKey, "1");
    } catch {
      // Migration must not block voice input.
    }
    return { ...current };
  },
  subscribe(listener: (settings: VoiceSettings) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function getVoiceShortcut(settings: VoiceSettings, os: "windows" | "macos"): VoiceShortcut {
  return os === "macos" ? settings.shortcutMacos : settings.shortcutWindows;
}

export function hasConfiguredVoiceShortcut(settings: VoiceSettings, os: VoiceOs): boolean {
  return getVoiceShortcut(settings, os) !== "disabled";
}

export function shouldShowVoiceShortcuts(settings: VoiceSettings, os: VoiceOs): boolean {
  return settings.enabled && hasConfiguredVoiceShortcut(settings, os);
}

export function getVoiceShortcutLabelKey(shortcut: VoiceShortcut, os: VoiceOs): string {
  if (shortcut === "alt-right") return os === "macos"
    ? "base.navRail.settingsCenter.value.rightOption"
    : "base.navRail.settingsCenter.value.rightAlt";
  if (shortcut === "shift-right") return "base.navRail.settingsCenter.value.rightShift";
  if (shortcut === "shift-left") return "base.navRail.settingsCenter.value.leftShift";
  return "base.navRail.settingsCenter.value.disabled";
}

/**
 * Matches a keyboard event against the configured voice shortcut.
 *
 * On Windows, some keyboard driver / IME combinations report the right Shift
 * key with an empty `code` and `location === 0` instead of the standard
 * `ShiftRight` / `location === 2`. Matching only on `e.code === "ShiftRight"`
 * silently drops the key there, so we fall back to `key === "Shift"` with an
 * unmapped code: the left Shift key always reports `ShiftLeft` / `location
 * 1`, so a Shift event with an empty code cannot be the left one. This
 * fallback is based on the affected Windows driver behavior and is not
 * independently verifiable on every keyboard / IME stack.
 */
export function voiceShortcutMatches(event: { code: string; key: string; location: number }, shortcut: VoiceShortcut): boolean {
  switch (shortcut) {
    case "alt-right":
      return event.code === "AltRight";
    case "shift-right":
      return (
        event.code === "ShiftRight" ||
        (event.key === "Shift" && event.code === "" && event.location !== 1)
      );
    case "shift-left":
      return event.code === "ShiftLeft";
    default:
      return false;
  }
}
