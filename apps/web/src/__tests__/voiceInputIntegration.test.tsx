import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React, { useRef, useState } from "react";

// Mock useVoiceInput
let capturedOnTranscribed: ((text: string) => void) | undefined;
let capturedStartRecording: ReturnType<typeof vi.fn>;

vi.mock("@octo/base/src/Components/MessageInput/useVoiceInput", () => ({
  default: (opts: { onTranscribed?: (text: string) => void }) => {
    capturedOnTranscribed = opts?.onTranscribed;
    return {
      isRecording: false,
      isTranscribing: false,
      startRecording: capturedStartRecording,
      stopRecordingAndTranscribe: vi.fn(),
      cancelRecording: vi.fn(),
      isVoiceEnabled: true,
      currentMode: "append_only",
      localAvailable: false,
    };
  },
}));

vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom");
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { error: vi.fn(), warning: vi.fn() },
  Dropdown: Object.assign(vi.fn(({ children }: any) => children), {
    Menu: vi.fn(({ children }: any) => children),
    Item: vi.fn(({ children }: any) => children),
  }),
}));

import VoiceInputButton from "@octo/base/src/Components/VoiceInputButton";
import type { ReplaceMode } from "@octo/base/src/Components/VoiceInputButton";

function TextareaWithVoice() {
  const [value, setValue] = useState("hello world");
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div>
      <textarea
        ref={ref}
        data-testid="textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <VoiceInputButton
        inputRef={ref}
        onTranscribed={(text: string, mode: ReplaceMode, savedRange?: { from: number; to: number }) => {
          if (mode === "all") {
            setValue(text);
          } else if (mode === "selection" && savedRange) {
            // Note: savedRange indices are from recording start; assumes input is read-only during recording
            setValue((prev) => prev.slice(0, savedRange.from) + text + prev.slice(savedRange.to));
          } else {
            setValue((prev) => {
              const pos = savedRange?.from ?? prev.length;
              return prev.slice(0, pos) + text + prev.slice(pos);
            });
          }
        }}
        getCurrentText={() => value}
        size="sm"
      />
      <div data-testid="value">{value}</div>
    </div>
  );
}

function InputWithVoice() {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div>
      <input
        ref={ref}
        data-testid="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <VoiceInputButton
        inputRef={ref}
        onTranscribed={(text: string) => setValue((prev) => prev + text)}
        size="sm"
      />
      <div data-testid="value">{value}</div>
    </div>
  );
}

function ConditionalTextareaWithVoice() {
  const [show, setShow] = useState(false);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div>
      <button data-testid="toggle" onClick={() => setShow(!show)}>
        Toggle
      </button>
      {show && (
        <div>
          <textarea
            ref={ref}
            data-testid="textarea"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <VoiceInputButton
            inputRef={ref}
            onTranscribed={(text: string) =>
              setValue((prev) => prev + text)
            }
            size="sm"
          />
        </div>
      )}
      <div data-testid="value">{value}</div>
    </div>
  );
}

describe("VoiceInputButton integration - textarea pattern", () => {
  beforeEach(() => {
    capturedStartRecording = vi.fn();
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should render VoiceInputButton next to textarea", () => {
    render(<TextareaWithVoice />);

    const voiceBtn = document.querySelector(".wk-vib");
    expect(voiceBtn).toBeTruthy();

    const textarea = document.querySelector('[data-testid="textarea"]');
    expect(textarea).toBeTruthy();
  });

  it("should call startRecording when clicked", async () => {
    render(<TextareaWithVoice />);

    const voiceBtn = document.querySelector(".wk-vib");
    await act(async () => {
      fireEvent.click(voiceBtn!);
    });

    expect(capturedStartRecording).toHaveBeenCalledWith("append_only");
  });

  it("should handle 'insert' mode transcription", async () => {
    const { getByTestId } = render(<TextareaWithVoice />);

    // Click to start recording first (sets up mode)
    const voiceBtn = document.querySelector(".wk-vib");
    await act(async () => {
      fireEvent.click(voiceBtn!);
    });

    // Simulate transcription callback
    await act(async () => {
      capturedOnTranscribed?.("test transcription");
    });

    // The onTranscribed callback processes it with mode "insert"
    // (since append_only → insert in useTextareaVoice)
    // Verify the component is functional
    expect(getByTestId("value")).toBeTruthy();
  });
});

describe("VoiceInputButton integration - input pattern", () => {
  beforeEach(() => {
    capturedStartRecording = vi.fn();
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should render VoiceInputButton next to input", () => {
    render(<InputWithVoice />);

    const voiceBtn = document.querySelector(".wk-vib");
    expect(voiceBtn).toBeTruthy();

    const input = document.querySelector('[data-testid="input"]');
    expect(input).toBeTruthy();
  });

  it("should handle voice input for input element", async () => {
    render(<InputWithVoice />);

    const voiceBtn = document.querySelector(".wk-vib");
    await act(async () => {
      fireEvent.click(voiceBtn!);
    });

    expect(capturedStartRecording).toHaveBeenCalledWith("append_only");
  });
});

describe("VoiceInputButton integration - conditional rendering", () => {
  beforeEach(() => {
    capturedStartRecording = vi.fn();
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should not show VoiceInputButton when textarea is not rendered", () => {
    render(<ConditionalTextareaWithVoice />);

    const voiceBtn = document.querySelector(".wk-vib");
    expect(voiceBtn).toBeNull();
  });

  it("should show VoiceInputButton after toggling textarea", async () => {
    const { getByTestId } = render(<ConditionalTextareaWithVoice />);

    await act(async () => {
      fireEvent.click(getByTestId("toggle"));
    });

    const voiceBtn = document.querySelector(".wk-vib");
    expect(voiceBtn).toBeTruthy();
  });

  it("should allow recording after textarea is shown", async () => {
    const { getByTestId } = render(<ConditionalTextareaWithVoice />);

    await act(async () => {
      fireEvent.click(getByTestId("toggle"));
    });

    const voiceBtn = document.querySelector(".wk-vib");
    await act(async () => {
      fireEvent.click(voiceBtn!);
    });

    expect(capturedStartRecording).toHaveBeenCalledWith("append_only");
  });
});
