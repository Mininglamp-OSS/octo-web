import { describe, it, expect, vi } from "vitest";
import { loadObjectUrl } from "../objectUrl";

// A blob whose creation we can trace by identity.
const fakeBlob = new Blob(["x"], { type: "image/jpeg" });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("loadObjectUrl", () => {
  it("delivers the object URL on success", async () => {
    const onLoad = vi.fn();
    const onError = vi.fn();
    loadObjectUrl(
      "att-1",
      { onLoad, onError },
      {
        fetchBlob: () => Promise.resolve(fakeBlob),
        createObjectURL: () => "blob:fake-1",
        revokeObjectURL: vi.fn(),
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(onLoad).toHaveBeenCalledWith("blob:fake-1");
    expect(onError).not.toHaveBeenCalled();
  });

  it("revokes the delivered URL exactly once on dispose", async () => {
    const revoke = vi.fn();
    const dispose = loadObjectUrl(
      "att-1",
      { onLoad: vi.fn(), onError: vi.fn() },
      {
        fetchBlob: () => Promise.resolve(fakeBlob),
        createObjectURL: () => "blob:fake-1",
        revokeObjectURL: revoke,
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    dispose();
    dispose(); // idempotent
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:fake-1");
  });

  it("does not deliver, and revokes, when the load resolves after dispose", async () => {
    const d = deferred<Blob>();
    const onLoad = vi.fn();
    const revoke = vi.fn();
    const dispose = loadObjectUrl(
      "att-1",
      { onLoad, onError: vi.fn() },
      {
        fetchBlob: () => d.promise,
        createObjectURL: () => "blob:late",
        revokeObjectURL: revoke,
      },
    );
    // Dispose before the fetch resolves (unmount / id change mid-flight).
    dispose();
    d.resolve(fakeBlob);
    await Promise.resolve();
    await Promise.resolve();
    expect(onLoad).not.toHaveBeenCalled();
    // The URL created after cancellation must still be revoked (no leak).
    expect(revoke).toHaveBeenCalledWith("blob:late");
  });

  it("reports error and creates no URL on fetch failure", async () => {
    const onError = vi.fn();
    const create = vi.fn();
    const revoke = vi.fn();
    loadObjectUrl(
      "att-1",
      { onLoad: vi.fn(), onError },
      {
        fetchBlob: () => Promise.reject(new Error("401")),
        createObjectURL: create,
        revokeObjectURL: revoke,
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("suppresses the error callback when disposed before failure", async () => {
    const d = deferred<Blob>();
    const onError = vi.fn();
    const dispose = loadObjectUrl(
      "att-1",
      { onLoad: vi.fn(), onError },
      {
        fetchBlob: () => d.promise,
        createObjectURL: vi.fn(),
        revokeObjectURL: vi.fn(),
      },
    );
    dispose();
    d.reject(new Error("late failure"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  // Security guard: a blob whose MIME is not inline-safe (e.g. SVG) must never
  // become an object URL — onError fires so the caller falls back to download.
  it("rejects an inline-unsafe blob without creating a URL", async () => {
    const onLoad = vi.fn();
    const onError = vi.fn();
    const create = vi.fn();
    loadObjectUrl(
      "att-1",
      { onLoad, onError },
      {
        fetchBlob: () => Promise.resolve(new Blob(["<svg/>"], { type: "image/svg+xml" })),
        isInlineSafe: (m) => m === "image/png",
        createObjectURL: create,
        revokeObjectURL: vi.fn(),
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onLoad).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("delivers an inline-safe blob through the guard", async () => {
    const onLoad = vi.fn();
    loadObjectUrl(
      "att-1",
      { onLoad, onError: vi.fn() },
      {
        fetchBlob: () => Promise.resolve(new Blob(["x"], { type: "image/png" })),
        isInlineSafe: (m) => m === "image/png",
        createObjectURL: () => "blob:safe",
        revokeObjectURL: vi.fn(),
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(onLoad).toHaveBeenCalledWith("blob:safe");
  });
});
