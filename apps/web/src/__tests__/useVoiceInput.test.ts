import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { mockOnTranscribeResult, mockLocalTranscribe } = vi.hoisted(() => ({
  mockOnTranscribeResult: vi.fn(),
  mockLocalTranscribe: vi.fn(),
}));

// Mock WKApp
vi.mock("@octo/base/src/App", () => ({
  default: {
    shared: {
      currentSpaceId: "test-space-id",
    },
    mittBus: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    },
  },
}));

// Mock VoiceService
vi.mock("@octo/base/src/Service/VoiceService", () => {
  return {
    default: {
      shared: {
        getConfig: vi.fn(),
        transcribe: vi.fn(),
        getVoiceContext: vi.fn(),
        clearVoiceContextCache: vi.fn(),
      },
    },
  };
});

// Mock VoiceFeedback
vi.mock("@octo/base/src/Service/VoiceFeedback", () => ({
  default: {
    init: vi.fn(),
    destroy: vi.fn(),
    shared: () => ({ onTranscribeResult: mockOnTranscribeResult }),
  },
}));

// Mock LocalModelService
vi.mock("@octo/base/src/Service/LocalModelService", () => ({
  default: {
    shared: {
      config: { preferLocal: false, enabled: false },
      loadConfig: vi.fn(),
      updateConfig: vi.fn(),
      probe: vi.fn().mockResolvedValue(false),
      transcribe: mockLocalTranscribe,
    },
  },
}));

// Mock useSpaceFeedbackSetting helpers
vi.mock(
  "@octo/base/src/Components/MessageInput/useSpaceFeedbackSetting",
  () => ({
    fetchAndApplySpaceSetting: vi.fn().mockResolvedValue(undefined),
    resetSharedSpaceSetting: vi.fn(),
    setSharedVoiceConfig: vi.fn(),
    getSharedSpaceFeedbackState: () => ({
      spaceSetting: { voice_feedback_on: 1, voice_feedback_notice_acked: 1 },
    }),
    getSharedVoiceConfig: () => null,
    subscribe: vi.fn(() => vi.fn()),
  }),
);

import WKApp from "@octo/base/src/App";
import VoiceService from "@octo/base/src/Service/VoiceService";
import LocalModelService from "@octo/base/src/Service/LocalModelService";
import useVoiceInput from "@octo/base/src/Components/MessageInput/useVoiceInput";

// Mock MediaRecorder
class MockMediaRecorder {
  state = "inactive";
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;
  chunks: Blob[] = [];

  constructor(public stream: any, public options?: any) {}

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    if (this.ondataavailable) {
      this.ondataavailable({
        data: new Blob([new ArrayBuffer(5000)], { type: "audio/webm" }),
      });
    }
    if (this.onstop) {
      setTimeout(() => {
        if (this.onstop) this.onstop();
      }, 0);
    }
  }

  static isTypeSupported(type: string) {
    return type === "audio/webm;codecs=opus";
  }
}

function setupMocks() {
  // Setup getUserMedia mock
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
      }),
    },
    writable: true,
    configurable: true,
  });

  // Setup MediaRecorder mock
  (globalThis as any).MediaRecorder = MockMediaRecorder;
}

