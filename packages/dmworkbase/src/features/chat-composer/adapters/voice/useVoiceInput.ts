import { useState, useEffect, useRef, useCallback } from "react";
import { Toast } from "@douyinfe/semi-ui";
import VoiceService, {
  VoiceConfig,
  VoiceContextResponse,
  VoiceMode,
} from "../../../../Service/VoiceService";
import VoiceFeedback, {
  type AsrParams,
} from "../../../../Service/VoiceFeedback";
import LocalModelService, {
  LocalModelConfig,
} from "../../../../Service/LocalModelService";
import type {
  ChatComposerVoiceContext,
  ChatComposerVoiceHost,
} from "../../ports";
import { t } from "../../../../i18n";
import {
  fetchAndApplySpaceSetting,
  resetSharedSpaceSetting,
  setSharedVoiceConfig,
  getSharedSpaceFeedbackState,
  getSharedVoiceConfig,
  subscribe as subscribeSpaceFeedback,
} from "../../../voice-input/useSpaceFeedbackSetting";

export interface UseVoiceInputOptions {
  voiceHost: ChatComposerVoiceHost;
  maxDuration?: number;
  onTranscribed?: (text: string) => void;
  onError?: (error: Error) => void;
  onRecordingFailed?: () => void;
  getChatContext?: () =>
    | ChatComposerVoiceContext
    | Promise<ChatComposerVoiceContext>;
  mode?: VoiceMode;
  scene?: string;
}

export interface UseVoiceInputReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  startRecording: (overrideMode?: VoiceMode) => void;
  stopRecordingAndTranscribe: (contextText?: string) => void;
  cancelRecording: () => void;
  isVoiceEnabled: boolean;
  currentMode: VoiceMode;
  localAvailable: boolean;
  currentUtteranceId: string;
}

interface VoiceOperation {
  epoch: number;
  spaceId: string;
  utteranceId: string;
  mode: VoiceMode;
}

function getSupportedMimeType(): string {
  if (
    typeof MediaRecorder !== "undefined" &&
    MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
  ) {
    return "audio/webm;codecs=opus";
  }
  return "audio/mp4";
}

