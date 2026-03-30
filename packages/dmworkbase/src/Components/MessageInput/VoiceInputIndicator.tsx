import React, { useEffect } from "react"
import { Toast } from "@douyinfe/semi-ui"
import useVoiceInput from "./useVoiceInput"
import "./voiceInput.css"

interface VoiceInputIndicatorProps {
    onTranscribed: (text: string) => void
    getCurrentText?: () => string | undefined
    getChatContext?: () => string | undefined
}

function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, "0")}`
}

export default function VoiceInputIndicator({ onTranscribed, getCurrentText, getChatContext }: VoiceInputIndicatorProps) {
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
            if (error.message.includes("denied") || error.message.includes("Permission") || error.message.includes("NotAllowedError")) {
                Toast.error("Please allow microphone access")
            } else {
                Toast.error(error.message || "Voice transcription failed")
            }
        },
    })

    // Keyboard shortcut: Shift + Cmd/Ctrl + Space
    useEffect(() => {
        if (!isVoiceEnabled) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.code === "Space") {
                if (!isRecording && !isTranscribing) {
                    e.preventDefault()
                    startRecording()
                }
            }
        }

        const handleKeyUp = (e: KeyboardEvent) => {
            if (!isRecording) return
            // Stop recording when any modifier key is released
            if (e.key === "Shift" || e.key === "Meta" || e.key === "Control") {
                e.preventDefault()
                const contextText = getCurrentText?.()
                stopRecordingAndTranscribe(contextText)
            }
        }

        window.addEventListener("keydown", handleKeyDown)
        window.addEventListener("keyup", handleKeyUp)

        return () => {
            window.removeEventListener("keydown", handleKeyDown)
            window.removeEventListener("keyup", handleKeyUp)
        }
    }, [isVoiceEnabled, isRecording, isTranscribing, startRecording, stopRecordingAndTranscribe, getCurrentText])

    // Window blur: auto-stop recording
    useEffect(() => {
        if (!isRecording) return
        const handleBlur = () => {
            const contextText = getCurrentText?.()
            stopRecordingAndTranscribe(contextText)
        }
        window.addEventListener("blur", handleBlur)
        return () => window.removeEventListener("blur", handleBlur)
    }, [isRecording, stopRecordingAndTranscribe, getCurrentText])

    if (!isVoiceEnabled) return null

    if (isTranscribing) {
        return (
            <div className="wk-voice-indicator wk-voice-transcribing">
                <span className="wk-voice-spinner" />
                <span className="wk-voice-label">Transcribing...</span>
            </div>
        )
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
                        e.preventDefault()
                        cancelRecording()
                    }}
                    type="button"
                >
                    Cancel
                </button>
            </div>
        )
    }

    return null
}
