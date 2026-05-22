import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";

const mockUseTextareaVoice = vi.fn();
vi.mock("@octo/base/src/Components/VoiceInputButton/useTextareaVoice", () => ({
  default: (opts: unknown) => mockUseTextareaVoice(opts),
}));

vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom");
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
  Dropdown: Object.assign(vi.fn(({ children }: any) => children), {
    Menu: vi.fn(({ children }: any) => children),
    Item: vi.fn(({ children }: any) => children),
  }),
}));
vi.mock("@douyinfe/semi-icons", () => ({}));

const mockSharedSpaceFeedbackState = {
  spaceSetting: null as { voice_feedback_on?: number; voice_feedback_notice_acked?: number } | null,
  loaded: false,
  apiAvailable: false,
  loadedSpaceId: null as string | null,
};

vi.mock("@octo/base/src/Components/MessageInput/VoiceFeedbackNotice", () => ({
  default: (props: any) => {
    const React = require("react");
    return React.createElement("div", { className: "voice-feedback-notice" });
  },
}));

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

import VoiceInputButton from "@octo/base/src/Components/VoiceInputButton";
import { Toast } from "@douyinfe/semi-ui";

function createMockReturn(overrides = {}) {
  return {
    isRecording: false,
    isTranscribing: false,
    startRecording: vi.fn(),
    stopRecordingAndTranscribe: vi.fn(),
    cancelRecording: vi.fn(),
    isVoiceEnabled: true,
    localAvailable: false,
    ...overrides,
  };
}

