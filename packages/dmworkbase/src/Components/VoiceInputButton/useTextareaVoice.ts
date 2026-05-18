import { useRef, useCallback } from "react";
import useVoiceInput from "../MessageInput/useVoiceInput";
import type { ChatContextResult } from "../Conversation/chatContext";
import type { VoiceMode } from "../../Service/VoiceService";

export type ReplaceMode = "all" | "selection" | "insert";

export interface SelectionRange {
  from: number;
  to: number;
}

export interface UseTextareaVoiceOptions {
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  onTranscribed: (text: string, replaceMode: ReplaceMode, savedSelectionRange?: SelectionRange) => void;
  getCurrentText?: () => string;
  enableEditMode?: boolean;
  getChatContext?: () => ChatContextResult | Promise<ChatContextResult>;
}

export interface UseTextareaVoiceReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  startRecording: (mode?: VoiceMode) => void;
  stopRecordingAndTranscribe: () => void;
  cancelRecording: () => void;
  isVoiceEnabled: boolean;
  localAvailable: boolean;
}

export default function useTextareaVoice({
  inputRef,
  onTranscribed,
  getCurrentText,
  enableEditMode = false,
  getChatContext,
}: UseTextareaVoiceOptions): UseTextareaVoiceReturn {
  const hadSelectionRef = useRef(false);
  const savedSelectionRangeRef = useRef<SelectionRange>({ from: 0, to: 0 });
  const savedSelectedTextRef = useRef<string | undefined>(undefined);
  const recordingModeRef = useRef<VoiceMode>("append_only");

  const onTranscribedRef = useRef(onTranscribed);
  onTranscribedRef.current = onTranscribed;
  const getCurrentTextRef = useRef(getCurrentText);
  getCurrentTextRef.current = getCurrentText;

  const {
    isRecording,
    isTranscribing,
    startRecording: rawStartRecording,
    stopRecordingAndTranscribe: rawStop,
    cancelRecording,
    isVoiceEnabled,
    localAvailable,
  } = useVoiceInput({
    onTranscribed: (text: string) => {
      const mode = recordingModeRef.current;
      const range = savedSelectionRangeRef.current;
      if (mode === "edit_only") {
        if (hadSelectionRef.current) {
          onTranscribedRef.current(text, "selection", range);
        } else {
          onTranscribedRef.current(text, "all", range);
        }
      } else {
        onTranscribedRef.current(text, "insert", range);
      }
    },
    getChatContext,
    mode: "append_only",
    onError: () => {},
  });

  const startRecording = useCallback(
    (mode?: VoiceMode) => {
      if (!inputRef.current) return;

      const el = inputRef.current;
      const selStart = el.selectionStart ?? 0;
      const selEnd = el.selectionEnd ?? 0;
      hadSelectionRef.current = selStart !== selEnd;
      savedSelectionRangeRef.current = { from: selStart, to: selEnd };
      const selectedText = (selStart !== selEnd) ? el.value.slice(selStart, selEnd) : undefined;
      savedSelectedTextRef.current = selectedText;

      const effectiveMode = mode ?? "append_only";
      recordingModeRef.current = effectiveMode;
      rawStartRecording(effectiveMode);
    },
    [inputRef, rawStartRecording],
  );

  const stopRecordingAndTranscribe = useCallback(() => {
    const contextText =
      recordingModeRef.current === "edit_only"
        ? (savedSelectedTextRef.current || getCurrentTextRef.current?.())
        : undefined;
    rawStop(contextText);
  }, [rawStop]);

  return {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecordingAndTranscribe,
    cancelRecording,
    isVoiceEnabled,
    localAvailable,
  };
}
