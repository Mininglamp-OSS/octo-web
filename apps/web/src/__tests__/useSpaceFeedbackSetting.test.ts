import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@octo/base/src/App", () => ({
  default: {
    shared: {
      currentSpaceId: "space-a",
    },
  },
}));

vi.mock("@octo/base/src/Service/SpaceSettingService", () => ({
  getSpaceSetting: vi.fn(),
  updateSpaceSetting: vi.fn(),
}));

vi.mock("@octo/base/src/Service/VoiceFeedback", () => ({
  default: { shared: () => null, init: vi.fn() },
}));

const mockGetConfig = vi.fn();
vi.mock("@octo/base/src/Service/VoiceService", () => ({
  default: { shared: { getConfig: () => mockGetConfig() } },
}));

import WKApp from "@octo/base/src/App";
import { getSpaceSetting } from "@octo/base/src/Service/SpaceSettingService";
import {
  ensureVoiceFeedbackLoaded,
  fetchAndApplySpaceSetting,
  getSharedSpaceFeedbackState,
  resetSharedSpaceSetting,
  setSharedSpaceSetting,
} from "@octo/base/src/Components/MessageInput/useSpaceFeedbackSetting";

const mockGetSpaceSetting = vi.mocked(getSpaceSetting);

describe("useSpaceFeedbackSetting - spaceId isolation", () => {
  beforeEach(() => {
    resetSharedSpaceSetting();
    vi.clearAllMocks();
    (WKApp.shared as any).currentSpaceId = "space-a";
  });

  it("should store loadedSpaceId when setting is applied", () => {
    setSharedSpaceSetting({ voice_feedback_on: 1, voice_feedback_notice_acked: 0 }, true, "space-a");
    const state = getSharedSpaceFeedbackState();
    expect(state.loadedSpaceId).toBe("space-a");
  });

  it("should clear loadedSpaceId on reset", () => {
    setSharedSpaceSetting({ voice_feedback_on: 1, voice_feedback_notice_acked: 0 }, true, "space-a");
    resetSharedSpaceSetting();
    const state = getSharedSpaceFeedbackState();
    expect(state.loadedSpaceId).toBeNull();
  });

  it("should re-fetch when switching to a different space", async () => {
    const settingA = { voice_feedback_on: 1, voice_feedback_notice_acked: 0 };
    const settingB = { voice_feedback_on: 0, voice_feedback_notice_acked: 0 };

    mockGetConfig.mockResolvedValue({ feedback_url: "https://feedback.test" });
    mockGetSpaceSetting.mockResolvedValueOnce(settingA);

    (WKApp.shared as any).currentSpaceId = "space-a";
    await ensureVoiceFeedbackLoaded();

    let state = getSharedSpaceFeedbackState();
    expect(state.loadedSpaceId).toBe("space-a");
    expect(state.spaceSetting?.voice_feedback_on).toBe(1);

    mockGetSpaceSetting.mockResolvedValueOnce(settingB);
    (WKApp.shared as any).currentSpaceId = "space-b";
    await ensureVoiceFeedbackLoaded();

    state = getSharedSpaceFeedbackState();
    expect(state.loadedSpaceId).toBe("space-b");
    expect(state.spaceSetting?.voice_feedback_on).toBe(0);
    expect(mockGetSpaceSetting).toHaveBeenCalledTimes(2);
  });

  it("should NOT re-fetch when same space is already loaded", async () => {
    mockGetConfig.mockResolvedValue({ feedback_url: "https://feedback.test" });
    mockGetSpaceSetting.mockResolvedValueOnce({ voice_feedback_on: 1, voice_feedback_notice_acked: 0 });

    (WKApp.shared as any).currentSpaceId = "space-a";
    await ensureVoiceFeedbackLoaded();
    await ensureVoiceFeedbackLoaded();

    expect(mockGetSpaceSetting).toHaveBeenCalledTimes(1);
  });

  it("should discard stale response when space changes during fetch", async () => {
    let resolveA: (value: any) => void;
    const delayedPromise = new Promise<any>((resolve) => {
      resolveA = resolve;
    });
    mockGetSpaceSetting.mockReturnValueOnce(delayedPromise);

    const promise = fetchAndApplySpaceSetting("space-a", "https://feedback.test");

    (WKApp.shared as any).currentSpaceId = "space-b";

    resolveA!({ voice_feedback_on: 1, voice_feedback_notice_acked: 0 });
    await promise;

    const state = getSharedSpaceFeedbackState();
    expect(state.loadedSpaceId).not.toBe("space-a");
  });

  it("voiceFeedbackOn should be false when voice_feedback_on=1 but notice_acked=0 (race condition guard)", async () => {
    mockGetConfig.mockResolvedValue({ feedback_url: "https://feedback.test" });
    mockGetSpaceSetting.mockResolvedValueOnce({ voice_feedback_on: 1, voice_feedback_notice_acked: 0 });

    (WKApp.shared as any).currentSpaceId = "space-a";
    await ensureVoiceFeedbackLoaded();

    const state = getSharedSpaceFeedbackState();
    expect(state.spaceSetting?.voice_feedback_on).toBe(1);
    expect(state.spaceSetting?.voice_feedback_notice_acked).toBe(0);

    const allowFeedback =
      (state.spaceSetting?.voice_feedback_on === 1 && state.spaceSetting?.voice_feedback_notice_acked === 1) ? 1 : 0;
    expect(allowFeedback).toBe(0);
  });

  it("voiceFeedbackOn should be true when both voice_feedback_on=1 and notice_acked=1", async () => {
    mockGetConfig.mockResolvedValue({ feedback_url: "https://feedback.test" });
    mockGetSpaceSetting.mockResolvedValueOnce({ voice_feedback_on: 1, voice_feedback_notice_acked: 1 });

    (WKApp.shared as any).currentSpaceId = "space-c";
    await ensureVoiceFeedbackLoaded();

    const state = getSharedSpaceFeedbackState();
    const allowFeedback =
      (state.spaceSetting?.voice_feedback_on === 1 && state.spaceSetting?.voice_feedback_notice_acked === 1) ? 1 : 0;
    expect(allowFeedback).toBe(1);
  });
});

