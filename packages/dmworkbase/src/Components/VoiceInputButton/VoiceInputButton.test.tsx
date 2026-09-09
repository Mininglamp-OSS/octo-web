/** @vitest-environment jsdom */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// These tests run the REAL VoiceInputButton with the REAL useTextareaVoice.
// Only the lower useVoiceInput adapter is replaced so no microphone or backend
// is touched. The adapter's onTranscribed option (the real useTextareaVoice
// handler that computes replaceMode + selection) is preserved and invoked so
// transcript delivery through the real hook is covered.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  adapterOnTranscribed: undefined as undefined | ((text: string) => void),
  rawStartRecording: vi.fn(),
  rawStopRecording: vi.fn(),
  rawCancelRecording: vi.fn(),
  isRecording: false,
  isTranscribing: false,
  isVoiceEnabled: true,
  localAvailable: false,
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  shortcut: "alt-right" as "alt-right" | "shift-right" | "shift-left",
  speakingMode: "toggle" as "toggle" | "hold",
  settingsEnabled: true,
  // Simulates the async window where the real adapter's startRecording is
  // pending before useVoiceInput flips isRecording to true.
  deferStart: false,
  pendingStart: null as null | (() => void),
}));

vi.mock("../../features/chat-composer/voice", () => ({
  useVoiceInput: (options: { onTranscribed?: (text: string) => void }) => {
    mocks.adapterOnTranscribed = options.onTranscribed;
    const [recording, setRecording] = React.useState(mocks.isRecording);
    const [transcribing, setTranscribing] = React.useState(mocks.isTranscribing);
    return {
      isRecording: recording,
      isTranscribing: transcribing,
      startRecording: (...args: unknown[]) => {
        mocks.rawStartRecording(...args);
        if (mocks.deferStart) {
          mocks.pendingStart = () => {
            mocks.isRecording = true;
            setRecording(true);
          };
        } else {
          mocks.isRecording = true;
          setRecording(true);
        }
      },
      stopRecordingAndTranscribe: (contextText?: string) => {
        mocks.rawStopRecording(contextText);
        mocks.adapterOnTranscribed?.("transcribed text");
        mocks.isRecording = false;
        mocks.isTranscribing = false;
        setRecording(false);
        setTranscribing(false);
      },
      cancelRecording: (...args: unknown[]) => {
        mocks.isRecording = false;
        setRecording(false);
        mocks.rawCancelRecording(...args);
      },
      isVoiceEnabled: mocks.isVoiceEnabled,
      localAvailable: mocks.localAvailable,
      currentMode: "append_only" as const,
      currentUtteranceId: "utt-1",
    };
  },
}));

vi.mock("../../Service/VoiceSettingsStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../Service/VoiceSettingsStore")>()),
  getVoiceShortcut: () => mocks.shortcut,
  voiceSettingsStore: {
    get: () => ({
      enabled: mocks.settingsEnabled,
      speakingMode: mocks.speakingMode,
      shortcutWindows: mocks.shortcut,
      shortcutMacos: mocks.shortcut,
    }),
    subscribe: () => () => {},
  },
}));

vi.mock("../../App", () => ({
  default: {
    shared: { currentSpaceId: "space-a" },
    mittBus: { on: vi.fn(), off: vi.fn() },
  },
}));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("lucide-react", () => ({ Mic: () => <span /> }));
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: {
    warning: (...args: unknown[]) => mocks.toastWarning(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
  },
  Dropdown: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import VoiceInputButton from "./index";

let container: HTMLDivElement;
let textarea: HTMLTextAreaElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isRecording = false;
  mocks.isTranscribing = false;
  mocks.isVoiceEnabled = true;
  mocks.localAvailable = false;
  mocks.settingsEnabled = true;
  mocks.shortcut = "alt-right";
  mocks.speakingMode = "toggle";
  mocks.deferStart = false;
  mocks.pendingStart = null;
  mocks.rawStartRecording.mockReset();
  mocks.rawStopRecording.mockReset();
  mocks.rawCancelRecording.mockReset();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  container = document.createElement("div");
  textarea = document.createElement("textarea");
  textarea.value = "existing content";
  document.body.appendChild(textarea);
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { ReactDOM.unmountComponentAtNode(container); });
  textarea.remove();
  container.remove();
});

