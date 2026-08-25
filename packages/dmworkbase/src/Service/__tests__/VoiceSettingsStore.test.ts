import { VOICE_SETTINGS_KEY, VOICE_PROTOCOL_VERSION, voiceSettingsStore, voiceShortcutMatches } from "../VoiceSettingsStore";

describe("voiceShortcutMatches", () => {
  it("matches standard code reporting", () => {
    expect(voiceShortcutMatches({ code: "AltRight", key: "Alt", location: 2 }, "alt-right")).toBe(true);
    expect(voiceShortcutMatches({ code: "ShiftRight", key: "Shift", location: 2 }, "shift-right")).toBe(true);
    expect(voiceShortcutMatches({ code: "ShiftLeft", key: "Shift", location: 1 }, "shift-left")).toBe(true);
  });

  it("does not cross-match shortcuts", () => {
    expect(voiceShortcutMatches({ code: "ShiftRight", key: "Shift", location: 2 }, "shift-left")).toBe(false);
    expect(voiceShortcutMatches({ code: "ShiftLeft", key: "Shift", location: 1 }, "shift-right")).toBe(false);
    expect(voiceShortcutMatches({ code: "AltRight", key: "Alt", location: 2 }, "shift-right")).toBe(false);
    expect(voiceShortcutMatches({ code: "ShiftRight", key: "Shift", location: 2 }, "disabled")).toBe(false);
  });

  it("matches the Windows empty-code right Shift report", () => {
    // Some Windows keyboard driver / IME combinations report the right Shift
    // key with an empty code and location 0.
    expect(voiceShortcutMatches({ code: "", key: "Shift", location: 0 }, "shift-right")).toBe(true);
  });

  it("does not treat the empty-code fallback as the left Shift", () => {
    expect(voiceShortcutMatches({ code: "", key: "Shift", location: 0 }, "shift-left")).toBe(false);
    // A left Shift press always reports ShiftLeft / location 1, so the
    // fallback must not claim events that already carry a mapped code.
    expect(voiceShortcutMatches({ code: "ShiftLeft", key: "Shift", location: 1 }, "shift-right")).toBe(false);
  });
});

describe("voiceSettingsStore", () => {
  beforeEach(() => {
    voiceSettingsStore.reset();
    localStorage.clear();
  });

  it("defaults to disabled and persists validated local settings", () => {
    expect(voiceSettingsStore.get().enabled).toBe(false);
    voiceSettingsStore.set({ enabled: true, shortcutWindows: "shift-left" });
    expect(JSON.parse(localStorage.getItem(VOICE_SETTINGS_KEY)!).shortcutWindows).toBe("shift-left");
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

  it("migrates an enabled legacy space setting to the old voice defaults", () => {
    voiceSettingsStore.setUserId("legacy-user");

    const migrated = voiceSettingsStore.migrateLegacySpaceSetting(1, "legacy-space");

    expect(migrated.enabled).toBe(true);
    expect(migrated.shortcutWindows).toBe("shift-left");
    expect(migrated.shortcutMacos).toBe("shift-left");
    expect(migrated.speakingMode).toBe("hold");
    expect(migrated.consent?.protocolVersion).toBe(VOICE_PROTOCOL_VERSION);
    expect(migrated.consent?.ackedAt).toBeNull();
    expect(migrated.consent?.migratedFrom).toBe("legacy-space-setting");
    expect(localStorage.getItem(`${VOICE_SETTINGS_KEY}.legacy-user.legacy-space-setting-migrated.legacy-space`)).toBe("1");
  });

  it("does not overwrite an existing user setting during legacy migration", () => {
    voiceSettingsStore.setUserId("legacy-user");
    voiceSettingsStore.set({ enabled: false, shortcutWindows: "alt-right", speakingMode: "toggle" });

    const current = voiceSettingsStore.migrateLegacySpaceSetting(1, "legacy-space");

    expect(current.enabled).toBe(false);
    expect(current.shortcutWindows).toBe("alt-right");
    expect(current.speakingMode).toBe("toggle");
  });

  it("migrates the legacy space setting after local ASR config migration", () => {
    voiceSettingsStore.setUserId("legacy-user");
    voiceSettingsStore.migrateServerConfig({ local_enabled: false, local_timeout_ms: 5000 });

    const migrated = voiceSettingsStore.migrateLegacySpaceSetting(1, "legacy-space");

    expect(migrated.enabled).toBe(true);
    expect(migrated.shortcutWindows).toBe("shift-left");
    expect(migrated.speakingMode).toBe("hold");
  });

  it("keeps a pre-existing customized setting after server config migration", () => {
    localStorage.setItem(`${VOICE_SETTINGS_KEY}.legacy-user`, JSON.stringify({
      enabled: false,
      consent: { protocolVersion: VOICE_PROTOCOL_VERSION, ackedAt: "2025-01-01T00:00:00.000Z" },
      shortcutWindows: "alt-right",
      shortcutMacos: "alt-right",
      speakingMode: "toggle",
      microphoneDeviceId: "",
      localEnabled: false,
    }));
    voiceSettingsStore.setUserId("legacy-user");
    voiceSettingsStore.migrateServerConfig({ local_enabled: false });
    voiceSettingsStore.setUserId("legacy-user");

    const current = voiceSettingsStore.migrateLegacySpaceSetting(1, "legacy-space");

    expect(current.enabled).toBe(false);
    expect(current.shortcutWindows).toBe("alt-right");
    expect(current.speakingMode).toBe("toggle");
  });

  it("allows a later enabled space to migrate after a disabled space is loaded", () => {
    voiceSettingsStore.setUserId("legacy-user");

    expect(voiceSettingsStore.migrateLegacySpaceSetting(0, "disabled-space").enabled).toBe(false);
    expect(voiceSettingsStore.migrateLegacySpaceSetting(1, "enabled-space").enabled).toBe(true);
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
