import React, { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Toast, Dropdown } from "@douyinfe/semi-ui";
import { Mic } from "lucide-react";
import useTextareaVoice, { ReplaceMode, SelectionRange } from "./useTextareaVoice";
import type { ChatContextResult } from "../Conversation/chatContext";
import type { VoiceMode } from "../../Service/VoiceService";
import VoiceFeedbackNotice from "../MessageInput/VoiceFeedbackNotice";
import useSpaceFeedbackSetting, { getSharedSpaceFeedbackState, acceptVoiceInput } from "../MessageInput/useSpaceFeedbackSetting";
import WKApp from "../../App";
import { useI18n } from "../../i18n";
import "./index.css";

const VOICE_MODES: { value: VoiceMode; labelKey: string }[] = [
  { value: "append_only", labelKey: "base.voiceInput.mode.input" },
  { value: "edit_only", labelKey: "base.voiceInput.mode.edit" },
];

const FLOATING_GAP = 12;
const FLOATING_WIDTH = 184;
const FLOATING_HORIZONTAL_MARGIN = 8;
const INDICATOR_HEIGHT = 48;
const PREPARING_DELAY_MS = 300;
const RECORDING_DELAY_MS = 500;

export interface VoiceInputButtonProps {
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  onTranscribed: (text: string, replaceMode: ReplaceMode, savedSelectionRange?: SelectionRange) => void;
  getCurrentText?: () => string;
  showModeMenu?: boolean;
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
  showModeMenu = false,
  size = "sm",
  getChatContext,
  className,
  onRecordingStart,
}: VoiceInputButtonProps) {
  const { t } = useI18n();
  const [showMenu, setShowMenu] = useState(false);
  const [showFeedbackNotice, setShowFeedbackNotice] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);
  const pendingModeRef = useRef<VoiceMode>("append_only");
  const { spaceSetting, loaded, voiceConfig } = useSpaceFeedbackSetting();

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
    enableEditMode: showModeMenu,
    getChatContext,
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

  // Window blur: auto-stop recording
  useEffect(() => {
    if (!isRecording) return;
    const handleBlur = () => stopRecordingAndTranscribe();
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [isRecording, stopRecordingAndTranscribe]);

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
    if (!isVoiceEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!inputRef.current || document.activeElement !== inputRef.current) return;

      if (
        e.code === "ShiftLeft" &&
        !e.repeat &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        if (
          !isRecordingRef.current &&
          !isTranscribingRef.current &&
          shiftTimerRef.current === null
        ) {
          cancelPendingRef.current = false;
          preparingTimerRef.current = setTimeout(() => {
            preparingTimerRef.current = null;
          }, PREPARING_DELAY_MS);
          shiftTimerRef.current = setTimeout(() => {
            shiftTimerRef.current = null;
            if (!isOnlineRef.current && !localAvailableRef.current) {
              Toast.warning(t("base.voiceInput.error.networkUnavailable"));
              return;
            }
            const feedbackState = getSharedSpaceFeedbackState();
            if (!feedbackState.loaded) {
              return;
            }
            if (feedbackState.spaceSetting?.voice_input_enabled !== 1) {
              setShowFeedbackNotice(true);
              return;
            }
            shiftRecordingRef.current = true;
            startRecordingRef.current("append_only");
          }, RECORDING_DELAY_MS);
        }
        return;
      }

      if (shiftTimerRef.current !== null && e.code !== "ShiftLeft") {
        if (
          e.code.startsWith("Control") ||
          e.code.startsWith("Alt") ||
          e.code.startsWith("Meta")
        ) {
          clearShiftTimer();
          return;
        }
        const isIME =
          e.code.startsWith("Shift") ||
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

      if (e.code === "ShiftLeft" && shiftTimerRef.current !== null) {
        clearShiftTimer();
        return;
      }

      if (
        e.code === "ShiftLeft" &&
        shiftRecordingRef.current &&
        !isRecordingRef.current
      ) {
        cancelPendingRef.current = true;
        shiftRecordingRef.current = false;
        return;
      }

      if (
        e.code === "ShiftLeft" &&
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
  }, [isVoiceEnabled, inputRef, clearShiftTimer, t]);

  if (!isVoiceEnabled) return null;

  const handleVoiceClick = () => {
    setShowMenu(false);
    if (!canRecord) {
      Toast.warning(t("base.voiceInput.error.networkUnavailable"));
      return;
    }
    if (!inputRef.current) return;
    if (!loaded) {
      return;
    }
    if (spaceSetting?.voice_input_enabled !== 1) {
      pendingModeRef.current = "append_only";
      setShowFeedbackNotice(true);
      return;
    }
    onRecordingStart?.();
    startRecording("append_only");
  };

  const handleModeSelect = (selectedMode: VoiceMode) => {
    setShowMenu(false);
    if (!canRecord || !inputRef.current) return;
    if (!loaded) {
      return;
    }
    if (spaceSetting?.voice_input_enabled !== 1) {
      pendingModeRef.current = selectedMode;
      setShowFeedbackNotice(true);
      return;
    }
    onRecordingStart?.();
    startRecording(selectedMode);
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
            title={isTranscribing
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
  if (showModeMenu) {
    const currentText = getCurrentText?.() ?? "";
    const hasContent = currentText.trim().length > 0;
    const dropdownMenu = (
      <Dropdown.Menu style={{ width: 140 }}>
        {VOICE_MODES.map((mode) => {
          const isEditMode = mode.value === "edit_only";
          const itemDisabled = isEditMode && !hasContent;
          return (
            <Dropdown.Item
              key={mode.value}
              onClick={() => !itemDisabled && handleModeSelect(mode.value)}
              disabled={itemDisabled}
              title={itemDisabled ? t("base.voiceInput.error.emptyCannotEdit") : undefined}
            >
              {t(mode.labelKey)}
            </Dropdown.Item>
          );
        })}
      </Dropdown.Menu>
    );

    return (
      <>
        <Dropdown
          trigger="hover"
          position="topRight"
          render={dropdownMenu}
          visible={canRecord && !!inputRef.current ? showMenu : false}
          onVisibleChange={setShowMenu}
          spacing={4}
        >
          <div
            className={rootClasses}
            ref={buttonRef}
            onClick={handleVoiceClick}
            style={{ cursor: isDisabled ? "not-allowed" : "pointer" }}
          >
            <div
              className={`wk-vib__btn ${isDisabled ? "wk-vib__btn--disabled" : ""}`}
              title={canRecord
                ? t("base.voiceInput.title.input")
                : t("base.voiceInput.title.networkUnavailable")}
              role="button"
              tabIndex={isDisabled ? -1 : 0}
            >
              <Mic size={iconSize} color="currentColor" />
            </div>
          </div>
        </Dropdown>
        {showFeedbackNotice && (
          <VoiceFeedbackNotice
            onAccept={async (feedbackOn) => {
              setShowFeedbackNotice(false);
              const spaceId = WKApp.shared.currentSpaceId;
              try {
                if (spaceId) {
                  await acceptVoiceInput(spaceId, feedbackOn);
                }
              } catch {
                Toast.error(t("base.voiceInput.error.operationFailed"));
                return;
              }
              onRecordingStart?.();
              startRecording(pendingModeRef.current);
            }}
            onCancel={() => {
              setShowFeedbackNotice(false);
            }}
            feedbackPrivacyUrl={voiceConfig?.feedback_privacy_url}
            feedbackUserAgreementUrl={voiceConfig?.feedback_user_agreement_url}
          />
        )}
      </>
    );
  }

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
          title={canRecord
            ? t("base.voiceInput.title.input")
            : t("base.voiceInput.title.networkUnavailable")}
          role="button"
          tabIndex={isDisabled ? -1 : 0}
        >
          <Mic size={iconSize} color="currentColor" />
        </div>
      </div>
      {showFeedbackNotice && (
        <VoiceFeedbackNotice
          onAccept={async (feedbackOn) => {
            setShowFeedbackNotice(false);
            const spaceId = WKApp.shared.currentSpaceId;
            try {
              if (spaceId) {
                await acceptVoiceInput(spaceId, feedbackOn);
              }
            } catch {
              Toast.error(t("base.voiceInput.error.operationFailed"));
              return;
            }
            onRecordingStart?.();
            startRecording(pendingModeRef.current);
          }}
          onCancel={() => {
            setShowFeedbackNotice(false);
          }}
          feedbackPrivacyUrl={voiceConfig?.feedback_privacy_url}
          feedbackUserAgreementUrl={voiceConfig?.feedback_user_agreement_url}
        />
      )}
    </>
  );
}

export type { ReplaceMode, SelectionRange };