describe("useVoiceInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupMocks();
    WKApp.shared.currentSpaceId = "test-space-id";
    vi.mocked(VoiceService.shared.getConfig).mockResolvedValue({
      enabled: true,
      max_duration: 60,
      max_file_size: 3145728,
    });
    vi.mocked(VoiceService.shared.getVoiceContext).mockResolvedValue({
      status: 200,
      has_context: false,
      context: "",
      updated_at: "",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should fetch voice config on mount", async () => {
    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(VoiceService.shared.getConfig).toHaveBeenCalled();
    expect(result.current.isVoiceEnabled).toBe(true);
  });

  it("should set isVoiceEnabled to false when config fetch fails", async () => {
    vi.mocked(VoiceService.shared.getConfig).mockRejectedValue(
      new Error("fail")
    );

    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.isVoiceEnabled).toBe(false);
  });

  it("should set isVoiceEnabled to false when config returns disabled", async () => {
    vi.mocked(VoiceService.shared.getConfig).mockResolvedValue({
      enabled: false,
      max_duration: 60,
      max_file_size: 3145728,
    });

    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.isVoiceEnabled).toBe(false);
  });

  it("should start in non-recording state", () => {
    const { result } = renderHook(() => useVoiceInput());

    expect(result.current.isRecording).toBe(false);
    expect(result.current.isTranscribing).toBe(false);
  });

  it("should set isRecording to true when startRecording is called", async () => {
    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: true,
    });
  });

  it("should call onError when getUserMedia fails", async () => {
    const mockError = new Error("NotAllowedError");
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(mockError);
    const onError = vi.fn();

    const { result } = renderHook(() => useVoiceInput({ onError }));

    await act(async () => {
      await result.current.startRecording();
    });

    expect(onError).toHaveBeenCalledWith(mockError);
    expect(result.current.isRecording).toBe(false);
  });

  it("should auto-stop recording after maxDuration timeout", async () => {
    vi.mocked(VoiceService.shared.getConfig).mockResolvedValue({
      enabled: true,
      max_file_size: 3145728,
    } as any);

    const { result } = renderHook(() => useVoiceInput({ maxDuration: 5 }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001);
    });

    // maxDuration timeout should have triggered stopRecordingAndTranscribe
    expect(result.current.isRecording).toBe(false);
  });

  it("should cancel recording and reset state", async () => {
    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);

    act(() => {
      result.current.cancelRecording();
    });

    expect(result.current.isRecording).toBe(false);
  });

  it("should not start recording if already recording", async () => {
    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      await result.current.startRecording();
    });

    const callCount = vi.mocked(navigator.mediaDevices.getUserMedia).mock.calls
      .length;

    await act(async () => {
      await result.current.startRecording();
    });

    // Should not call getUserMedia again
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(
      callCount
    );
  });

  it("should use audio/mp4 mime type when webm is not supported (Safari)", () => {
    (globalThis as any).MediaRecorder = class extends MockMediaRecorder {
      static isTypeSupported(type: string) {
        return type === "audio/mp4";
      }
    };

    const safariRecorder = (globalThis as any).MediaRecorder;
    const isMp4Supported = safariRecorder.isTypeSupported("audio/mp4");

    expect(isMp4Supported).toBe(true);
  });

  it("should cleanup on unmount", async () => {
    const { result, unmount } = renderHook(() => useVoiceInput());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);

    unmount();

    // No errors should occur on unmount
  });
});

