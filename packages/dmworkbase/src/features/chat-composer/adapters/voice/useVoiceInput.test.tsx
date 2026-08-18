/** @vitest-environment jsdom */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getVoiceContext: vi.fn(),
  transcribe: vi.fn(),
  clearVoiceContextCache: vi.fn(),
  fetchAndApplySpaceSetting: vi.fn(),
  resetSharedSpaceSetting: vi.fn(),
  setSharedVoiceConfig: vi.fn(),
  voiceFeedbackInit: vi.fn(),
  voiceFeedbackDestroy: vi.fn(),
  loadLocalConfig: vi.fn(),
  updateLocalConfig: vi.fn(),
  probeLocal: vi.fn(),
  transcribeLocal: vi.fn(),
  setVoiceSettings: vi.fn(),
  getUserMedia: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  feedbackListeners: new Set<() => void>(),
  localConfig: { preferLocal: false, enabled: false },
  voiceFeedbackShared: null as null | {
    onTranscribeResult: ReturnType<typeof vi.fn>;
  },
  spaceFeedbackState: {
    spaceSetting: null as null | {
      voice_input_enabled: number;
      voice_feedback_on: number;
      voice_feedback_notice_acked: number;
    },
    loaded: false,
    apiAvailable: false,
    loadedSpaceId: null as string | null,
  },
  localVoiceSettings: {
    microphoneDeviceId: "",
    localEnabled: false,
    localProbeUrl: "http://localhost:8787/",
    localTranscribeUrl: "http://localhost:8787/v1/voice/transcribe",
    localTimeoutMs: 10000,
  },
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: {
    warning: (...args: unknown[]) => mocks.toastWarning(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
  },
}));

vi.mock("../../../../Service/VoiceService", () => ({
  default: {
    shared: {
      getConfig: (...args: unknown[]) => mocks.getConfig(...args),
      getVoiceContext: (...args: unknown[]) => mocks.getVoiceContext(...args),
      transcribe: (...args: unknown[]) => mocks.transcribe(...args),
      clearVoiceContextCache: (...args: unknown[]) =>
        mocks.clearVoiceContextCache(...args),
    },
  },
}));

vi.mock("../../../../Service/VoiceFeedback", () => ({
  default: {
    shared: () => mocks.voiceFeedbackShared,
    init: (...args: unknown[]) => mocks.voiceFeedbackInit(...args),
    destroy: (...args: unknown[]) => mocks.voiceFeedbackDestroy(...args),
  },
}));

vi.mock("../../../../Service/LocalModelService", () => ({
  default: {
    shared: {
      get config() {
        return mocks.localConfig;
      },
      loadConfig: (...args: unknown[]) => mocks.loadLocalConfig(...args),
      updateConfig: (...args: unknown[]) => mocks.updateLocalConfig(...args),
      probe: (...args: unknown[]) => mocks.probeLocal(...args),
      transcribe: (...args: unknown[]) => mocks.transcribeLocal(...args),
    },
  },
}));

vi.mock("../../../../Service/VoiceSettingsStore", () => ({
  voiceSettingsStore: {
    get: () => mocks.localVoiceSettings,
    set: (patch: Record<string, unknown>) => { Object.assign(mocks.localVoiceSettings, patch); mocks.setVoiceSettings(patch); return mocks.localVoiceSettings; },
    subscribe: () => () => {},
  },
}));

vi.mock("../../../../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../../voice-input/useSpaceFeedbackSetting", () => ({
  fetchAndApplySpaceSetting: (...args: unknown[]) =>
    mocks.fetchAndApplySpaceSetting(...args),
  resetSharedSpaceSetting: (...args: unknown[]) =>
    mocks.resetSharedSpaceSetting(...args),
  setSharedVoiceConfig: (...args: unknown[]) =>
    mocks.setSharedVoiceConfig(...args),
  getSharedSpaceFeedbackState: () => mocks.spaceFeedbackState,
  getSharedVoiceConfig: () => null,
  subscribe: (listener: () => void) => {
    mocks.feedbackListeners.add(listener);
    return () => mocks.feedbackListeners.delete(listener);
  },
}));

import useVoiceInput, { type UseVoiceInputReturn } from "./useVoiceInput";
import type { ChatComposerVoiceHost } from "../../ports";

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static isTypeSupported = vi.fn(() => true);

  state: RecordingState = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream, _options: MediaRecorderOptions) {
    MockMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.onstop?.();
  }

  emitData(data: Blob) {
    this.ondataavailable?.({ data });
  }
}

function createHost(initialSpaceId: string) {
  let spaceId = initialSpaceId;
  const listeners = new Set<() => void>();
  const host: ChatComposerVoiceHost = {
    getSpaceId: () => spaceId,
    subscribeSpaceChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    host,
    changeSpace(nextSpaceId: string) {
      spaceId = nextSpaceId;
      listeners.forEach((listener) => listener());
    },
  };
}

