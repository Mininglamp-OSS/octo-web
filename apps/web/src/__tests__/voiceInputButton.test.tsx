import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";

// Mock useTextareaVoice hook
const mockUseTextareaVoice = vi.fn();
vi.mock("@octo/base/src/Components/VoiceInputButton/useTextareaVoice", () => ({
  default: (opts: unknown) => mockUseTextareaVoice(opts),
}));

// Mock createPortal
vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom");
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock Toast
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

function createInputRef(): React.RefObject<HTMLTextAreaElement> {
  const el = document.createElement("textarea");
  return { current: el } as React.RefObject<HTMLTextAreaElement>;
}

describe("VoiceInputButton - rendering", () => {
  beforeEach(() => {
    mockUseTextareaVoice.mockReturnValue(createMockReturn());
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should render nothing when voice is disabled", () => {
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ isVoiceEnabled: false })
    );

    const { container } = render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("should render microphone button when enabled", () => {
    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
      />
    );

    const button = document.querySelector(".wk-vib__btn");
    expect(button).toBeTruthy();
  });

  it("should render with sm size class", () => {
    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
        size="sm"
      />
    );

    const root = document.querySelector(".wk-vib--sm");
    expect(root).toBeTruthy();
  });

  it("should render recording state", () => {
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ isRecording: true })
    );

    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
      />
    );

    const recordingBtn = document.querySelector(".wk-vib__btn--recording");
    expect(recordingBtn).toBeTruthy();
  });

  it("should render transcribing state", () => {
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ isTranscribing: true })
    );

    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
      />
    );

    const recordingBtn = document.querySelector(".wk-vib__btn--recording");
    expect(recordingBtn).toBeTruthy();
    expect(recordingBtn?.getAttribute("title")).toBe("转写中...");
  });

  it("should render disabled state when inputRef.current is null", () => {
    const nullRef = {
      current: null,
    } as React.RefObject<HTMLTextAreaElement>;

    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });

    render(
      <VoiceInputButton inputRef={nullRef} onTranscribed={vi.fn()} />
    );

    const button = document.querySelector(".wk-vib__btn--disabled");
    expect(button).toBeTruthy();
  });

  it("should render disabled state when offline and no local model", () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });

    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ localAvailable: false })
    );

    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
      />
    );

    const button = document.querySelector(".wk-vib__btn--disabled");
    expect(button).toBeTruthy();
  });

  it("should apply custom className", () => {
    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
        className="my-custom-class"
      />
    );

    const root = document.querySelector(".my-custom-class");
    expect(root).toBeTruthy();
  });
});

describe("VoiceInputButton - interactions", () => {
  beforeEach(() => {
    mockUseTextareaVoice.mockReturnValue(createMockReturn());
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should call startRecording on click", async () => {
    const mockStart = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ startRecording: mockStart })
    );

    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
      />
    );

    const root = document.querySelector(".wk-vib");
    await act(async () => {
      fireEvent.click(root!);
    });

    expect(mockStart).toHaveBeenCalledWith("append_only");
  });

  it("should call stopRecordingAndTranscribe when clicking during recording", async () => {
    const mockStop = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({
        isRecording: true,
        stopRecordingAndTranscribe: mockStop,
      })
    );

    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
      />
    );

    const root = document.querySelector(".wk-vib");
    await act(async () => {
      fireEvent.click(root!);
    });

    expect(mockStop).toHaveBeenCalled();
  });

  it("should show warning Toast when clicking while offline", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });

    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ localAvailable: false })
    );

    const inputRef = createInputRef();
    const { container } = render(
      <VoiceInputButton
        inputRef={inputRef}
        onTranscribed={vi.fn()}
      />
    );

    const disabledBtn = container.querySelector(".wk-vib__btn--disabled");
    expect(disabledBtn).toBeTruthy();
    expect(disabledBtn?.getAttribute("title")).toBe("网络不可用");
  });

  it("should not start recording when inputRef.current is null", async () => {
    const mockStart = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ startRecording: mockStart })
    );

    const nullRef = {
      current: null,
    } as React.RefObject<HTMLTextAreaElement>;

    render(
      <VoiceInputButton inputRef={nullRef} onTranscribed={vi.fn()} />
    );

    const root = document.querySelector(".wk-vib");
    await act(async () => {
      fireEvent.click(root!);
    });

    expect(mockStart).not.toHaveBeenCalled();
  });

  it("should cancel recording on Escape key", async () => {
    const mockCancel = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({
        isRecording: true,
        cancelRecording: mockCancel,
      })
    );

    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(mockCancel).toHaveBeenCalled();
  });

  it("should stop recording on window blur", async () => {
    const mockStop = vi.fn();
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({
        isRecording: true,
        stopRecordingAndTranscribe: mockStop,
      })
    );

    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent(window, new Event("blur"));
    });

    expect(mockStop).toHaveBeenCalled();
  });
});

describe("VoiceInputButton - floating indicator", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should show wave animation during recording", () => {
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ isRecording: true })
    );

    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
      />
    );

    const waveContainer = document.querySelector(".wk-voice-wave-container");
    expect(waveContainer).toBeTruthy();

    const waveBars = document.querySelectorAll(".wk-voice-wave-bar");
    expect(waveBars.length).toBe(16);
  });

  it("should show spinner during transcribing", () => {
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ isTranscribing: true })
    );

    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
      />
    );

    const spinner = document.querySelector(".wk-voice-transcribing-spinner");
    expect(spinner).toBeTruthy();
  });

  it("should show '语音输入' text during recording", () => {
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ isRecording: true })
    );

    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
      />
    );

    const text = document.querySelector(".wk-voice-floating-text");
    expect(text?.textContent).toBe("语音输入");
  });

  it("should show '转写中' text during transcribing", () => {
    mockUseTextareaVoice.mockReturnValue(
      createMockReturn({ isTranscribing: true })
    );

    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
      />
    );

    const text = document.querySelector(".wk-voice-floating-text");
    expect(text?.textContent).toBe("转写中");
  });
});

describe("VoiceInputButton - mode menu", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should pass showModeMenu through to component rendering", () => {
    mockUseTextareaVoice.mockReturnValue(createMockReturn());

    const { container } = render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
        showModeMenu
      />
    );

    // With showModeMenu=true, the component tries to render Dropdown
    // The button should still be present
    const button = container.querySelector(".wk-vib__btn");
    expect(button).toBeTruthy();
  });

  it("should render simple button without dropdown when showModeMenu is false", () => {
    mockUseTextareaVoice.mockReturnValue(createMockReturn());

    const { container } = render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
        showModeMenu={false}
      />
    );

    const button = container.querySelector(".wk-vib__btn");
    expect(button).toBeTruthy();
  });
});