const clickButton = () =>
  act(() => {
    (container.querySelector(".wk-vib__btn") as HTMLElement).click();
  });

// ======================================================
// Availability + settings gating (with real hook)
// ======================================================
describe("VoiceInputButton availability", () => {
  it("renders nothing when the voice service is unavailable", () => {
    mocks.isVoiceEnabled = false;
    act(() => {
      ReactDOM.render(
        <VoiceInputButton inputRef={{ current: textarea }} onTranscribed={() => undefined} />,
        container,
      );
    });
    expect(container.querySelector(".wk-vib")).toBeNull();
  });

  it("shows the disabled toast when voice input is not enabled in settings", () => {
    mocks.settingsEnabled = false;
    act(() => {
      ReactDOM.render(
        <VoiceInputButton inputRef={{ current: textarea }} onTranscribed={() => undefined} />,
        container,
      );
    });
    clickButton();
    expect(mocks.toastWarning).toHaveBeenCalledWith("base.voiceInput.error.unavailable");
  });

  it("recognizes the configured Shift shortcut in hold mode", () => {
    vi.useFakeTimers();
    mocks.speakingMode = "hold";
    mocks.shortcut = "shift-right";
    textarea.focus();
    act(() => {
      ReactDOM.render(
        <VoiceInputButton inputRef={{ current: textarea }} onTranscribed={() => undefined} />,
        container,
      );
    });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftRight" })); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(mocks.rawStartRecording).toHaveBeenCalledWith("append_only");
    act(() => { window.dispatchEvent(new KeyboardEvent("keyup", { code: "ShiftRight", key: "Shift" })); });
    expect(mocks.rawStopRecording).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not treat AltGraph as the Alt shortcut", () => {
    textarea.focus();
    act(() => {
      ReactDOM.render(
        <VoiceInputButton inputRef={{ current: textarea }} onTranscribed={() => undefined} />,
        container,
      );
    });
    const event = new KeyboardEvent("keydown", { code: "AltRight", altKey: true });
    Object.defineProperty(event, "getModifierState", { value: (key: string) => key === "AltGraph" });
    act(() => { window.dispatchEvent(event); });
    expect(mocks.rawStartRecording).not.toHaveBeenCalled();
  });
});

// ======================================================
// Ref-supplied mode: native behavior preserved
// ======================================================
describe("ref-supplied mode", () => {
  it("keyboard shortcut fires when the input is focused", () => {
    textarea.focus();
    act(() => {
      ReactDOM.render(
        <VoiceInputButton inputRef={{ current: textarea }} onTranscribed={() => undefined} />,
        container,
      );
    });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })); });
    expect(mocks.rawStartRecording).toHaveBeenCalledWith("append_only");
  });

  it("keyboard shortcut is blocked when the input is not focused", () => {
    act(() => {
      ReactDOM.render(
        <VoiceInputButton inputRef={{ current: textarea }} onTranscribed={() => undefined} />,
        container,
      );
    });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })); });
    expect(mocks.rawStartRecording).not.toHaveBeenCalled();
  });

  it("mouse click captures and preserves native selection", () => {
    textarea.setSelectionRange(2, 7);
    const onTranscribed = vi.fn();
    act(() => {
      ReactDOM.render(
        <VoiceInputButton inputRef={{ current: textarea }} onTranscribed={onTranscribed} />,
        container,
      );
    });
    clickButton();
    clickButton();
    expect(onTranscribed).toHaveBeenCalledWith("transcribed text", "insert", { from: 2, to: 7 });
  });

  it("a supplied ref whose element is null stays disabled", () => {
    act(() => {
      ReactDOM.render(
        <VoiceInputButton inputRef={{ current: null }} onTranscribed={() => undefined} />,
        container,
      );
    });
    clickButton();
    expect(mocks.rawStartRecording).not.toHaveBeenCalled();
    const btn = container.querySelector(".wk-vib__btn") as HTMLElement;
    expect(btn.classList.contains("wk-vib__btn--disabled")).toBe(true);
  });

  it("keyboard shortcut is blocked when the ref element is null even with a hotkey callback", () => {
    act(() => {
      ReactDOM.render(
        <VoiceInputButton inputRef={{ current: null }} onTranscribed={() => undefined} isHotkeyActive={() => true} />,
        container,
      );
    });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })); });
    expect(mocks.rawStartRecording).not.toHaveBeenCalled();
  });
});

