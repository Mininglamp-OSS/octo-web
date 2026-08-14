/**
 * @vitest-environment jsdom
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

const mockGetSpaceSetting = vi.fn();
const mockUpdateSpaceSetting = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../Service/SpaceSettingService", () => ({
  getSpaceSetting: (...args: any[]) => mockGetSpaceSetting(...args),
  updateSpaceSetting: (...args: any[]) => mockUpdateSpaceSetting(...args),
}));

const mockVoiceFeedbackShared = vi.fn();
const mockVoiceFeedbackInit = vi.fn();

vi.mock("../../../Service/VoiceFeedback", () => ({
  default: {
    shared: () => mockVoiceFeedbackShared(),
    init: (...args: any[]) => mockVoiceFeedbackInit(...args),
  },
}));

vi.mock("../../../Service/VoiceService", () => ({
  default: {
    shared: { getConfig: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("../../../App", () => ({
  default: {
    shared: { currentSpaceId: "space-1" },
    mittBus: { on: vi.fn(), off: vi.fn() },
  },
}));

import {
  acceptVoiceInput,
  enableVoiceInput,
  disableVoiceInput,
  setSharedSpaceSetting,
  setSharedVoiceConfig,
  getSharedSpaceFeedbackState,
  fetchAndApplySpaceSetting,
  ensureVoiceFeedbackLoaded,
  resetSharedSpaceSetting,
  toggleVoiceFeedback,
} from "../useSpaceFeedbackSetting";

describe("useSpaceFeedbackSetting helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSharedSpaceSetting();
    setSharedSpaceSetting(
      {
        voice_input_enabled: 0,
        voice_feedback_on: 0,
        voice_feedback_notice_acked: 0,
      },
      true,
      "space-1"
    );
    setSharedVoiceConfig({
      feedback_url: "https://fb.test",
      feedback_privacy_url: "",
      feedback_user_agreement_url: "",
    } as any);
  });

  it("does not apply a response after its space becomes inactive", async () => {
    mockGetSpaceSetting.mockResolvedValue({
      voice_input_enabled: 1,
      voice_feedback_on: 1,
      voice_feedback_notice_acked: 1,
    });

    await fetchAndApplySpaceSetting("space-2", "https://fb.test", () => false);

    expect(getSharedSpaceFeedbackState().loadedSpaceId).toBe("space-1");
    expect(mockVoiceFeedbackInit).not.toHaveBeenCalled();
  });

  it("does not enable feedback before the notice is acknowledged", async () => {
    mockGetSpaceSetting.mockResolvedValue({
      voice_input_enabled: 1,
      voice_feedback_on: 1,
      voice_feedback_notice_acked: 0,
    });

    await fetchAndApplySpaceSetting("space-1", "https://fb.test", () => true);

    expect(mockVoiceFeedbackInit).not.toHaveBeenCalled();
  });

  it("does not enable a manual feedback toggle before acknowledgement", async () => {
    const enable = vi.fn();
    const disable = vi.fn();
    mockVoiceFeedbackShared.mockReturnValue({ enable, disable });
    setSharedSpaceSetting(
      {
        voice_input_enabled: 1,
        voice_feedback_on: 0,
        voice_feedback_notice_acked: 0,
      },
      true,
      "space-1"
    );

    await toggleVoiceFeedback("space-1", 1, "https://fb.test");

    expect(enable).not.toHaveBeenCalled();
    expect(mockVoiceFeedbackInit).not.toHaveBeenCalled();
    expect(disable).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent loads while the existing space request is active", async () => {
    resetSharedSpaceSetting();
    let resolveSetting!: (value: any) => void;
    mockGetSpaceSetting.mockReturnValue(
      new Promise((resolve) => {
        resolveSetting = resolve;
      })
    );
    const isSpaceActive = () => true;

    const first = ensureVoiceFeedbackLoaded("space-1", isSpaceActive);
    const second = ensureVoiceFeedbackLoaded("space-1", isSpaceActive);

    expect(first).toBe(second);
    await Promise.resolve();
    expect(mockGetSpaceSetting).toHaveBeenCalledOnce();

    resolveSetting({
      voice_input_enabled: 1,
      voice_feedback_on: 0,
      voice_feedback_notice_acked: 1,
    });
    await first;
  });

  it("starts a fresh request when navigation returns to an inflight space", async () => {
    resetSharedSpaceSetting();
    const resolvers: Array<(value: any) => void> = [];
    mockGetSpaceSetting.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve))
    );
    let activeSpace = "space-a";
    let generation = 1;

    const firstA = ensureVoiceFeedbackLoaded(
      "space-a",
      () => activeSpace === "space-a" && generation === 1
    );
    await Promise.resolve();
    await Promise.resolve();

    activeSpace = "space-b";
    generation = 2;
    const b = ensureVoiceFeedbackLoaded(
      "space-b",
      () => activeSpace === "space-b" && generation === 2
    );
    await Promise.resolve();

    activeSpace = "space-a";
    generation = 3;
    const latestA = ensureVoiceFeedbackLoaded(
      "space-a",
      () => activeSpace === "space-a" && generation === 3
    );
    await Promise.resolve();

    expect(mockGetSpaceSetting).toHaveBeenCalledTimes(3);
    resolvers[2]({
      voice_input_enabled: 1,
      voice_feedback_on: 0,
      voice_feedback_notice_acked: 1,
    });
    await latestA;
    expect(getSharedSpaceFeedbackState().loadedSpaceId).toBe("space-a");

    resolvers[0]({
      voice_input_enabled: 0,
      voice_feedback_on: 0,
      voice_feedback_notice_acked: 0,
    });
    resolvers[1]({
      voice_input_enabled: 0,
      voice_feedback_on: 0,
      voice_feedback_notice_acked: 0,
    });
    await Promise.all([firstA, b]);
    expect(
      getSharedSpaceFeedbackState().spaceSetting?.voice_input_enabled
    ).toBe(1);
  });

  describe("acceptVoiceInput", () => {
    it("sets voice_feedback_notice_acked: 1 alongside voice_input_enabled: 1", async () => {
      await acceptVoiceInput("space-1", false, () => true);
      expect(mockUpdateSpaceSetting).toHaveBeenCalledWith("space-1", {
        voice_input_enabled: 1,
        voice_feedback_notice_acked: 1,
        voice_feedback_on: 0,
      });
      const state = getSharedSpaceFeedbackState();
      expect(state.spaceSetting?.voice_feedback_notice_acked).toBe(1);
      expect(state.spaceSetting?.voice_input_enabled).toBe(1);
    });

    it("sets voice_feedback_on: 1 when feedbackOn is true", async () => {
      mockVoiceFeedbackShared.mockReturnValue({ enable: vi.fn() });
      await acceptVoiceInput("space-1", true, () => true);
      expect(mockUpdateSpaceSetting).toHaveBeenCalledWith("space-1", {
        voice_input_enabled: 1,
        voice_feedback_notice_acked: 1,
        voice_feedback_on: 1,
      });
      const state = getSharedSpaceFeedbackState();
      expect(state.spaceSetting?.voice_feedback_on).toBe(1);
    });

    it("initializes VoiceFeedback when feedbackOn is true and no shared instance", async () => {
      mockVoiceFeedbackShared.mockReturnValue(null);
      await acceptVoiceInput("space-1", true, () => true);
      expect(mockVoiceFeedbackInit).toHaveBeenCalledWith("https://fb.test");
    });

    it("does not apply feedback side effects after its space becomes inactive", async () => {
      mockVoiceFeedbackShared.mockReturnValue(null);

      await acceptVoiceInput("space-1", true, () => false);

      expect(
        getSharedSpaceFeedbackState().spaceSetting?.voice_input_enabled
      ).toBe(0);
      expect(mockVoiceFeedbackInit).not.toHaveBeenCalled();
    });
  });

  describe("enableVoiceInput", () => {
    it("sets only voice_input_enabled: 1", async () => {
      await enableVoiceInput("space-1");
      expect(mockUpdateSpaceSetting).toHaveBeenCalledWith("space-1", {
        voice_input_enabled: 1,
      });
      const state = getSharedSpaceFeedbackState();
      expect(state.spaceSetting?.voice_input_enabled).toBe(1);
    });

    it("does not touch voice_feedback_notice_acked or voice_feedback_on", async () => {
      await enableVoiceInput("space-1");
      const state = getSharedSpaceFeedbackState();
      expect(state.spaceSetting?.voice_feedback_notice_acked).toBe(0);
      expect(state.spaceSetting?.voice_feedback_on).toBe(0);
    });
  });

  describe("disableVoiceInput", () => {
    beforeEach(() => {
      setSharedSpaceSetting(
        {
          voice_input_enabled: 1,
          voice_feedback_on: 1,
          voice_feedback_notice_acked: 1,
        },
        true,
        "space-1"
      );
    });

    it("sets voice_input_enabled: 0 and voice_feedback_on: 0", async () => {
      mockVoiceFeedbackShared.mockReturnValue({ disable: vi.fn() });
      await disableVoiceInput("space-1");
      expect(mockUpdateSpaceSetting).toHaveBeenCalledWith("space-1", {
        voice_input_enabled: 0,
        voice_feedback_on: 0,
      });
      const state = getSharedSpaceFeedbackState();
      expect(state.spaceSetting?.voice_input_enabled).toBe(0);
      expect(state.spaceSetting?.voice_feedback_on).toBe(0);
    });

    it("does NOT reset voice_feedback_notice_acked", async () => {
      mockVoiceFeedbackShared.mockReturnValue({ disable: vi.fn() });
      await disableVoiceInput("space-1");
      const state = getSharedSpaceFeedbackState();
      expect(state.spaceSetting?.voice_feedback_notice_acked).toBe(1);
    });

    it("calls VoiceFeedback.shared()?.disable()", async () => {
      const mockDisable = vi.fn();
      mockVoiceFeedbackShared.mockReturnValue({ disable: mockDisable });
      await disableVoiceInput("space-1");
      expect(mockDisable).toHaveBeenCalled();
    });

    it("handles null VoiceFeedback.shared() gracefully", async () => {
      mockVoiceFeedbackShared.mockReturnValue(null);
      await expect(disableVoiceInput("space-1")).resolves.not.toThrow();
    });
  });
});
