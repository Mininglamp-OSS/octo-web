import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Toast } from "@douyinfe/semi-ui";
import { Mic } from "lucide-react";
import useVoiceInput from "./useVoiceInput";
import "./voiceInput.css";
import { ChatContextResult } from "../Conversation/chatContext";
import { VoiceMode } from "../../Service/VoiceService";

interface VoiceInputIndicatorProps {
  onTranscribed: (text: string, shouldReplace: boolean) => void;
  getCurrentText?: () => string | undefined;
  getChatContext?: () => ChatContextResult;
}

// Floating indicator positioning constants
const FLOATING_GAP = 20;
const INDICATOR_HEIGHT = 48;

// Long-press timing constants
const PREPARING_DELAY_MS = 300;
const RECORDING_DELAY_MS = 500;

// 模式配置
const VOICE_MODES: { value: VoiceMode; label: string; description: string }[] =
  [
    { value: "smart", label: "语音输入", description: "智能识别追加或编辑" },
    { value: "append_only", label: "追加模式", description: "仅追加文字" },
    { value: "edit_only", label: "编辑模式", description: "仅编辑现有文字" },
  ];

export default function VoiceInputIndicator({
  onTranscribed,
  getCurrentText,
  getChatContext,
}: VoiceInputIndicatorProps) {
  // Voice mode state
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("smart");
  const [showModeMenu, setShowModeMenu] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const dropdownArrowRef = useRef<HTMLDivElement>(null);

  // Long-press ShiftLeft state
  const shiftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preparingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shiftRecordingRef = useRef(false);
  const cancelPendingRef = useRef(false);
  const [isPreparing, setIsPreparing] = useState(false);

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
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

  const {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecordingAndTranscribe,
    cancelRecording,
    isVoiceEnabled,
  } = useVoiceInput({
    onTranscribed,
    getChatContext,
    mode: voiceMode,
    onError: (error) => {
      // 麦克风权限被拒绝时显示中文提示
      if (
        error.message.includes("denied") ||
        error.message.includes("Permission") ||
        error.message.includes("NotAllowedError")
      ) {
        Toast.error("请允许麦克风访问权限");
      } else if (
        error.message.includes("NotFoundError") ||
        error.message.includes("NotReadableError")
      ) {
        // 设备不存在或不可用
        Toast.error("麦克风不可用");
      } else if (
        !error.message.includes("file size") &&
        !error.message.includes("Transcription failed")
      ) {
        // 兜底：显示通用错误（排除已在 useVoiceInput 中 Toast 的错误）
        Toast.error("语音输入失败");
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

  // Close mode menu when clicking outside
  useEffect(() => {
    if (!showModeMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        modeMenuRef.current &&
        !modeMenuRef.current.contains(e.target as Node) &&
        dropdownArrowRef.current &&
        !dropdownArrowRef.current.contains(e.target as Node)
      ) {
        setShowModeMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showModeMenu]);

  // Keyboard shortcut: Shift + Cmd/Ctrl + Space, and long-press ShiftLeft
  useEffect(() => {
    if (!isVoiceEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Esc to cancel recording
      if (e.code === "Escape" && isRecordingRef.current) {
        e.preventDefault();
        cancelRecording();
        return;
      }

      // Existing shortcut: Shift+Cmd/Ctrl+Space
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.code === "Space") {
        if (!isRecordingRef.current && !isTranscribingRef.current) {
          e.preventDefault();
          // Check network status before starting
          if (!isOnlineRef.current) {
            Toast.warning("网络不可用，无法使用语音功能");
            return;
          }
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
            // Check network status before starting
            if (!isOnlineRef.current) {
              Toast.warning("网络不可用，无法使用语音功能");
              setIsPreparing(false);
              return;
            }
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
  }, [isVoiceEnabled, getCurrentText, cancelRecording]);

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

  // Handle mode selection
  const handleModeSelect = (mode: VoiceMode) => {
    setVoiceMode(mode);
    setShowModeMenu(false);
  };

  // Toggle mode menu
  const handleDropdownClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOnline) {
      Toast.warning("网络不可用，无法使用语音功能");
      return;
    }
    setShowModeMenu(!showModeMenu);
  };

  // Get current mode label
  const currentModeLabel =
    VOICE_MODES.find((m) => m.value === voiceMode)?.label || "语音输入";

  // Handle click/keyboard for voice button
  const handleVoiceClick = () => {
    if (!isOnline) {
      Toast.warning("网络不可用，无法使用语音功能");
      return;
    }
    startRecording();
  };

  const handleVoiceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      handleVoiceClick();
    }
  };

  // Handle stop recording click/keyboard
  const handleStopClick = () => {
    const contextText = getCurrentText?.();
    stopRecordingAndTranscribe(contextText);
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
            title="转写中..."
          >
            <Mic size={18} color="currentColor" />
          </div>
        </div>
      );
    }

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
          <span className="wk-voice-floating-text">转写中</span>
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
            title="转写中..."
          >
            <Mic size={18} color="currentColor" />
          </div>
        </div>
      </>
    );
  }

  if (isRecording) {
    // If no position yet, still show the button in recording state
    if (!floatingPosition) {
      return (
        <div className="wk-voice-button-group" ref={buttonGroupRef}>
          <div
            className="wk-voice-button wk-voice-button--recording"
            title="点击停止录音"
            onClick={handleStopClick}
            onKeyDown={handleStopKeyDown}
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer" }}
          >
            <Mic size={18} color="currentColor" />
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
          <span className="wk-voice-floating-text">语音输入</span>
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
        <div className="wk-voice-button-group" ref={buttonGroupRef}>
          <div
            className="wk-voice-button wk-voice-button--recording"
            title="点击停止录音"
            onClick={handleStopClick}
            onKeyDown={handleStopKeyDown}
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer" }}
          >
            <Mic size={18} color="currentColor" />
          </div>
        </div>
      </>
    );
  }

  if (isPreparing) {
    return (
      <div className="wk-voice-button-group" ref={buttonGroupRef}>
        <div
          className="wk-voice-button wk-voice-button--preparing"
          title="准备中..."
        >
          <Mic size={18} color="currentColor" />
        </div>
      </div>
    );
  }

  // 默认状态：显示麦克风按钮和下拉箭头
  // PRD: 无网络时话筒 icon 置灰，点击时 Toast「网络不可用，无法使用语音功能」
  // 激活态：菜单打开时，麦克风和箭头都显示激活样式（淡紫色背景 + 紫色图标）
  const isActive = showModeMenu;

  return (
    <div className="wk-voice-button-group" ref={buttonGroupRef}>
      <div
        className={`wk-voice-button ${
          !isOnline
            ? "wk-voice-button--disabled"
            : isActive
            ? "wk-voice-button--active"
            : ""
        }`}
        title={isOnline ? `${currentModeLabel} (长按 Shift)` : "网络不可用"}
        onClick={handleVoiceClick}
        onKeyDown={handleVoiceKeyDown}
        role="button"
        tabIndex={isOnline ? 0 : -1}
      >
        <Mic size={18} color="currentColor" />
      </div>
      {/* 下拉箭头 - 实心三角形 */}
      <div
        ref={dropdownArrowRef}
        className={`wk-voice-dropdown-arrow ${
          !isOnline
            ? "wk-voice-dropdown-arrow--disabled"
            : isActive
            ? "wk-voice-dropdown-arrow--active"
            : ""
        }`}
        onClick={handleDropdownClick}
        role="button"
        tabIndex={isOnline ? 0 : -1}
        title="选择语音模式"
      >
        {/* 实心向下三角形 SVG */}
        <svg width="6" height="4" viewBox="0 0 6 4" fill="currentColor">
          <path d="M0.5 0.5L3 3.5L5.5 0.5H0.5Z" />
        </svg>
      </div>
      {/* 模式选择弹窗 */}
      {showModeMenu && (
        <div className="wk-voice-mode-menu" ref={modeMenuRef}>
          {VOICE_MODES.map((mode) => (
            <div
              key={mode.value}
              className={`wk-voice-mode-item ${
                voiceMode === mode.value ? "wk-voice-mode-item--active" : ""
              }`}
              onClick={() => handleModeSelect(mode.value)}
              role="menuitem"
            >
              <span className="wk-voice-mode-label">{mode.label}</span>
              <span className="wk-voice-mode-desc">{mode.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