// ======================================================
// Ref-less mode: callback-only capture and delivery
// ======================================================
describe("ref-less mode", () => {
  it("renders the button when voice is available and ref is omitted", () => {
    act(() => { ReactDOM.render(<VoiceInputButton onTranscribed={() => undefined} />, container); });
    expect(container.querySelector(".wk-vib__btn")).not.toBeNull();
  });

  it("mouse click captures via the existing callback and delivers transcript", () => {
    const onTranscribed = vi.fn();
    act(() => { ReactDOM.render(<VoiceInputButton onTranscribed={onTranscribed} />, container); });
    clickButton();
    clickButton();
    expect(onTranscribed).toHaveBeenCalledWith("transcribed text", "insert", { from: 0, to: 0 });
  });

  it("keyboard shortcut never globally captures when isHotkeyActive is absent", () => {
    act(() => { ReactDOM.render(<VoiceInputButton onTranscribed={() => undefined} />, container); });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })); });
    expect(mocks.rawStartRecording).not.toHaveBeenCalled();
  });

  it("keyboard shortcut fires only when isHotkeyActive returns true", () => {
    act(() => {
      ReactDOM.render(
        <VoiceInputButton onTranscribed={() => undefined} isHotkeyActive={() => true} />,
        container,
      );
    });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })); });
    expect(mocks.rawStartRecording).toHaveBeenCalledWith("append_only");
  });

  it("keyboard shortcut is silently skipped when isHotkeyActive returns false", () => {
    const isHotkeyActive = vi.fn(() => false);
    act(() => {
      ReactDOM.render(
        <VoiceInputButton onTranscribed={() => undefined} isHotkeyActive={isHotkeyActive} />,
        container,
      );
    });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })); });
    expect(mocks.rawStartRecording).not.toHaveBeenCalled();
  });

  it("Escape always cancels ref-less recording even without isHotkeyActive", () => {
    const onTranscribed = vi.fn();
    act(() => { ReactDOM.render(<VoiceInputButton onTranscribed={onTranscribed} />, container); });
    // Start via click
    clickButton();
    expect(mocks.rawStartRecording).toHaveBeenCalled();
    mocks.isRecording = true;
    // Escape should cancel regardless of isHotkeyActive being absent
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(mocks.rawCancelRecording).toHaveBeenCalled();
  });
});

