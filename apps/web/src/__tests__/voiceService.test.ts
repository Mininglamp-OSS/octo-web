import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"

// Mock APIClient before importing VoiceService
vi.mock("@octo/base/src/Service/APIClient", () => {
    const mockAPIClient = {
        shared: {
            get: vi.fn(),
            post: vi.fn(),
            put: vi.fn(),
            delete: vi.fn(),
            config: { apiURL: "" },
        },
    }
    return {
        default: mockAPIClient,
        APIClientConfig: vi.fn(),
        RequestConfig: vi.fn(),
    }
})

// Mock LocalModelService
vi.mock("@octo/base/src/Service/LocalModelService", () => {
    const mockLocalModelService = {
        shared: {
            transcribe: vi.fn().mockResolvedValue(null),
            probe: vi.fn().mockResolvedValue(false),
            status: "unavailable" as const,
            config: { enabled: false, preferLocal: true, endpoint: "http://localhost:8787", probeTimeoutMs: 2000, requestTimeoutMs: 30000 },
        },
    }
    return { default: mockLocalModelService }
})

import APIClient from "@octo/base/src/Service/APIClient"
import VoiceService from "@octo/base/src/Service/VoiceService"
import LocalModelService from "@octo/base/src/Service/LocalModelService"

describe("VoiceService", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe("getConfig", () => {
        it("should call GET /api/voice/config and return config", async () => {
            const mockConfig = { enabled: true, max_duration: 60 }
            vi.mocked(APIClient.shared.get).mockResolvedValue(mockConfig)

            const result = await VoiceService.shared.getConfig()

            expect(APIClient.shared.get).toHaveBeenCalledWith("/voice/config")
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

        it("should return VoiceConfig with local_enabled and local_timeout_ms fields", async () => {
            const mockConfig = { enabled: true, max_duration: 60, max_file_size: 5000000, local_enabled: true, local_timeout_ms: 15000 }
            vi.mocked(APIClient.shared.get).mockResolvedValue(mockConfig)

            const result = await VoiceService.shared.getConfig()

            expect(result.enabled).toBe(true)
            expect(result.local_enabled).toBe(true)
            expect(result.local_timeout_ms).toBe(15000)
        })

        it("should return VoiceConfig with local_probe_url and local_transcribe_url fields", async () => {
            const mockConfig = { enabled: true, max_duration: 60, max_file_size: 5000000, local_enabled: true, local_timeout_ms: 15000, local_probe_url: "http://myserver:8080/health", local_transcribe_url: "http://myserver:8080/api/transcribe" }
            vi.mocked(APIClient.shared.get).mockResolvedValue(mockConfig)

            const result = await VoiceService.shared.getConfig()

            expect(result.local_probe_url).toBe("http://myserver:8080/health")
            expect(result.local_transcribe_url).toBe("http://myserver:8080/api/transcribe")
        })

        it("should return VoiceConfig without local_enabled when not set by server", async () => {
            const mockConfig = { enabled: true, max_duration: 60, max_file_size: 5000000 }
            vi.mocked(APIClient.shared.get).mockResolvedValue(mockConfig)

            const result = await VoiceService.shared.getConfig()

            expect(result.local_enabled).toBeUndefined()
            expect(result.local_timeout_ms).toBeUndefined()
        })
    })

    describe("transcribe", () => {
        it("should POST audio blob as FormData to /api/voice/transcribe", async () => {
            const mockResult = { text: "hello world", m: "whisper-1" }
            vi.mocked(APIClient.shared.post).mockResolvedValue(mockResult)

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            const result = await VoiceService.shared.transcribe(audioBlob)

            expect(APIClient.shared.post).toHaveBeenCalledTimes(1)
            const [url, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect(url).toBe("/voice/transcribe")
            expect(formData).toBeInstanceOf(FormData)
            expect((formData as FormData).get("audio")).toBeTruthy()
            expect(result).toEqual(mockResult)
        })

        it("should include context_text when provided", async () => {
            const mockResult = { text: "hello", m: "whisper-1" }
            vi.mocked(APIClient.shared.post).mockResolvedValue(mockResult)

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, "some context")

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("context_text")).toBe("some context")
        })

        it("should not include context_text when not provided", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hi", m: "whisper-1" })

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob)

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("context_text")).toBeNull()
        })

        it("should use .webm extension for webm audio", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "", m: "" })

            const audioBlob = new Blob(["data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob)

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            const file = (formData as FormData).get("audio") as File
            expect(file.name).toBe("recording.webm")
        })

        it("should use .mp4 extension for mp4 audio", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "", m: "" })

            const audioBlob = new Blob(["data"], { type: "audio/mp4" })
            await VoiceService.shared.transcribe(audioBlob)

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            const file = (formData as FormData).get("audio") as File
            expect(file.name).toBe("recording.mp4")
        })

        it("should propagate transcription errors", async () => {
            vi.mocked(APIClient.shared.post).mockRejectedValue(new Error("Transcription failed"))

            const audioBlob = new Blob(["data"], { type: "audio/webm" })
            await expect(VoiceService.shared.transcribe(audioBlob)).rejects.toThrow("Transcription failed")
        })

        it("should include chat_context when provided", async () => {
            const mockResult = { text: "hello", m: "whisper-1" }
            vi.mocked(APIClient.shared.post).mockResolvedValue(mockResult)

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, undefined, "[Alice]: hi\n[Bob]: hello")

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("chat_context")).toBe("[Alice]: hi\n[Bob]: hello")
        })

        it("should not include chat_context when not provided", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hi", m: "whisper-1" })

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, "some context")

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("chat_context")).toBeNull()
        })

        it("should include both context_text and chat_context when both provided", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hi", m: "whisper-1" })

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, "input text", "[Alice]: hi")

            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("context_text")).toBe("input text")
            expect((formData as FormData).get("chat_context")).toBe("[Alice]: hi")
        })

        it("should include personal_context when provided", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hi", m: "whisper-1" })
            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, undefined, undefined, "个人纠错词")
            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("personal_context")).toBe("个人纠错词")
        })

        it("should include member_context when provided", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hi", m: "whisper-1" })
            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, undefined, undefined, undefined, "聊天成员：Alice")
            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("member_context")).toBe("聊天成员：Alice")
        })

        it("should include all context fields when all provided", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hi", m: "whisper-1" })
            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, "input text", "[Alice]: hi", "纠错词", "聊天成员：Alice")
            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("context_text")).toBe("input text")
            expect((formData as FormData).get("chat_context")).toBe("[Alice]: hi")
            expect((formData as FormData).get("personal_context")).toBe("纠错词")
            expect((formData as FormData).get("member_context")).toBe("聊天成员：Alice")
        })

        it("should not include personal_context and member_context when not provided", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hi", m: "whisper-1" })
            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, undefined, "[Alice]: hi")
            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("personal_context")).toBeNull()
            expect((formData as FormData).get("member_context")).toBeNull()
        })

        it("should include self_name when a non-empty selfName is provided", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hi", m: "whisper-1" })
            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(
                audioBlob, undefined, undefined, undefined, undefined, undefined, true, undefined, undefined, "张三/zhangsan"
            )
            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("self_name")).toBe("张三/zhangsan")
        })

        it("should not include self_name when selfName is empty", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hi", m: "whisper-1" })
            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(
                audioBlob, undefined, undefined, undefined, undefined, undefined, true, undefined, undefined, ""
            )
            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("self_name")).toBeNull()
        })

        it("should not include self_name when selfName is undefined", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hi", m: "whisper-1" })
            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, undefined, undefined, undefined, undefined, undefined, true)
            const [, formData] = vi.mocked(APIClient.shared.post).mock.calls[0]
            expect((formData as FormData).get("self_name")).toBeNull()
        })

        it("should return TranscribeResult with m field from backend response", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "hello", m: "g3fp" })

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            const result = await VoiceService.shared.transcribe(audioBlob)

            expect(result.m).toBe("g3fp")
            expect(result.text).toBe("hello")
        })

        it("should skip local model when skipLocal is true", async () => {
            vi.mocked(LocalModelService.shared.transcribe).mockResolvedValue({ text: "local result", m: "local" })
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "backend result", m: "whisper-1" })

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            const result = await VoiceService.shared.transcribe(audioBlob, undefined, undefined, undefined, undefined, undefined, true)

            expect(LocalModelService.shared.transcribe).not.toHaveBeenCalled()
            expect(result.text).toBe("backend result")
        })

        it("should try local model when skipLocal is false or undefined", async () => {
            vi.mocked(LocalModelService.shared.transcribe).mockResolvedValue({ text: "local result", m: "local" })

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            const result = await VoiceService.shared.transcribe(audioBlob, "ctx", "chat", "personal", "member", "smart")

            expect(LocalModelService.shared.transcribe).toHaveBeenCalledWith(audioBlob, "ctx", "chat", "personal", "member", "smart", undefined)
            expect(result.text).toBe("local result")
            expect(APIClient.shared.post).not.toHaveBeenCalled()
        })

        it("should pass all context params to LocalModelService.transcribe", async () => {
            vi.mocked(LocalModelService.shared.transcribe).mockResolvedValue(null)
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "backend", m: "whisper-1" })

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            await VoiceService.shared.transcribe(audioBlob, "ctxText", "chatCtx", "personalCtx", "memberCtx", "edit_only")

            expect(LocalModelService.shared.transcribe).toHaveBeenCalledWith(
                audioBlob, "ctxText", "chatCtx", "personalCtx", "memberCtx", "edit_only", undefined
            )
        })

        it("should fallback to backend when local model returns null", async () => {
            vi.mocked(LocalModelService.shared.transcribe).mockResolvedValue(null)
            vi.mocked(APIClient.shared.post).mockResolvedValue({ text: "backend result", m: "whisper-1" })

            const audioBlob = new Blob(["audio-data"], { type: "audio/webm;codecs=opus" })
            const result = await VoiceService.shared.transcribe(audioBlob, "ctx")

            expect(LocalModelService.shared.transcribe).toHaveBeenCalledWith(audioBlob, "ctx", undefined, undefined, undefined, undefined, undefined)
            expect(APIClient.shared.post).toHaveBeenCalled()
            expect(result.text).toBe("backend result")
        })
    })

    describe("getVoiceContext", () => {
        beforeEach(() => {
            VoiceService.shared.clearVoiceContextCache()
            vi.useFakeTimers()
        })

        afterEach(() => {
            vi.useRealTimers()
        })

        it("should send GET /voice/context with space_id param", async () => {
            vi.mocked(APIClient.shared.get).mockResolvedValueOnce({
                status: 200,
                has_context: true,
                context: "纠错词",
                updated_at: "2026-04-09T13:00:00+08:00",
            })

            const result = await VoiceService.shared.getVoiceContext("space1")

            expect(APIClient.shared.get).toHaveBeenCalledWith("/voice/context", {
                param: { space_id: "space1" },
            })
            expect(result.has_context).toBe(true)
            expect(result.context).toBe("纠错词")
            expect(result.updated_at).toBe("2026-04-09T13:00:00+08:00")
        })

        it("should return cached result within TTL", async () => {
            vi.mocked(APIClient.shared.get).mockResolvedValueOnce({
                status: 200,
                has_context: true,
                context: "纠错词",
                updated_at: "",
            })

            await VoiceService.shared.getVoiceContext("space1")
            await VoiceService.shared.getVoiceContext("space1")

            expect(APIClient.shared.get).toHaveBeenCalledTimes(1)
        })

        it("should re-fetch after cache TTL expires", async () => {
            vi.mocked(APIClient.shared.get).mockResolvedValue({
                status: 200,
                has_context: true,
                context: "纠错词",
                updated_at: "",
            })

            await VoiceService.shared.getVoiceContext("space1")
            expect(APIClient.shared.get).toHaveBeenCalledTimes(1)

            vi.advanceTimersByTime(5 * 60 * 1000 + 1)

            await VoiceService.shared.getVoiceContext("space1")
            expect(APIClient.shared.get).toHaveBeenCalledTimes(2)
        })

        it("should deduplicate concurrent requests for the same spaceId", async () => {
            let resolveRequest!: (v: any) => void
            vi.mocked(APIClient.shared.get).mockReturnValueOnce(
                new Promise((r) => { resolveRequest = r })
            )

            const p1 = VoiceService.shared.getVoiceContext("space1")
            const p2 = VoiceService.shared.getVoiceContext("space1")

            resolveRequest({ status: 200, has_context: false, context: "", updated_at: "" })

            const [r1, r2] = await Promise.all([p1, p2])
            expect(r1).toEqual(r2)
            expect(APIClient.shared.get).toHaveBeenCalledTimes(1)
        })

        it("should re-fetch after clearVoiceContextCache(spaceId)", async () => {
            vi.mocked(APIClient.shared.get).mockResolvedValue({
                status: 200,
                has_context: false,
                context: "",
                updated_at: "",
            })

            await VoiceService.shared.getVoiceContext("space1")
            VoiceService.shared.clearVoiceContextCache("space1")
            await VoiceService.shared.getVoiceContext("space1")

            expect(APIClient.shared.get).toHaveBeenCalledTimes(2)
        })

        it("should clear all caches when clearVoiceContextCache() is called without args", async () => {
            vi.mocked(APIClient.shared.get).mockResolvedValue({
                status: 200,
                has_context: false,
                context: "",
                updated_at: "",
            })

            await VoiceService.shared.getVoiceContext("space1")
            await VoiceService.shared.getVoiceContext("space2")
            VoiceService.shared.clearVoiceContextCache()
            await VoiceService.shared.getVoiceContext("space1")
            await VoiceService.shared.getVoiceContext("space2")

            expect(APIClient.shared.get).toHaveBeenCalledTimes(4)
        })

        it("should not cache on request failure", async () => {
            vi.mocked(APIClient.shared.get).mockRejectedValueOnce(new Error("network error"))
            await expect(VoiceService.shared.getVoiceContext("space1")).rejects.toThrow()

            vi.mocked(APIClient.shared.get).mockResolvedValueOnce({
                status: 200,
                has_context: false,
                context: "",
                updated_at: "",
            })
            const result = await VoiceService.shared.getVoiceContext("space1")
            expect(result.has_context).toBe(false)
        })

        it("should timeout and reject after 3 seconds", async () => {
            vi.mocked(APIClient.shared.get).mockReturnValueOnce(new Promise(() => {}))

            const promise = VoiceService.shared.getVoiceContext("space1")

            vi.advanceTimersByTime(3000)

            await expect(promise).rejects.toThrow("voice context request timeout")
        })

        it("should not write back to cache when clearVoiceContextCache is called during in-flight request", async () => {
            let resolveRequest!: (v: any) => void
            vi.mocked(APIClient.shared.get).mockReturnValueOnce(
                new Promise((r) => { resolveRequest = r })
            )

            // 1. Start a request but don't resolve yet
            const p1 = VoiceService.shared.getVoiceContext("space1")

            // 2. Call clearVoiceContextCache while request is in-flight
            VoiceService.shared.clearVoiceContextCache("space1")

            // 3. Resolve the old request
            resolveRequest({ status: 200, has_context: true, context: "stale", updated_at: "" })
            await p1

            // 4. Verify the result is NOT cached (next getVoiceContext triggers a new API call)
            vi.mocked(APIClient.shared.get).mockResolvedValueOnce({
                status: 200,
                has_context: true,
                context: "fresh",
                updated_at: "",
            })
            const result = await VoiceService.shared.getVoiceContext("space1")
            expect(result.context).toBe("fresh")
            expect(APIClient.shared.get).toHaveBeenCalledTimes(2)
        })

        it("should maintain independent caches per spaceId", async () => {
            vi.mocked(APIClient.shared.get)
                .mockResolvedValueOnce({
                    status: 200,
                    has_context: true,
                    context: "Space A 纠错词",
                    updated_at: "",
                })
                .mockResolvedValueOnce({
                    status: 200,
                    has_context: true,
                    context: "Space B 纠错词",
                    updated_at: "",
                })

            const r1 = await VoiceService.shared.getVoiceContext("spaceA")
            const r2 = await VoiceService.shared.getVoiceContext("spaceB")

            expect(r1.context).toBe("Space A 纠错词")
            expect(r2.context).toBe("Space B 纠错词")
            expect(APIClient.shared.get).toHaveBeenCalledTimes(2)
        })
    })

    describe("putLocalConfig", () => {
        it("should call PUT /voice/local-config with enabled true", async () => {
            vi.mocked(APIClient.shared.put).mockResolvedValue({ status: 200, msg: "ok" })

            await VoiceService.shared.putLocalConfig({ enabled: true })

            expect(APIClient.shared.put).toHaveBeenCalledWith("/voice/local-config", { enabled: true })
        })

        it("should call PUT /voice/local-config with enabled false", async () => {
            vi.mocked(APIClient.shared.put).mockResolvedValue({ status: 200, msg: "ok" })

            await VoiceService.shared.putLocalConfig({ enabled: false })

            expect(APIClient.shared.put).toHaveBeenCalledWith("/voice/local-config", { enabled: false })
        })

        it("should propagate errors from the API", async () => {
            vi.mocked(APIClient.shared.put).mockRejectedValue(new Error("Forbidden"))

            await expect(VoiceService.shared.putLocalConfig({ enabled: true })).rejects.toThrow("Forbidden")
        })
    })

    describe("getLocalConfig", () => {
        it("should call GET /voice/local-config and return config", async () => {
            const mockResp = {
                status: 200,
                enabled: true,
                timeout_ms: 8000,
                probe_url: "http://localhost:8787/",
                transcribe_url: "http://localhost:8787/v1/voice/transcribe",
            }
            vi.mocked(APIClient.shared.get).mockResolvedValue(mockResp)

            const result = await VoiceService.shared.getLocalConfig()

            expect(APIClient.shared.get).toHaveBeenCalledWith("/voice/local-config")
            expect(result).toEqual(mockResp)
        })

        it("should handle null fields from unset config", async () => {
            const mockResp = {
                status: 200,
                enabled: false,
                timeout_ms: null,
                probe_url: null,
                transcribe_url: null,
            }
            vi.mocked(APIClient.shared.get).mockResolvedValue(mockResp)

            const result = await VoiceService.shared.getLocalConfig()

            expect(result.timeout_ms).toBeNull()
            expect(result.probe_url).toBeNull()
            expect(result.transcribe_url).toBeNull()
        })

        it("should propagate errors from the API", async () => {
            vi.mocked(APIClient.shared.get).mockRejectedValue(new Error("Service unavailable"))

            await expect(VoiceService.shared.getLocalConfig()).rejects.toThrow("Service unavailable")
        })
    })

    describe("deleteLocalConfig", () => {
        it("should call DELETE /voice/local-config", async () => {
            vi.mocked(APIClient.shared.delete).mockResolvedValue({ status: 200, msg: "ok" })

            await VoiceService.shared.deleteLocalConfig()

            expect(APIClient.shared.delete).toHaveBeenCalledWith("/voice/local-config")
        })

        it("should propagate errors from the API", async () => {
            vi.mocked(APIClient.shared.delete).mockRejectedValue(new Error("Not found"))

            await expect(VoiceService.shared.deleteLocalConfig()).rejects.toThrow("Not found")
        })
    })

    describe("resetLocalConfig", () => {
        it("should call POST /voice/local-config/reset with enabled true", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ status: 200, msg: "ok" })

            await VoiceService.shared.resetLocalConfig({ enabled: true })

            expect(APIClient.shared.post).toHaveBeenCalledWith("/voice/local-config/reset", { enabled: true })
        })

        it("should call POST /voice/local-config/reset with enabled false", async () => {
            vi.mocked(APIClient.shared.post).mockResolvedValue({ status: 200, msg: "ok" })

            await VoiceService.shared.resetLocalConfig({ enabled: false })

            expect(APIClient.shared.post).toHaveBeenCalledWith("/voice/local-config/reset", { enabled: false })
        })

        it("should propagate errors from the API", async () => {
            vi.mocked(APIClient.shared.post).mockRejectedValue(new Error("Server error"))

            await expect(VoiceService.shared.resetLocalConfig({ enabled: true })).rejects.toThrow("Server error")
        })
    })
})
