import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Toast, Dropdown } from "@douyinfe/semi-ui";
import { Mic } from "lucide-react";
import useVoiceInput from "./useVoiceInput";
import "./voiceInput.css";
import { ChatContextResult } from "../Conversation/chatContext";
import { VoiceMode } from "../../Service/VoiceService";
import VoiceFeedbackNotice from "./VoiceFeedbackNotice";
import useSpaceFeedbackSetting, { getSharedSpaceFeedbackState, getSharedVoiceConfig } from "./useSpaceFeedbackSetting";

type ReplaceMode = "all" | "selection" | "insert";

/** 选区位置信息 */
interface SelectionRange {
  from: number;
  to: number;
}

interface VoiceInputIndicatorProps {
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
  getChatContext?: () => ChatContextResult | Promise<ChatContextResult>;
  /** 判断当前输入框是否处于活动状态（用于避免多个输入框同时响应语音快捷键） */
  checkIsInputActive?: () => boolean;
}

// Floating indicator positioning constants
const FLOATING_GAP = 20;
const INDICATOR_HEIGHT = 48;

// Long-press timing constants
const PREPARING_DELAY_MS = 300;
const RECORDING_DELAY_MS = 500;

// 模式配置 - 匹配 Figma 设计：语音输入 / 语音编辑
const VOICE_MODES: { value: VoiceMode; label: string; description: string }[] =
  [
    { value: "append_only", label: "语音输入", description: "" },
    { value: "edit_only", label: "语音编辑", description: "" },
  ];

