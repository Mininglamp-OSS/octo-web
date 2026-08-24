import type { Page } from "@playwright/test";
import { VOICE_PROTOCOL_VERSION } from "@octo/base/src/Service/VoiceProtocol";

export type VoiceSeed = {
  shortcutEnabled: boolean;
  speakingMode: "toggle" | "hold";
  enabled?: boolean;
};

const VOICE_STORAGE_KEY = "octo.voice-input.v1.e2e-user-1";

async function grantVoicePermission(page: Page): Promise<void> {
  await page.context().grantPermissions(["microphone"], {
    origin: new URL(process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PW_PREVIEW_PORT ?? "3000"}`).origin,
  });
}

export async function prepareVoiceSettings(page: Page, settings: VoiceSeed): Promise<void> {
  await grantVoicePermission(page);
  await page.addInitScript(({ key, settings: value, protocolVersion }) => {
    localStorage.setItem(key, JSON.stringify({
      enabled: value.enabled ?? true,
      shortcutEnabled: value.shortcutEnabled,
      consent: { protocolVersion, ackedAt: "2026-01-01T00:00:00.000Z" },
      shortcutWindows: "alt-right",
      shortcutMacos: "alt-right",
      speakingMode: value.speakingMode,
      microphoneDeviceId: "",
      localEnabled: false,
      localTimeoutMs: 10000,
      localProbeUrl: "http://localhost:8787/",
      localTranscribeUrl: "http://localhost:8787/v1/voice/transcribe",
    }));
  }, { key: VOICE_STORAGE_KEY, settings, protocolVersion: VOICE_PROTOCOL_VERSION });
  await page.reload();
  await page.getByRole("button", { name: "设置" }).waitFor({ state: "visible", timeout: 15_000 });
}

export async function prepareVoiceConversation(page: Page, settings: VoiceSeed, name: string): Promise<void> {
  await grantVoicePermission(page);
  await page.addInitScript(({ key, settings: value, conversationName, protocolVersion }) => {
    for (const os of ["windows", "macos"]) {
      for (const mode of ["toggle", "hold"]) localStorage.removeItem(`${key}.learned.${os}.${mode}`);
    }
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      enabled: value.enabled ?? true,
      shortcutEnabled: value.shortcutEnabled,
      consent: { protocolVersion, ackedAt: "2026-01-01T00:00:00.000Z" },
      shortcutWindows: "alt-right",
      shortcutMacos: "alt-right",
      speakingMode: value.speakingMode,
      microphoneDeviceId: "",
      localEnabled: false,
      localTimeoutMs: 10000,
      localProbeUrl: "http://localhost:8787/",
      localTranscribeUrl: "http://localhost:8787/v1/voice/transcribe",
    }));
    const seed = {
      currentUid: "e2e-user-1",
      spaceId: "e2e-space-001",
      users: [{ uid: "e2e-user-1", name: "E2E Tester", robot: 0 }],
      groups: [{ group_no: "voice-settings-group", name: conversationName }],
      conversations: [{ channelId: "voice-settings-group", channelType: 2, unread: 0 }],
      messages: [],
      subscribers: [{ uid: "e2e-user-1", name: "E2E Tester", channelId: "voice-settings-group", channelType: 2, role: 1, robot: 0 }],
    };
    let tries = 0;
    const timer = setInterval(() => {
      const install = (globalThis as { __installMockImRuntime__?: (value: unknown) => void }).__installMockImRuntime__;
      if (install) { install(seed); (globalThis as { __e2eVoiceSeedReady__?: boolean }).__e2eVoiceSeedReady__ = true; clearInterval(timer); }
      else if (++tries > 120) {
        (globalThis as { __e2eVoiceSeedError__?: string }).__e2eVoiceSeedError__ = "__installMockImRuntime__ was not ready after 12s";
        clearInterval(timer);
      }
    }, 100);
  }, { key: VOICE_STORAGE_KEY, settings, conversationName: name, protocolVersion: VOICE_PROTOCOL_VERSION });
  await page.reload();
  await page.getByRole("button", { name: "会话" }).waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => {
    const state = globalThis as { __e2eVoiceSeedReady__?: boolean; __e2eVoiceSeedError__?: string };
    if (state.__e2eVoiceSeedError__) throw new Error(state.__e2eVoiceSeedError__);
    return state.__e2eVoiceSeedReady__ === true;
  }, undefined, { timeout: 15_000 });
  await page.getByRole("button", { name: "会话" }).click();
  await page.getByRole("button", { name: "最近" }).click();
  await page.getByText(name, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText(name, { exact: true }).click();
  await page.getByRole("textbox").waitFor({ state: "visible", timeout: 15_000 });
}

export async function openVoiceSettings(page: Page) {
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByTestId("settings-center-nav-voice").click();
  const content = page.getByTestId("settings-center-content");
  await content.getByRole("heading", { name: "语音输入", exact: true }).waitFor({ state: "visible" });
  return content;
}

export async function closeSettings(page: Page): Promise<void> {
  await page.getByTestId("settings-center").getByRole("button", { name: "关闭" }).click();
}

export async function getComposerPlaceholder(page: Page): Promise<string> {
  return (await page.locator(".wk-messageinput-placeholder-base").textContent({ timeout: 1_000 })) ?? "";
}

export async function getComposerVoiceShortcutHint(page: Page): Promise<string> {
  const hint = page.locator(".wk-messageinput-shortcut-hint");
  return (await hint.count()) > 0 ? (await hint.innerText()) : "";
}