let latest: UseVoiceInputReturn;
let container: HTMLDivElement;

function Probe({
  host,
  onTranscribed,
}: {
  host: ChatComposerVoiceHost;
  onTranscribed: (text: string) => void;
}) {
  latest = useVoiceInput({ voiceHost: host, onTranscribed });
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.feedbackListeners.clear();
  mocks.localConfig.preferLocal = false;
  mocks.localConfig.enabled = false;
  mocks.voiceFeedbackShared = null;
  mocks.spaceFeedbackState = {
    spaceSetting: null,
    loaded: false,
    apiAvailable: false,
    loadedSpaceId: null,
  };
  Object.assign(mocks.localVoiceSettings, {
    microphoneDeviceId: "",
    localEnabled: false,
    localProbeUrl: "http://localhost:8787/",
    localTranscribeUrl: "http://localhost:8787/v1/voice/transcribe",
    localTimeoutMs: 10000,
  });
  mocks.getConfig.mockResolvedValue({ enabled: true });
  mocks.getVoiceContext.mockResolvedValue({ has_context: false });
  mocks.fetchAndApplySpaceSetting.mockResolvedValue(undefined);
  mocks.probeLocal.mockResolvedValue(false);
  MockMediaRecorder.instances.length = 0;
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: MockMediaRecorder,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: mocks.getUserMedia },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
  vi.restoreAllMocks();
});

