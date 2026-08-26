import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  localTranscribe: vi.fn(),
  post: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../LocalModelService", () => ({
  default: { shared: { transcribe: mocks.localTranscribe } },
}));

vi.mock("../APIClient", () => ({
  default: { shared: { post: mocks.post, get: mocks.get, put: mocks.put, delete: mocks.delete } },
}));

import VoiceService from "../VoiceService";

describe("VoiceService transcription routing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.localTranscribe.mockResolvedValue(null);
    mocks.post.mockResolvedValue({ text: "云端结果", m: "remote" });
    mocks.get.mockResolvedValue({});
    VoiceService.shared.clearVoiceContextCache();
  });

  it("uses cloud directly when local recognition is disabled by the caller", async () => {
    const result = await VoiceService.shared.transcribe(new Blob(["audio"]), undefined, undefined, undefined, undefined, "smart", true);

    expect(result.text).toBe("云端结果");
    expect(mocks.localTranscribe).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it("prefers a local result when local recognition is enabled", async () => {
    mocks.localTranscribe.mockResolvedValue({ text: "本地结果", m: "local" });

    const result = await VoiceService.shared.transcribe(new Blob(["audio"]));

    expect(result).toEqual({ text: "本地结果", m: "local" });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("falls back to cloud when local recognition returns no result", async () => {
    const result = await VoiceService.shared.transcribe(new Blob(["audio"]));

    expect(result.text).toBe("云端结果");
    expect(mocks.localTranscribe).toHaveBeenCalledOnce();
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it("sends optional context fields and selects mp4 for mp4 audio", async () => {
    const audio = new Blob(["audio"], { type: "audio/mp4" });

    await VoiceService.shared.transcribe(
      audio,
      "context",
      "chat",
      "personal",
      "member",
      "append_only",
      true,
      2,
      false,
      "Nancy",
    );

    const formData = mocks.post.mock.calls[0][1] as FormData;
    expect(mocks.post.mock.calls[0][0]).toBe("/voice/transcribe");
    expect(formData.get("context_text")).toBe("context");
    expect(formData.get("chat_context")).toBe("chat");
    expect(formData.get("personal_context")).toBe("personal");
    expect(formData.get("member_context")).toBe("member");
    expect(formData.get("mode")).toBe("append_only");
    expect(formData.get("channel_type")).toBe("2");
    expect(formData.get("allow_feedback")).toBe("false");
    expect(formData.get("self_name")).toBe("Nancy");
    expect((formData.get("audio") as File).name).toBe("recording.mp4");
  });

  it("delegates config and deprecated local-config operations", async () => {
    mocks.get.mockResolvedValueOnce({ enabled: true }).mockResolvedValueOnce({ status: 200 });

    await expect(VoiceService.shared.getConfig()).resolves.toEqual({ enabled: true });
    await expect(VoiceService.shared.getLocalConfig()).resolves.toEqual({ status: 200 });
    expect(mocks.get).toHaveBeenNthCalledWith(1, "/voice/config");
    expect(mocks.get).toHaveBeenNthCalledWith(2, "/voice/local-config");
    await VoiceService.shared.putLocalConfig({ enabled: true });
    await VoiceService.shared.deleteLocalConfig();
    await VoiceService.shared.resetLocalConfig({ enabled: false });

    expect(mocks.put).toHaveBeenCalledWith("/voice/local-config", { enabled: true });
    expect(mocks.delete).toHaveBeenCalledWith("/voice/local-config");
    expect(mocks.post).toHaveBeenCalledWith("/voice/local-config/reset", { enabled: false });
  });

  it("caches voice context per space and clearVoiceContextCache forces a refresh", async () => {
    const first = { status: 200, has_context: true, context: "one", updated_at: "1" };
    const second = { status: 200, has_context: false, context: "", updated_at: "2" };
    const third = { status: 200, has_context: true, context: "three", updated_at: "3" };
    mocks.get.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(third);

    await expect(VoiceService.shared.getVoiceContext("space-1")).resolves.toEqual(first);
    await expect(VoiceService.shared.getVoiceContext("space-1")).resolves.toEqual(first);
    expect(mocks.get).toHaveBeenCalledOnce();
    await expect(VoiceService.shared.getVoiceContext("space-2")).resolves.toEqual(second);
    expect(mocks.get).toHaveBeenCalledTimes(2);

    VoiceService.shared.clearVoiceContextCache("space-1");
    await expect(VoiceService.shared.getVoiceContext("space-1")).resolves.toEqual(third);
    expect(mocks.get).toHaveBeenCalledTimes(3);
  });
});
