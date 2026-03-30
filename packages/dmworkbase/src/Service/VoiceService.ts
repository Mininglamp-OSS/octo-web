import APIClient from "./APIClient"

export interface VoiceConfig {
    enabled: boolean
    max_duration: number
}

export interface TranscribeResult {
    text: string
    model: string
}

export default class VoiceService {
    private constructor() {}
    public static shared = new VoiceService()

    async getConfig(): Promise<VoiceConfig> {
        return APIClient.shared.get<VoiceConfig>("/api/voice/config")
    }

    async transcribe(audio: Blob, contextText?: string, chatContext?: string): Promise<TranscribeResult> {
        const formData = new FormData()
        const ext = audio.type.includes("mp4") ? "mp4" : "webm"
        formData.append("file", audio, `recording.${ext}`)
        if (contextText) {
            formData.append("context_text", contextText)
        }
        if (chatContext) {
            formData.append("chat_context", chatContext)
        }
        return APIClient.shared.post("/api/voice/transcribe", formData)
    }
}
