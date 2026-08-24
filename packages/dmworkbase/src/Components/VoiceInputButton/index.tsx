import React, { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Toast } from "@douyinfe/semi-ui";
import { Mic } from "lucide-react";
import useTextareaVoice, { ReplaceMode, SelectionRange } from "./useTextareaVoice";
import type { ChatContextResult } from "../Conversation/chatContext";
import { getVoiceShortcut, voiceSettingsStore, voiceShortcutMatches } from "../../Service/VoiceSettingsStore";
import WKApp from "../../App";
import { useI18n } from "../../i18n";
import "./index.css";

const FLOATING_GAP = 12;
const FLOATING_WIDTH = 184;
const FLOATING_HORIZONTAL_MARGIN = 8;
const INDICATOR_HEIGHT = 48;

const voiceHost = {
  getSpaceId: () => WKApp.shared.currentSpaceId,
  subscribeSpaceChange: (listener: () => void) => {
    WKApp.mittBus.on("space-changed", listener);
    return () => WKApp.mittBus.off("space-changed", listener);
  },
};

export interface VoiceInputButtonProps {
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  onTranscribed: (text: string, replaceMode: ReplaceMode, savedSelectionRange?: SelectionRange) => void;
  getCurrentText?: () => string;
  size?: "sm" | "md";
  getChatContext?: () => ChatContextResult | Promise<ChatContextResult>;
  className?: string;
  /** Called right before recording starts (useful for cancelling pending blur commits) */
  onRecordingStart?: () => void;
}