export default function VoiceInputIndicator({
  onTranscribed,
  getCurrentText,
  getSelectedText,
  getSelectionRange,
  getChatContext,
  checkIsInputActive,
}: VoiceInputIndicatorProps) {
  // Voice mode menu state (不保存选中的模式，每次都是临时选择)
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showFeedbackNotice, setShowFeedbackNotice] = useState(false);
  const { spaceSetting, loaded, voiceConfig, updateSetting } = useSpaceFeedbackSetting();

  // Long-press ShiftLeft state
  const shiftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preparingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shiftRecordingRef = useRef(false);
  const cancelPendingRef = useRef(false);
  const [isPreparing, setIsPreparing] = useState(false);

  // 记录开始录音时是否有选中文本，用于决定替换模式
  const hadSelectionRef = useRef(false);
  // 记录开始录音时选中的文本内容（用于后续定位替换）
  const savedSelectedTextRef = useRef<string | undefined>(undefined);
  // 记录开始录音时选区的 ProseMirror 位置（优先使用位置替换，文本匹配作为兜底）
  const savedSelectionRangeRef = useRef<SelectionRange | undefined>(undefined);
  // 记录当前录音使用的模式（用于 onTranscribed 回调）
  const recordingModeRef = useRef<VoiceMode>("append_only");

  const {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecordingAndTranscribe,
    cancelRecording,
    isVoiceEnabled,
    currentMode,
    localAvailable,
  } = useVoiceInput({
    onTranscribed: (text: string) => {
      // 根据模式和是否有选中文本决定替换方式
      const mode = recordingModeRef.current;
      if (mode === "edit_only") {
        if (hadSelectionRef.current && savedSelectedTextRef.current) {
          // 传递选区位置和文本内容，优先使用位置替换
          onTranscribed(
            text,
            "selection",
            savedSelectedTextRef.current,
            savedSelectionRangeRef.current
          );
        } else {
          onTranscribed(text, "all");
        }
      } else {
        // 语音输入模式：插入到光标处
        onTranscribed(text, "insert");
      }
    },
    getChatContext,
    mode: recordingModeRef.current,
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

  // Keyboard shortcut: Shift + Cmd/Ctrl + Space, and long-press ShiftLeft
  useEffect(() => {
    if (!isVoiceEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 只处理当前活动输入框的快捷键（避免多个输入框同时响应）
      if (checkIsInputActive && !checkIsInputActive()) {
        return;
      }

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
          if (!isOnlineRef.current && !localAvailableRef.current) {
            Toast.warning("网络不可用，无法使用语音功能");
            return;
          }
          const feedbackState = getSharedSpaceFeedbackState();
          const vc = getSharedVoiceConfig();
          if (vc?.feedback_url && !feedbackState.loaded) {
            return;
          }
          if (
            vc?.feedback_url &&
            feedbackState.spaceSetting?.voice_feedback_on === 1 &&
            feedbackState.spaceSetting?.voice_feedback_notice_acked !== 1
          ) {
            setShowFeedbackNotice(true);
            return;
          }
          // 记录选中文本和位置
          const selectedText = getSelectedText?.();
          const selectionRange = getSelectionRange?.();
          hadSelectionRef.current = !!selectedText;
          savedSelectedTextRef.current = selectedText;
          savedSelectionRangeRef.current = selectionRange;
          recordingModeRef.current = "append_only";
          startRecordingRef.current("append_only");
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
            if (!isOnlineRef.current && !localAvailableRef.current) {
              Toast.warning("网络不可用，无法使用语音功能");
              setIsPreparing(false);
              return;
            }
            const feedbackState = getSharedSpaceFeedbackState();
            const vc = getSharedVoiceConfig();
            if (vc?.feedback_url && !feedbackState.loaded) {
              setIsPreparing(false);
              return;
            }
            if (
              vc?.feedback_url &&
              feedbackState.spaceSetting?.voice_feedback_on === 1 &&
              feedbackState.spaceSetting?.voice_feedback_notice_acked !== 1
            ) {
              setIsPreparing(false);
              setShowFeedbackNotice(true);
              return;
            }
            shiftRecordingRef.current = true;
            // 记录选中文本和位置
            const selectedText = getSelectedText?.();
            const selectionRange = getSelectionRange?.();
            hadSelectionRef.current = !!selectedText;
            savedSelectedTextRef.current = selectedText;
            savedSelectionRangeRef.current = selectionRange;
            recordingModeRef.current = "append_only";
            startRecordingRef.current("append_only");
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
      // 如果正在录音，允许任何输入框停止录音（用户可能在录音时切换了输入框）
      // 如果没在录音，只处理当前活动输入框的事件
      if (!isRecordingRef.current && checkIsInputActive && !checkIsInputActive()) {
        return;
      }

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
        // 语音输入模式不需要传 context_text
        const contextText =
          recordingModeRef.current === "edit_only"
            ? getCurrentText?.()
            : undefined;
        stopRecordingRef.current(contextText);
        return;
      }

      if (!isRecordingRef.current) return;
      // Stop recording when any modifier key is released (existing Shift+Cmd+Space flow)
      if (e.key === "Shift" || e.key === "Meta" || e.key === "Control") {
        // Don't stop if this was a long-press ShiftLeft release handled above
        if (shiftRecordingRef.current) return;
        e.preventDefault();
        // 语音输入模式不需要传 context_text
        const contextText =
          recordingModeRef.current === "edit_only"
            ? getCurrentText?.()
            : undefined;
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
  }, [isVoiceEnabled, getCurrentText, getSelectedText, cancelRecording]);

  // Window blur: auto-stop recording
  useEffect(() => {
    if (!isRecording) return;
    const handleBlur = () => {
      // 语音输入模式不需要传 context_text
      const contextText =
        recordingModeRef.current === "edit_only"
          ? getCurrentText?.()
          : undefined;
      stopRecordingAndTranscribe(contextText);
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [isRecording, stopRecordingAndTranscribe, getCurrentText]);

  if (!isVoiceEnabled) return null;

  // Handle mode selection - 点击菜单选项直接用该模式开始录音（不保存状态）
  const handleModeSelect = (selectedMode: VoiceMode) => {
    setShowModeMenu(false);

    if (voiceConfig?.feedback_url && !loaded) {
      return;
    }
    if (
      voiceConfig?.feedback_url &&
      spaceSetting?.voice_feedback_on === 1 &&
      spaceSetting?.voice_feedback_notice_acked !== 1
    ) {
      setShowFeedbackNotice(true);
      return;
    }

    // 直接用选中的模式开始录音（不保存到 state）
    if (canRecord) {
      // 记录开始录音时是否有选中文本、选中文本内容、位置和使用的模式
      const selectedText = getSelectedText?.();
      const selectionRange = getSelectionRange?.();
      hadSelectionRef.current = !!selectedText;
      savedSelectedTextRef.current = selectedText;
      savedSelectionRangeRef.current = selectionRange;
      recordingModeRef.current = selectedMode;
      startRecording(selectedMode);
    }
  };

  // Handle click/keyboard for voice button
  const handleVoiceClick = () => {
    setShowModeMenu(false);

    if (!canRecord) {
      Toast.warning("网络不可用，无法使用语音功能");
      return;
    }
    if (voiceConfig?.feedback_url && !loaded) {
      return;
    }
    if (
      voiceConfig?.feedback_url &&
      spaceSetting?.voice_feedback_on === 1 &&
      spaceSetting?.voice_feedback_notice_acked !== 1
    ) {
      setShowFeedbackNotice(true);
      return;
    }
    // 点击麦克风 icon 固定使用语音输入模式
    const selectedText = getSelectedText?.();
    const selectionRange = getSelectionRange?.();
    hadSelectionRef.current = !!selectedText;
    savedSelectedTextRef.current = selectedText;
    savedSelectionRangeRef.current = selectionRange;
    recordingModeRef.current = "append_only";
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
    // 语音编辑模式：传递上下文（优先选中文字，否则全部内容）
    // 语音输入模式：不需要传 context_text
    let contextText: string | undefined;
    if (currentMode === "edit_only") {
      const selectedText = getSelectedText?.();
      contextText = selectedText || getCurrentText?.();
    }
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

    // 语音编辑模式显示「编辑中」，语音输入模式显示「转写中」
    const statusText = currentMode === "edit_only" ? "编辑中" : "转写中";

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
            title={currentMode === "edit_only" ? "编辑中..." : "转写中..."}
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
            title="点击停止录音"
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
            {currentMode === "edit_only" ? "语音编辑" : "语音输入"}
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
            title="点击停止录音"
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

  if (isPreparing) {
    return (
      <div className="wk-voice-button-group" ref={buttonGroupRef}>
        <div
          className="wk-voice-button wk-voice-button--preparing"
          title="准备中..."
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

  // 默认状态：显示麦克风按钮和下拉箭头（一体交互）
  // hover 整个按钮 → 箭头向上 + 弹出选择框
  // 直接点击 icon → 开始语音输入
  // PRD: 无网络时话筒 icon 置灰，点击时 Toast「网络不可用，无法使用语音功能」
  const isActive = showModeMenu;

  const dropdownMenu = (
    <Dropdown.Menu style={{ width: 160 }}>
      {VOICE_MODES.map((mode) => (
        <Dropdown.Item
          key={mode.value}
          onClick={() => handleModeSelect(mode.value)}
        >
          {mode.label}
        </Dropdown.Item>
      ))}
    </Dropdown.Menu>
  );

  return (
    <>
    <Dropdown
      trigger="hover"
      position="topRight"
      render={dropdownMenu}
      visible={canRecord ? showModeMenu : false}
      onVisibleChange={setShowModeMenu}
      spacing={4}
    >
      <div
        className={`wk-voice-button-group ${
          isActive ? "wk-voice-button-group--active" : ""
        }`}
        ref={buttonGroupRef}
        onClick={handleVoiceClick}
        onKeyDown={handleVoiceKeyDown}
        style={{
          cursor: canRecord ? "pointer" : "not-allowed",
        }}
      >
        {/* 麦克风 + 箭头一体，点击整个区域开始录音 */}
        <div
          className={`wk-voice-button ${
            !canRecord
              ? "wk-voice-button--disabled"
              : isActive
              ? "wk-voice-button--active"
              : ""
          }`}
          title={canRecord ? "语音输入 (长按 Shift)" : "网络不可用"}
          role="button"
          tabIndex={canRecord ? 0 : -1}
        >
          <Mic size={18} color="currentColor" />
          <svg
            width="6"
            height="4"
            viewBox="0 0 6 4"
            fill="currentColor"
            className={`wk-voice-arrow ${isActive ? "wk-voice-arrow--up" : ""}`}
          >
            <path d="M0.5 0.5L3 3.5L5.5 0.5H0.5Z" />
          </svg>
        </div>
      </div>
    </Dropdown>
    {showFeedbackNotice && (
      <VoiceFeedbackNotice
        onClose={() => {
          setShowFeedbackNotice(false);
          updateSetting({ voice_feedback_notice_acked: 1 });
        }}
        privacyUrl={voiceConfig?.feedback_privacy_url}
      />
    )}
    </>
  );
}
