import { useState, useEffect, useRef, useCallback } from "react";
import { Toast } from "@douyinfe/semi-ui";
import VoiceService, {
  VoiceConfig,
  VoiceContextResponse,
  VoiceMode,
} from "../../Service/VoiceService";
import LocalModelService, { LocalModelConfig } from "../../Service/LocalModelService";
import WKApp from "../../App";
import { ChatContextResult } from "../Conversation/chatContext";

export interface UseVoiceInputOptions {
  maxDuration?: number;
  onTranscribed?: (text: string) => void;
  onError?: (error: Error) => void;
  onRecordingFailed?: () => void;
  getChatContext?: () => ChatContextResult | Promise<ChatContextResult>;
  mode?: VoiceMode;
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
  options: UseVoiceInputOptions = {}
): UseVoiceInputReturn {
  const {
    maxDuration = 60, // PRD: 最长录音时长 60秒
    onTranscribed,
    onError,
    onRecordingFailed,
    getChatContext,
    mode = "smart",
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
  const startTimeRef = useRef<number>(0);
  const contextTextRef = useRef<string | undefined>(undefined);
  const recordingModeRef = useRef<VoiceMode>(mode);

  const getChatContextRef = useRef(getChatContext);
  getChatContextRef.current = getChatContext;
  const stopFnRef = useRef<(contextText?: string) => void>(() => {});

  const voiceContextRef = useRef<VoiceContextResponse | null>(null);
  const voiceContextPromiseRef =
    useRef<Promise<VoiceContextResponse | null> | null>(null);
  const voiceContextSpaceIdRef = useRef<string>("");
  const maxFileSizeRef = useRef<number>(0);
  const backendMaxDurationRef = useRef<number | null>(null);
  const backendEnabledRef = useRef(false);

  // Load local model config from localStorage on mount, then fetch voice config
  useEffect(() => {
    let cancelled = false;

    LocalModelService.shared.loadConfig(localStorage);
    LocalModelService.shared.updateConfig({ enabled: false }, localStorage);

    const LOCAL_DEFAULT_TIMEOUT_MS = 10000;

    VoiceService.shared
      .getConfig()
      .then((config: VoiceConfig) => {
        if (cancelled) return;
        const localAllowed = config.local_enabled === true;
        setIsVoiceEnabled(config.enabled || localAllowed);
        backendEnabledRef.current = config.enabled;
        maxFileSizeRef.current = config.max_file_size || 0;
        if (config.max_duration != null) {
          backendMaxDurationRef.current = config.max_duration;
        }
        const localTimeout = config.local_timeout_ms ?? LOCAL_DEFAULT_TIMEOUT_MS;

        if (localAllowed) {
          const updateFields: Partial<LocalModelConfig> = {
            enabled: true,
            requestTimeoutMs: localTimeout,
          };
          // Backend-provided URLs take priority
          if (config.local_probe_url) {
            updateFields.probeUrl = config.local_probe_url;
          }
          if (config.local_transcribe_url) {
            updateFields.transcribeUrl = config.local_transcribe_url;
          }
          LocalModelService.shared.updateConfig(updateFields, localStorage);
          // Probe immediately so status becomes "available" before first recording
          LocalModelService.shared.probe().then((available) => {
            if (!cancelled) setLocalAvailable(available);
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Backend unreachable: keep local disabled (safety-first, require backend confirmation)
        setIsVoiceEnabled(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Listen for space changes to clear stale cache
  useEffect(() => {
    const handler = () => {
      const prevSpaceId = voiceContextSpaceIdRef.current;
      if (prevSpaceId) {
        VoiceService.shared.clearVoiceContextCache(prevSpaceId);
      }
      voiceContextRef.current = null;
      voiceContextPromiseRef.current = null;
      voiceContextSpaceIdRef.current = "";
    };
    WKApp.mittBus.on("space-changed", handler);
    return () => {
      WKApp.mittBus.off("space-changed", handler);
    };
  }, []);

  const cleanup = useCallback(() => {
    if (maxDurationTimeoutRef.current) {
      clearTimeout(maxDurationTimeoutRef.current);
      maxDurationTimeoutRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const startRecording = useCallback(
    async (overrideMode?: VoiceMode) => {
      if (isRecording) {
        return;
      }

      // 保存本次录音使用的 mode
      recordingModeRef.current = overrideMode ?? mode;
      setCurrentMode(recordingModeRef.current);

      voiceContextRef.current = null;

      const spaceId = WKApp.shared.currentSpaceId;
      voiceContextSpaceIdRef.current = spaceId;

      if (spaceId) {
        const promise = VoiceService.shared
          .getVoiceContext(spaceId)
          .then((resp) => {
            if (voiceContextSpaceIdRef.current === spaceId) {
              voiceContextRef.current = resp;
            }
            return resp;
          })
          .catch(() => {
            return null;
          });
        voiceContextPromiseRef.current = promise;
      } else {
        voiceContextPromiseRef.current = null;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        streamRef.current = stream;

        const mimeType = getSupportedMimeType();
        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e: BlobEvent) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        recorder.start();
        setIsRecording(true);

        // 记录开始时间
        startTimeRef.current = Date.now();

        // 使用 setTimeout 替代 setInterval 处理 maxDuration 自动停止
        const effectiveDuration = Math.max(
          5,
          backendMaxDurationRef.current ?? maxDuration
        );
        maxDurationTimeoutRef.current = setTimeout(() => {
          stopFnRef.current();
        }, effectiveDuration * 1000);
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Microphone access denied");
        if (onError) onError(error);
        cleanup();
        if (onRecordingFailed) onRecordingFailed();
      }
    },
    [isRecording, maxDuration, onError, onRecordingFailed, cleanup]
  );

  const stopRecordingAndTranscribe = useCallback(
    (contextText?: string) => {
      if (contextText !== undefined) {
        contextTextRef.current = contextText;
      }
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        cleanup();
        setIsRecording(false);
        return;
      }

      // 捕获开始时间到局部变量，避免竞态问题
      const capturedStartTime = startTimeRef.current;

      recorder.onstop = async () => {
        const mimeType = getSupportedMimeType();
        const blob = new Blob(chunksRef.current, { type: mimeType });
        cleanup();
        setIsRecording(false);

        // PRD: 录音时长不足 1 秒，Toast「未检测到语音」
        const recordingDurationMs = Date.now() - capturedStartTime;
        if (recordingDurationMs < 1000) {
          Toast.warning("未检测到语音");
          return;
        }

        if (maxFileSizeRef.current > 0 && blob.size > maxFileSizeRef.current) {
          Toast.error("录音文件过大");
          if (onError) onError(new Error("Recording file size exceeds limit"));
          return;
        }

        setIsTranscribing(true);
        try {
          const localConfig = LocalModelService.shared.config;
          const useLocalFirst =
            localConfig.preferLocal &&
            localConfig.enabled;

          if (useLocalFirst) {
            const contextPromise = voiceContextPromiseRef.current
              ? Promise.race([
                  voiceContextPromiseRef.current,
                  new Promise<null>((resolve) =>
                    setTimeout(() => resolve(null), 3000)
                  ),
                ])
              : Promise.resolve(null);
            const chatCtxPromise =
              getChatContextRef.current?.() ?? Promise.resolve({});

            // Await context before passing to local model
            await contextPromise;
            voiceContextPromiseRef.current = null;

            let personalContext: string | undefined;
            const voiceCtx = voiceContextRef.current;
            if (voiceCtx && voiceCtx.has_context === true && voiceCtx.context) {
              personalContext = voiceCtx.context;
            }

            const chatCtxResult = (await chatCtxPromise) ?? {};
            const memberContext = chatCtxResult.memberContext;
            const chatContext = chatCtxResult.chatContext;

            const localResult =
              await LocalModelService.shared.transcribe(
                blob,
                contextTextRef.current,
                chatContext,
                personalContext,
                memberContext,
                recordingModeRef.current,
              );
            if (localResult) {
              if (localResult.text && onTranscribed) {
                onTranscribed(localResult.text);
              }
              return;
            }

            if (!backendEnabledRef.current) {
              Toast.error("本地转写失败");
              if (onError) onError(new Error("Transcription failed"));
              return;
            }

            const result = await VoiceService.shared.transcribe(
              blob,
              contextTextRef.current,
              chatContext,
              personalContext,
              memberContext,
              recordingModeRef.current,
              true,
              chatCtxResult.channelType,
            );
            if (result.text && onTranscribed) {
              onTranscribed(result.text);
            }
            return;
          }

          if (voiceContextPromiseRef.current) {
            await voiceContextPromiseRef.current;
            voiceContextPromiseRef.current = null;
          }

          // 个人纠错上下文
          let personalContext: string | undefined;
          const voiceCtx = voiceContextRef.current;
          if (voiceCtx && voiceCtx.has_context === true && voiceCtx.context) {
            personalContext = voiceCtx.context;
          }

          // 群成员名 + 聊天消息上下文
          const chatCtxResult = (await getChatContextRef.current?.()) ?? {};
          const memberContext = chatCtxResult.memberContext;
          const chatContext = chatCtxResult.chatContext;

          if (!backendEnabledRef.current) {
            Toast.error("语音功能不可用");
            if (onError) onError(new Error("Transcription failed"));
            return;
          }

          const result = await VoiceService.shared.transcribe(
            blob,
            contextTextRef.current,
            chatContext,
            personalContext,
            memberContext,
            recordingModeRef.current,
            true,
            chatCtxResult.channelType,
          );
          if (result.text && onTranscribed) {
            onTranscribed(result.text);
          }
        } catch (err) {
          // PRD: 转写失败时 Toast「转写失败，请重试」
          Toast.error("转写失败，请重试");
          // 统一使用 "Transcription failed" 确保 VoiceInputIndicator 能正确过滤，避免双重 Toast
          if (onError) onError(new Error("Transcription failed"));
        } finally {
          setIsTranscribing(false);
          contextTextRef.current = undefined;
        }
      };

      recorder.stop();
    },
    [cleanup, onTranscribed, onError]
  );

  stopFnRef.current = stopRecordingAndTranscribe;

  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    cleanup();
    setIsRecording(false);
    voiceContextRef.current = null;
    voiceContextPromiseRef.current = null;
    voiceContextSpaceIdRef.current = "";
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      cleanup();
    };
  }, [cleanup]);

  return {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecordingAndTranscribe,
    cancelRecording,
    isVoiceEnabled,
    currentMode,
    localAvailable,
  };
}
