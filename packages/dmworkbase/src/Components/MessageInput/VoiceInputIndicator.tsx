import React, { useEffect, useRef, useState } from "react";
import { Toast } from "@douyinfe/semi-ui";
import { Mic } from "lucide-react";
import useVoiceInput from "./useVoiceInput";
import "./voiceInput.css";
import { ChatContextResult } from "../Conversation/chatContext";
import IconClick from "../IconClick";

interface VoiceInputIndicatorProps {
  onTranscribed: (text: string, shouldReplace: boolean) => void;
  getCurrentText?: () => string | undefined;
  getChatContext?: () => ChatContextResult;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VoiceInputIndicator({
  onTranscribed,
  getCurrentText,
  getChatContext,
}: VoiceInputIndicatorProps) {
  // Long-press ShiftLeft state
  const shiftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preparingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shiftRecordingRef = useRef(false);
  const cancelPendingRef = useRef(false);
  const [isPreparing, setIsPreparing] = useState(false);

  const PREPARING_DELAY_MS = 300;
  const RECORDING_DELAY_MS = 500;

  const {
    isRecording,
    isTranscribing,
    duration,
    startRecording,
    stopRecordingAndTranscribe,
    cancelRecording,
    isVoiceEnabled,
  } = useVoiceInput({
    onTranscribed,
    getChatContext,
    onError: (error) => {
      if (
        error.message.includes("denied") ||
        error.message.includes("Permission") ||
        error.message.includes("NotAllowedError")
      ) {
        Toast.error("Please allow microphone access");
      } else {
        Toast.error(error.message || "Voice transcription failed");
      }
    },
    onRecordingFailed: () => {
      shiftRecordingRef.current = false;
      cancelPendingRef.current = false;
      setIsPreparing(false);
    },
  });

  // Refs to avoid closure staleness in timer/keyboard callbacks
  const startRecordingRef = useRef(startRecording);
  startRecordingRef.current = startRecording;
  const stopRecordingRef = useRef(stopRecordingAndTranscribe);
  stopRecordingRef.current = stopRecordingAndTranscribe;
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const isTranscribingRef = useRef(isTranscribing);
  isTranscribingRef.current = isTranscribing;

  const clearShiftTimer = () => {
    if (shiftTimerRef.current !== null) {
      clearTimeout(shiftTimerRef.current);
      shiftTimerRef.current = null;
    }
    if (preparingTimerRef.current !== null) {
      clearTimeout(preparingTimerRef.current);
      preparingTimerRef.current = null;
    }
    setIsPreparing(false);
  };

  // Handle transition from preparing/pending -> actual recording or auto-cancel.
  useEffect(() => {
    if (isRecording && cancelPendingRef.current) {
      cancelPendingRef.current = false;
      shiftRecordingRef.current = false;
      setIsPreparing(false);
      cancelRecording();
      return;
    }
    if (isRecording) {
      setIsPreparing(false);
    }
  }, [isRecording, cancelRecording]);

  // Keyboard shortcut: Shift + Cmd/Ctrl + Space, and long-press ShiftLeft
  useEffect(() => {
    if (!isVoiceEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Existing shortcut: Shift+Cmd/Ctrl+Space
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.code === "Space") {
        if (!isRecordingRef.current && !isTranscribingRef.current) {
          e.preventDefault();
          startRecordingRef.current();
        }
        return;
      }

      // Long-press ShiftLeft: start 500ms timer
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
            setIsPreparing(true);
          }, PREPARING_DELAY_MS);
          shiftTimerRef.current = setTimeout(() => {
            shiftTimerRef.current = null;
            shiftRecordingRef.current = true;
            startRecordingRef.current();
          }, RECORDING_DELAY_MS);
        }
        return;
      }

      if (shiftTimerRef.current !== null && e.code !== "ShiftLeft") {
        // Modifier chord (Ctrl/Meta/Alt pressed): cancel voice intent
        if (
          e.code.startsWith("Control") ||
          e.code.startsWith("Alt") ||
          e.code.startsWith("Meta")
        ) {
          clearShiftTimer();
          return;
        }
        // IME-related events: do not cancel timer
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
      // ShiftLeft released while timer is pending: cancel (normal Shift press)
      if (e.code === "ShiftLeft" && shiftTimerRef.current !== null) {
        clearShiftTimer();
        return;
      }

      // ShiftLeft released while waiting for getUserMedia (recording not yet started)
      if (
        e.code === "ShiftLeft" &&
        shiftRecordingRef.current &&
        !isRecordingRef.current
      ) {
        cancelPendingRef.current = true;
        shiftRecordingRef.current = false;
        return;
      }

      // ShiftLeft released after long-press recording started: stop recording
      if (
        e.code === "ShiftLeft" &&
        shiftRecordingRef.current &&
        isRecordingRef.current
      ) {
        shiftRecordingRef.current = false;
        e.preventDefault();
        const contextText = getCurrentText?.();
        stopRecordingRef.current(contextText);
        return;
      }

      if (!isRecordingRef.current) return;
      // Stop recording when any modifier key is released (existing Shift+Cmd+Space flow)
      if (e.key === "Shift" || e.key === "Meta" || e.key === "Control") {
        // Don't stop if this was a long-press ShiftLeft release handled above
        if (shiftRecordingRef.current) return;
        e.preventDefault();
        const contextText = getCurrentText?.();
        stopRecordingRef.current(contextText);
      }
    };

    const handleBlurWhilePreparing = () => {
      clearShiftTimer();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlurWhilePreparing);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlurWhilePreparing);
      clearShiftTimer();
    };
  }, [isVoiceEnabled, getCurrentText]);

  // Window blur: auto-stop recording
  useEffect(() => {
    if (!isRecording) return;
    const handleBlur = () => {
      const contextText = getCurrentText?.();
      stopRecordingAndTranscribe(contextText);
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [isRecording, stopRecordingAndTranscribe, getCurrentText]);

  if (!isVoiceEnabled) return null;

  if (isTranscribing) {
    return (
      <div className="wk-voice-indicator wk-voice-transcribing">
        <span className="wk-voice-spinner" />
        <span className="wk-voice-label">Transcribing...</span>
      </div>
    );
  }

  if (isRecording) {
    return (
      <div className="wk-voice-indicator wk-voice-recording">
        <span className="wk-voice-dot" />
        <span className="wk-voice-label">{formatDuration(duration)}</span>
        <span className="wk-voice-label">Recording...</span>
        <button
          className="wk-voice-cancel"
          onClick={(e) => {
            e.preventDefault();
            cancelRecording();
          }}
          type="button"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (isPreparing) {
    return (
      <div className="wk-voice-indicator wk-voice-preparing">
        <span className="wk-voice-label">Hold for voice...</span>
      </div>
    );
  }

  // 默认状态：显示麦克风按钮 + 下拉箭头
  return (
    <div className="wk-voice-button-group">
      <IconClick
        size="sm"
        title="语音输入 (长按 Shift)"
        icon={<Mic size={18} color="currentColor" />}
        onClick={() => {
          startRecording();
        }}
      />
      <div
        className="wk-voice-dropdown-arrow"
        title="语音设置"
        onClick={(e) => {
          e.stopPropagation();
          // TODO: 打开语音设置菜单
        }}
      >
        <span className="wk-voice-dropdown-triangle" />
      </div>
    </div>
  );
}
