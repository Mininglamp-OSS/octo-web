import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { Toast, Tooltip } from "@douyinfe/semi-ui";
import { Mic } from "lucide-react";
import useVoiceInput from "../../adapters/voice/useVoiceInput";
import "./voiceInput.css";
import type {
  ChatComposerVoiceContext,
  ChatComposerVoiceHost,
} from "../../ports";
import { useI18n } from "../../../../i18n";
import { getMicrophonePermission, getVoiceShortcut, refreshMicrophonePermission, subscribeMicrophonePermission, voiceSettingsStore, voiceShortcutMatches } from "../../../../Service/VoiceSettingsStore";

type ReplaceMode = "all" | "selection" | "insert";

/** 选区位置信息 */
interface SelectionRange {
  from: number;
  to: number;
}

interface VoiceInputIndicatorProps {
  onRecordingStarted?: () => void;
  voiceHost: ChatComposerVoiceHost;
  onTranscribed: (
    text: string,
    replaceMode: ReplaceMode,
    savedSelectedText?: string,
    savedSelectionRange?: SelectionRange
  ) => void;
  getCurrentText?: () => string | undefined;
  getSelectedText?: () => string | undefined;
  /** 获取当前选区的 ProseMirror 位置 */
  getSelectionRange?: () => SelectionRange | undefined;
  getChatContext?: () =>
    | ChatComposerVoiceContext
    | Promise<ChatComposerVoiceContext>;
  /** 判断当前输入框是否处于活动状态（用于避免多个输入框同时响应语音快捷键） */
  checkIsInputActive?: () => boolean;
}

// Floating indicator positioning constants
const FLOATING_GAP = 20;
const INDICATOR_HEIGHT = 48;