export default function VoiceInputButton({
  inputRef,
  onTranscribed,
  getCurrentText,
  size = "sm",
  getChatContext,
  className,
  onRecordingStart,
}: VoiceInputButtonProps) {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [voiceSettings, setVoiceSettings] = useState(() => voiceSettingsStore.get());
  useEffect(() => voiceSettingsStore.subscribe(setVoiceSettings), []);

  const {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecordingAndTranscribe,
    cancelRecording,
    isVoiceEnabled,
    localAvailable,
  } = useTextareaVoice({
    inputRef,
    onTranscribed,
    getCurrentText,
    getChatContext,
    voiceHost,
  });

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
  const localAvailableRef = useRef(localAvailable);
  localAvailableRef.current = localAvailable;
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

  const canRecord = isOnline || localAvailable;
  const isDisabled = !inputRef.current || !canRecord;

  // Floating indicator position
  const [floatingPosition, setFloatingPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const updateFloatingPosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const preferredLeft = rect.left + rect.width / 2 - FLOATING_WIDTH / 2;
    const maxLeft = window.innerWidth - FLOATING_WIDTH - FLOATING_HORIZONTAL_MARGIN;
    const left = Math.max(
      FLOATING_HORIZONTAL_MARGIN,
      Math.min(preferredLeft, maxLeft),
    );
    setFloatingPosition({
      top: rect.top - FLOATING_GAP - INDICATOR_HEIGHT,
      left,
    });
  }, []);

  useEffect(() => {
    if (!isRecording && !isTranscribing) {
      setFloatingPosition(null);
      return;
    }
    updateFloatingPosition();
    const handleResize = () => updateFloatingPosition();
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
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isRecording, isTranscribing, updateFloatingPosition]);

  // Esc to cancel during recording
  useEffect(() => {
    if (!isRecording) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelRecording();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRecording, cancelRecording]);

  // Window/page lifecycle cancels the session; it must not transcribe after focus is lost.
  useEffect(() => {
    if (!isRecording) return;
    const cancel = () => cancelRecording();
    const handleVisibilityChange = () => { if (document.visibilityState === "hidden") cancel(); };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => { window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", handleVisibilityChange); };
  }, [isRecording, cancelRecording]);

  useEffect(() => {
    if (!voiceSettings.enabled && (isRecording || isTranscribing)) cancelRecording();
  }, [voiceSettings.enabled, isRecording, isTranscribing, cancelRecording]);

  // Left Shift long-press to start/stop recording
  const shiftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preparingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shiftRecordingRef = useRef(false);
  const cancelPendingRef = useRef(false);
  const startRecordingRef = useRef(startRecording);
  startRecordingRef.current = startRecording;
  const stopRecordingRef = useRef(stopRecordingAndTranscribe);
  stopRecordingRef.current = stopRecordingAndTranscribe;
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const isTranscribingRef = useRef(isTranscribing);
  isTranscribingRef.current = isTranscribing;

  const clearShiftTimer = useCallback(() => {
    if (shiftTimerRef.current !== null) {
      clearTimeout(shiftTimerRef.current);
      shiftTimerRef.current = null;
    }
    if (preparingTimerRef.current !== null) {
      clearTimeout(preparingTimerRef.current);
      preparingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isRecording && cancelPendingRef.current) {
      cancelPendingRef.current = false;
      shiftRecordingRef.current = false;
      cancelRecording();
    }
  }, [isRecording, cancelRecording]);

  useEffect(() => {
    if (!isVoiceEnabled || !voiceSettings.enabled) return;
    const configuredShortcut = getVoiceShortcut(voiceSettings, /Mac|iPhone|iPad/i.test(navigator.userAgent) ? "macos" : "windows");
    if (configuredShortcut === "disabled") return;
    const modifiersValid = (event: KeyboardEvent) => configuredShortcut === "alt-right"
      ? !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.getModifierState("AltGraph")
      : !event.altKey && !event.ctrlKey && !event.metaKey;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!inputRef.current || document.activeElement !== inputRef.current || document.querySelector(".wk-settings-center-modal")) return;

      if (
        voiceShortcutMatches(e, configuredShortcut) &&
        !e.repeat &&
        !e.metaKey &&
        !e.ctrlKey &&
        modifiersValid(e)
      ) {
        if (voiceSettings.speakingMode === "toggle") {
          e.preventDefault();
          if (isRecordingRef.current) stopRecordingRef.current();
          else if (!isTranscribingRef.current) {
            if (!isOnlineRef.current && !localAvailableRef.current) {
              Toast.warning(t("base.voiceInput.error.networkUnavailable"));
              return;
            }
            onRecordingStart?.();
            startRecordingRef.current("append_only");
          }
          return;
        }
        if (!isRecordingRef.current && !isTranscribingRef.current) {
          if (!isOnlineRef.current && !localAvailableRef.current) {
            Toast.warning(t("base.voiceInput.error.networkUnavailable"));
            return;
          }
          if (!voiceSettings.enabled) return;
          shiftRecordingRef.current = true;
          onRecordingStart?.();
          startRecordingRef.current("append_only");
        }
        return;
      }

      if (shiftTimerRef.current !== null && !voiceShortcutMatches(e, configuredShortcut)) {
        if (
          e.code.startsWith("Control") ||
          e.code.startsWith("Alt") ||
          e.code.startsWith("Meta")
        ) {
          clearShiftTimer();
          return;
        }
        const isIME =
          e.key === "Shift" ||
          e.key === "Process" ||
          e.key === "Unidentified" ||
          e.isComposing;
        if (!isIME) {
          clearShiftTimer();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!inputRef.current) return;
      const isInputFocused = document.activeElement === inputRef.current;

      if (!isRecordingRef.current && !isInputFocused) return;

      if (voiceShortcutMatches(e, configuredShortcut) && shiftTimerRef.current !== null) {
        clearShiftTimer();
        return;
      }

      if (
        voiceShortcutMatches(e, configuredShortcut) &&
        shiftRecordingRef.current &&
        !isRecordingRef.current
      ) {
        cancelPendingRef.current = true;
        shiftRecordingRef.current = false;
        return;
      }

      if (
        voiceShortcutMatches(e, configuredShortcut) &&
        shiftRecordingRef.current &&
        isRecordingRef.current
      ) {
        shiftRecordingRef.current = false;
        e.preventDefault();
        stopRecordingRef.current();
        return;
      }
    };

    const handleBlurClear = () => {
      clearShiftTimer();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlurClear);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlurClear);
      clearShiftTimer();
    };
  }, [isVoiceEnabled, inputRef, clearShiftTimer, t, voiceSettings]);

  const handleVoiceClick = () => {
    if (!isVoiceEnabled) {
      Toast.warning(t("base.voiceInput.error.unavailable"));
      return;
    }
    if (!canRecord) {
      Toast.warning(t("base.voiceInput.error.networkUnavailable"));
      return;
    }
    if (!inputRef.current) return;
    if (!voiceSettings.enabled) {
      Toast.warning(t("base.voiceInput.error.unavailable"));
      return;
    }
    onRecordingStart?.();
    startRecording("append_only");
  };

  const handleStopClick = () => {
    stopRecordingAndTranscribe();
  };

  const iconSize = size === "sm" ? 16 : 18;

  const rootClasses = [
    "wk-vib",
    size === "sm" ? "wk-vib--sm" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  // Recording or transcribing state
  if (isRecording || isTranscribing) {
    const statusText = isTranscribing
      ? t("base.voiceInput.status.transcribing")
      : t("base.voiceInput.mode.input");

    const floatingIndicator = floatingPosition ? (
      <div
        className="wk-voice-floating-indicator"
        style={{
          top: floatingPosition.top,
          left: floatingPosition.left,
          transform: "none",
        }}
      >
        <div className="wk-voice-floating-content">
          <span className="wk-voice-floating-text">{statusText}</span>
        </div>
        <span className="wk-voice-floating-divider" />
        {isTranscribing ? (
          <div className="wk-voice-transcribing-spinner" />
        ) : (
          <div className="wk-voice-wave-container">
            {Array.from({ length: 16 }, (_, i) => (
              <span key={i} className="wk-voice-wave-bar" />
            ))}
          </div>
        )}
      </div>
    ) : null;

    return (
      <>
        {floatingIndicator && createPortal(floatingIndicator, document.body)}
        <div
          className={rootClasses}
          ref={buttonRef}
          onClick={isRecording ? handleStopClick : undefined}
          style={{ cursor: isRecording ? "pointer" : "default" }}
        >
          <div
            className="wk-vib__btn wk-vib__btn--recording"
            aria-label={isTranscribing
              ? t("base.voiceInput.status.transcribingDots")
              : t("base.voiceInput.action.stopRecording")}
            role="button"
            tabIndex={0}
          >
            <Mic size={iconSize} color="currentColor" />
          </div>
        </div>
      </>
    );
  }

  // Default idle state
  if (!isVoiceEnabled) return null;

  return (
    <>
      <div
        className={rootClasses}
        ref={buttonRef}
        onClick={handleVoiceClick}
        style={{ cursor: isDisabled ? "not-allowed" : "pointer" }}
      >
        <div
          className={`wk-vib__btn ${isDisabled ? "wk-vib__btn--disabled" : ""}`}
          aria-label={canRecord
            ? t("base.voiceInput.title.input")
            : t("base.voiceInput.title.networkUnavailable")}
          role="button"
          tabIndex={isDisabled ? -1 : 0}
        >
          <Mic size={iconSize} color="currentColor" />
        </div>
      </div>
    </>
  );
}

export type { ReplaceMode, SelectionRange };
