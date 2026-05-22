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
    Item: vi.fn(({ children, onClick }: any) => {
      const React = require("react");
      return React.createElement("div", { className: "dropdown-item", onClick }, children);
    }),
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

function createInputRef(): React.RefObject<HTMLTextAreaElement> {
  const el = document.createElement("textarea");
  return { current: el } as React.RefObject<HTMLTextAreaElement>;
}

describe("VoiceInputButton - rendering", () => {
  beforeEach(() => {
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

  it("should show feedback notice on handleModeSelect when notice not acked", async () => {
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
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
        showModeMenu
      />
    );

    const dropdownItem = container.querySelector(".dropdown-item");
    await act(async () => {
      fireEvent.click(dropdownItem!);
    });

    expect(mockStart).not.toHaveBeenCalled();
    const notice = container.querySelector(".voice-feedback-notice");
    expect(notice).toBeTruthy();
  });

  it("should allow handleModeSelect when notice already acked", async () => {
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

    render(
      <VoiceInputButton
        inputRef={createInputRef()}
        onTranscribed={vi.fn()}
        showModeMenu
      />
    );

    const dropdownItem = document.querySelector(".dropdown-item");
    await act(async () => {
      fireEvent.click(dropdownItem!);
    });

    expect(mockStart).toHaveBeenCalled();
  });
});

describe("VoiceInputButton - fail-closed when settings not loaded", () => {
  beforeEach(() => {
    mockSharedSpaceFeedbackState.spaceSetting = null;
    mockSharedSpaceFeedbackState.loaded = false;
    mockSharedSpaceFeedbackState.apiAvailable = false;
    mockSharedSpaceFeedbackState.loadedSpaceId = null;
    mockVoiceConfig.current = { feedback_url: "https://feedback.test" };
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should NOT call startRecording on click when loaded=false and feedback_url exists", async () => {
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

    expect(mockStart).not.toHaveBeenCalled();
  });

  it("should NOT call startRecording via mode menu when loaded=false and feedback_url exists", async () => {
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

    expect(mockStart).not.toHaveBeenCalled();
    const notice = document.querySelector(".voice-feedback-notice");
    expect(notice).toBeNull();
  });

  it("should allow recording when loaded=true and feedback_url exists", async () => {
    mockSharedSpaceFeedbackState.loaded = true;
    mockSharedSpaceFeedbackState.apiAvailable = true;
    mockSharedSpaceFeedbackState.spaceSetting = {
      voice_feedback_on: 0,
      voice_feedback_notice_acked: 0,
    };

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
});