export default function VoiceInputIndicator({
  onRecordingStarted,
  voiceHost,
  onTranscribed,
  getChatContext,
  checkIsInputActive,
}: VoiceInputIndicatorProps) {
  const { t } = useI18n();
  const [voiceSettings, setVoiceSettings] = useState(() => voiceSettingsStore.get());
  const [microphonePermission, setMicrophonePermission] = useState(() => getMicrophonePermission());
  useEffect(() => voiceSettingsStore.subscribe(setVoiceSettings), []);
  useEffect(() => subscribeMicrophonePermission(setMicrophonePermission), []);
  useEffect(() => { void refreshMicrophonePermission(); }, []);
  const shortcutStartedRef = useRef(false);
  const holdShortcutDownRef = useRef(false);
  const {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecordingAndTranscribe,
    cancelRecording,
    isVoiceEnabled,
    localAvailable,
  } = useVoiceInput({
    voiceHost,
    onTranscribed: (text: string) => {
      if (shortcutStartedRef.current) {
        voiceSettingsStore.markShortcutLearned(/Mac|iPhone|iPad/i.test(navigator.userAgent) ? "macos" : "windows", voiceSettings.speakingMode);
        shortcutStartedRef.current = false;
      }
      onTranscribed(text, "insert");
    },
    getChatContext,
    mode: "append_only",
    onError: (error) => {
      // 麦克风权限被拒绝时显示中文提示
      if (
        error.message.includes("denied") ||
        error.message.includes("Permission") ||
        error.message.includes("NotAllowedError")
      ) {
        Toast.error(t("base.voiceInput.error.allowMicrophone"));
      } else if (
        error.message.includes("NotFoundError") ||
        error.message.includes("NotReadableError")
      ) {
        // 设备不存在或不可用
        Toast.error(t("base.voiceInput.error.microphoneUnavailable"));
      } else if (
        !error.message.includes("file size") &&
        !error.message.includes("Transcription failed")
      ) {
        // 兜底：显示通用错误（排除已在 useVoiceInput 中 Toast 的错误）
        Toast.error(t("base.voiceInput.error.genericFailure"));
      }
    },
    onRecordingFailed: () => {
      // The hook owns recorder cleanup.
    },
  });
  useEffect(() => {
    if (!voiceSettings.enabled && (isRecording || isTranscribing)) {
      cancelRecording();
    }
  }, [voiceSettings.enabled, isRecording, isTranscribing, cancelRecording]);

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
  const localAvailableRef = useRef(localAvailable);
  localAvailableRef.current = localAvailable;
  const canRecord = isOnline || localAvailable;
  const buttonGroupRef = useRef<HTMLDivElement>(null);

  // Floating indicator position state
  const [floatingPosition, setFloatingPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // Network status detection - PRD: 无网络时话筒 icon 置灰
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Refs to avoid closure staleness in timer/keyboard callbacks
  const startRecordingRef = useRef(startRecording);
  startRecordingRef.current = startRecording;
  const stopRecordingRef = useRef(stopRecordingAndTranscribe);
  stopRecordingRef.current = stopRecordingAndTranscribe;
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const isTranscribingRef = useRef(isTranscribing);
  isTranscribingRef.current = isTranscribing;

  // Handle transition to actual recording.
  useEffect(() => {
    if (isRecording) {
      onRecordingStarted?.();
    }
  }, [isRecording, cancelRecording, onRecordingStarted]);

  // Calculate floating indicator position when recording starts
  const updateFloatingPosition = useCallback(() => {
    if (!buttonGroupRef.current) return;

    // Find the parent .wk-messageinput-card element
    const card = buttonGroupRef.current.closest(".wk-messageinput-card");
    if (!card) return;

    const cardRect = card.getBoundingClientRect();
    setFloatingPosition({
      top: cardRect.top - FLOATING_GAP - INDICATOR_HEIGHT,
      left: cardRect.left + cardRect.width / 2,
    });
  }, []);

  // Update position when recording or transcribing, and on window resize/scroll
  useEffect(() => {
    if (!isRecording && !isTranscribing) {
      setFloatingPosition(null);
      return;
    }

    updateFloatingPosition();

    const handleResize = () => updateFloatingPosition();

    // 使用 requestAnimationFrame 节流 scroll 事件
    let rafId: number | null = null;
    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        updateFloatingPosition();
        rafId = null;
      });
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isRecording, isTranscribing, updateFloatingPosition]);

  // Fixed physical right Alt/Option shortcut.
  useEffect(() => {
    if (!isVoiceEnabled || !voiceSettings.enabled || !voiceSettings.shortcutEnabled) return;
    const shortcut = getVoiceShortcut(voiceSettings, /Mac|iPhone|iPad/i.test(navigator.userAgent) ? "macos" : "windows");
    const validModifiers = (event: KeyboardEvent) => !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.getModifierState("AltGraph");
    const start = () => {
      if (!isOnlineRef.current && !localAvailableRef.current) {
        Toast.warning(t("base.voiceInput.error.networkUnavailable"));
        return;
      }
      shortcutStartedRef.current = true;
      startRecordingRef.current("append_only");
    };
    const stop = () => stopRecordingRef.current();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (checkIsInputActive && !checkIsInputActive()) return;
      if (event.code === "Escape" && isRecordingRef.current) {
        event.preventDefault();
        cancelRecording();
        return;
      }
      if (!voiceShortcutMatches(event, shortcut) || event.repeat || !validModifiers(event)) return;
      event.preventDefault();
      if (isTranscribingRef.current) return;
      holdShortcutDownRef.current = voiceSettings.speakingMode === "hold";
      if (voiceSettings.speakingMode === "toggle" && isRecordingRef.current) stop();
      else if (!isRecordingRef.current) start();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (voiceSettings.speakingMode !== "hold" || !holdShortcutDownRef.current || !voiceShortcutMatches(event, shortcut)) return;
      holdShortcutDownRef.current = false;
      event.preventDefault();
      stop();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isVoiceEnabled, voiceSettings, checkIsInputActive, cancelRecording, t]);

  // Window blur: auto-stop recording
  useEffect(() => {
    if (!isRecording) return;
    const handleBlur = () => {
      stopRecordingAndTranscribe();
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [isRecording, stopRecordingAndTranscribe]);

  if (!isVoiceEnabled) return null;

  // Handle click/keyboard for voice button
  const handleVoiceClick = () => {
    if (!canRecord) {
      Toast.warning(t("base.voiceInput.error.networkUnavailable"));
      return;
    }
    if (!voiceSettings.enabled) {
      Toast.warning(t("base.voiceInput.error.disabled"));
      return;
    }
    if (!isVoiceEnabled) {
      Toast.warning(t("base.voiceInput.error.unavailable"));
      return;
    }
    // 点击麦克风 icon 固定使用语音输入模式
    shortcutStartedRef.current = false;
    startRecording("append_only");
  };

  const handleVoiceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      handleVoiceClick();
    }
  };

  // Handle stop recording click/keyboard
  const handleStopClick = () => {
    stopRecordingAndTranscribe();
  };

  const handleStopKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      handleStopClick();
    }
  };

  if (isTranscribing) {
    // If no position yet, still show the button in recording state
    if (!floatingPosition) {
      return (
        <div className="wk-voice-button-group" ref={buttonGroupRef}>
          <div
            className="wk-voice-button wk-voice-button--recording"
            aria-label={t("base.voiceInput.status.transcribingDots")}
          >
            <Mic size={18} color="currentColor" />
          </div>
        </div>
      );
    }

    const statusText = t("base.voiceInput.status.organizing");

    const transcribingIndicator = (
      <div
        className="wk-voice-floating-indicator"
        style={{
          top: floatingPosition.top,
          left: floatingPosition.left,
          transform: "translateX(-50%)",
        }}
      >
        <div className="wk-voice-floating-content">
          <span className="wk-voice-floating-text">{statusText}</span>
        </div>
        <span className="wk-voice-floating-divider" />
        <div className="wk-voice-transcribing-spinner" />
      </div>
    );

    return (
      <>
        {createPortal(transcribingIndicator, document.body)}
        <div className="wk-voice-button-group" ref={buttonGroupRef}>
          <div
            className="wk-voice-button wk-voice-button--recording"
            aria-label={t("base.voiceInput.status.transcribingDots")}
          >
            <Mic size={18} color="currentColor" />
            <svg
              width="6"
              height="4"
              viewBox="0 0 6 4"
              fill="currentColor"
              className="wk-voice-arrow"
            >
              <path d="M0.5 0.5L3 3.5L5.5 0.5H0.5Z" />
            </svg>
          </div>
        </div>
      </>
    );
  }

  if (isRecording) {
    // If no position yet, still show the button in recording state
    if (!floatingPosition) {
      return (
        <div
          className="wk-voice-button-group"
          ref={buttonGroupRef}
          onClick={handleStopClick}
          onKeyDown={handleStopKeyDown}
          style={{ cursor: "pointer" }}
        >
          <div
            className="wk-voice-button wk-voice-button--recording"
            aria-label={t("base.voiceInput.title.stop")}
            role="button"
            tabIndex={0}
          >
            <Mic size={18} color="currentColor" />
            <svg
              width="6"
              height="4"
              viewBox="0 0 6 4"
              fill="currentColor"
              className="wk-voice-arrow"
            >
              <path d="M0.5 0.5L3 3.5L5.5 0.5H0.5Z" />
            </svg>
          </div>
        </div>
      );
    }

    const floatingIndicator = (
      <div
        className="wk-voice-floating-indicator"
        style={{
          top: floatingPosition.top,
          left: floatingPosition.left,
          transform: "translateX(-50%)",
        }}
      >
        <div className="wk-voice-floating-content">
          <span className="wk-voice-floating-text">
            {t("base.voiceInput.mode.input")}
          </span>
        </div>
        <span className="wk-voice-floating-divider" />
        <div className="wk-voice-wave-container">
          {Array.from({ length: 16 }, (_, i) => (
            <span key={i} className="wk-voice-wave-bar" />
          ))}
        </div>
      </div>
    );

    return (
      <>
        {createPortal(floatingIndicator, document.body)}
        <div
          className="wk-voice-button-group"
          ref={buttonGroupRef}
          onClick={handleStopClick}
          onKeyDown={handleStopKeyDown}
          style={{ cursor: "pointer" }}
        >
          <div
            className="wk-voice-button wk-voice-button--recording"
            aria-label={t("base.voiceInput.title.stop")}
            role="button"
            tabIndex={0}
          >
            <Mic size={18} color="currentColor" />
            <svg
              width="6"
              height="4"
              viewBox="0 0 6 4"
              fill="currentColor"
              className="wk-voice-arrow"
            >
              <path d="M0.5 0.5L3 3.5L5.5 0.5H0.5Z" />
            </svg>
          </div>
        </div>
      </>
    );
  }

  const os = /Mac|iPhone|iPad/i.test(navigator.userAgent) ? "macos" : "windows";
  const shortcutName = t(os === "macos" ? "base.navRail.settingsCenter.value.rightOption" : "base.navRail.settingsCenter.value.rightAlt");
  const tooltipLabel = !canRecord
    ? t("base.voiceInput.title.networkUnavailable")
    : !voiceSettings.enabled
      ? t("base.voiceInput.title.disabled")
      : microphonePermission !== "granted"
        ? t("base.voiceInput.title.microphoneUnavailable")
        : t("base.voiceInput.title.input");
  const showShortcutKey = canRecord && voiceSettings.enabled && voiceSettings.shortcutEnabled && microphonePermission === "granted";
  return (
    <Tooltip content={<span className="wk-voice-tooltip-content"><span>{tooltipLabel}</span>{showShortcutKey && <kbd>{shortcutName}</kbd>}</span>}>
      <div
        className="wk-voice-button-group"
        ref={buttonGroupRef}
        onClick={handleVoiceClick}
        onKeyDown={handleVoiceKeyDown}
        style={{ cursor: canRecord ? "pointer" : "not-allowed" }}
      >
        <div
          className={`wk-voice-button ${!canRecord ? "wk-voice-button--disabled" : ""}`}
          aria-label={tooltipLabel}
          role="button"
          tabIndex={canRecord ? 0 : -1}
        >
          <Mic size={18} color="currentColor" />
        </div>
      </div>
    </Tooltip>
  );
}
