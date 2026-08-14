/** @vitest-environment jsdom */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startRecording: vi.fn(),
  acceptVoiceInput: vi.fn(),
  toastError: vi.fn(),
  noticeAccept: undefined as
    | ((feedbackOn: boolean) => void | Promise<void>)
    | undefined,
  noticeCancel: undefined as (() => void) | undefined,
}));

vi.mock("../../adapters/voice/useVoiceInput", () => ({
  default: () => ({
    isRecording: false,
    isTranscribing: false,
    startRecording: (...args: unknown[]) => mocks.startRecording(...args),
    stopRecordingAndTranscribe: vi.fn(),
    cancelRecording: vi.fn(),
    isVoiceEnabled: true,
    currentMode: "append_only",
    localAvailable: false,
  }),
}));

vi.mock("../../../voice-input/useSpaceFeedbackSetting", () => ({
  default: () => ({
    spaceSetting: {
      voice_input_enabled: 0,
      voice_feedback_on: 0,
      voice_feedback_notice_acked: 0,
    },
    loaded: true,
    voiceConfig: {},
  }),
  getSharedSpaceFeedbackState: () => ({ loaded: true }),
  acceptVoiceInput: (...args: unknown[]) => mocks.acceptVoiceInput(...args),
}));

vi.mock("../../../voice-input/VoiceFeedbackNotice", () => ({
  default: ({
    onAccept,
    onCancel,
  }: {
    onAccept: (feedbackOn: boolean) => void | Promise<void>;
    onCancel: () => void;
  }) => {
    mocks.noticeAccept = onAccept;
    mocks.noticeCancel = onCancel;
    return (
      <>
        <button data-testid="accept-consent" onClick={() => onAccept(false)}>
          accept
        </button>
        <button data-testid="cancel-consent" onClick={onCancel}>
          cancel
        </button>
      </>
    );
  },
}));

vi.mock("../../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("lucide-react", () => ({
  Mic: () => <span />,
}));

vi.mock("@douyinfe/semi-ui", () => {
  const Dropdown = ({
    children,
    render,
  }: {
    children: React.ReactNode;
    render?: React.ReactNode;
  }) => (
    <>
      {children}
      {render}
    </>
  );
  Dropdown.Menu = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  Dropdown.Item = ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>;
  return {
    Dropdown,
    Toast: {
      error: (...args: unknown[]) => mocks.toastError(...args),
      warning: vi.fn(),
    },
  };
});

import VoiceInputIndicator from "./VoiceInputIndicator";
import type { ChatComposerVoiceHost } from "../../ports";

let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.noticeAccept = undefined;
  mocks.noticeCancel = undefined;
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});

describe("VoiceInputIndicator consent lifecycle", () => {
  it("does not start recording when the space changes during consent", async () => {
    let spaceId = "space-a";
    const listeners = new Set<() => void>();
    const voiceHost: ChatComposerVoiceHost = {
      getSpaceId: () => spaceId,
      subscribeSpaceChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    let resolveConsent!: () => void;
    mocks.acceptVoiceInput.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveConsent = resolve;
      })
    );

    await act(async () => {
      ReactDOM.render(
        <VoiceInputIndicator
          voiceHost={voiceHost}
          onTranscribed={() => undefined}
        />,
        container
      );
    });
    act(() => {
      (
        container.querySelector(".wk-voice-button-group") as HTMLElement
      ).click();
    });
    act(() => {
      (
        container.querySelector('[data-testid="accept-consent"]') as HTMLElement
      ).click();
    });

    spaceId = "space-b";
    act(() => {
      listeners.forEach((listener) => listener());
    });
    await act(async () => {
      resolveConsent();
      await Promise.resolve();
    });

    expect(mocks.acceptVoiceInput).toHaveBeenCalledWith(
      "space-a",
      false,
      expect.any(Function)
    );
    expect(mocks.acceptVoiceInput.mock.calls[0][2]()).toBe(false);
    expect(mocks.startRecording).not.toHaveBeenCalled();
  });

  it("allows only one consent request at a time", async () => {
    const voiceHost: ChatComposerVoiceHost = {
      getSpaceId: () => "space-a",
      subscribeSpaceChange: () => () => {},
    };
    let resolveConsent!: () => void;
    mocks.acceptVoiceInput.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveConsent = resolve;
      })
    );

    await act(async () => {
      ReactDOM.render(
        <VoiceInputIndicator
          voiceHost={voiceHost}
          onTranscribed={() => undefined}
        />,
        container
      );
    });
    act(() => {
      (
        container.querySelector(".wk-voice-button-group") as HTMLElement
      ).click();
    });

    let firstRequest!: Promise<void>;
    act(() => {
      firstRequest = mocks.noticeAccept?.(false) as Promise<void>;
      void mocks.noticeAccept?.(true);
    });
    expect(mocks.acceptVoiceInput).toHaveBeenCalledOnce();

    await act(async () => {
      resolveConsent();
      await firstRequest;
    });

    expect(mocks.startRecording).toHaveBeenCalledOnce();
    expect(mocks.startRecording).toHaveBeenCalledWith("append_only");
  });

  it("resets a cancelled edit consent before a main-button consent", async () => {
    const voiceHost: ChatComposerVoiceHost = {
      getSpaceId: () => "space-a",
      subscribeSpaceChange: () => () => {},
    };
    mocks.acceptVoiceInput.mockResolvedValue(undefined);

    await act(async () => {
      ReactDOM.render(
        <VoiceInputIndicator
          voiceHost={voiceHost}
          onTranscribed={() => undefined}
        />,
        container
      );
    });

    const editMode = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "base.voiceInput.mode.edit"
    ) as HTMLButtonElement;
    act(() => editMode.click());
    act(() => mocks.noticeCancel?.());
    act(() => {
      (
        container.querySelector(".wk-voice-button-group") as HTMLElement
      ).click();
    });

    await act(async () => {
      await mocks.noticeAccept?.(false);
    });

    expect(mocks.startRecording).toHaveBeenCalledOnce();
    expect(mocks.startRecording).toHaveBeenCalledWith("append_only");
  });
});