// ======================================================
// Hold mode in ref-less context
// ======================================================
describe("ref-less hold mode", () => {
  it("hold capture fires when isHotkeyActive returns true and key is held", () => {
    vi.useFakeTimers();
    mocks.speakingMode = "hold";
    mocks.shortcut = "shift-right";
    act(() => {
      ReactDOM.render(
        <VoiceInputButton onTranscribed={() => undefined} isHotkeyActive={() => true} />,
        container,
      );
    });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftRight" })); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(mocks.rawStartRecording).toHaveBeenCalledWith("append_only");
    act(() => { window.dispatchEvent(new KeyboardEvent("keyup", { code: "ShiftRight", key: "Shift" })); });
    expect(mocks.rawStopRecording).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("hold capture is blocked before timer fires when isHotkeyActive returns false", () => {
    vi.useFakeTimers();
    mocks.speakingMode = "hold";
    mocks.shortcut = "shift-right";
    act(() => {
      ReactDOM.render(
        <VoiceInputButton onTranscribed={() => undefined} isHotkeyActive={() => false} />,
        container,
      );
    });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftRight" })); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(mocks.rawStartRecording).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("focus loss before hold timer fires prevents capture", () => {
    vi.useFakeTimers();
    mocks.speakingMode = "hold";
    mocks.shortcut = "shift-right";
    const focusState = { active: true };
    const isHotkeyActive = vi.fn(() => focusState.active);
    act(() => {
      ReactDOM.render(
        <VoiceInputButton onTranscribed={() => undefined} isHotkeyActive={isHotkeyActive} />,
        container,
      );
    });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftRight" })); });
    // Focus leaves before the timer fires
    focusState.active = false;
    act(() => { vi.advanceTimersByTime(500); });
    expect(mocks.rawStartRecording).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("release during a deferred start still sets cancelPendingRef (no stuck recording)", () => {
    vi.useFakeTimers();
    mocks.speakingMode = "hold";
    mocks.shortcut = "shift-right";
    mocks.deferStart = true;
    const focusState = { active: true };
    const isHotkeyActive = vi.fn(() => focusState.active);
    act(() => {
      ReactDOM.render(
        <VoiceInputButton onTranscribed={() => undefined} isHotkeyActive={isHotkeyActive} />,
        container,
      );
    });
    // Hold fires the timer; async start is now pending so isRecording is false.
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftRight" })); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(mocks.rawStartRecording).toHaveBeenCalledWith("append_only");
    expect(mocks.rawCancelRecording).not.toHaveBeenCalled();
    // Focus leaves while the start is still pending, then the key is released.
    focusState.active = false;
    act(() => { window.dispatchEvent(new KeyboardEvent("keyup", { code: "ShiftRight", key: "Shift" })); });
    // Deferred start resolves to isRecording=true; the cancelPending path must
    // then cancel the session rather than leaving a stuck recording.
    act(() => { mocks.pendingStart?.(); });
    expect(mocks.rawCancelRecording).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("focus loss after recording starts still stops on keyup (ownership-based)", () => {
    vi.useFakeTimers();
    mocks.speakingMode = "hold";
    mocks.shortcut = "shift-right";
    const focusState = { active: true };
    const isHotkeyActive = vi.fn(() => focusState.active);
    act(() => {
      ReactDOM.render(
        <VoiceInputButton onTranscribed={() => undefined} isHotkeyActive={isHotkeyActive} />,
        container,
      );
    });
    // Start: keydown fires
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftRight" })); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(mocks.rawStartRecording).toHaveBeenCalledWith("append_only");
    // Focus leaves while still holding the key
    focusState.active = false;
    // keyup should still stop because ownsRecording is true
    act(() => { window.dispatchEvent(new KeyboardEvent("keyup", { code: "ShiftRight", key: "Shift" })); });
    expect(mocks.rawStopRecording).toHaveBeenCalled();
    vi.useRealTimers();
  });

});

// ======================================================
// Cancel and blur behavior
// ======================================================
describe("cancel and blur", () => {
  it("Escape during ref-supplied recording triggers cancel", () => {
    textarea.focus();
    act(() => {
      ReactDOM.render(
        <VoiceInputButton inputRef={{ current: textarea }} onTranscribed={() => undefined} />,
        container,
      );
    });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })); });
    expect(mocks.rawStartRecording).toHaveBeenCalled();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(mocks.rawCancelRecording).toHaveBeenCalled();
  });

  it("window blur event cancels recording", () => {
    textarea.focus();
    act(() => {
      ReactDOM.render(
        <VoiceInputButton inputRef={{ current: textarea }} onTranscribed={() => undefined} />,
        container,
      );
    });
    // Start recording
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })); });
    expect(mocks.rawStartRecording).toHaveBeenCalled();
    mocks.rawCancelRecording.mockClear();
    // Dispatch window blur
    act(() => { window.dispatchEvent(new Event("blur")); });
    expect(mocks.rawCancelRecording).toHaveBeenCalled();
  });
});
