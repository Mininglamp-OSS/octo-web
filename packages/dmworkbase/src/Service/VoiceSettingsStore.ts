import { VOICE_PROTOCOL_VERSION } from "./VoiceProtocol";

export type VoiceShortcut = "alt-right" | "shift-right" | "shift-left" | "disabled";
export type VoiceSpeakingMode = "toggle" | "hold";

export interface VoiceSettings {
  enabled: boolean;
  consent?: { protocolVersion: string; ackedAt: string };
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
const LEGACY_SERVER_MIGRATION = "legacy-server-config-migrated";

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

export function setMicrophonePermission(permission: PermissionState): void {
  microphonePermission = permission;
  microphonePermissionListeners.forEach((listener) => listener(permission));
}

export function getMicrophonePermission(): PermissionState { return microphonePermission; }

export function subscribeMicrophonePermission(listener: (permission: PermissionState) => void): () => void {
  microphonePermissionListeners.add(listener);
  return () => microphonePermissionListeners.delete(listener);
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
  set(patch: Partial<VoiceSettings>): VoiceSettings {
    const previous = current;
    const next = {
      ...current,
      ...patch,
      localProbeUrl: patch.localProbeUrl === undefined ? current.localProbeUrl : normalizeLocalUrl(patch.localProbeUrl, current.localProbeUrl),
      localTranscribeUrl: patch.localTranscribeUrl === undefined ? current.localTranscribeUrl : normalizeLocalUrl(patch.localTranscribeUrl, current.localTranscribeUrl),
    };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
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
    try { window.localStorage.removeItem(storageKey); } catch { /* unavailable storage */ }
    listeners.forEach((listener) => listener({ ...current }));
    return { ...current };
  },
  setUserId(userId: string): VoiceSettings {
    storageKey = userId ? `${VOICE_SETTINGS_KEY}.${encodeURIComponent(userId)}` : VOICE_SETTINGS_KEY;
    current = read();
    listeners.forEach((listener) => listener({ ...current }));
    return { ...current };
  },
  migrateServerConfig(config: {
    local_enabled?: boolean;
    local_timeout_ms?: number;
    local_probe_url?: string;
    local_transcribe_url?: string;
  }): VoiceSettings {
    try {
      if (window.localStorage.getItem(`${storageKey}.${LEGACY_SERVER_MIGRATION}`) === "1") return { ...current };
      const patch: Partial<VoiceSettings> = {};
      if (typeof config.local_enabled === "boolean") patch.localEnabled = config.local_enabled;
      if (typeof config.local_timeout_ms === "number" && config.local_timeout_ms > 0) patch.localTimeoutMs = config.local_timeout_ms;
      if (config.local_probe_url) patch.localProbeUrl = config.local_probe_url;
      if (config.local_transcribe_url) patch.localTranscribeUrl = config.local_transcribe_url;
      if (Object.keys(patch).length > 0) current = this.set(patch);
      window.localStorage.setItem(`${storageKey}.${LEGACY_SERVER_MIGRATION}`, "1");
    } catch { /* migration must not block voice input */ }
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