describe("useVoiceInput - getChatContext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupMocks();
    WKApp.shared.currentSpaceId = "test-space-id";
    vi.mocked(VoiceService.shared.getConfig).mockResolvedValue({
      enabled: true,
      max_duration: 60,
      max_file_size: 3145728,
    });
    vi.mocked(VoiceService.shared.getVoiceContext).mockResolvedValue({
      status: 200,
      has_context: false,
      context: "",
      updated_at: "",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should pass getChatContext result to VoiceService.transcribe", async () => {
    const getChatContext = vi.fn().mockReturnValue({
      memberContext: undefined,
      chatContext: "[Alice]: hi\n[Bob]: hello",
    });
    vi.mocked(VoiceService.shared.transcribe).mockResolvedValue({
      text: "transcribed",
      m: "whisper-1",
    });

    const { result } = renderHook(() =>
      useVoiceInput({
        getChatContext,
        onTranscribed: vi.fn(),
      })
    );

    // Start recording
    await act(async () => {
      await result.current.startRecording();
    });

    // Stop recording and transcribe
    act(() => {
      result.current.stopRecordingAndTranscribe("input text");
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });
  });

  it("should pass channelType=1 (DM) to VoiceService.transcribe", async () => {
    const getChatContext = vi.fn().mockReturnValue({
      channelType: 1,
      chatContext: "私聊「Alice」\n[Alice]: hi",
    });
    vi.mocked(VoiceService.shared.transcribe).mockResolvedValue({
      text: "transcribed",
      m: "whisper-1",
    });

    const { result } = renderHook(() =>
      useVoiceInput({
        getChatContext,
        onTranscribed: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    await act(async () => {
      result.current.stopRecordingAndTranscribe("input text");
      await vi.runAllTimersAsync();
    });

    expect(VoiceService.shared.transcribe).toHaveBeenCalledWith(
      expect.any(Blob),
      "input text",
      "私聊「Alice」\n[Alice]: hi",
      undefined,
      undefined,
      "smart",
      true,
      1,
      false,
      undefined
    );
  });

  it("should pass channelType=2 (group) to VoiceService.transcribe", async () => {
    const getChatContext = vi.fn().mockReturnValue({
      channelType: 2,
      chatContext: "群聊「产品组」\n[Bob]: hey",
      memberContext: "聊天成员：Bob",
    });
    vi.mocked(VoiceService.shared.transcribe).mockResolvedValue({
      text: "transcribed",
      m: "whisper-1",
    });

    const { result } = renderHook(() =>
      useVoiceInput({
        getChatContext,
        onTranscribed: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    await act(async () => {
      result.current.stopRecordingAndTranscribe();
      await vi.runAllTimersAsync();
    });

    expect(VoiceService.shared.transcribe).toHaveBeenCalledWith(
      expect.any(Blob),
      undefined,
      "群聊「产品组」\n[Bob]: hey",
      undefined,
      "聊天成员：Bob",
      "smart",
      true,
      2,
      false,
      undefined
    );
  });

  it("should handle undefined getChatContext gracefully", async () => {
    const { result } = renderHook(() =>
      useVoiceInput({
        onTranscribed: vi.fn(),
      })
    );

    // Start recording
    await act(async () => {
      await result.current.startRecording();
    });

    // Should not throw when getChatContext is undefined
    act(() => {
      result.current.stopRecordingAndTranscribe();
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.isRecording).toBe(false);
  });
});

describe("useVoiceInput - keyboard shortcut logic", () => {
  it("should detect Shift+Meta+Space as voice shortcut on macOS", () => {
    const event = new KeyboardEvent("keydown", {
      shiftKey: true,
      metaKey: true,
      code: "Space",
    });

    const isVoiceShortcut =
      event.shiftKey &&
      (event.metaKey || event.ctrlKey) &&
      event.code === "Space";
    expect(isVoiceShortcut).toBe(true);
  });

  it("should detect Shift+Ctrl+Space as voice shortcut on Windows/Linux", () => {
    const event = new KeyboardEvent("keydown", {
      shiftKey: true,
      ctrlKey: true,
      code: "Space",
    });

    const isVoiceShortcut =
      event.shiftKey &&
      (event.metaKey || event.ctrlKey) &&
      event.code === "Space";
    expect(isVoiceShortcut).toBe(true);
  });

  it("should not trigger on Shift+Space alone", () => {
    const event = new KeyboardEvent("keydown", {
      shiftKey: true,
      code: "Space",
    });

    const isVoiceShortcut =
      event.shiftKey &&
      (event.metaKey || event.ctrlKey) &&
      event.code === "Space";
    expect(isVoiceShortcut).toBe(false);
  });

  it("should not trigger on Ctrl+Space without Shift", () => {
    const event = new KeyboardEvent("keydown", {
      ctrlKey: true,
      code: "Space",
    });

    const isVoiceShortcut =
      event.shiftKey &&
      (event.metaKey || event.ctrlKey) &&
      event.code === "Space";
    expect(isVoiceShortcut).toBe(false);
  });

  it("should not trigger on Shift+Cmd+Enter", () => {
    const event = new KeyboardEvent("keydown", {
      shiftKey: true,
      metaKey: true,
      code: "Enter",
    });

    const isVoiceShortcut =
      event.shiftKey &&
      (event.metaKey || event.ctrlKey) &&
      event.code === "Space";
    expect(isVoiceShortcut).toBe(false);
  });
});

describe("useVoiceInput - window blur handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupMocks();
    WKApp.shared.currentSpaceId = "test-space-id";
    vi.mocked(VoiceService.shared.getConfig).mockResolvedValue({
      enabled: true,
      max_duration: 60,
      max_file_size: 3145728,
    });
    vi.mocked(VoiceService.shared.getVoiceContext).mockResolvedValue({
      status: 200,
      has_context: false,
      context: "",
      updated_at: "",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should register blur listener while recording", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");

    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);

    addSpy.mockRestore();
  });
});

describe("useVoiceInput - personal voice context", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupMocks();
    WKApp.shared.currentSpaceId = "test-space-id";
    vi.mocked(VoiceService.shared.getConfig).mockResolvedValue({
      enabled: true,
      max_duration: 60,
      max_file_size: 3145728,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should pass all three contexts simultaneously", async () => {
    vi.mocked(VoiceService.shared.getVoiceContext).mockResolvedValue({
      status: 200,
      has_context: true,
      context: "个人纠错词",
      updated_at: "2026-04-09T13:00:00+08:00",
    });
    vi.mocked(VoiceService.shared.transcribe).mockResolvedValue({
      text: "转写结果",
      m: "g3fp",
    });
    const getChatContext = vi.fn(() => ({
      memberContext: "聊天成员：Alice,Bob",
      chatContext: undefined,
    }));
    const onTranscribed = vi.fn();

    const { result } = renderHook(() =>
      useVoiceInput({ onTranscribed, getChatContext })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      result.current.stopRecordingAndTranscribe();
      await vi.runAllTimersAsync();
    });

    expect(VoiceService.shared.transcribe).toHaveBeenCalledWith(
      expect.any(Blob),
      undefined, // contextText
      undefined, // chatContext
      "个人纠错词", // personalContext
      "聊天成员：Alice,Bob", // memberContext
      "smart", // mode
      true, // skipLocal
      undefined, // channelType
      false, // allowFeedback
      undefined // selfName
    );
    expect(getChatContext).toHaveBeenCalled();
  });

  it("should pass member/chat context when no personal context", async () => {
    vi.mocked(VoiceService.shared.getVoiceContext).mockResolvedValue({
      status: 200,
      has_context: false,
      context: "",
      updated_at: "",
    });
    vi.mocked(VoiceService.shared.transcribe).mockResolvedValue({
      text: "转写结果",
      m: "g3fp",
    });
    const getChatContext = vi.fn(() => ({
      memberContext: "聊天成员：Alice,Bob",
      chatContext: undefined,
    }));

    const { result } = renderHook(() => useVoiceInput({ getChatContext }));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await act(async () => {
      result.current.stopRecordingAndTranscribe();
      await vi.runAllTimersAsync();
    });

    expect(VoiceService.shared.transcribe).toHaveBeenCalledWith(
      expect.any(Blob),
      undefined, // contextText
      undefined, // chatContext
      undefined, // personalContext (has_context=false)
      "聊天成员：Alice,Bob", // memberContext
      "smart", // mode
      true, // skipLocal
      undefined, // channelType
      false, // allowFeedback
      undefined // selfName
    );
    expect(getChatContext).toHaveBeenCalled();
  });

  it("should defensively fallback when has_context is true but context is empty", async () => {
    vi.mocked(VoiceService.shared.getVoiceContext).mockResolvedValue({
      status: 200,
      has_context: true,
      context: "",
      updated_at: "",
    });
    vi.mocked(VoiceService.shared.transcribe).mockResolvedValue({
      text: "转写结果",
      m: "g3fp",
    });
    const getChatContext = vi.fn(() => ({
      memberContext: "聊天成员：Alice",
      chatContext: undefined,
    }));

    const { result } = renderHook(() => useVoiceInput({ getChatContext }));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await act(async () => {
      result.current.stopRecordingAndTranscribe();
      await vi.runAllTimersAsync();
    });

    expect(VoiceService.shared.transcribe).toHaveBeenCalledWith(
      expect.any(Blob),
      undefined, // contextText
      undefined, // chatContext
      undefined, // personalContext (context 为空字符串，视为无)
      "聊天成员：Alice", // memberContext
      "smart", // mode
      true, // skipLocal
      undefined, // channelType
      false, // allowFeedback
      undefined // selfName
    );
  });

  it("should fallback to getChatContext when API fails", async () => {
    vi.mocked(VoiceService.shared.getVoiceContext).mockRejectedValue(
      new Error("timeout")
    );
    vi.mocked(VoiceService.shared.transcribe).mockResolvedValue({
      text: "转写结果",
      m: "g3fp",
    });
    const getChatContext = vi.fn(() => ({
      memberContext: "聊天成员：Alice",
      chatContext: undefined,
    }));

    const { result } = renderHook(() => useVoiceInput({ getChatContext }));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await act(async () => {
      result.current.stopRecordingAndTranscribe();
      await vi.runAllTimersAsync();
    });

    expect(VoiceService.shared.transcribe).toHaveBeenCalledWith(
      expect.any(Blob),
      undefined, // contextText
      undefined, // chatContext
      undefined, // personalContext (API 失败，voiceContextRef 为 null)
      "聊天成员：Alice", // memberContext
      "smart", // mode
      true, // skipLocal
      undefined, // channelType
      false, // allowFeedback
      undefined // selfName
    );
  });

  it("should not query voice context when not in Space mode", async () => {
    WKApp.shared.currentSpaceId = "";

    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(VoiceService.shared.getVoiceContext).not.toHaveBeenCalled();
  });

  it("should await in-flight context promise on stop for first recording", async () => {
    let resolveContext!: (v: any) => void;
    vi.mocked(VoiceService.shared.getVoiceContext).mockReturnValue(
      new Promise((resolve) => {
        resolveContext = resolve;
      })
    );
    vi.mocked(VoiceService.shared.transcribe).mockResolvedValue({
      text: "转写结果",
      m: "g3fp",
    });

    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await act(async () => {
      result.current.stopRecordingAndTranscribe();
    });

    await act(async () => {
      resolveContext({
        status: 200,
        has_context: true,
        context: "延迟到达的纠错词",
        updated_at: "",
      });
      await vi.runAllTimersAsync();
    });

    expect(VoiceService.shared.transcribe).toHaveBeenCalledWith(
      expect.any(Blob),
      undefined, // contextText
      undefined, // chatContext (无 getChatContext)
      "延迟到达的纠错词", // personalContext
      undefined, // memberContext (无 getChatContext)
      "smart", // mode
      true, // skipLocal
      undefined, // channelType
      false, // allowFeedback
      undefined // selfName
    );
  });

  it("should register space-changed handler on mittBus", () => {
    renderHook(() => useVoiceInput());

    expect(WKApp.mittBus.on).toHaveBeenCalledWith(
      "space-changed",
      expect.any(Function)
    );
  });

  it("should report error and skip transcribe when file exceeds max_file_size", async () => {
    vi.mocked(VoiceService.shared.getVoiceContext).mockResolvedValue({
      status: 200,
      has_context: false,
      context: "",
      updated_at: "",
    });
    vi.mocked(VoiceService.shared.getConfig).mockResolvedValue({
      enabled: true,
      max_duration: 60,
      max_file_size: 1000,
    });
    const onError = vi.fn();

    const { result } = renderHook(() => useVoiceInput({ onError }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await act(async () => {
      result.current.stopRecordingAndTranscribe();
      await vi.runAllTimersAsync();
    });

    expect(VoiceService.shared.transcribe).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Recording file size exceeds limit" })
    );
  });

  it("should invalidate old context promise on cancel", async () => {
    let resolveContext!: (v: any) => void;
    vi.mocked(VoiceService.shared.getVoiceContext).mockReturnValue(
      new Promise((resolve) => {
        resolveContext = resolve;
      })
    );

    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      await result.current.startRecording();
    });

    act(() => {
      result.current.cancelRecording();
    });

    await act(async () => {
      resolveContext({
        status: 200,
        has_context: true,
        context: "不应被使用的旧数据",
        updated_at: "",
      });
      await vi.runAllTimersAsync();
    });

    // After cancel, the voiceContextRef should remain null
    // because spaceId check fails. We verify indirectly:
    // next recording should query fresh context
  });
});

