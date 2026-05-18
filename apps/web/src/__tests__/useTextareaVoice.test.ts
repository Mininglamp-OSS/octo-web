// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

// Mock useVoiceInput hook
const mockStartRecording = vi.fn();
const mockStopRecordingAndTranscribe = vi.fn();
const mockCancelRecording = vi.fn();
let capturedOnTranscribed: ((text: string) => void) | undefined;

vi.mock("@octo/base/src/Components/MessageInput/useVoiceInput", () => ({
  default: (opts: { onTranscribed?: (text: string) => void }) => {
    capturedOnTranscribed = opts?.onTranscribed;
    return {
      isRecording: false,
      isTranscribing: false,
      startRecording: mockStartRecording,
      stopRecordingAndTranscribe: mockStopRecordingAndTranscribe,
      cancelRecording: mockCancelRecording,
      isVoiceEnabled: true,
      currentMode: "append_only",
      localAvailable: false,
    };
  },
}));

import useTextareaVoice from "@octo/base/src/Components/VoiceInputButton/useTextareaVoice";

describe("useTextareaVoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnTranscribed = undefined;
  });

  function createInputRef(
    overrides: Partial<HTMLTextAreaElement> = {}
  ): React.RefObject<HTMLTextAreaElement> {
    const el = {
      selectionStart: 0,
      selectionEnd: 0,
      ...overrides,
    } as HTMLTextAreaElement;
    return { current: el } as React.RefObject<HTMLTextAreaElement>;
  }

  it("should return voice state from useVoiceInput", () => {
    const inputRef = createInputRef();
    const onTranscribed = vi.fn();

    const { result } = renderHook(() =>
      useTextareaVoice({ inputRef, onTranscribed })
    );

    expect(result.current.isRecording).toBe(false);
    expect(result.current.isTranscribing).toBe(false);
    expect(result.current.isVoiceEnabled).toBe(true);
  });

  it("should call startRecording with mode when inputRef is valid", () => {
    const inputRef = createInputRef({ selectionStart: 0, selectionEnd: 0 });
    const onTranscribed = vi.fn();

    const { result } = renderHook(() =>
      useTextareaVoice({ inputRef, onTranscribed })
    );

    act(() => {
      result.current.startRecording("append_only");
    });

    expect(mockStartRecording).toHaveBeenCalledWith("append_only");
  });

  it("should not call startRecording when inputRef.current is null", () => {
    const inputRef = { current: null } as React.RefObject<HTMLTextAreaElement>;
    const onTranscribed = vi.fn();

    const { result } = renderHook(() =>
      useTextareaVoice({ inputRef, onTranscribed })
    );

    act(() => {
      result.current.startRecording();
    });

    expect(mockStartRecording).not.toHaveBeenCalled();
  });

  it("should detect selection when starting recording", () => {
    const inputRef = createInputRef({ selectionStart: 2, selectionEnd: 8 });
    const onTranscribed = vi.fn();

    const { result } = renderHook(() =>
      useTextareaVoice({ inputRef, onTranscribed })
    );

    act(() => {
      result.current.startRecording("edit_only");
    });

    expect(mockStartRecording).toHaveBeenCalledWith("edit_only");

    // Simulate transcription callback from useVoiceInput
    act(() => {
      capturedOnTranscribed?.("replaced text");
    });

    // edit_only + had selection → "selection" mode
    expect(onTranscribed).toHaveBeenCalledWith("replaced text", "selection", { from: 2, to: 8 });
  });

  it("should use 'all' replaceMode for edit_only without selection", () => {
    const inputRef = createInputRef({ selectionStart: 5, selectionEnd: 5 });
    const onTranscribed = vi.fn();

    const { result } = renderHook(() =>
      useTextareaVoice({ inputRef, onTranscribed })
    );

    act(() => {
      result.current.startRecording("edit_only");
    });

    act(() => {
      capturedOnTranscribed?.("new text");
    });

    expect(onTranscribed).toHaveBeenCalledWith("new text", "all", { from: 5, to: 5 });
  });

  it("should use 'insert' replaceMode for append_only mode", () => {
    const inputRef = createInputRef({ selectionStart: 3, selectionEnd: 3 });
    const onTranscribed = vi.fn();

    const { result } = renderHook(() =>
      useTextareaVoice({ inputRef, onTranscribed })
    );

    act(() => {
      result.current.startRecording("append_only");
    });

    act(() => {
      capturedOnTranscribed?.("appended");
    });

    expect(onTranscribed).toHaveBeenCalledWith("appended", "insert", { from: 3, to: 3 });
  });

  it("should default to append_only mode when no mode specified", () => {
    const inputRef = createInputRef();
    const onTranscribed = vi.fn();

    const { result } = renderHook(() =>
      useTextareaVoice({ inputRef, onTranscribed })
    );

    act(() => {
      result.current.startRecording();
    });

    expect(mockStartRecording).toHaveBeenCalledWith("append_only");
  });

  it("should pass contextText when stopping in edit_only mode", () => {
    const inputRef = createInputRef();
    const onTranscribed = vi.fn();
    const getCurrentText = vi.fn().mockReturnValue("current content");

    const { result } = renderHook(() =>
      useTextareaVoice({
        inputRef,
        onTranscribed,
        getCurrentText,
      })
    );

    // Start in edit_only mode
    act(() => {
      result.current.startRecording("edit_only");
    });

    act(() => {
      result.current.stopRecordingAndTranscribe();
    });

    expect(mockStopRecordingAndTranscribe).toHaveBeenCalledWith(
      "current content"
    );
  });

  it("should not pass contextText when stopping in append_only mode", () => {
    const inputRef = createInputRef();
    const onTranscribed = vi.fn();
    const getCurrentText = vi.fn().mockReturnValue("current content");

    const { result } = renderHook(() =>
      useTextareaVoice({
        inputRef,
        onTranscribed,
        getCurrentText,
      })
    );

    act(() => {
      result.current.startRecording("append_only");
    });

    act(() => {
      result.current.stopRecordingAndTranscribe();
    });

    expect(mockStopRecordingAndTranscribe).toHaveBeenCalledWith(undefined);
  });

  it("should expose cancelRecording from useVoiceInput", () => {
    const inputRef = createInputRef();
    const onTranscribed = vi.fn();

    const { result } = renderHook(() =>
      useTextareaVoice({ inputRef, onTranscribed })
    );

    act(() => {
      result.current.cancelRecording();
    });

    expect(mockCancelRecording).toHaveBeenCalled();
  });
});