describe("ensureVoiceFeedbackLoaded - inflight promise deduplication", () => {
  beforeEach(() => {
    resetSharedSpaceSetting();
    vi.clearAllMocks();
    (WKApp.shared as any).currentSpaceId = "space-dedup";
  });

  it("should return the same promise for concurrent calls with same spaceId", async () => {
    let resolveConfig: (value: any) => void;
    const configDeferred = new Promise<any>((resolve) => {
      resolveConfig = resolve;
    });
    mockGetConfig.mockReturnValue(configDeferred);
    mockGetSpaceSetting.mockResolvedValue({ voice_feedback_on: 0, voice_feedback_notice_acked: 0 });

    const p1 = ensureVoiceFeedbackLoaded();
    const p2 = ensureVoiceFeedbackLoaded();

    expect(p1).toBe(p2);

    resolveConfig!({ feedback_url: "https://feedback.test" });
    await p1;
    await p2;

    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("should allow new call after previous completes", async () => {
    mockGetConfig.mockResolvedValue({ feedback_url: "https://feedback.test" });
    mockGetSpaceSetting.mockResolvedValue({ voice_feedback_on: 0, voice_feedback_notice_acked: 0 });

    await ensureVoiceFeedbackLoaded();

    (WKApp.shared as any).currentSpaceId = "space-dedup-2";
    mockGetSpaceSetting.mockResolvedValue({ voice_feedback_on: 1, voice_feedback_notice_acked: 1 });

    await ensureVoiceFeedbackLoaded();

    const state = getSharedSpaceFeedbackState();
    expect(state.loadedSpaceId).toBe("space-dedup-2");
  });
});
