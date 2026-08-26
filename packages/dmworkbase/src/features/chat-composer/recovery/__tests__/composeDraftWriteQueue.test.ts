import { describe, expect, it, vi } from "vitest";
import { ComposeDraftWriteQueue } from "../composeDraftWriteQueue";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("ComposeDraftWriteQueue", () => {
  it("serializes writes for one channel", async () => {
    const queue = new ComposeDraftWriteQueue();
    const first = deferred();
    const order: string[] = [];

    const firstWrite = queue.enqueue("channel", async () => {
      order.push("first:start");
      await first.promise;
      order.push("first:end");
    });
    const secondWrite = queue.enqueue("channel", async () => {
      order.push("second");
    });

    await vi.waitFor(() => expect(order).toEqual(["first:start"]));
    first.resolve();
    await Promise.all([firstWrite, secondWrite]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("continues after an earlier write fails", async () => {
    const queue = new ComposeDraftWriteQueue();
    const error = new Error("write failed");
    const second = vi.fn(async () => undefined);

    const firstWrite = queue.enqueue("channel", async () => {
      throw error;
    });
    const secondWrite = queue.enqueue("channel", second);

    await expect(firstWrite).rejects.toBe(error);
    await expect(secondWrite).resolves.toBeUndefined();
    expect(second).toHaveBeenCalledOnce();
  });

  it("does not block another channel", async () => {
    const queue = new ComposeDraftWriteQueue();
    const first = deferred();
    queue.enqueue("one", () => first.promise).catch(() => undefined);

    await expect(
      queue.enqueue("two", async () => undefined)
    ).resolves.toBeUndefined();
    first.resolve();
  });
});
