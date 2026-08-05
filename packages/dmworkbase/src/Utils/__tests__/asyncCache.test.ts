import { describe, expect, it, vi } from "vitest";

import { createAsyncCache } from "../asyncCache";

/** 手动控制 resolve/reject 时机，用于断言合流与取消语义。 */
function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** 可推进的假时钟，避免依赖真实计时器。 */
function clock(start = 0) {
    let t = start;
    return {
        now: () => t,
        advance: (ms: number) => {
            t += ms;
        },
    };
}

describe("createAsyncCache", () => {
    it("serves a fresh hit without calling the loader again", async () => {
        const time = clock();
        const cache = createAsyncCache<string>({ ttlMs: 1000, now: time.now });
        const loader = vi.fn(async () => "v1");

        await expect(cache.get("k", loader)).resolves.toBe("v1");
        time.advance(999);
        await expect(cache.get("k", loader)).resolves.toBe("v1");

        expect(loader).toHaveBeenCalledTimes(1);
    });

    it("reloads once the entry is older than the ttl", async () => {
        const time = clock();
        const cache = createAsyncCache<string>({ ttlMs: 1000, now: time.now });
        const loader = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");

        await cache.get("k", loader);
        time.advance(1001);

        await expect(cache.get("k", loader)).resolves.toBe("v2");
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it("rides concurrent callers along a single in-flight load", async () => {
        const cache = createAsyncCache<string>({ ttlMs: 1000 });
        const d = deferred<string>();
        const loader = vi.fn(() => d.promise);

        const a = cache.get("k", loader);
        const b = cache.get("k", loader);
        d.resolve("shared");

        await expect(a).resolves.toBe("shared");
        await expect(b).resolves.toBe("shared");
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it("keeps separate keys independent", async () => {
        const cache = createAsyncCache<string>({ ttlMs: 1000 });
        const loader = vi.fn(async (v: string) => v);

        await cache.get("a", () => loader("a"));
        await cache.get("b", () => loader("b"));

        expect(cache.peek("a")).toBe("a");
        expect(cache.peek("b")).toBe("b");
    });

    it("does not cache a failed load and retries on the next get", async () => {
        const cache = createAsyncCache<string>({ ttlMs: 1000 });
        const loader = vi
            .fn()
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValueOnce("v1");

        await expect(cache.get("k", loader)).rejects.toThrow("boom");
        expect(cache.peek("k")).toBeUndefined();

        await expect(cache.get("k", loader)).resolves.toBe("v1");
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it("propagates a rejection to every concurrent waiter", async () => {
        const cache = createAsyncCache<string>({ ttlMs: 1000 });
        const d = deferred<string>();
        const loader = vi.fn(() => d.promise);

        const a = cache.get("k", loader);
        const b = cache.get("k", loader);
        d.reject(new Error("boom"));

        await expect(a).rejects.toThrow("boom");
        await expect(b).rejects.toThrow("boom");
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it("discards the result of a load that was invalidated while in flight", async () => {
        const cache = createAsyncCache<string>({ ttlMs: 1000 });
        const d = deferred<string>();
        const loader = vi.fn(() => d.promise);

        const pending = cache.get("k", loader);
        cache.invalidate("k");
        d.resolve("stale");

        // 等待方仍拿到该次返回值，但缓存不保留已知过期的数据。
        await expect(pending).resolves.toBe("stale");
        expect(cache.peek("k")).toBeUndefined();
    });

    it("discards an in-flight result after a keyless invalidate", async () => {
        const cache = createAsyncCache<string>({ ttlMs: 1000 });
        const d = deferred<string>();

        const pending = cache.get("k", () => d.promise);
        cache.invalidate();
        d.resolve("stale");

        await expect(pending).resolves.toBe("stale");
        expect(cache.peek("k")).toBeUndefined();
    });

    it("drops cached entries on invalidate", async () => {
        const cache = createAsyncCache<string>({ ttlMs: 1000 });
        const loader = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");

        await cache.get("k", loader);
        cache.invalidate("k");

        await expect(cache.get("k", loader)).resolves.toBe("v2");
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it("bypasses the cache when maxAgeMs is 0", async () => {
        const cache = createAsyncCache<string>({ ttlMs: 1000 });
        const loader = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");

        await cache.get("k", loader);
        await expect(cache.get("k", loader, { maxAgeMs: 0 })).resolves.toBe("v2");
    });

    it("rejects an aborted caller but still commits the shared load", async () => {
        const cache = createAsyncCache<string>({ ttlMs: 1000 });
        const d = deferred<string>();
        const loader = vi.fn(() => d.promise);
        const controller = new AbortController();

        const cancelled = cache.get("k", loader, { signal: controller.signal });
        const other = cache.get("k", loader);
        controller.abort();

        await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });

        d.resolve("v1");
        // 取消一个等待方不影响其余等待方，底层加载照常填充缓存。
        await expect(other).resolves.toBe("v1");
        expect(cache.peek("k")).toBe("v1");
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it("rejects immediately when the signal is already aborted", async () => {
        const cache = createAsyncCache<string>({ ttlMs: 1000 });
        const loader = vi.fn(async () => "v1");
        const controller = new AbortController();
        controller.abort();

        await expect(
            cache.get("k", loader, { signal: controller.signal })
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(loader).not.toHaveBeenCalled();
    });
});