describe("useVoiceInput space lifecycle", () => {
  it("applies local voice settings to the runtime model service", async () => {
    Object.assign(mocks.localVoiceSettings, {
      localEnabled: true,
      localProbeUrl: "http://127.0.0.1:9000/health",
      localTranscribeUrl: "http://127.0.0.1:9000/transcribe",
      localTimeoutMs: 7000,
    });
    const current = createHost("space-a");

    await act(async () => {
      ReactDOM.render(
        <Probe host={current.host} onTranscribed={() => undefined} />,
        container,
      );
    });
    await flush();

    expect(mocks.updateLocalConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        probeUrl: "http://127.0.0.1:9000/health",
        transcribeUrl: "http://127.0.0.1:9000/transcribe",
        requestTimeoutMs: 7000,
        preferLocal: true,
      }),
      localStorage,
    );
  });

  it("passes the selected microphone constraint to getUserMedia", async () => {
    mocks.localVoiceSettings.microphoneDeviceId = "mic-1";
    mocks.getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream);
    const current = createHost("space-a");

    await act(async () => {
      ReactDOM.render(<Probe host={current.host} onTranscribed={() => undefined} />, container);
    });
    act(() => { latest.startRecording(); });
    await flush();

    expect(mocks.getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: "mic-1" } } });
  });

  it("retries local availability after the service starts later", async () => {
    vi.useFakeTimers();
    mocks.localVoiceSettings.localEnabled = true;
    mocks.probeLocal.mockResolvedValueOnce(false).mockResolvedValue(true);
    const current = createHost("space-a");

    await act(async () => {
      ReactDOM.render(<Probe host={current.host} onTranscribed={() => undefined} />, container);
      await Promise.resolve();
    });
    mocks.probeLocal.mockClear();
    act(() => { vi.advanceTimersByTime(5000); });
    await flush();

    expect(mocks.probeLocal).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("falls back to the default microphone when the selected device disappears", async () => {
    mocks.localVoiceSettings.microphoneDeviceId = "missing-mic";
    mocks.getUserMedia
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { name: "OverconstrainedError" }))
      .mockResolvedValueOnce({ getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream);
    const current = createHost("space-a");

    await act(async () => {
      ReactDOM.render(<Probe host={current.host} onTranscribed={() => undefined} />, container);
    });
    act(() => { latest.startRecording(); });
    await flush();

    expect(mocks.setVoiceSettings).toHaveBeenCalledWith({ microphoneDeviceId: "" });
    expect(mocks.getUserMedia).toHaveBeenLastCalledWith({ audio: true });
  });

  it("does not tear down shared voice feedback on a plain mount", async () => {
    const current = createHost("space-a");

    await act(async () => {
      ReactDOM.render(
        <Probe host={current.host} onTranscribed={() => undefined} />,
        container
      );
    });

    expect(mocks.voiceFeedbackDestroy).not.toHaveBeenCalled();
    expect(mocks.resetSharedSpaceSetting).not.toHaveBeenCalled();
  });

  it("reconciles the replacement host immediately", async () => {
    const first = createHost("space-a");
    const second = createHost("space-b");

    await act(async () => {
      ReactDOM.render(
        <Probe host={first.host} onTranscribed={() => undefined} />,
        container
      );
    });
    mocks.fetchAndApplySpaceSetting.mockClear();

    await act(async () => {
      ReactDOM.render(
        <Probe host={second.host} onTranscribed={() => undefined} />,
        container
      );
    });

    expect(mocks.fetchAndApplySpaceSetting).toHaveBeenCalledWith(
      "space-b",
      undefined,
      expect.any(Function)
    );
  });

  it("stops a microphone stream that resolves after the space changed", async () => {
    let resolveStream!: (stream: MediaStream) => void;
    mocks.getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        resolveStream = resolve;
      })
    );
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    const current = createHost("space-a");

    await act(async () => {
      ReactDOM.render(
        <Probe host={current.host} onTranscribed={() => undefined} />,
        container
      );
    });
    act(() => {
      latest.startRecording();
    });
    act(() => {
      current.changeSpace("space-b");
    });
    await act(async () => {
      resolveStream(stream);
      await Promise.resolve();
    });

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(MockMediaRecorder.instances).toHaveLength(0);
    expect(latest.isRecording).toBe(false);
  });

  it("stops a pending microphone stream when the host changes in the same space", async () => {
    let resolveStream!: (stream: MediaStream) => void;
    mocks.getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        resolveStream = resolve;
      })
    );
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    const first = createHost("space-a");
    const second = createHost("space-a");

    await act(async () => {
      ReactDOM.render(
        <Probe host={first.host} onTranscribed={() => undefined} />,
        container
      );
    });
    act(() => {
      latest.startRecording();
    });
    await act(async () => {
      ReactDOM.render(
        <Probe host={second.host} onTranscribed={() => undefined} />,
        container
      );
      resolveStream(stream);
      await Promise.resolve();
    });

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(MockMediaRecorder.instances).toHaveLength(0);
  });

  it("remains mounted when rendered under StrictMode", async () => {
    mocks.getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream);
    const current = createHost("space-a");

    await act(async () => {
      ReactDOM.render(
        <React.StrictMode>
          <Probe host={current.host} onTranscribed={() => undefined} />
        </React.StrictMode>,
        container
      );
    });
    act(() => {
      latest.startRecording();
    });
    await flush();

    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(latest.isRecording).toBe(true);
  });

  it("ignores a transcription result after the recording space changed", async () => {
    const stopTrack = vi.fn();
    mocks.getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream);
    let resolveTranscription!: (value: { text: string }) => void;
    mocks.transcribe.mockReturnValue(
      new Promise((resolve) => {
        resolveTranscription = resolve;
      })
    );
    const onTranscribed = vi.fn();
    const current = createHost("space-a");
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);

    await act(async () => {
      ReactDOM.render(
        <Probe host={current.host} onTranscribed={onTranscribed} />,
        container
      );
    });
    act(() => {
      latest.startRecording();
    });
    await flush();
    const recorder = MockMediaRecorder.instances[0];
    recorder.emitData(new Blob(["audio"]));
    now.mockReturnValue(3000);

    await act(async () => {
      latest.stopRecordingAndTranscribe();
      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
    });
    expect(mocks.transcribe).toHaveBeenCalledOnce();

    act(() => {
      current.changeSpace("space-b");
    });
    await act(async () => {
      resolveTranscription({ text: "text from space a" });
      await Promise.resolve();
    });

    expect(onTranscribed).not.toHaveBeenCalled();
    expect(latest.isTranscribing).toBe(false);
  });

  it("preserves legacy feedback after an unacknowledged setting notification", async () => {
    const onTranscribeResult = vi.fn();
    let resolveVoiceContext!: (value: { has_context: boolean }) => void;
    mocks.voiceFeedbackShared = { onTranscribeResult };
    mocks.getVoiceContext.mockReturnValue(
      new Promise((resolve) => {
        resolveVoiceContext = resolve;
      })
    );
    mocks.spaceFeedbackState = {
      spaceSetting: {
        voice_input_enabled: 1,
        voice_feedback_on: 1,
        voice_feedback_notice_acked: 1,
      },
      loaded: true,
      apiAvailable: true,
      loadedSpaceId: "space-a",
    };
    mocks.getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream);
    mocks.transcribe.mockResolvedValue({ text: "hello" });
    const current = createHost("space-a");
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);

    await act(async () => {
      ReactDOM.render(
        <Probe host={current.host} onTranscribed={() => undefined} />,
        container
      );
    });
    act(() => {
      latest.startRecording();
    });
    await flush();
    MockMediaRecorder.instances[0].emitData(new Blob(["audio"]));
    now.mockReturnValue(3000);

    await act(async () => {
      latest.stopRecordingAndTranscribe();
      await Promise.resolve();
    });
    mocks.spaceFeedbackState.spaceSetting = {
      voice_input_enabled: 1,
      voice_feedback_on: 1,
      voice_feedback_notice_acked: 0,
    };
    act(() => {
      mocks.feedbackListeners.forEach((listener) => listener());
    });
    await act(async () => {
      resolveVoiceContext({ has_context: false });
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });

    expect(mocks.transcribe).toHaveBeenCalledOnce();
    expect(mocks.transcribe.mock.calls[0][8]).toBe(true);
    expect(onTranscribeResult).toHaveBeenCalled();
  });
});
