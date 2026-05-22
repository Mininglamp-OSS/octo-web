import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";

// Mock useVoiceInput hook
const mockUseVoiceInput = vi.fn();
vi.mock("@octo/base/src/Components/MessageInput/useVoiceInput", () => ({
  default: () => mockUseVoiceInput(),
}));

// Mock createPortal
vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom");
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock semi-ui and semi-icons
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
  Dropdown: Object.assign(
    (props: any) => props.children,
    {
      Menu: (props: any) => props.children,
      Item: (props: any) => props.children,
    }
  ),
}));
vi.mock("@douyinfe/semi-icons", () => ({}));

// Mock VoiceFeedbackNotice
vi.mock("@octo/base/src/Components/MessageInput/VoiceFeedbackNotice", () => ({
  default: (props: any) => {
    const React = require("react");
    return React.createElement("div", { className: "voice-feedback-notice" });
  },
}));

// Mock useSpaceFeedbackSetting
const mockSharedSpaceFeedbackState = {
  spaceSetting: null as { voice_feedback_on?: number; voice_feedback_notice_acked?: number } | null,
  loaded: false,
  apiAvailable: false,
};

const mockVoiceConfig = { current: null as { feedback_url?: string } | null };

vi.mock("@octo/base/src/Components/MessageInput/useSpaceFeedbackSetting", () => ({
  default: () => ({
    spaceSetting: mockSharedSpaceFeedbackState.spaceSetting,
    loaded: mockSharedSpaceFeedbackState.loaded,
    apiAvailable: mockSharedSpaceFeedbackState.apiAvailable,
    voiceConfig: mockVoiceConfig.current,
    updateSetting: vi.fn(),
  }),
  getSharedSpaceFeedbackState: () => mockSharedSpaceFeedbackState,
  getSharedVoiceConfig: () => mockVoiceConfig.current,
}));

import VoiceInputIndicator from "@octo/base/src/Components/MessageInput/VoiceInputIndicator";
import { Toast } from "@douyinfe/semi-ui";

// Reset shared feedback state before each test
beforeEach(() => {
  mockSharedSpaceFeedbackState.spaceSetting = null;
  mockSharedSpaceFeedbackState.loaded = false;
  mockSharedSpaceFeedbackState.apiAvailable = false;
  mockVoiceConfig.current = null;
});

// Default mock return value for useVoiceInput
function createMockHookReturn(overrides = {}) {
  return {
    isRecording: false,
    isTranscribing: false,
    startRecording: vi.fn(),
    stopRecordingAndTranscribe: vi.fn(),
    cancelRecording: vi.fn(),
    isVoiceEnabled: true,
    localAvailable: false,
    currentMode: "append_only",
    ...overrides,
  };
}

describe("VoiceInputIndicator - rendering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseVoiceInput.mockReturnValue(createMockHookReturn());
    // Mock navigator.onLine
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should render nothing when voice is disabled", () => {
    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({ isVoiceEnabled: false })
    );

    const { container } = render(
      <VoiceInputIndicator onTranscribed={vi.fn()} />
    );

    expect(container.firstChild).toBeNull();
  });

  it("should render microphone button when enabled and not recording", () => {
    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({ isVoiceEnabled: true })
    );

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    const button = document.querySelector(".wk-voice-button");
    expect(button).toBeTruthy();
  });

  it("should render recording state with floating indicator", () => {
    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({
        isVoiceEnabled: true,
        isRecording: true,
      })
    );

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    // Should show recording button
    const recordingButton = document.querySelector(
      ".wk-voice-button--recording"
    );
    expect(recordingButton).toBeTruthy();
  });

  it("should render transcribing state", () => {
    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({
        isVoiceEnabled: true,
        isTranscribing: true,
      })
    );

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    const recordingButton = document.querySelector(
      ".wk-voice-button--recording"
    );
    expect(recordingButton).toBeTruthy();
  });

  it("should render preparing state", async () => {
    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({ isVoiceEnabled: true })
    );

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    // Simulate ShiftLeft keydown
    await act(async () => {
      fireEvent.keyDown(window, {
        code: "ShiftLeft",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    // Advance time to show preparing state (300ms)
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    const preparingButton = document.querySelector(
      ".wk-voice-button--preparing"
    );
    expect(preparingButton).toBeTruthy();
  });
});

describe("VoiceInputIndicator - network status", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseVoiceInput.mockReturnValue(createMockHookReturn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should show disabled state when offline", () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });

    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({ isVoiceEnabled: true })
    );

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    const button = document.querySelector(".wk-voice-button--disabled");
    expect(button).toBeTruthy();
  });

  it("should show Toast when clicking while offline", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });

    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({ isVoiceEnabled: true })
    );

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    const button = document.querySelector(".wk-voice-button");
    await act(async () => {
      fireEvent.click(button!);
    });

    expect(Toast.warning).toHaveBeenCalledWith(
      "网络不可用，无法使用语音功能"
    );
  });

  it("should respond to online/offline events", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });

    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({ isVoiceEnabled: true })
    );

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    // Initially online - should not be disabled
    let button = document.querySelector(".wk-voice-button--disabled");
    expect(button).toBeNull();

    // Simulate going offline
    await act(async () => {
      Object.defineProperty(navigator, "onLine", {
        value: false,
        writable: true,
        configurable: true,
      });
      fireEvent(window, new Event("offline"));
    });

    button = document.querySelector(".wk-voice-button--disabled");
    expect(button).toBeTruthy();

    // Simulate going online
    await act(async () => {
      Object.defineProperty(navigator, "onLine", {
        value: true,
        writable: true,
        configurable: true,
      });
      fireEvent(window, new Event("online"));
    });

    button = document.querySelector(".wk-voice-button--disabled");
    expect(button).toBeNull();
  });
});

