import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  localTranscribe: vi.fn(),
  post: vi.fn(),
}));

vi.mock("../LocalModelService", () => ({
  default: { shared: { transcribe: mocks.localTranscribe } },
}));

vi.mock("../APIClient", () => ({
  default: { shared: { post: mocks.post } },
}));

import VoiceService from "../VoiceService";

describe("VoiceService transcription routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.localTranscribe.mockResolvedValue(null);
    mocks.post.mockResolvedValue({ text: "云端结果", m: "remote" });
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
});