export default function useVoiceInput(
  options: UseVoiceInputOptions
): UseVoiceInputReturn {
  const {
    voiceHost,
    maxDuration = 60,
    onTranscribed,
    onError,
    onRecordingFailed,
    getChatContext,
    mode = "smart",
    scene = "chat",
  } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [currentMode, setCurrentMode] = useState<VoiceMode>(mode);
  const [localAvailable, setLocalAvailable] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef(0);
  const contextTextRef = useRef<string | undefined>(undefined);
  const utteranceIdRef = useRef("");

  const getChatContextRef = useRef(getChatContext);
  getChatContextRef.current = getChatContext;
  const voiceHostRef = useRef(voiceHost);
  voiceHostRef.current = voiceHost;
  const stopFnRef = useRef<(contextText?: string) => void>(() => {});

  const voiceContextRef = useRef<VoiceContextResponse | null>(null);
  const voiceContextPromiseRef =
    useRef<Promise<VoiceContextResponse | null> | null>(null);
  const voiceContextSpaceIdRef = useRef("");
  const maxFileSizeRef = useRef(0);
  const backendMaxDurationRef = useRef<number | null>(null);
  const backendEnabledRef = useRef(false);
  const feedbackUrlRef = useRef<string | undefined>(undefined);
  const voiceFeedbackOnRef = useRef(0);

  const mountedRef = useRef(true);
  const lifecycleEpochRef = useRef(0);
  const settingGenerationRef = useRef(0);
  const localProbeGenerationRef = useRef(0);
  const operationRef = useRef<VoiceOperation | null>(null);

  const isOperationActive = useCallback((operation: VoiceOperation) => {
    return (
      mountedRef.current &&
      operationRef.current === operation &&
      lifecycleEpochRef.current === operation.epoch &&
      voiceHostRef.current.getSpaceId() === operation.spaceId
    );
  }, []);

  const cleanupRecorder = useCallback(() => {
    if (maxDurationTimeoutRef.current) {
      clearTimeout(maxDurationTimeoutRef.current);
      maxDurationTimeoutRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current
        .getTracks()
        .forEach((track: MediaStreamTrack) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const abortActiveOperation = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    cleanupRecorder();
    operationRef.current = null;
    contextTextRef.current = undefined;
    voiceContextRef.current = null;
    voiceContextPromiseRef.current = null;
    voiceContextSpaceIdRef.current = "";
    if (mountedRef.current) {
      setIsRecording(false);
      setIsTranscribing(false);
    }
  }, [cleanupRecorder]);

  const reconcileSpaceSetting = useCallback(
    (feedbackUrl = feedbackUrlRef.current) => {
      const generation = ++settingGenerationRef.current;
      const host = voiceHostRef.current;
      const spaceId = host.getSpaceId();
      const isCurrent = () =>
        mountedRef.current &&
        settingGenerationRef.current === generation &&
        voiceHostRef.current === host &&
        host.getSpaceId() === spaceId;

      if (!spaceId) {
        VoiceFeedback.init(undefined);
        return;
      }

      void fetchAndApplySpaceSetting(spaceId, feedbackUrl, isCurrent).then(
        () => {
          if (!isCurrent()) return;
          const state = getSharedSpaceFeedbackState();
          voiceFeedbackOnRef.current =
            state.loadedSpaceId === spaceId &&
            state.spaceSetting?.voice_input_enabled === 1 &&
            state.spaceSetting?.voice_feedback_on === 1
              ? 1
              : 0;
        }
      );
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    LocalModelService.shared.loadConfig(localStorage);
    LocalModelService.shared.updateConfig({ enabled: false }, localStorage);

    VoiceService.shared
      .getConfig()
      .then((config: VoiceConfig) => {
        if (cancelled || !mountedRef.current) return;
        setIsVoiceEnabled(config.enabled || config.local_enabled === true);
        backendEnabledRef.current = config.enabled;
        maxFileSizeRef.current = config.max_file_size || 0;
        if (config.max_duration != null) {
          backendMaxDurationRef.current = config.max_duration;
        }
        feedbackUrlRef.current = config.feedback_url;
        setSharedVoiceConfig(config);
        reconcileSpaceSetting(config.feedback_url);
      })
      .catch(() => {
        if (cancelled || !mountedRef.current) return;
        setIsVoiceEnabled(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reconcileSpaceSetting]);

  useEffect(() => {
    const handleSpaceLifecycleChange = () => {
      const previousSpaceId = voiceContextSpaceIdRef.current;
      lifecycleEpochRef.current += 1;
      abortActiveOperation();

      if (previousSpaceId) {
        VoiceService.shared.clearVoiceContextCache(previousSpaceId);
      }
      voiceContextRef.current = null;
      voiceContextPromiseRef.current = null;
      voiceContextSpaceIdRef.current = "";

      VoiceFeedback.destroy();
      resetSharedSpaceSetting();
      voiceFeedbackOnRef.current = 0;
      reconcileSpaceSetting();
    };

    handleSpaceLifecycleChange();
    return voiceHost.subscribeSpaceChange(handleSpaceLifecycleChange);
  }, [voiceHost, abortActiveOperation, reconcileSpaceSetting]);

  useEffect(() => {
    return subscribeSpaceFeedback(() => {
      const state = getSharedSpaceFeedbackState();
      const spaceId = voiceHostRef.current.getSpaceId();
      voiceFeedbackOnRef.current =
        state.loadedSpaceId === spaceId &&
        state.spaceSetting?.voice_input_enabled === 1 &&
        state.spaceSetting?.voice_feedback_on === 1
          ? 1
          : 0;
    });
  }, []);

  useEffect(() => {
    const previous = {
      enabled: false,
      probeUrl: "",
      transcribeUrl: "",
      timeoutMs: 0,
    };
    return subscribeSpaceFeedback(() => {
      const config = getSharedVoiceConfig();
      if (!config) return;

      const next = {
        enabled: config.local_enabled === true,
        probeUrl: config.local_probe_url ?? "",
        transcribeUrl: config.local_transcribe_url ?? "",
        timeoutMs: config.local_timeout_ms ?? 10000,
      };
      const changed =
        next.enabled !== previous.enabled ||
        next.probeUrl !== previous.probeUrl ||
        next.transcribeUrl !== previous.transcribeUrl ||
        next.timeoutMs !== previous.timeoutMs;
      if (!changed) return;
      Object.assign(previous, next);

      const generation = ++localProbeGenerationRef.current;
      if (next.enabled) {
        const updateFields: Partial<LocalModelConfig> = {
          enabled: true,
          requestTimeoutMs: next.timeoutMs,
        };
        if (next.probeUrl) updateFields.probeUrl = next.probeUrl;
        if (next.transcribeUrl) {
          updateFields.transcribeUrl = next.transcribeUrl;
        }
        LocalModelService.shared.updateConfig(updateFields, localStorage);
        void LocalModelService.shared.probe().then((available) => {
          if (
            mountedRef.current &&
            localProbeGenerationRef.current === generation
          ) {
            setLocalAvailable(available);
          }
        });
      } else {
        LocalModelService.shared.updateConfig({ enabled: false }, localStorage);
        if (mountedRef.current) setLocalAvailable(false);
      }
    });
  }, []);

  const startRecording = useCallback(
    async (overrideMode?: VoiceMode) => {
      if (operationRef.current) return;

      const operation: VoiceOperation = {
        epoch: lifecycleEpochRef.current,
        spaceId: voiceHostRef.current.getSpaceId(),
        utteranceId:
          crypto.randomUUID?.() ??
          Math.random().toString(36).slice(2) + Date.now().toString(36),
        mode: overrideMode ?? mode,
      };
      operationRef.current = operation;
      utteranceIdRef.current = operation.utteranceId;
      setCurrentMode(operation.mode);

      voiceContextRef.current = null;
      voiceContextSpaceIdRef.current = operation.spaceId;
      if (operation.spaceId) {
        voiceContextPromiseRef.current = VoiceService.shared
          .getVoiceContext(operation.spaceId)
          .then((response) => {
            if (isOperationActive(operation)) {
              voiceContextRef.current = response;
            }
            return response;
          })
          .catch(() => null);
      } else {
        voiceContextPromiseRef.current = null;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (!isOperationActive(operation)) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const mimeType = getSupportedMimeType();
        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (event: BlobEvent) => {
          if (isOperationActive(operation) && event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };

        recorder.start();
        setIsRecording(true);
        startTimeRef.current = Date.now();

        const effectiveDuration = Math.max(
          5,
          backendMaxDurationRef.current ?? maxDuration
        );
        maxDurationTimeoutRef.current = setTimeout(() => {
          if (isOperationActive(operation)) stopFnRef.current();
        }, effectiveDuration * 1000);
      } catch (errorValue) {
        if (!isOperationActive(operation)) return;
        const error =
          errorValue instanceof Error
            ? errorValue
            : new Error("Microphone access denied");
        onError?.(error);
        cleanupRecorder();
        operationRef.current = null;
        onRecordingFailed?.();
      }
    },
    [
      mode,
      maxDuration,
      onError,
      onRecordingFailed,
      cleanupRecorder,
      isOperationActive,
    ]
  );

  const stopRecordingAndTranscribe = useCallback(
    (contextText?: string) => {
      if (contextText !== undefined) contextTextRef.current = contextText;
      const operation = operationRef.current;
      const recorder = mediaRecorderRef.current;
      if (
        !operation ||
        !isOperationActive(operation) ||
        !recorder ||
        recorder.state === "inactive"
      ) {
        abortActiveOperation();
        return;
      }

      const capturedStartTime = startTimeRef.current;
      const capturedContextText = contextTextRef.current;

      recorder.onstop = async () => {
        const mimeType = getSupportedMimeType();
        const blob = new Blob(chunksRef.current, { type: mimeType });
        cleanupRecorder();
        if (!isOperationActive(operation)) return;
        setIsRecording(false);

        try {
          const recordingDurationMs = Date.now() - capturedStartTime;
          if (recordingDurationMs < 1000) {
            Toast.warning(t("base.voiceInput.error.noSpeech"));
            return;
          }

          if (
            maxFileSizeRef.current > 0 &&
            blob.size > maxFileSizeRef.current
          ) {
            Toast.error(t("base.voiceInput.error.fileTooLarge"));
            onError?.(new Error("Recording file size exceeds limit"));
            return;
          }

          setIsTranscribing(true);
          const allowFeedback = voiceFeedbackOnRef.current === 1;
          const notifyFeedback = (
            text: string,
            source: "local" | "remote",
            requestId?: string,
            asrParams?: AsrParams
          ) => {
            if (
              !isOperationActive(operation) ||
              voiceFeedbackOnRef.current !== 1
            ) {
              return;
            }
            VoiceFeedback.shared()?.onTranscribeResult({
              utteranceId: operation.utteranceId,
              modelText: text,
              source,
              requestId,
              scene,
              audioBlob: source === "local" ? blob : undefined,
              asrParams,
            });
          };

          const localConfig = LocalModelService.shared.config;
          const useLocalFirst = localConfig.preferLocal && localConfig.enabled;

          if (useLocalFirst) {
            const contextPromise = voiceContextPromiseRef.current
              ? Promise.race([
                  voiceContextPromiseRef.current,
                  new Promise<null>((resolve) =>
                    setTimeout(() => resolve(null), 3000)
                  ),
                ])
              : Promise.resolve(null);
            const chatContextPromise =
              getChatContextRef.current?.() ?? Promise.resolve({});

            await contextPromise;
            if (!isOperationActive(operation)) return;
            voiceContextPromiseRef.current = null;

            const voiceContext = voiceContextRef.current;
            const personalContext =
              voiceContext?.has_context === true
                ? voiceContext.context
                : undefined;
            const chatContextResult = (await chatContextPromise) ?? {};
            if (!isOperationActive(operation)) return;
            const { memberContext, chatContext, selfName, channelType } =
              chatContextResult;

            const localResult = await LocalModelService.shared.transcribe(
              blob,
              capturedContextText,
              chatContext,
              personalContext,
              memberContext,
              operation.mode,
              selfName
            );
            if (!isOperationActive(operation)) return;
            if (localResult) {
              if (localResult.text) {
                notifyFeedback(localResult.text, "local", undefined, {
                  contextText: capturedContextText,
                  chatContext,
                  personalContext,
                  memberContext,
                  selfName,
                  mode: operation.mode,
                  channelType,
                  model: localResult.m,
                  allowFeedback,
                });
                onTranscribed?.(localResult.text);
              }
              return;
            }

            if (!backendEnabledRef.current) {
              Toast.error(t("base.voiceInput.error.localTranscriptionFailed"));
              onError?.(new Error("Transcription failed"));
              return;
            }

            const result = await VoiceService.shared.transcribe(
              blob,
              capturedContextText,
              chatContext,
              personalContext,
              memberContext,
              operation.mode,
              true,
              channelType,
              allowFeedback,
              selfName
            );
            if (!isOperationActive(operation)) return;
            if (result.text) {
              notifyFeedback(result.text, "remote", result.request_id);
              onTranscribed?.(result.text);
            }
            return;
          }

          if (voiceContextPromiseRef.current) {
            await voiceContextPromiseRef.current;
            if (!isOperationActive(operation)) return;
            voiceContextPromiseRef.current = null;
          }

          const voiceContext = voiceContextRef.current;
          const personalContext =
            voiceContext?.has_context === true
              ? voiceContext.context
              : undefined;
          const chatContextResult = (await getChatContextRef.current?.()) ?? {};
          if (!isOperationActive(operation)) return;
          const { memberContext, chatContext, selfName, channelType } =
            chatContextResult;

          if (!backendEnabledRef.current) {
            Toast.error(t("base.voiceInput.error.unavailable"));
            onError?.(new Error("Transcription failed"));
            return;
          }

          const result = await VoiceService.shared.transcribe(
            blob,
            capturedContextText,
            chatContext,
            personalContext,
            memberContext,
            operation.mode,
            true,
            channelType,
            allowFeedback,
            selfName
          );
          if (!isOperationActive(operation)) return;
          if (result.text) {
            notifyFeedback(result.text, "remote", result.request_id);
            onTranscribed?.(result.text);
          }
        } catch {
          if (!isOperationActive(operation)) return;
          Toast.error(t("base.voiceInput.error.transcriptionFailedRetry"));
          onError?.(new Error("Transcription failed"));
        } finally {
          if (operationRef.current === operation) {
            operationRef.current = null;
            contextTextRef.current = undefined;
            if (mountedRef.current) setIsTranscribing(false);
          }
        }
      };

      recorder.stop();
    },
    [
      cleanupRecorder,
      abortActiveOperation,
      isOperationActive,
      onTranscribed,
      onError,
      scene,
    ]
  );

  stopFnRef.current = stopRecordingAndTranscribe;

  const cancelRecording = useCallback(() => {
    lifecycleEpochRef.current += 1;
    abortActiveOperation();
  }, [abortActiveOperation]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      lifecycleEpochRef.current += 1;
      settingGenerationRef.current += 1;
      localProbeGenerationRef.current += 1;
      abortActiveOperation();
    };
  }, [abortActiveOperation]);

  return {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecordingAndTranscribe,
    cancelRecording,
    isVoiceEnabled,
    currentMode,
    localAvailable,
    currentUtteranceId: utteranceIdRef.current,
  };
}