describe("VoiceInputIndicator - long-press ShiftLeft state machine", () => {
  let startRecording: ReturnType<typeof vi.fn>;
  let stopRecordingAndTranscribe: ReturnType<typeof vi.fn>;
  let cancelRecording: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    startRecording = vi.fn();
    stopRecordingAndTranscribe = vi.fn();
    cancelRecording = vi.fn();

    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });

    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({
        isVoiceEnabled: true,
        startRecording,
        stopRecordingAndTranscribe,
        cancelRecording,
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should NOT start recording if ShiftLeft released before 500ms", async () => {
    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    // Press ShiftLeft
    await act(async () => {
      fireEvent.keyDown(window, {
        code: "ShiftLeft",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    // Advance time to 400ms (before 500ms threshold)
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // Release ShiftLeft
    await act(async () => {
      fireEvent.keyUp(window, {
        code: "ShiftLeft",
        key: "Shift",
      });
    });

    // startRecording should not be called
    expect(startRecording).not.toHaveBeenCalled();
  });

  it("should start recording after holding ShiftLeft for 500ms", async () => {
    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    // Press ShiftLeft
    await act(async () => {
      fireEvent.keyDown(window, {
        code: "ShiftLeft",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    // Advance time to 500ms
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(startRecording).toHaveBeenCalled();
  });

  it("should cancel timer when another key is pressed during wait", async () => {
    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    // Press ShiftLeft
    await act(async () => {
      fireEvent.keyDown(window, {
        code: "ShiftLeft",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    // Press another key (like 'A' for uppercase typing)
    await act(async () => {
      fireEvent.keyDown(window, {
        code: "KeyA",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    // Advance time past 500ms
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    // startRecording should NOT be called (timer was cancelled)
    expect(startRecording).not.toHaveBeenCalled();
  });

  it("should cancel timer when Ctrl is pressed during ShiftLeft hold", async () => {
    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    // Press ShiftLeft
    await act(async () => {
      fireEvent.keyDown(window, {
        code: "ShiftLeft",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    // Press Ctrl (modifier chord)
    await act(async () => {
      fireEvent.keyDown(window, {
        code: "ControlLeft",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: true,
        altKey: false,
      });
    });

    // Advance time past 500ms
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(startRecording).not.toHaveBeenCalled();
  });

  it("should NOT cancel timer for IME events (key=Process)", async () => {
    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    // Press ShiftLeft
    await act(async () => {
      fireEvent.keyDown(window, {
        code: "ShiftLeft",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    // IME event
    await act(async () => {
      fireEvent.keyDown(window, {
        code: "KeyA",
        key: "Process",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    // Advance time to 500ms
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Should still start recording (IME events don't cancel timer)
    expect(startRecording).toHaveBeenCalled();
  });

  it("should NOT trigger on ShiftRight", async () => {
    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    // Press ShiftRight
    await act(async () => {
      fireEvent.keyDown(window, {
        code: "ShiftRight",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    // Advance time past 500ms
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(startRecording).not.toHaveBeenCalled();
  });

  it("should allow Shift+Cmd+Space shortcut", async () => {
    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    await act(async () => {
      fireEvent.keyDown(window, {
        code: "Space",
        shiftKey: true,
        metaKey: true,
        repeat: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    expect(startRecording).toHaveBeenCalled();
  });

  it("should cancel recording with Escape key", async () => {
    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({
        isVoiceEnabled: true,
        isRecording: true,
        startRecording,
        stopRecordingAndTranscribe,
        cancelRecording,
      })
    );

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    await act(async () => {
      fireEvent.keyDown(window, {
        code: "Escape",
      });
    });

    expect(cancelRecording).toHaveBeenCalled();
  });
});

describe("VoiceInputIndicator - cancelPending integration", () => {
  let startRecording: ReturnType<typeof vi.fn>;
  let cancelRecording: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    startRecording = vi.fn();
    cancelRecording = vi.fn();

    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should set cancelPending when Shift released while waiting for getUserMedia", async () => {
    // Mock that recording takes time to start (getUserMedia delay)
    let isRecording = false;

    mockUseVoiceInput.mockImplementation(() => ({
      isRecording,
      isTranscribing: false,
      startRecording: vi.fn(() => {
        // Simulate async getUserMedia - isRecording becomes true later
        setTimeout(() => {
          isRecording = true;
        }, 100);
      }),
      stopRecordingAndTranscribe: vi.fn(),
      cancelRecording,
      isVoiceEnabled: true,
    }));

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    // Press ShiftLeft
    await act(async () => {
      fireEvent.keyDown(window, {
        code: "ShiftLeft",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    // Advance time to trigger recording start (500ms)
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Release ShiftLeft before getUserMedia resolves
    await act(async () => {
      fireEvent.keyUp(window, {
        code: "ShiftLeft",
        key: "Shift",
      });
    });

    // The cancelPending flag should be set internally
    // This will cause recording to be cancelled when it actually starts
  });
});

describe("VoiceInputIndicator - click interactions", () => {
  let startRecording: ReturnType<typeof vi.fn>;
  let stopRecordingAndTranscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    startRecording = vi.fn();
    stopRecordingAndTranscribe = vi.fn();

    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });

    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({
        isVoiceEnabled: true,
        startRecording,
        stopRecordingAndTranscribe,
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should start recording on click", async () => {
    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    const button = document.querySelector(".wk-voice-button");
    await act(async () => {
      fireEvent.click(button!);
    });

    expect(startRecording).toHaveBeenCalled();
  });

  it("should stop recording on click when recording", async () => {
    const getCurrentText = vi.fn().mockReturnValue("test text");

    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({
        isVoiceEnabled: true,
        isRecording: true,
        startRecording,
        stopRecordingAndTranscribe,
      })
    );

    render(
      <VoiceInputIndicator
        onTranscribed={vi.fn()}
        getCurrentText={getCurrentText}
      />
    );

    const button = document.querySelector(".wk-voice-button--recording");
    await act(async () => {
      fireEvent.click(button!);
    });

    expect(stopRecordingAndTranscribe).toHaveBeenCalledWith("test text");
  });

  it("should support keyboard interaction (Enter/Space)", async () => {
    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    const button = document.querySelector(".wk-voice-button");

    await act(async () => {
      fireEvent.keyDown(button!, { key: "Enter" });
    });

    expect(startRecording).toHaveBeenCalled();
  });
});

describe("VoiceInputIndicator - floating indicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();

    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should render floating indicator with wave animation when recording", () => {
    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({
        isVoiceEnabled: true,
        isRecording: true,
      })
    );

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    const waveContainer = document.querySelector(".wk-voice-wave-container");
    expect(waveContainer).toBeTruthy();

    // Should have 16 wave bars
    const waveBars = document.querySelectorAll(".wk-voice-wave-bar");
    expect(waveBars.length).toBe(16);
  });

  it("should render floating indicator with spinner when transcribing", () => {
    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({
        isVoiceEnabled: true,
        isTranscribing: true,
      })
    );

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    const spinner = document.querySelector(".wk-voice-transcribing-spinner");
    expect(spinner).toBeTruthy();
  });

  it("should show 语音输入 text in floating indicator when recording", () => {
    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({
        isVoiceEnabled: true,
        isRecording: true,
      })
    );

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    const text = document.querySelector(".wk-voice-floating-text");
    expect(text?.textContent).toBe("语音输入");
  });

  it("should show 转写中 text in floating indicator when transcribing", () => {
    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({
        isVoiceEnabled: true,
        isTranscribing: true,
      })
    );

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    const text = document.querySelector(".wk-voice-floating-text");
    expect(text?.textContent).toBe("转写中");
  });
});

describe("VoiceInputIndicator - keyboard feedback notice", () => {
  let startRecording: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    startRecording = vi.fn();

    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });

    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({
        isVoiceEnabled: true,
        startRecording,
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("Shift+Cmd+Space should show feedback notice when voice_feedback_on=1 and notice_acked=0", async () => {
    mockSharedSpaceFeedbackState.spaceSetting = {
      voice_feedback_on: 1,
      voice_feedback_notice_acked: 0,
    };
    mockSharedSpaceFeedbackState.loaded = true;
    mockVoiceConfig.current = { feedback_url: "https://feedback.test" };

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    await act(async () => {
      fireEvent.keyDown(window, {
        code: "Space",
        shiftKey: true,
        metaKey: true,
        repeat: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    expect(startRecording).not.toHaveBeenCalled();
    const notice = document.querySelector(".voice-feedback-notice");
    expect(notice).toBeTruthy();
  });

  it("long-press ShiftLeft should show feedback notice when voice_feedback_on=1 and notice_acked=0", async () => {
    mockSharedSpaceFeedbackState.spaceSetting = {
      voice_feedback_on: 1,
      voice_feedback_notice_acked: 0,
    };
    mockSharedSpaceFeedbackState.loaded = true;
    mockVoiceConfig.current = { feedback_url: "https://feedback.test" };

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    await act(async () => {
      fireEvent.keyDown(window, {
        code: "ShiftLeft",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(startRecording).not.toHaveBeenCalled();
    const notice = document.querySelector(".voice-feedback-notice");
    expect(notice).toBeTruthy();
  });

  it("Shift+Cmd+Space should start recording normally when notice_acked=1", async () => {
    mockSharedSpaceFeedbackState.spaceSetting = {
      voice_feedback_on: 1,
      voice_feedback_notice_acked: 1,
    };
    mockSharedSpaceFeedbackState.loaded = true;
    mockVoiceConfig.current = { feedback_url: "https://feedback.test" };

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    await act(async () => {
      fireEvent.keyDown(window, {
        code: "Space",
        shiftKey: true,
        metaKey: true,
        repeat: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    expect(startRecording).toHaveBeenCalled();
    const notice = document.querySelector(".voice-feedback-notice");
    expect(notice).toBeNull();
  });

  it("long-press ShiftLeft should start recording normally when notice_acked=1", async () => {
    mockSharedSpaceFeedbackState.spaceSetting = {
      voice_feedback_on: 1,
      voice_feedback_notice_acked: 1,
    };
    mockSharedSpaceFeedbackState.loaded = true;
    mockVoiceConfig.current = { feedback_url: "https://feedback.test" };

    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    await act(async () => {
      fireEvent.keyDown(window, {
        code: "ShiftLeft",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(startRecording).toHaveBeenCalled();
    const notice = document.querySelector(".voice-feedback-notice");
    expect(notice).toBeNull();
  });
});

describe("VoiceInputIndicator - fail-closed when settings not loaded", () => {
  let startRecording: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    startRecording = vi.fn();

    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });

    mockSharedSpaceFeedbackState.spaceSetting = null;
    mockSharedSpaceFeedbackState.loaded = false;
    mockSharedSpaceFeedbackState.apiAvailable = false;
    mockVoiceConfig.current = { feedback_url: "https://feedback.test" };

    mockUseVoiceInput.mockReturnValue(
      createMockHookReturn({
        isVoiceEnabled: true,
        startRecording,
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should NOT start recording on click when loaded=false and feedback_url exists", async () => {
    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    const button = document.querySelector(".wk-voice-button");
    await act(async () => {
      fireEvent.click(button!);
    });

    expect(startRecording).not.toHaveBeenCalled();
    const notice = document.querySelector(".voice-feedback-notice");
    expect(notice).toBeNull();
  });

  it("Shift+Cmd+Space should silently block when loaded=false", async () => {
    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    await act(async () => {
      fireEvent.keyDown(window, {
        code: "Space",
        shiftKey: true,
        metaKey: true,
        repeat: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    expect(startRecording).not.toHaveBeenCalled();
    const notice = document.querySelector(".voice-feedback-notice");
    expect(notice).toBeNull();
  });

  it("long-press ShiftLeft should silently block when loaded=false", async () => {
    render(<VoiceInputIndicator onTranscribed={vi.fn()} />);

    await act(async () => {
      fireEvent.keyDown(window, {
        code: "ShiftLeft",
        shiftKey: true,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(startRecording).not.toHaveBeenCalled();
    const notice = document.querySelector(".voice-feedback-notice");
    expect(notice).toBeNull();
  });
});
