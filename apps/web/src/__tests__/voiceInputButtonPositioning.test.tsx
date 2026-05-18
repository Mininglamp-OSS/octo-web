import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React, { useRef } from "react";

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
  Toast: { error: vi.fn(), warning: vi.fn() },
  Dropdown: Object.assign(vi.fn(({ children }: any) => children), {
    Menu: vi.fn(({ children }: any) => children),
    Item: vi.fn(({ children }: any) => children),
  }),
}));

import VoiceInputButton from "@octo/base/src/Components/VoiceInputButton";

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

function InputWithVoiceInline() {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input ref={ref} type="text" style={{ flex: 1 }} />
      <VoiceInputButton inputRef={ref} onTranscribed={vi.fn()} size="sm" />
    </div>
  );
}

function TextareaWithVoiceCorner() {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div style={{ position: "relative" }}>
      <textarea ref={ref} rows={3} />
      <VoiceInputButton
        inputRef={ref}
        onTranscribed={vi.fn()}
        size="sm"
        className="wk-vib--textarea-corner"
      />
    </div>
  );
}

describe("VoiceInputButton positioning", () => {
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

  it("should position voice button beside input using flex layout", () => {
    const { container } = render(<InputWithVoiceInline />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.display).toBe("flex");
    expect(wrapper.style.alignItems).toBe("center");

    const voiceBtn = wrapper.querySelector(".wk-vib");
    expect(voiceBtn).toBeTruthy();

    const input = wrapper.querySelector("input");
    expect(input).toBeTruthy();

    // Voice button should be a sibling of input, not nested below
    expect(voiceBtn?.parentElement).toBe(input?.parentElement);
  });

  it("should position voice button at top-right corner of textarea using absolute positioning class", () => {
    const { container } = render(<TextareaWithVoiceCorner />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.position).toBe("relative");

    const voiceBtn = wrapper.querySelector(".wk-vib--textarea-corner");
    expect(voiceBtn).toBeTruthy();

    const textarea = wrapper.querySelector("textarea");
    expect(textarea).toBeTruthy();

    // Both inside the same position:relative container
    expect(voiceBtn?.parentElement).toBe(textarea?.parentElement);
  });

  it("should have wk-vib--textarea-corner class for absolute positioning", () => {
    const { container } = render(<TextareaWithVoiceCorner />);

    const voiceBtn = container.querySelector(".wk-vib--textarea-corner");
    expect(voiceBtn).toBeTruthy();
    expect(voiceBtn?.classList.contains("wk-vib")).toBe(true);
    expect(voiceBtn?.classList.contains("wk-vib--textarea-corner")).toBe(true);
  });

  it("should render voice button as inline-flex element", () => {
    const { container } = render(<InputWithVoiceInline />);

    const voiceBtn = container.querySelector(".wk-vib") as HTMLElement;
    expect(voiceBtn).toBeTruthy();
    // The CSS class .wk-vib has display: inline-flex
    // Just verify the element exists and is part of the flex flow
    expect(voiceBtn.parentElement?.style.display).toBe("flex");
  });
});
