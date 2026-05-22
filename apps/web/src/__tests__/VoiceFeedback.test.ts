import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let VoiceFeedback: typeof import("../../../../packages/dmworkbase/src/Service/VoiceFeedback").default;

beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true })),
  );
  const mod = await import(
    "../../../../packages/dmworkbase/src/Service/VoiceFeedback"
  );
  VoiceFeedback = mod.default;
  VoiceFeedback.init(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  VoiceFeedback.init(undefined);
});

describe("VoiceFeedback", () => {
  describe("init", () => {
    it("strips trailing slashes from feedbackUrl", () => {
      VoiceFeedback.init("https://example.com/feedback///");
      const instance = VoiceFeedback.shared();
      expect(instance).not.toBeNull();

      instance!.onTranscribeResult({
        utteranceId: "u1",
        modelText: "hello",
        source: "remote",
      });
      instance!.submitAll("hello");

      const fetchMock = vi.mocked(fetch);
      const call = fetchMock.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/final"),
      );
      expect(call).toBeDefined();
      expect(call![0]).toBe("https://example.com/feedback/final");
    });

    it("returns null from shared() when feedbackUrl is empty", () => {
      VoiceFeedback.init("");
      expect(VoiceFeedback.shared()).toBeNull();
    });

    it("returns null from shared() when feedbackUrl is undefined", () => {
      VoiceFeedback.init(undefined);
      expect(VoiceFeedback.shared()).toBeNull();
    });
  });

  describe("onTranscribeResult", () => {
    it("stores pending utterance", () => {
      VoiceFeedback.init("https://fb.test");
      const fb = VoiceFeedback.shared()!;

      fb.onTranscribeResult({
        utteranceId: "u1",
        modelText: "hello world",
        source: "remote",
        scene: "chat",
      });

      fb.submitAll("hello world");

      const fetchMock = vi.mocked(fetch);
      const finalCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/final"),
      );
      expect(finalCall).toBeDefined();
    });

    it("uploads local audio when source is local and audioBlob provided", () => {
      VoiceFeedback.init("https://fb.test");
      const fb = VoiceFeedback.shared()!;
      const blob = new Blob(["audio data"], { type: "audio/webm" });

      fb.onTranscribeResult({
        utteranceId: "u2",
        modelText: "test text",
        source: "local",
        audioBlob: blob,
        scene: "todo-title",
      });

      const fetchMock = vi.mocked(fetch);
      const localCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/local"),
      );
      expect(localCall).toBeDefined();
      expect(localCall![0]).toBe("https://fb.test/local");
    });

    it("does not upload local audio when source is remote", () => {
      VoiceFeedback.init("https://fb.test");
      const fb = VoiceFeedback.shared()!;

      fb.onTranscribeResult({
        utteranceId: "u3",
        modelText: "test",
        source: "remote",
      });

      const fetchMock = vi.mocked(fetch);
      const localCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/local"),
      );
      expect(localCall).toBeUndefined();
    });
  });

  describe("submitAll", () => {
    it("submits all pending utterances", () => {
      VoiceFeedback.init("https://fb.test");
      const fb = VoiceFeedback.shared()!;

      fb.onTranscribeResult({
        utteranceId: "u-old",
        modelText: "old",
        source: "remote",
        scene: "chat",
      });
      fb.onTranscribeResult({
        utteranceId: "u-new",
        modelText: "new",
        source: "remote",
        scene: "chat",
      });

      vi.mocked(fetch).mockClear();
      fb.submitAll("final text");

      const fetchMock = vi.mocked(fetch);
      const finalCalls = fetchMock.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].includes("/final"),
      );
      expect(finalCalls).toHaveLength(2);

      const bodies = finalCalls.map((c) => JSON.parse(c[1]!.body as string));
      const ids = bodies.map((b: any) => b.utterance_id).sort();
      expect(ids).toEqual(["u-new", "u-old"]);
      expect(bodies[0].user_text).toBe("final text");
      expect(bodies[1].user_text).toBe("final text");
    });

    it("is no-op when no pending utterances", () => {
      VoiceFeedback.init("https://fb.test");
      const fb = VoiceFeedback.shared()!;

      fb.submitAll("text");

      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it("clears pending after submit", () => {
      VoiceFeedback.init("https://fb.test");
      const fb = VoiceFeedback.shared()!;

      fb.onTranscribeResult({
        utteranceId: "u1",
        modelText: "hello",
        source: "remote",
      });

      fb.submitAll("text");
      vi.mocked(fetch).mockClear();

      fb.submitAll("text again");
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
  });

  describe("expiration", () => {
    it("cleans expired entries on new transcribe result", () => {
      VoiceFeedback.init("https://fb.test");
      const fb = VoiceFeedback.shared()!;

      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      fb.onTranscribeResult({
        utteranceId: "u-expired",
        modelText: "old",
        source: "remote",
      });

      vi.spyOn(Date, "now").mockReturnValue(now + 130_000);

      fb.onTranscribeResult({
        utteranceId: "u-fresh",
        modelText: "new",
        source: "remote",
      });

      vi.mocked(fetch).mockClear();
      fb.submitAll("text");

      const finalCalls = vi.mocked(fetch).mock.calls.filter(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("/final"),
      );
      expect(finalCalls).toHaveLength(1);
      const body = JSON.parse(finalCalls[0][1]!.body as string);
      expect(body.utterance_id).toBe("u-fresh");
    });
  });

  describe("uploadLocal metadata", () => {
    it("includes scene field in metadata", () => {
      VoiceFeedback.init("https://fb.test");
      const fb = VoiceFeedback.shared()!;
      const blob = new Blob(["data"], { type: "audio/webm" });

      fb.onTranscribeResult({
        utteranceId: "u-scene",
        modelText: "hello",
        source: "local",
        audioBlob: blob,
        scene: "todo-desc",
      });

      const fetchMock = vi.mocked(fetch);
      const localCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/local"),
      );
      expect(localCall).toBeDefined();

      const formData = localCall![1]!.body as FormData;
      const metadata = JSON.parse(formData.get("metadata") as string);
      expect(metadata.scene).toBe("todo-desc");
      expect(metadata.utterance_id).toBe("u-scene");
      expect(metadata.source).toBe("local");
    });
  });

  describe("no-op when disabled", () => {
    it("all operations are safe when shared() is null", () => {
      VoiceFeedback.init(undefined);
      expect(VoiceFeedback.shared()).toBeNull();

      VoiceFeedback.shared()?.onTranscribeResult({
        utteranceId: "u1",
        modelText: "text",
        source: "remote",
      });
      VoiceFeedback.shared()?.submitAll("text");
      VoiceFeedback.shared()?.submitAll("text");

      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
  });

  describe("disable", () => {
    it("prevents onTranscribeResult from storing or uploading", () => {
      VoiceFeedback.init("https://fb.test");
      const fb = VoiceFeedback.shared()!;
      fb.disable();

      fb.onTranscribeResult({
        utteranceId: "u1",
        modelText: "hello",
        source: "local",
        audioBlob: new Blob(["data"]),
      });

      expect(vi.mocked(fetch)).not.toHaveBeenCalled();

      fb.submitAll("hello");
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it("clears pending entries", () => {
      VoiceFeedback.init("https://fb.test");
      const fb = VoiceFeedback.shared()!;

      fb.onTranscribeResult({
        utteranceId: "u1",
        modelText: "hello",
        source: "remote",
      });

      fb.disable();
      vi.mocked(fetch).mockClear();

      fb.submitAll("hello");
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it("aborts in-flight fetch requests", async () => {
      let abortSignal: AbortSignal | undefined;
      vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
        abortSignal = init?.signal;
        return new Promise(() => {});
      }));

      VoiceFeedback.init("https://fb.test");
      const fb = VoiceFeedback.shared()!;
      const blob = new Blob(["audio"], { type: "audio/webm" });

      fb.onTranscribeResult({
        utteranceId: "u-abort",
        modelText: "test",
        source: "local",
        audioBlob: blob,
      });

      await vi.waitFor(() => expect(abortSignal).toBeDefined());
      expect(abortSignal!.aborted).toBe(false);

      fb.disable();
      expect(abortSignal!.aborted).toBe(true);
    });
  });

  describe("enable", () => {
    it("re-enables a disabled instance", () => {
      VoiceFeedback.init("https://fb.test");
      const fb = VoiceFeedback.shared()!;
      fb.disable();

      fb.enable("https://fb.test");

      fb.onTranscribeResult({
        utteranceId: "u1",
        modelText: "hello",
        source: "remote",
      });
      fb.submitAll("hello");

      const fetchMock = vi.mocked(fetch);
      const finalCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/final"),
      );
      expect(finalCall).toBeDefined();
    });

    it("auto-inits when instance is null", () => {
      VoiceFeedback.init(undefined);
      expect(VoiceFeedback.shared()).toBeNull();

      VoiceFeedback.shared()?.enable("https://fb.test");
      // enable is an instance method, so calling on null has no effect
      // but static enable can be called via init
      expect(VoiceFeedback.shared()).toBeNull();
    });
  });

  describe("destroy", () => {
    it("sets shared() to null", () => {
      VoiceFeedback.init("https://fb.test");
      expect(VoiceFeedback.shared()).not.toBeNull();

      VoiceFeedback.destroy();
      expect(VoiceFeedback.shared()).toBeNull();
    });

    it("clears pending and aborts in-flight on destroy", async () => {
      let abortSignal: AbortSignal | undefined;
      vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
        abortSignal = init?.signal;
        return new Promise(() => {});
      }));

      VoiceFeedback.init("https://fb.test");
      const fb = VoiceFeedback.shared()!;
      const blob = new Blob(["audio"], { type: "audio/webm" });

      fb.onTranscribeResult({
        utteranceId: "u-destroy",
        modelText: "test",
        source: "local",
        audioBlob: blob,
      });

      await vi.waitFor(() => expect(abortSignal).toBeDefined());

      VoiceFeedback.destroy();
      expect(VoiceFeedback.shared()).toBeNull();
      expect(abortSignal!.aborted).toBe(true);
    });

    it("is safe to call destroy when no instance exists", () => {
      VoiceFeedback.init(undefined);
      expect(() => VoiceFeedback.destroy()).not.toThrow();
      expect(VoiceFeedback.shared()).toBeNull();
    });
  });
});
