/** @vitest-environment jsdom */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isVoiceEnabled: true,
  settingsEnabled: false,
  toastWarning: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  cancelRecording: vi.fn(),
  shortcut: "alt-right" as "alt-right" | "shift-right" | "shift-left",
  speakingMode: "toggle" as "toggle" | "hold",
  isRecording: false,
}));

vi.mock("./useTextareaVoice", () => ({
  default: () => {
    const [isRecording, setIsRecording] = React.useState(mocks.isRecording);
    return {
    isRecording,
    isTranscribing: false,
    isVoiceEnabled: mocks.isVoiceEnabled,
    localAvailable: false,
    startRecording: (...args: unknown[]) => { mocks.isRecording = true; setIsRecording(true); mocks.startRecording(...args); },
    stopRecordingAndTranscribe: (...args: unknown[]) => { mocks.isRecording = false; setIsRecording(false); mocks.stopRecording(...args); },
    cancelRecording: mocks.cancelRecording,
    };
  },
}));

vi.mock("../../Service/VoiceSettingsStore", () => ({
  getVoiceShortcut: () => mocks.shortcut,
  voiceSettingsStore: {
    get: () => ({ enabled: mocks.settingsEnabled, speakingMode: mocks.speakingMode, shortcutWindows: mocks.shortcut, shortcutMacos: mocks.shortcut }),
    subscribe: () => () => {},
  },
}));

vi.mock("../../App", () => ({ default: { shared: { currentSpaceId: "space-a" }, mittBus: { on: vi.fn(), off: vi.fn() } } }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("lucide-react", () => ({ Mic: () => <span /> }));
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { warning: (...args: unknown[]) => mocks.toastWarning(...args), error: vi.fn() },
  Dropdown: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import VoiceInputButton from "./index";

let container: HTMLDivElement;
let input: HTMLTextAreaElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isVoiceEnabled = true;
  mocks.settingsEnabled = false;
  mocks.shortcut = "alt-right";
  mocks.speakingMode = "toggle";
  mocks.isRecording = false;
  mocks.startRecording.mockReset();
  mocks.stopRecording.mockReset();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  container = document.createElement("div");
  input = document.createElement("textarea");
  document.body.appendChild(input);
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  input.remove();
  container.remove();
});

describe("VoiceInputButton availability", () => {
  it("renders nothing when the voice service is unavailable", () => {
    mocks.isVoiceEnabled = false;
    act(() => ReactDOM.render(<VoiceInputButton inputRef={{ current: input }} onTranscribed={() => undefined} />, container));
    expect(container.querySelector(".wk-vib")).toBeNull();
  });

  it("shows the disabled toast when voice input is not enabled in settings", () => {
    act(() => ReactDOM.render(<VoiceInputButton inputRef={{ current: input }} onTranscribed={() => undefined} />, container));
    act(() => (container.querySelector(".wk-vib__btn") as HTMLElement).click());
    expect(mocks.toastWarning).toHaveBeenCalledWith("base.voiceInput.error.unavailable");
  });

  it("starts and stops toggle mode for the configured shortcut", () => {
    mocks.settingsEnabled = true;
    input.focus();
    act(() => ReactDOM.render(<VoiceInputButton inputRef={{ current: input }} onTranscribed={() => undefined} />, container));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })));
    expect(mocks.startRecording).toHaveBeenCalledWith("append_only");
    expect(mocks.stopRecording).toHaveBeenCalled();
  });

  it("recognizes both configurable Shift shortcuts in hold mode", () => {
    vi.useFakeTimers();
    mocks.settingsEnabled = true;
    mocks.speakingMode = "hold";
    mocks.shortcut = "shift-right";
    input.focus();
    act(() => ReactDOM.render(<VoiceInputButton inputRef={{ current: input }} onTranscribed={() => undefined} />, container));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftRight" })));
    act(() => vi.advanceTimersByTime(500));
    expect(mocks.startRecording).toHaveBeenCalledWith("append_only");
    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { code: "ShiftRight", key: "Shift" })));
    expect(mocks.stopRecording).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not treat AltGraph as the Alt shortcut", () => {
    mocks.settingsEnabled = true;
    input.focus();
    act(() => ReactDOM.render(<VoiceInputButton inputRef={{ current: input }} onTranscribed={() => undefined} />, container));
    const event = new KeyboardEvent("keydown", { code: "AltRight", altKey: true });
    Object.defineProperty(event, "getModifierState", { value: (key: string) => key === "AltGraph" });
    act(() => window.dispatchEvent(event));
    expect(mocks.startRecording).not.toHaveBeenCalled();
  });
});