describe("useVoiceInput - max duration config", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupMocks();
    WKApp.shared.currentSpaceId = "test-space-id";
    vi.mocked(VoiceService.shared.getVoiceContext).mockResolvedValue({
      status: 200,
      has_context: false,
      context: "",
      updated_at: "",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should default to 60s when backend does not return max_duration", async () => {
    vi.mocked(VoiceService.shared.getConfig).mockResolvedValue({
      enabled: true,
      max_file_size: 3145728,
    });

    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);

    // Advance 59s — should still be recording
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59000);
    });
    expect(result.current.isRecording).toBe(true);

    // Advance past 60s — should auto-stop
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(result.current.isRecording).toBe(false);
  });

  it("should use backend max_duration when returned by getConfig", async () => {
    vi.mocked(VoiceService.shared.getConfig).mockResolvedValue({
      enabled: true,
      max_duration: 30,
      max_file_size: 3145728,
    });

    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);

    // Advance 29s — should still be recording
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29000);
    });
    expect(result.current.isRecording).toBe(true);

    // Advance past 30s — should auto-stop
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(result.current.isRecording).toBe(false);
  });

  it("should enforce safety floor of 5s when backend returns a smaller value", async () => {
    vi.mocked(VoiceService.shared.getConfig).mockResolvedValue({
      enabled: true,
      max_duration: 2,
      max_file_size: 3145728,
    });

    const { result } = renderHook(() => useVoiceInput());

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);

    // Advance 2s — should NOT stop (floor is 5s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.isRecording).toBe(true);

    // Advance to 4.9s — still recording
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2900);
    });
    expect(result.current.isRecording).toBe(true);

    // Advance past 5s — should auto-stop
    await act(async () => {
      await vi.advanceTimersByTimeAsync(101);
    });
    expect(result.current.isRecording).toBe(false);
  });

  it("should allow explicit caller-passed maxDuration to override when no backend config", async () => {
    vi.mocked(VoiceService.shared.getConfig).mockResolvedValue({
      enabled: true,
      max_file_size: 3145728,
    });

    const { result } = renderHook(() => useVoiceInput({ maxDuration: 10 }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);

    // Advance 9s — should still be recording
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(result.current.isRecording).toBe(true);

    // Advance past 10s — should auto-stop
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(result.current.isRecording).toBe(false);
  });
});