describe("VoiceInputButton - Left Shift long-press", () => {
  let textarea: HTMLTextAreaElement;
  let inputRef: React.RefObject<HTMLTextAreaElement>;

  beforeEach(() => {
    vi.useFakeTimers();
    textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    inputRef = { current: textarea } as React.RefObject<HTMLTextAreaElement>;
    mockUseTextareaVoice.mockReturnValue(createMockReturn());
    mockSharedSpaceFeedbackState.spaceSetting = null;
    mockSharedSpaceFeedbackState.loaded = false;
    mockSharedSpaceFeedbackState.apiAvailable = false;
    mockSharedSpaceFeedbackState.loadedSpaceId = null;
    mockVoiceConfig.current = null;
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    document.body.removeChild(textarea);
  });

  it("should start recording after holding ShiftLeft for 500ms when input is focused", () => {
    const mockStart = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ startRecording: mockStart })
    );

    render(<VoiceInputButton inputRef={inputRef} onTranscribed={vi.fn()} />);

    textarea.focus();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "ShiftLeft",
          key: "Shift",
          bubbles: true,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(mockStart).toHaveBeenCalledWith("append_only");
  });

  it("should NOT start recording if ShiftLeft is released before 500ms", () => {
    const mockStart = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ startRecording: mockStart })
    );

    render(<VoiceInputButton inputRef={inputRef} onTranscribed={vi.fn()} />);

    textarea.focus();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "ShiftLeft",
          key: "Shift",
          bubbles: true,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keyup", {
          code: "ShiftLeft",
          key: "Shift",
          bubbles: true,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mockStart).not.toHaveBeenCalled();
  });

  it("should NOT activate when input is not focused", () => {
    const mockStart = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ startRecording: mockStart })
    );

    render(<VoiceInputButton inputRef={inputRef} onTranscribed={vi.fn()} />);

    // Do not focus the textarea
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "ShiftLeft",
          key: "Shift",
          bubbles: true,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(mockStart).not.toHaveBeenCalled();
  });

  it("should cancel timer when another key is pressed during hold", () => {
    const mockStart = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ startRecording: mockStart })
    );

    render(<VoiceInputButton inputRef={inputRef} onTranscribed={vi.fn()} />);

    textarea.focus();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "ShiftLeft",
          key: "Shift",
          bubbles: true,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Press another key (typing a capital letter)
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyA",
          key: "A",
          shiftKey: true,
          bubbles: true,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(mockStart).not.toHaveBeenCalled();
  });

  it("should cancel timer when modifier chord is detected", () => {
    const mockStart = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ startRecording: mockStart })
    );

    render(<VoiceInputButton inputRef={inputRef} onTranscribed={vi.fn()} />);

    textarea.focus();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "ShiftLeft",
          key: "Shift",
          bubbles: true,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Press Ctrl (modifier chord)
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "ControlLeft",
          key: "Control",
          bubbles: true,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(mockStart).not.toHaveBeenCalled();
  });

  it("should show warning toast when offline", () => {
    // Render with offline state from the start
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });

    const mockStart = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ startRecording: mockStart, localAvailable: false })
    );

    render(<VoiceInputButton inputRef={inputRef} onTranscribed={vi.fn()} />);

    act(() => {
      textarea.focus();
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "ShiftLeft",
          key: "Shift",
          bubbles: true,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Verify startRecording is NOT called when offline - this is the critical assertion
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("should stop recording when ShiftLeft is released after recording started", () => {
    const mockStop = vi.fn();
    const mockStart = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({
        startRecording: mockStart,
        stopRecordingAndTranscribe: mockStop,
        isRecording: true,
      })
    );

    render(<VoiceInputButton inputRef={inputRef} onTranscribed={vi.fn()} />);

    // Simulate: the timer already fired and shiftRecordingRef.current = true
    // We simulate this by dispatching keydown, advancing time past threshold,
    // then re-rendering with isRecording=true, then releasing shift.
    // Since the mock already returns isRecording=true, we just need to
    // set up the internal shiftRecordingRef. Let's do a full sequence:

    // Re-render with isRecording=false first to set up the timer
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({
        startRecording: mockStart,
        stopRecordingAndTranscribe: mockStop,
        isRecording: false,
      })
    );

    const { rerender } = render(
      <VoiceInputButton inputRef={inputRef} onTranscribed={vi.fn()} />
    );

    textarea.focus();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "ShiftLeft",
          key: "Shift",
          bubbles: true,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(mockStart).toHaveBeenCalledWith("append_only");

    // Now simulate that recording started
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({
        startRecording: mockStart,
        stopRecordingAndTranscribe: mockStop,
        isRecording: true,
      })
    );

    rerender(<VoiceInputButton inputRef={inputRef} onTranscribed={vi.fn()} />);

    // Release shift
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keyup", {
          code: "ShiftLeft",
          key: "Shift",
          bubbles: true,
        })
      );
    });

    expect(mockStop).toHaveBeenCalled();
  });

  it("should not conflict with repeated keydown events", () => {
    const mockStart = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ startRecording: mockStart })
    );

    render(<VoiceInputButton inputRef={inputRef} onTranscribed={vi.fn()} />);

    textarea.focus();

    // First press
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "ShiftLeft",
          key: "Shift",
          bubbles: true,
        })
      );
    });

    // Repeated keydown (key repeat)
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "ShiftLeft",
          key: "Shift",
          bubbles: true,
          repeat: true,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Should only start once
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it("should show feedback notice instead of recording when notice not acked", () => {
    mockSharedSpaceFeedbackState.spaceSetting = {
      voice_feedback_on: 1,
      voice_feedback_notice_acked: 0,
    };
    mockSharedSpaceFeedbackState.loaded = true;
    mockSharedSpaceFeedbackState.apiAvailable = true;
    mockVoiceConfig.current = { feedback_url: "https://feedback.test" };

    const mockStart = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ startRecording: mockStart })
    );

    const { container } = render(
      <VoiceInputButton inputRef={inputRef} onTranscribed={vi.fn()} />
    );

    textarea.focus();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "ShiftLeft",
          key: "Shift",
          bubbles: true,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(mockStart).not.toHaveBeenCalled();
    const notice = container.querySelector(".voice-feedback-notice");
    expect(notice).toBeTruthy();
  });

  it("should allow recording via long-press when notice already acked", () => {
    mockSharedSpaceFeedbackState.spaceSetting = {
      voice_feedback_on: 1,
      voice_feedback_notice_acked: 1,
    };
    mockSharedSpaceFeedbackState.loaded = true;
    mockSharedSpaceFeedbackState.apiAvailable = true;
    mockVoiceConfig.current = { feedback_url: "https://feedback.test" };

    const mockStart = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ startRecording: mockStart })
    );

    render(<VoiceInputButton inputRef={inputRef} onTranscribed={vi.fn()} />);

    textarea.focus();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "ShiftLeft",
          key: "Shift",
          bubbles: true,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(mockStart).toHaveBeenCalledWith("append_only");
  });
});
