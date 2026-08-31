/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- browser-side MSW bridge */
import type { Page } from "@playwright/test";

/** V3: Chat 录音后转写失败的 HTTP + MediaRecorder fixture. */
export async function registerV3ChatVoiceTranscriptionFailure(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class E2EMediaRecorder {
      static isTypeSupported() { return true; }
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(public stream: unknown, public options?: unknown) {}
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["e2e-audio"], { type: "audio/webm" }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: E2EMediaRecorder });
  });

  await page.addInitScript(() => {
    type MSW = {
      worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: (info: any) => unknown) => unknown;
        post: (path: string, resolver: (info: any) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
    };
    const win = window as unknown as { __msw?: MSW; __v3VoiceTimer?: number; __v3VoiceInstalled?: boolean };
    const install = () => {
      const msw = win.__msw;
      if (!msw) return false;
      if (win.__v3VoiceInstalled) return true;
      msw.worker.use(
        msw.http.get("*/voice/config", () => msw.HttpResponse.json({ enabled: true, max_file_size: 5_000_000, max_duration: 60 })),
        msw.http.get("*/voice/context", () => msw.HttpResponse.json({ status: 200, has_context: false, context: "", updated_at: "2026-08-26T00:00:00Z" })),
        msw.http.post("*/voice/transcribe", () => msw.HttpResponse.json({ message: "e2e transcription failure" }, { status: 500 }))
      );
      win.__v3VoiceInstalled = true;
      return true;
    };
    if (!install()) {
      let attempts = 0;
      win.__v3VoiceTimer = window.setInterval(() => {
        if (install() || ++attempts > 300) window.clearInterval(win.__v3VoiceTimer);
      }, 10);
    }
  });
}