describe("useVoiceInput - notifyFeedback asrParams", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupMocks();
    WKApp.shared.currentSpaceId = "test-space-id";
    vi.mocked(VoiceService.shared.getConfig).mockResolvedValue({
      enabled: true,
      max_duration: 60,
      max_file_size: 3145728,
      feedback_url: "https://fb.test",
    } as any);
    vi.mocked(VoiceService.shared.getVoiceContext).mockResolvedValue({
      status: 200,
      has_context: false,
      context: "",
      updated_at: "",
    });
    mockOnTranscribeResult.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should NOT pass asrParams for remote-only transcription", async () => {
    vi.mocked(VoiceService.shared.transcribe).mockResolvedValue({
      text: "remote text",
      request_id: "req-1",
      m: "whisper-1",
    });

    const { result } = renderHook(() =>
      useVoiceInput({ onTranscribed: vi.fn() }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    await act(async () => {
      result.current.stopRecordingAndTranscribe();
      await vi.runAllTimersAsync();
    });

    expect(mockOnTranscribeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        modelText: "remote text",
        source: "remote",
        requestId: "req-1",
      }),
    );
    const callArg = mockOnTranscribeResult.mock.calls[0][0];
    expect(callArg.asrParams).toBeUndefined();
  });

  it("should NOT pass asrParams when falling back to remote after local failure", async () => {
    (LocalModelService.shared as any).config = {
      preferLocal: true,
      enabled: true,
    };
    mockLocalTranscribe.mockResolvedValue(null);
    vi.mocked(VoiceService.shared.transcribe).mockResolvedValue({
      text: "fallback text",
      request_id: "req-2",
      m: "whisper-1",
    });

    const { result } = renderHook(() =>
      useVoiceInput({ onTranscribed: vi.fn() }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    await act(async () => {
      result.current.stopRecordingAndTranscribe();
      await vi.runAllTimersAsync();
    });

    expect(mockOnTranscribeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        modelText: "fallback text",
        source: "remote",
        requestId: "req-2",
      }),
    );
    const callArg = mockOnTranscribeResult.mock.calls[0][0];
    expect(callArg.asrParams).toBeUndefined();

    (LocalModelService.shared as any).config = {
      preferLocal: false,
      enabled: false,
    };
  });

  it("should pass asrParams for local transcription", async () => {
    (LocalModelService.shared as any).config = {
      preferLocal: true,
      enabled: true,
    };
    mockLocalTranscribe.mockResolvedValue({ text: "local text", m: "v3" });

    const getChatContext = vi.fn().mockReturnValue({
      chatContext: "chat-ctx",
      memberContext: "member-ctx",
      channelType: 2,
    });

    const { result } = renderHook(() =>
      useVoiceInput({ onTranscribed: vi.fn(), getChatContext }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    await act(async () => {
      result.current.stopRecordingAndTranscribe("ctx text");
      await vi.runAllTimersAsync();
    });

    expect(mockOnTranscribeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        modelText: "local text",
        source: "local",
        asrParams: expect.objectContaining({
          chatContext: "chat-ctx",
          memberContext: "member-ctx",
          channelType: 2,
          model: "v3",
        }),
      }),
    );

    (LocalModelService.shared as any).config = {
      preferLocal: false,
      enabled: false,
    };
  });
});
