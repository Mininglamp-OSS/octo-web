import { useState, useEffect, useRef, useCallback } from "react"
import VoiceService, { VoiceConfig } from "../../Service/VoiceService"

export interface UseVoiceInputOptions {
    maxDuration?: number
    onTranscribed?: (text: string) => void
    onError?: (error: Error) => void
}

export interface UseVoiceInputReturn {
    isRecording: boolean
    isTranscribing: boolean
    duration: number
    startRecording: () => void
    stopRecordingAndTranscribe: (contextText?: string) => void
    cancelRecording: () => void
    isVoiceEnabled: boolean
}

function getSupportedMimeType(): string {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        return "audio/webm;codecs=opus"
    }
    return "audio/mp4"
}

export default function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
    const { maxDuration = 60, onTranscribed, onError } = options

    const [isRecording, setIsRecording] = useState(false)
    const [isTranscribing, setIsTranscribing] = useState(false)
    const [duration, setDuration] = useState(0)
    const [isVoiceEnabled, setIsVoiceEnabled] = useState(false)

    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const chunksRef = useRef<Blob[]>([])
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const contextTextRef = useRef<string | undefined>(undefined)
    const stopFnRef = useRef<(contextText?: string) => void>(() => {})

    // Fetch voice config on mount
    useEffect(() => {
        VoiceService.shared.getConfig()
            .then((config: VoiceConfig) => {
                setIsVoiceEnabled(config.enabled)
            })
            .catch(() => {
                setIsVoiceEnabled(false)
            })
    }, [])

    const cleanup = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop())
            streamRef.current = null
        }
        mediaRecorderRef.current = null
        chunksRef.current = []
        setDuration(0)
    }, [])

    const startRecording = useCallback(async () => {
        if (isRecording) return

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            streamRef.current = stream

            const mimeType = getSupportedMimeType()
            const recorder = new MediaRecorder(stream, { mimeType })
            mediaRecorderRef.current = recorder
            chunksRef.current = []

            recorder.ondataavailable = (e: BlobEvent) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data)
                }
            }

            recorder.start()
            setIsRecording(true)
            setDuration(0)

            const startTime = Date.now()
            timerRef.current = setInterval(() => {
                const elapsed = Math.floor((Date.now() - startTime) / 1000)
                setDuration(elapsed)
                if (elapsed >= maxDuration) {
                    stopFnRef.current()
                }
            }, 1000)
        } catch (err) {
            const error = err instanceof Error ? err : new Error("Microphone access denied")
            if (onError) onError(error)
            cleanup()
        }
    }, [isRecording, maxDuration, onError, cleanup])

    const stopRecordingAndTranscribe = useCallback((contextText?: string) => {
        if (contextText !== undefined) {
            contextTextRef.current = contextText
        }
        const recorder = mediaRecorderRef.current
        if (!recorder || recorder.state === "inactive") {
            cleanup()
            setIsRecording(false)
            return
        }

        recorder.onstop = async () => {
            const mimeType = getSupportedMimeType()
            const blob = new Blob(chunksRef.current, { type: mimeType })
            cleanup()
            setIsRecording(false)

            // Ignore very short recordings (< 0.5s worth of data is likely accidental)
            if (blob.size < 1000) {
                return
            }

            setIsTranscribing(true)
            try {
                const result = await VoiceService.shared.transcribe(blob, contextTextRef.current)
                if (result.text && onTranscribed) {
                    onTranscribed(result.text)
                }
            } catch (err) {
                const error = err instanceof Error ? err : new Error("Transcription failed")
                if (onError) onError(error)
            } finally {
                setIsTranscribing(false)
                contextTextRef.current = undefined
            }
        }

        recorder.stop()
    }, [cleanup, onTranscribed, onError])

    stopFnRef.current = stopRecordingAndTranscribe

    const cancelRecording = useCallback(() => {
        const recorder = mediaRecorderRef.current
        if (recorder && recorder.state !== "inactive") {
            recorder.onstop = null
            recorder.stop()
        }
        cleanup()
        setIsRecording(false)
    }, [cleanup])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                mediaRecorderRef.current.onstop = null
                mediaRecorderRef.current.stop()
            }
            cleanup()
        }
    }, [cleanup])

    return {
        isRecording,
        isTranscribing,
        duration,
        startRecording,
        stopRecordingAndTranscribe,
        cancelRecording,
        isVoiceEnabled,
    }
}
