/** @vitest-environment jsdom */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  voiceEnabled: false,
  speakingMode: "toggle" as "toggle" | "hold",
  shortcut: "alt-right" as "alt-right",
  isRecording: false,
  isTranscribing: false,
  cancelRecording: vi.fn(),
  settingsListeners: new Set<(settings: unknown) => void>(),
  transcribed: null as null | ((text: string) => void),
  inputTranscribed: null as null | ((text: string) => void),
}));

vi.mock("../../adapters/voice/useVoiceInput", () => ({
  default: (options: { onTranscribed: (text: string) => void }) => {
    mocks.inputTranscribed = options.onTranscribed;
    const [isRecording, setIsRecording] = React.useState(mocks.isRecording);
    return {
      isRecording,
      isTranscribing: mocks.isTranscribing,
      startRecording: (...args: unknown[]) => {
        mocks.startRecording(...args);
        setIsRecording(true);
      },
      stopRecordingAndTranscribe: (...args: unknown[]) => {
        mocks.stopRecording(...args);
        setIsRecording(false);
      },
      cancelRecording: mocks.cancelRecording,
      isVoiceEnabled: true,
      currentMode: "append_only",
      localAvailable: false,
    };
  },
}));

vi.mock("../../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
  I18nContext: React.createContext({ t: (key: string) => key }),
}));

vi.mock("../../../../Service/VoiceSettingsStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../Service/VoiceSettingsStore")>()),
  getVoiceShortcut: () => mocks.shortcut,
  voiceSettingsStore: {
    get: () => ({ enabled: mocks.voiceEnabled, shortcutEnabled: true, shortcutWindows: "alt-right", shortcutMacos: "alt-right", speakingMode: mocks.speakingMode }),
    markShortcutLearned: vi.fn(),
    subscribe: (listener: (settings: unknown) => void) => { mocks.settingsListeners.add(listener); return () => mocks.settingsListeners.delete(listener); },
  },
}));

vi.mock("lucide-react", () => ({ Mic: () => <span /> }));

vi.mock("@douyinfe/semi-ui", () => {
  const Tooltip = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    Tooltip,
    Toast: {
      error: (...args: unknown[]) => mocks.toastError(...args),
      warning: (...args: unknown[]) => mocks.toastWarning(...args),
    },
  };
});

import VoiceInputIndicator from "./VoiceInputIndicator";
import type { ChatComposerVoiceHost } from "../../ports";

let container: HTMLDivElement;
const voiceHost: ChatComposerVoiceHost = {
  getSpaceId: () => "space-a",
  subscribeSpaceChange: () => () => {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.voiceEnabled = false;
  mocks.speakingMode = "toggle";
  mocks.shortcut = "alt-right";
  mocks.isRecording = false;
  mocks.isTranscribing = false;
  mocks.cancelRecording.mockReset();
  mocks.settingsListeners.clear();
  mocks.inputTranscribed = null;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
});

