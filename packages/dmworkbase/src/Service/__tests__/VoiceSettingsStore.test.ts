import { VOICE_SETTINGS_KEY, VOICE_PROTOCOL_VERSION, voiceSettingsStore, voiceShortcutMatches } from "../VoiceSettingsStore";

describe("voiceShortcutMatches", () => {
  it("matches standard code reporting", () => {
    expect(voiceShortcutMatches({ code: "AltRight", key: "Alt", location: 2 }, "alt-right")).toBe(true);
  });

  it("does not cross-match shortcuts", () => {
    expect(voiceShortcutMatches({ code: "ShiftRight", key: "Shift", location: 2 }, "alt-right")).toBe(false);
    expect(voiceShortcutMatches({ code: "ShiftLeft", key: "Shift", location: 1 }, "alt-right")).toBe(false);
    expect(voiceShortcutMatches({ code: "ShiftRight", key: "Shift", location: 2 }, "disabled")).toBe(false);
  });

});

describe("voiceSettingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    voiceSettingsStore.reset();
  });

  it("defaults to disabled and persists validated local settings", () => {
    expect(voiceSettingsStore.get().enabled).toBe(false);
    voiceSettingsStore.set({ enabled: true, shortcutEnabled: false });
    expect(JSON.parse(localStorage.getItem(VOICE_SETTINGS_KEY)!).shortcutEnabled).toBe(false);
    expect(voiceSettingsStore.get().enabled).toBe(true);
  });

  it("stores protocol consent independently of spaces", () => {
    voiceSettingsStore.acknowledge();
    expect(voiceSettingsStore.get().consent?.protocolVersion).toBe(VOICE_PROTOCOL_VERSION);
  });

  it("does not restore enabled voice input after a consent protocol change", () => {
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({
      enabled: true,
      consent: { protocolVersion: "old", ackedAt: new Date().toISOString() },
    }));
    voiceSettingsStore.setUserId("");
    expect(voiceSettingsStore.get().enabled).toBe(false);
  });

  it("migrates server local voice settings until the migration marker is set", () => {
    voiceSettingsStore.set({ enabled: true });
    const migrated = voiceSettingsStore.migrateServerConfig({
      local_enabled: true,
      local_timeout_ms: 4500,
      local_probe_url: "http://localhost:9999",
      local_transcribe_url: "http://localhost:9999/transcribe",
    });

    expect(migrated.localEnabled).toBe(true);
    expect(migrated.localTimeoutMs).toBe(4500);
    expect(migrated.localProbeUrl).toBe("http://localhost:9999/");

    const unchanged = voiceSettingsStore.migrateServerConfig({ local_enabled: false, local_probe_url: "http://localhost:8888" });
    expect(unchanged.localEnabled).toBe(true);
    expect(unchanged.localProbeUrl).toBe("http://localhost:9999/");
  });

  it("isolates settings and consent by user id", () => {
    voiceSettingsStore.setUserId("user-a");
    voiceSettingsStore.set({ enabled: true });
    voiceSettingsStore.acknowledge();

    voiceSettingsStore.setUserId("user-b");
    expect(voiceSettingsStore.get().enabled).toBe(false);
    expect(voiceSettingsStore.get().consent).toBeUndefined();

    voiceSettingsStore.setUserId("user-a");
    expect(voiceSettingsStore.get().enabled).toBe(true);
    expect(voiceSettingsStore.get().consent?.protocolVersion).toBe(VOICE_PROTOCOL_VERSION);
  });

  it("restores persisted values and normalizes invalid enum values", async () => {
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({
      enabled: true,
      consent: { protocolVersion: VOICE_PROTOCOL_VERSION, ackedAt: new Date().toISOString() },
      shortcutWindows: "old-shortcut",
      speakingMode: "old-mode",
    }));
    vi.resetModules();
    const { voiceSettingsStore: restoredStore } = await import("../VoiceSettingsStore");

    expect(restoredStore.get().enabled).toBe(true);
    expect(restoredStore.get().shortcutWindows).toBe("alt-right");
    expect(restoredStore.get().speakingMode).toBe("toggle");
  });

  it("preserves a legacy disabled shortcut during migration", async () => {
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({
      enabled: true,
      consent: { protocolVersion: VOICE_PROTOCOL_VERSION, ackedAt: new Date().toISOString() },
      shortcutWindows: "disabled",
      shortcutMacos: "disabled",
    }));
    vi.resetModules();
    const { voiceSettingsStore: restoredStore } = await import("../VoiceSettingsStore");

    expect(restoredStore.get().shortcutEnabled).toBe(false);
    expect(restoredStore.get().shortcutWindows).toBe("disabled");
    expect(restoredStore.get().shortcutMacos).toBe("disabled");
  });

  it("rolls back the in-memory value when persistence fails", () => {
    voiceSettingsStore.set({ enabled: true });
    const originalStorage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { ...originalStorage, setItem: () => { throw new Error("storage unavailable"); } },
    });
    try {
      expect(() => voiceSettingsStore.set({ enabled: false })).toThrow("storage unavailable");
      expect(voiceSettingsStore.get().enabled).toBe(true);
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: originalStorage });
    }
  });
});
