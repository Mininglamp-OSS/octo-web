import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Must mock VoiceService to avoid importing APIClient transitively
vi.mock("@octo/base/src/Service/APIClient", () => ({
  default: { shared: { get: vi.fn(), post: vi.fn(), config: { apiURL: "" } } },
}));

import LocalModelService, {
  normalizeEndpoint,
} from "@octo/base/src/Service/LocalModelService";

describe("LocalModelService", () => {
  let service: typeof LocalModelService.shared;

  beforeEach(() => {
    vi.useFakeTimers();
    // Reset singleton state by accessing a fresh instance via the class
    // We manipulate the shared instance directly since it's a singleton
    service = LocalModelService.shared;
    // Reset internal state via updateConfig + forceProbe pattern
    const mockStorage = { setItem: vi.fn(), getItem: vi.fn(() => null) };
    service.updateConfig(
      {
        endpoint: "http://localhost:8787",
        probeUrl: "http://localhost:8787/",
        transcribeUrl: "http://localhost:8787/v1/voice/transcribe",
        probeTimeoutMs: 2000,
        requestTimeoutMs: 30000,
        enabled: true,
        preferLocal: true,
      },
      mockStorage
    );
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("normalizeEndpoint", () => {
    it("should remove trailing slashes", () => {
      expect(normalizeEndpoint("http://localhost:8787/")).toBe(
        "http://localhost:8787"
      );
      expect(normalizeEndpoint("http://localhost:8787///")).toBe(
        "http://localhost:8787"
      );
    });

    it("should strip /v1 suffix to prevent /v1/v1", () => {
      expect(normalizeEndpoint("http://localhost:8787/v1")).toBe(
        "http://localhost:8787"
      );
      expect(normalizeEndpoint("http://localhost:8787/v1/")).toBe(
        "http://localhost:8787"
      );
    });

    it("should preserve path that is not /v1", () => {
      expect(normalizeEndpoint("http://localhost:8787/api")).toBe(
        "http://localhost:8787/api"
      );
    });

    it("should handle invalid URLs gracefully", () => {
      expect(normalizeEndpoint("not-a-url/")).toBe("not-a-url");
      expect(normalizeEndpoint("not-a-url///")).toBe("not-a-url");
    });
  });

  describe("loadConfig", () => {
    it("should load config from storage", () => {
      const mockStorage = {
        getItem: vi.fn(() =>
          JSON.stringify({ endpoint: "http://localhost:1234", enabled: true, probeUrl: "http://localhost:1234/", transcribeUrl: "http://localhost:1234/v1/voice/transcribe" })
        ),
      };
      service.loadConfig(mockStorage);
      expect(service.config.endpoint).toBe("http://localhost:1234");
      expect(service.config.enabled).toBe(true);
    });

    it("should normalize endpoint on load", () => {
      const mockStorage = {
        getItem: vi.fn(() =>
          JSON.stringify({ endpoint: "http://localhost:1234/v1/", probeUrl: "http://localhost:1234/v1/", transcribeUrl: "http://localhost:1234/v1/v1/voice/transcribe" })
        ),
      };
      service.loadConfig(mockStorage);
      expect(service.config.endpoint).toBe("http://localhost:1234");
    });

    it("should derive probeUrl and transcribeUrl from endpoint when not in stored config", () => {
      const mockStorage = {
        getItem: vi.fn(() =>
          JSON.stringify({ endpoint: "http://localhost:5555" })
        ),
      };
      service.loadConfig(mockStorage);
      expect(service.config.endpoint).toBe("http://localhost:5555");
      expect(service.config.probeUrl).toBe("http://localhost:5555/");
      expect(service.config.transcribeUrl).toBe("http://localhost:5555/v1/voice/transcribe");
    });

    it("should use defaults when storage is empty", () => {
      const mockStorage = { getItem: vi.fn(() => null) };
      service.loadConfig(mockStorage);
      expect(service.config.probeTimeoutMs).toBe(2000);
      expect(service.config.probeUrl).toBe("http://localhost:8787/");
      expect(service.config.transcribeUrl).toBe("http://localhost:8787/v1/voice/transcribe");
    });

    it("should handle corrupted storage data", () => {
      const mockStorage = { getItem: vi.fn(() => "not-json{{{") };
      expect(() => service.loadConfig(mockStorage)).not.toThrow();
    });
  });

  describe("updateConfig", () => {
    it("should persist config to storage", () => {
      const mockStorage = { setItem: vi.fn() };
      service.updateConfig({ endpoint: "http://localhost:9999" }, mockStorage);
      expect(mockStorage.setItem).toHaveBeenCalledWith(
        "dmwork_local_model_config",
        expect.stringContaining("9999")
      );
    });

    it("should reset probe state on config change", () => {
      const mockStorage = { setItem: vi.fn() };
      service.updateConfig({ endpoint: "http://localhost:9999" }, mockStorage);
      expect(service.status).toBe("unknown");
    });

    it("should normalize endpoint on update", () => {
      const mockStorage = { setItem: vi.fn() };
      service.updateConfig(
        { endpoint: "http://localhost:9999/v1/" },
        mockStorage
      );
      expect(service.config.endpoint).toBe("http://localhost:9999");
    });

    it("should derive probeUrl and transcribeUrl when endpoint changes", () => {
      const mockStorage = { setItem: vi.fn() };
      service.updateConfig(
        { endpoint: "http://localhost:9999" },
        mockStorage
      );
      expect(service.config.probeUrl).toBe("http://localhost:9999/");
      expect(service.config.transcribeUrl).toBe("http://localhost:9999/v1/voice/transcribe");
    });

    it("should not override explicit probeUrl when endpoint changes", () => {
      const mockStorage = { setItem: vi.fn() };
      service.updateConfig(
        { endpoint: "http://localhost:9999", probeUrl: "http://custom/health" },
        mockStorage
      );
      expect(service.config.probeUrl).toBe("http://custom/health");
      expect(service.config.transcribeUrl).toBe("http://localhost:9999/v1/voice/transcribe");
    });

    it("should not override explicit transcribeUrl when endpoint changes", () => {
      const mockStorage = { setItem: vi.fn() };
      service.updateConfig(
        { endpoint: "http://localhost:9999", transcribeUrl: "http://custom/transcribe" },
        mockStorage
      );
      expect(service.config.probeUrl).toBe("http://localhost:9999/");
      expect(service.config.transcribeUrl).toBe("http://custom/transcribe");
    });

    it("should not derive URLs when only non-endpoint fields change", () => {
      const mockStorage = { setItem: vi.fn() };
      // First set a custom endpoint
      service.updateConfig(
        { endpoint: "http://localhost:5555", probeUrl: "http://custom/probe", transcribeUrl: "http://custom/transcribe" },
        mockStorage
      );
      // Now update only requestTimeoutMs - URLs should stay unchanged
      service.updateConfig(
        { requestTimeoutMs: 5000 },
        mockStorage
      );
      expect(service.config.probeUrl).toBe("http://custom/probe");
      expect(service.config.transcribeUrl).toBe("http://custom/transcribe");
    });
  });

  describe("probe", () => {
    it("should probe the root endpoint /", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("", { status: 200 })
      );
      await service.probe();
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:8787/",
        expect.objectContaining({ method: "GET", redirect: "manual" })
      );
    });

    it("should use configured probeUrl", async () => {
      const mockStorage = { setItem: vi.fn() };
      service.updateConfig({ probeUrl: "http://custom:9999/health" }, mockStorage);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("", { status: 200 })
      );
      await service.probe();
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://custom:9999/health",
        expect.objectContaining({ method: "GET", redirect: "manual" })
      );
    });

    it("should return false when disabled", async () => {
      const mockStorage = { setItem: vi.fn() };
      service.updateConfig({ enabled: false }, mockStorage);
      const result = await service.probe();
      expect(result).toBe(false);
      expect(service.status).toBe("unavailable");
    });

    it("should return false when preferLocal is false", async () => {
      const mockStorage = { setItem: vi.fn() };
      service.updateConfig({ preferLocal: false }, mockStorage);
      const result = await service.probe();
      expect(result).toBe(false);
    });

    it("should return true when server responds OK", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
      const result = await service.probe();
      expect(result).toBe(true);
      expect(service.status).toBe("available");
    });

    it("should return true when server responds with non-200 (e.g. 404)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("", { status: 404 })
      );
      const result = await service.probe();
      expect(result).toBe(true);
      expect(service.status).toBe("available");
    });

    it("should return true when server responds with redirect (opaque response)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 301 })
      );
      const result = await service.probe();
      expect(result).toBe(true);
      expect(service.status).toBe("available");
    });

    it("should return true when server responds with error status", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("", { status: 500 })
      );
      const result = await service.probe();
      expect(result).toBe(true);
      expect(service.status).toBe("available");
    });

    it("should return false when fetch throws (network error)", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
        new Error("net::ERR_CONNECTION_REFUSED")
      );
      const result = await service.probe();
      expect(result).toBe(false);
      expect(service.status).toBe("unavailable");
    });

    it("should use cache on second call within TTL", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        );

      await service.probe();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Within 30s TTL
      vi.advanceTimersByTime(10_000);
      const result = await service.probe();
      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should re-probe after cache TTL expires", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        );

      await service.probe();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(30_001);
      await service.probe();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("should deduplicate concurrent probe calls", async () => {
      let resolveProbe!: (v: Response) => void;
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockReturnValueOnce(
          new Promise((r) => {
            resolveProbe = r;
          })
        );

      const p1 = service.probe();
      const p2 = service.probe();

      resolveProbe(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("exponential backoff", () => {
    it("should use 5s cache TTL after first failure", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // First failure
      fetchSpy.mockRejectedValueOnce(new Error("fail"));
      await service.probe();
      expect(service.status).toBe("unavailable");

      // Within 5s → cached
      vi.advanceTimersByTime(4_000);
      fetchSpy.mockRejectedValueOnce(new Error("fail"));
      const cached = await service.probe();
      expect(cached).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // After 5s → retry
      vi.advanceTimersByTime(1_001);
      fetchSpy.mockRejectedValueOnce(new Error("fail"));
      await service.probe();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("should increase backoff: 5s → 10s → 20s → 40s → 60s cap", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // Failure 1 → 5s
      fetchSpy.mockRejectedValueOnce(new Error("fail"));
      await service.probe();

      // Failure 2 → 10s
      vi.advanceTimersByTime(5_001);
      fetchSpy.mockRejectedValueOnce(new Error("fail"));
      await service.probe();

      // Failure 3 → 20s
      vi.advanceTimersByTime(10_001);
      fetchSpy.mockRejectedValueOnce(new Error("fail"));
      await service.probe();

      // Failure 4 → 40s
      vi.advanceTimersByTime(20_001);
      fetchSpy.mockRejectedValueOnce(new Error("fail"));
      await service.probe();

      // Failure 5 → 60s (capped)
      vi.advanceTimersByTime(40_001);
      fetchSpy.mockRejectedValueOnce(new Error("fail"));
      await service.probe();

      // Within 60s → cached
      vi.advanceTimersByTime(59_000);
      const cached = await service.probe();
      expect(cached).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(5);

      // After 60s → retry
      vi.advanceTimersByTime(1_001);
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      );
      const success = await service.probe();
      expect(success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(6);
    });

    it("should reset backoff on success", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // Fail twice
      fetchSpy.mockRejectedValueOnce(new Error("fail"));
      await service.probe();
      vi.advanceTimersByTime(5_001);
      fetchSpy.mockRejectedValueOnce(new Error("fail"));
      await service.probe();

      // Succeed
      vi.advanceTimersByTime(10_001);
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      );
      await service.probe();

      // Next cache is 30s (success TTL)
      vi.advanceTimersByTime(30_001);
      fetchSpy.mockRejectedValueOnce(new Error("fail"));
      await service.probe();

      // Back to 5s backoff (consecutiveFailures = 1)
      vi.advanceTimersByTime(5_001);
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      );
      await service.probe();
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    });
  });

  describe("forceProbe", () => {
    it("should skip cache and probe immediately", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({}), { status: 200 })
        );

      await service.probe();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Normally cached
      const cached = await service.probe();
      expect(cached).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // forceProbe bypasses cache
      await service.forceProbe();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("probe after updateConfig", () => {
    it("should transition status from unknown to available after probe", async () => {
      const mockStorage = { setItem: vi.fn() };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );

      // updateConfig with enabled: true resets status to unknown
      service.updateConfig(
        { enabled: true, preferLocal: true },
        mockStorage
      );
      expect(service.status).toBe("unknown");

      // Probe immediately restores status to available
      const result = await service.probe();
      expect(result).toBe(true);
      expect(service.status).toBe("available");
    });
  });

  describe("epoch (race condition protection)", () => {
    it("should discard probe result when epoch changes mid-flight", async () => {
      let resolveProbe!: (v: Response) => void;
      vi.spyOn(globalThis, "fetch").mockImplementation(
        () => new Promise((r) => { resolveProbe = r; })
      );

      const probePromise = service.probe();

      // Config change increments epoch → stale probe should be discarded
      const mockStorage = { setItem: vi.fn() };
      service.updateConfig({ endpoint: "http://localhost:9999" }, mockStorage);

      // Resolve stale probe
      resolveProbe(new Response(JSON.stringify({}), { status: 200 }));
      await probePromise;

      // Status should be 'unknown' (reset by updateConfig), not 'available'
      expect(service.status).toBe("unknown");
    });
  });

  describe("transcribe", () => {
    it("should probe internally when status is unknown", async () => {
      // Reset status to unknown by updating config
      const mockStorage = { setItem: vi.fn() };
      service.updateConfig(
        { enabled: true, preferLocal: true, endpoint: "http://localhost:8787" },
        mockStorage
      );
      expect(service.status).toBe("unknown");

      // Mock fetch: first call is probe (GET), second call is transcribe (POST)
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response("", { status: 200 }) // probe success
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ status: 200, text: "probed and transcribed", m: "whisper" }),
            { status: 200 }
          )
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      const result = await service.transcribe(audio);

      // Probe should have been called internally
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[0][0]).toBe("http://localhost:8787/");
      expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: "GET" });
      // Transcribe should have succeeded
      expect(result).toEqual({ text: "probed and transcribed", m: "whisper" });
      expect(service.status).toBe("available");
    });

    it("should POST to /v1/voice/transcribe endpoint", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 200, text: "hi", m: "local" }), { status: 200 })
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      await service.transcribe(audio);

      const transcribeCall = fetchSpy.mock.calls[1];
      expect(transcribeCall[0]).toBe("http://localhost:8787/v1/voice/transcribe");
    });

    it("should use configured transcribeUrl", async () => {
      const mockStorage = { setItem: vi.fn() };
      service.updateConfig({ transcribeUrl: "http://custom:9999/api/transcribe" }, mockStorage);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 200, text: "hi", m: "local" }), { status: 200 })
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      await service.transcribe(audio);

      const transcribeCall = fetchSpy.mock.calls[1];
      expect(transcribeCall[0]).toBe("http://custom:9999/api/transcribe");
    });

    it("should return result on success", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ status: 200, text: "hello world", m: "whisper-large" }),
            { status: 200 }
          )
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      const result = await service.transcribe(audio);
      expect(result).toEqual({ text: "hello world", m: "whisper-large" });
    });

    it("should default m to 'local' when m field is missing from response", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ status: 200, text: "hello world" }),
            { status: 200 }
          )
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      const result = await service.transcribe(audio);
      expect(result).toEqual({ text: "hello world", m: "local" });
    });

    it("should return null when response is not valid JSON", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response("not json", { status: 200, headers: { "Content-Type": "text/plain" } })
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      const result = await service.transcribe(audio);
      // JSON parse will throw, catch block sets status unknown, returns null
      expect(result).toBeNull();
    });

    it("should return null when probe fails", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fail"));

      const audio = new Blob(["data"], { type: "audio/webm" });
      const result = await service.transcribe(audio);
      expect(result).toBeNull();
    });

    it("should set negative cache on 404", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(new Response("", { status: 404 }));

      const audio = new Blob(["data"], { type: "audio/webm" });
      const result = await service.transcribe(audio);
      expect(result).toBeNull();

      // Subsequent transcribe should return null immediately due to negative cache
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
      const result2 = await service.transcribe(audio);
      expect(result2).toBeNull();
    });

    it("should expire negative cache after 5 minutes", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(new Response("", { status: 404 }));

      const audio = new Blob(["data"], { type: "audio/webm" });
      await service.transcribe(audio);

      // Advance past negative cache TTL
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 200, text: "works now" }), { status: 200 })
        );

      // Need to advance past probe cache too
      vi.advanceTimersByTime(30_001);
      const result = await service.transcribe(audio);
      expect(result).toEqual({ text: "works now", m: "local" });
    });

    it("should use mp4 extension for mp4 audio", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 200, text: "hi" }), { status: 200 })
        );

      const audio = new Blob(["data"], { type: "audio/mp4" });
      await service.transcribe(audio);

      const transcribeCall = fetchSpy.mock.calls[1];
      const body = transcribeCall[1]?.body as FormData;
      const file = body.get("audio") as File;
      expect(file.name).toBe("recording.mp4");
    });

    it("should use 'audio' field name in FormData (not 'file')", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 200, text: "hi" }), { status: 200 })
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      await service.transcribe(audio);

      const transcribeCall = fetchSpy.mock.calls[1];
      const body = transcribeCall[1]?.body as FormData;
      expect(body.get("audio")).toBeTruthy();
      expect(body.get("file")).toBeNull();
    });

    it("should pass context parameters in FormData", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 200, text: "hi", m: "local" }), { status: 200 })
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      await service.transcribe(audio, "ctx text", "chat ctx", "personal ctx", "member ctx", "smart");

      const transcribeCall = fetchSpy.mock.calls[1];
      const body = transcribeCall[1]?.body as FormData;
      expect(body.get("context_text")).toBe("ctx text");
      expect(body.get("chat_context")).toBe("chat ctx");
      expect(body.get("personal_context")).toBe("personal ctx");
      expect(body.get("member_context")).toBe("member ctx");
      expect(body.get("mode")).toBe("smart");
    });

    it("should include self_name when a non-empty selfName is provided", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 200, text: "hi", m: "local" }), { status: 200 })
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      await service.transcribe(audio, undefined, undefined, undefined, undefined, undefined, "张三/zhangsan");

      const transcribeCall = fetchSpy.mock.calls[1];
      const body = transcribeCall[1]?.body as FormData;
      expect(body.get("self_name")).toBe("张三/zhangsan");
    });

    it("should not include self_name when selfName is empty", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 200, text: "hi", m: "local" }), { status: 200 })
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      await service.transcribe(audio, undefined, undefined, undefined, undefined, undefined, "");

      const transcribeCall = fetchSpy.mock.calls[1];
      const body = transcribeCall[1]?.body as FormData;
      expect(body.get("self_name")).toBeNull();
    });

    it("should not include context params when not provided", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 200, text: "hi", m: "local" }), { status: 200 })
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      await service.transcribe(audio);

      const transcribeCall = fetchSpy.mock.calls[1];
      const body = transcribeCall[1]?.body as FormData;
      expect(body.get("context_text")).toBeNull();
      expect(body.get("chat_context")).toBeNull();
      expect(body.get("personal_context")).toBeNull();
      expect(body.get("member_context")).toBeNull();
      expect(body.get("mode")).toBeNull();
      expect(body.get("self_name")).toBeNull();
    });

    it("should return null when text is empty", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 200, text: "" }), { status: 200 })
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      const result = await service.transcribe(audio);
      expect(result).toBeNull();
    });

    it("should check data.status === 200", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ status: 500, text: "error msg" }),
            { status: 200 }
          )
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      const result = await service.transcribe(audio);
      expect(result).toBeNull();
    });

    it("should return result when data.status is 200", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ status: 200, text: "hello", m: "local" }),
            { status: 200 }
          )
        );

      const audio = new Blob(["data"], { type: "audio/webm" });
      const result = await service.transcribe(audio);
      expect(result).toEqual({ text: "hello", m: "local" });
    });

    it("should reset status on non-404 error", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        )
        .mockResolvedValueOnce(new Response("", { status: 500 }));

      const audio = new Blob(["data"], { type: "audio/webm" });
      await service.transcribe(audio);

      expect(service.status).toBe("unknown");
    });
  });
});