describe("VoiceInputIndicator click behavior", () => {
  it("shows the settings hint without starting recording when disabled", async () => {
    await act(async () => {
      ReactDOM.render(
        <VoiceInputIndicator voiceHost={voiceHost} onTranscribed={() => undefined} />,
        container,
      );
    });

    act(() => {
      (container.querySelector(".wk-voice-button-group") as HTMLElement).click();
    });

    expect(mocks.startRecording).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith("base.voiceInput.error.disabled");
  });

  it("starts voice input directly from the microphone button", async () => {
    mocks.voiceEnabled = true;
    await act(async () => {
      ReactDOM.render(
        <VoiceInputIndicator voiceHost={voiceHost} onTranscribed={() => undefined} />,
        container,
      );
    });

    act(() => {
      (container.querySelector(".wk-voice-button-group") as HTMLElement).click();
    });

    expect(mocks.startRecording).toHaveBeenCalledWith("append_only");
  });

  it("starts and stops hold-mode shortcut recording after the long press", async () => {
    mocks.voiceEnabled = true;
    mocks.speakingMode = "hold";
    await act(async () => {
      ReactDOM.render(
        <VoiceInputIndicator voiceHost={voiceHost} onTranscribed={() => undefined} />,
        container,
      );
    });

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })));
    expect(mocks.startRecording).toHaveBeenCalledWith("append_only");
    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { code: "AltRight" })));
    expect(mocks.stopRecording).toHaveBeenCalledWith();
  });

  it("cancels an active recording when voice input is disabled", async () => {
    mocks.voiceEnabled = true;
    mocks.isRecording = true;
    await act(async () => {
      ReactDOM.render(<VoiceInputIndicator voiceHost={voiceHost} onTranscribed={() => undefined} />, container);
    });

    mocks.voiceEnabled = false;
    act(() => { mocks.settingsListeners.forEach((listener) => listener({ enabled: false })); });
    expect(mocks.cancelRecording).toHaveBeenCalled();
  });

  it("uses the fixed right Alt shortcut for toggle recording", async () => {
    mocks.voiceEnabled = true;
    mocks.shortcut = "alt-right";
    await act(async () => {
      ReactDOM.render(<VoiceInputIndicator voiceHost={voiceHost} onTranscribed={() => undefined} />, container);
    });

    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight", key: "Alt" })); });
    expect(mocks.startRecording).toHaveBeenCalledWith("append_only");

    mocks.isRecording = true;
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight", key: "Alt" })); });
    expect(mocks.stopRecording).toHaveBeenCalledWith();
  });

  it("uses the fixed right Alt shortcut for hold recording", async () => {
    mocks.voiceEnabled = true;
    mocks.shortcut = "alt-right";
    mocks.speakingMode = "hold";
    await act(async () => {
      ReactDOM.render(<VoiceInputIndicator voiceHost={voiceHost} onTranscribed={() => undefined} />, container);
    });

    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight", key: "Alt" })); });
    expect(mocks.startRecording).toHaveBeenCalledWith("append_only");

    mocks.isRecording = true;
    act(() => { window.dispatchEvent(new KeyboardEvent("keyup", { code: "AltRight", key: "Alt" })); });
    expect(mocks.stopRecording).toHaveBeenCalledWith();
  });

  it("uses append mode for toggle shortcuts even when text is selected", async () => {
    mocks.voiceEnabled = true;
    const onTranscribed = vi.fn();
    await act(async () => {
      ReactDOM.render(
        <VoiceInputIndicator
          voiceHost={voiceHost}
          onTranscribed={onTranscribed}
          getSelectedText={() => "selected"}
          getSelectionRange={() => ({ from: 3, to: 11 })}
        />,
        container,
      );
    });

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })));
    expect(mocks.startRecording).toHaveBeenCalledWith("append_only");
    act(() => mocks.inputTranscribed?.("new text"));
    expect(onTranscribed).toHaveBeenCalledWith("new text", "insert");
  });

  it("does not start from toggle shortcut while transcribing", async () => {
    mocks.voiceEnabled = true;
    mocks.isTranscribing = true;
    await act(async () => {
      ReactDOM.render(<VoiceInputIndicator voiceHost={voiceHost} onTranscribed={() => undefined} />, container);
    });

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })));
    expect(mocks.startRecording).not.toHaveBeenCalled();
  });

  it("shows the network warning for an offline toggle shortcut", async () => {
    mocks.voiceEnabled = true;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    await act(async () => {
      ReactDOM.render(<VoiceInputIndicator voiceHost={voiceHost} onTranscribed={() => undefined} />, container);
    });

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })));
    expect(mocks.startRecording).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith("base.voiceInput.error.networkUnavailable");
  });

  it("shows the network warning before starting an offline hold shortcut", async () => {
    mocks.voiceEnabled = true;
    mocks.speakingMode = "hold";
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    vi.useFakeTimers();
    await act(async () => {
      ReactDOM.render(<VoiceInputIndicator voiceHost={voiceHost} onTranscribed={() => undefined} />, container);
    });

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltRight" })));
    act(() => vi.advanceTimersByTime(500));
    expect(mocks.startRecording).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith("base.voiceInput.error.networkUnavailable");
    vi.useRealTimers();
  });

  it("cancels recording with Escape", async () => {
    mocks.voiceEnabled = true;
    mocks.isRecording = true;
    await act(async () => {
      ReactDOM.render(<VoiceInputIndicator voiceHost={voiceHost} onTranscribed={() => undefined} />, container);
    });

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" })));
    expect(mocks.cancelRecording).toHaveBeenCalled();
  });
});
