import { beforeEach, describe, expect, it, vi } from "vitest";
import LocalModelService from "../LocalModelService";

const storage = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
};

describe("LocalModelService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    LocalModelService.shared.updateConfig(
      {
        enabled: false,
        preferLocal: true,
        probeUrl: "http://localhost:8787/",
        transcribeUrl: "http://localhost:8787/v1/voice/transcribe",
        requestTimeoutMs: 1000,
      },
      storage,
    );
  });

  it("does not probe when local recognition is disabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    expect(await LocalModelService.shared.probe()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns local text when the local service responds successfully", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 200, text: "本地结果", m: "local-model" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    LocalModelService.shared.updateConfig({ enabled: true }, storage);

    const result = await LocalModelService.shared.transcribe(new Blob(["audio"]));

    expect(result).toEqual({ text: "本地结果", m: "local-model" });
  });

  it("returns null for an empty local result so the caller can fall back to cloud", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 200, text: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    LocalModelService.shared.updateConfig({ enabled: true }, storage);

    await expect(LocalModelService.shared.transcribe(new Blob(["audio"]))).resolves.toBeNull();
  });
});
