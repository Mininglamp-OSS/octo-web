import { vi, describe, it, expect, beforeEach } from "vitest"

// Mock APIClient before importing VoiceService
vi.mock("@octo/base/src/Service/APIClient", () => {
    const mockAPIClient = {
        shared: {
            get: vi.fn(),
            post: vi.fn(),
            config: { apiURL: "" },
        },
    }
    return {
        default: mockAPIClient,
        APIClientConfig: vi.fn(),
        RequestConfig: vi.fn(),
    }
})

import APIClient from "@octo/base/src/Service/APIClient"
import VoiceService from "@octo/base/src/Service/VoiceService"

describe("VoiceService", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe("getConfig", () => {
        it("should call GET /api/voice/config and return config", async () => {
            const mockConfig = { enabled: true, max_duration: 60 }
            vi.mocked(APIClient.shared.get).mockResolvedValue(mockConfig)

            const result = await VoiceService.shared.getConfig()

            expect(APIClient.shared.get).toHaveBeenCalledWith("/api/voice/config")
            expect(result).toEqual(mockConfig)
        })

        it("should propagate errors from the API", async () => {
            vi.mocked(APIClient.shared.get).mockRejectedValue(new Error("Network error"))

            await expect(VoiceService.shared.getConfig()).rejects.toThrow("Network error")
        })

        it("should return enabled false when server returns disabled", async () => {
            const mockConfig = { enabled: false, max_duration: 30 }
            vi.mocked(APIClient.shared.get).mockResolvedValue(mockConfig)

            const result = await VoiceService.shared.getConfig()

            expect(result.enabled).toBe(false)
            expect(result.max_duration).toBe(30)
        })
    })

    describe("transcribe", () => {
        it("should POST audio blob as FormData to /api/voice/transcribe", async () => {
            const mockResult = { text: "hello world", model: "whisper-1" }
            vi.mocked(APIClient.shared.post).mockResolvedValue(mockResult)

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            const result = await VoiceService.shared.transcribe(audioBlob)

            expect(APIClient.shared.post).toHaveBeenCalledTimes(1)
            const [url, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect(url).toBe("/api/voice/transcribe")
            expect(formData).toBeInstanceOf(FormData)
            expect((formData as FormData).get("file")).toBeTruthy()
            expect(result).toEqual(mockResult)
        })

        it("should include context_text when provided", async () => {
            const mockResult = { text: "hello", model: "whisper-1" }
            vi.mocked(APIClient.shared.post).mockResolvedValue(mockResult)

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, "some context")

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("context_text")).toBe("some context")
        })

        it("should not include context_text when not provided", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hi", model: "whisper-1" })

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob)

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("context_text")).toBeNull()
        })

        it("should use .webm extension for webm audio", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "", model: "" })

            const audioBlob = new Blob(["data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob)

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            const file = (formData as FormData).get("file") as File
            expect(file.name).toBe("recording.webm")
        })

        it("should use .mp4 extension for mp4 audio", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "", model: "" })

            const audioBlob = new Blob(["data"], { type: "audio/mp4" })
            await VoiceService.shared.transcribe(audioBlob)

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            const file = (formData as FormData).get("file") as File
            expect(file.name).toBe("recording.mp4")
        })

        it("should propagate transcription errors", async () => {
            vi.mocked(APIClient.shared.post).mockRejectedValue(new Error("Transcription failed"))

            const audioBlob = new Blob(["data"], { type: "audio/webm" })
            await expect(VoiceService.shared.transcribe(audioBlob)).rejects.toThrow("Transcription failed")
        })

        it("should include chat_context when provided", async () => {
            const mockResult = { text: "hello", model: "whisper-1" }
            vi.mocked(APIClient.shared.post).mockResolvedValue(mockResult)

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, undefined, "[Alice]: hi\n[Bob]: hello")

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("chat_context")).toBe("[Alice]: hi\n[Bob]: hello")
        })

        it("should not include chat_context when not provided", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hi", model: "whisper-1" })

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, "some context")

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("chat_context")).toBeNull()
        })

        it("should include both context_text and chat_context when both provided", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hi", model: "whisper-1" })

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, "input text", "[Alice]: hi")

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("context_text")).toBe("input text")
            expect((formData as FormData).get("chat_context")).toBe("[Alice]: hi")
        })
    })
})
