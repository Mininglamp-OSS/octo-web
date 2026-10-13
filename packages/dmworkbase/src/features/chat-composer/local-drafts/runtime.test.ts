import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LocalAttachmentDraftHost,
  LocalAttachmentDraftMetadata,
} from "./contract";
import {
  createChatComposerAttachmentDraftPort,
  invalidateLocalAttachmentDraftHost,
  installLocalAttachmentDraftHost,
} from "./runtime";

const channel = { id: "channel-a", type: 2 };
const disposals: Array<() => void> = [];

function metadata(
  id: string,
  overrides: Partial<LocalAttachmentDraftMetadata> = {}
): LocalAttachmentDraftMetadata {
  return {
    id,
    position: 0,
    name: `${id}.txt`,
    mimeType: "text/plain",
    size: 3,
    lastModified: 123,
    source: "upload",
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function host(
  overrides: Partial<LocalAttachmentDraftHost> = {}
): LocalAttachmentDraftHost {
  return {
    version: 1,
    stage: vi.fn(async ({ attachment }) => ({
      ...attachment,
      createdAt: 100,
      updatedAt: 100,
    })),
    list: vi.fn(async () => []),
    read: vi.fn(async () => {
      throw new Error("not found");
    }),
    remove: vi.fn(async () => {}),
    ...overrides,
  };
}

function install(value: LocalAttachmentDraftHost): void {
  disposals.push(installLocalAttachmentDraftHost(value));
}

function file(name = "draft.txt"): File {
  const value = new File([new Uint8Array([1, 2, 3])], name, {
    type: "text/plain",
    lastModified: 123,
  });
  if (typeof value.arrayBuffer !== "function") {
    Object.defineProperty(value, "arrayBuffer", {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
  }
  return value;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  while (disposals.length > 0) disposals.pop()?.();
  vi.restoreAllMocks();
});

describe("local attachment draft runtime", () => {
  it("retains restored drafts until each one has appeared in the composer", async () => {
    const value = host({
      list: vi.fn(async () => [metadata("first"), metadata("video", { position: 1 })]),
      read: vi.fn(async ({ attachmentId }) => ({
        attachment: metadata(attachmentId), bytes: new Uint8Array([1, 2, 3]),
      })),
    });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    expect((await port.restore()).attachments).toHaveLength(2);
    port.syncLive([]);
    port.syncLive(["first"]);
    await Promise.resolve();
    expect(value.remove).not.toHaveBeenCalled();
    port.syncLive(["first", "video"]);
    port.syncLive(["first"]);
    await vi.waitFor(() => expect(value.remove).toHaveBeenCalledWith({
      channel, attachmentId: "video",
    }));
  });

  it.each(["pending", "read", "collected"] as const)(
    "shares ordinary deletion intent across ports during %s restore",
    async (phase) => {
      const removal = deferred<void>();
      const read = deferred<void>();
      const value = host({
        list: vi.fn(async () => [metadata("gone"), metadata("tail")]),
        read: vi.fn(async ({ attachmentId }) => {
          if ((phase === "read" && attachmentId === "gone") ||
              (phase === "collected" && attachmentId === "tail")) await read.promise;
          return { attachment: metadata(attachmentId), bytes: new Uint8Array([1, 2, 3]) };
        }),
        remove: vi.fn(() => removal.promise),
      });
      install(value);
      const first = createChatComposerAttachmentDraftPort(channel)!;
      await first.stage({ id: "gone", file: file(), source: "upload" });
      first.syncLive(["gone"]);
      const second = createChatComposerAttachmentDraftPort(channel)!;
      let restoring: ReturnType<typeof second.restore>;
      if (phase === "pending") {
        first.syncLive([]);
        restoring = second.restore();
      } else {
        restoring = second.restore();
        await vi.waitFor(() => expect(value.read).toHaveBeenCalledWith({
          channel, attachmentId: phase === "read" ? "gone" : "tail",
        }));
        first.syncLive([]);
      }
      read.resolve();
      expect((await restoring).attachments.map(({ id }) => id)).toEqual(["tail"]);
      removal.resolve();
    }
  );

  it("allows a remount to recover a draft after ordinary deletion rejects", async () => {
    const removal = deferred<void>();
    const value = host({
      list: vi.fn(async () => [metadata("retained")]),
      read: vi.fn(async () => ({ attachment: metadata("retained"), bytes: new Uint8Array([1, 2, 3]) })),
      remove: vi.fn(() => removal.promise),
    });
    install(value);
    const first = createChatComposerAttachmentDraftPort(channel)!;
    await first.stage({ id: "retained", file: file(), source: "upload" });
    first.syncLive([]);
    const second = createChatComposerAttachmentDraftPort(channel)!;
    expect((await second.restore()).attachments).toEqual([]);
    removal.reject(new Error("unlink unavailable"));
    await vi.waitFor(() => expect(value.remove).toHaveBeenCalledOnce());
    await Promise.resolve();
    const reopened = createChatComposerAttachmentDraftPort(channel)!;
    expect((await reopened.restore()).attachments.map(({ id }) => id)).toEqual(["retained"]);
  });

  it("serializes a replacement write behind an already issued deletion", async () => {
    const removal = deferred<void>();
    const value = host({ remove: vi.fn(() => removal.promise) });
    install(value);
    const first = createChatComposerAttachmentDraftPort(channel)!;
    await first.stage({ id: "replace", file: file(), source: "upload" });
    first.syncLive([]);
    await vi.waitFor(() => expect(value.remove).toHaveBeenCalledOnce());
    const second = createChatComposerAttachmentDraftPort(channel)!;
    const reading = deferred<ArrayBuffer>();
    const replacement = file();
    const buffer = vi.spyOn(replacement, "arrayBuffer").mockReturnValue(reading.promise);
    const staging = second.stage({ id: "replace", file: replacement, source: "upload" });
    await vi.waitFor(() => expect(buffer).toHaveBeenCalledOnce());
    reading.resolve(new Uint8Array([1, 2, 3]).buffer);
    // Flush all microtasks before the next task, with the old unlink still held.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(value.stage).toHaveBeenCalledTimes(1);
    removal.resolve();
    expect(await staging).toBe(true);
    expect(value.stage).toHaveBeenCalledTimes(2);
  });

  it("ignores settlement from a port whose send ownership was replaced", async () => {
    const value = host();
    install(value);
    const first = createChatComposerAttachmentDraftPort(channel)!;
    await first.stage({ id: "owned", file: file(), source: "upload" });
    first.beginSend(["owned"]);
    const second = createChatComposerAttachmentDraftPort(channel)!;
    second.beginSend(["owned"]);
    first.settleSend({ attachmentIds: ["owned"], keepAttachmentIds: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(value.remove).not.toHaveBeenCalled();
    second.settleSend({ attachmentIds: ["owned"], keepAttachmentIds: ["owned"] });
  });

  it("keeps ordinary Web behavior when no Client host is installed", () => {
    expect(createChatComposerAttachmentDraftPort(channel)).toBeUndefined();
  });

  it("blocks navigation while staging and allows it after local persistence", async () => {
    let finishStage: (() => void) | undefined;
    const stage = vi.fn(
      () =>
        new Promise<LocalAttachmentDraftMetadata>((resolve) => {
          finishStage = () => resolve(metadata("attachment-a"));
        })
    );
    const value = host({ stage });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    const attachment = {
      id: "attachment-a",
      file: file(),
      source: "upload" as const,
    };

    const staging = port.stage(attachment);
    expect(port.canLeave([attachment.id])).toBe(false);
    await vi.waitFor(() => expect(stage).toHaveBeenCalledOnce());
    finishStage?.();
    await staging;
    expect(port.canLeave([attachment.id])).toBe(true);

    port.syncLive([]);
    await vi.waitFor(() =>
      expect(value.remove).toHaveBeenCalledWith({
        channel,
        attachmentId: attachment.id,
      })
    );
  });

  it("restores files and their original insertion source", async () => {
    const value = host({
      list: vi.fn(async () => [
        metadata("paste-a", {
          name: "capture.png",
          mimeType: "image/png",
          source: "paste",
        }),
      ]),
      read: vi.fn(async () => ({
        attachment: metadata("paste-a", {
          name: "capture.png",
          mimeType: "image/png",
          source: "paste",
        }),
        bytes: new Uint8Array([1, 2, 3]),
      })),
    });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;

    const { attachments: restored, failedCount } = await port.restore();

    expect(failedCount).toBe(0);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ id: "paste-a", source: "paste" });
    expect(restored[0].file.name).toBe("capture.png");
    expect(restored[0].file.type).toBe("image/png");
    port.syncLive(["paste-a"]);
    expect(port.canLeave(["paste-a"])).toBe(true);
  });

  it("does not delete drafts while a restore is still in flight", async () => {
    let finishSecondRead: (() => void) | undefined;
    const value = host({
      list: vi.fn(async () => [
        metadata("first", { position: 0 }),
        metadata("second", { position: 1 }),
      ]),
      read: vi.fn(async ({ attachmentId }) => {
        if (attachmentId === "second") {
          await new Promise<void>((resolve) => {
            finishSecondRead = resolve;
          });
        }
        return {
          attachment: metadata(attachmentId, {
            position: attachmentId === "first" ? 0 : 1,
          }),
          bytes: new Uint8Array([1, 2, 3]),
        };
      }),
    });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;

    const restoring = port.restore();
    await vi.waitFor(() => expect(value.read).toHaveBeenCalledTimes(2));
    port.syncLive(["unrelated"]);
    expect(value.remove).not.toHaveBeenCalled();
    finishSecondRead?.();

    expect((await restoring).attachments.map(({ id }) => id)).toEqual([
      "first",
      "second",
    ]);
    expect(value.remove).not.toHaveBeenCalled();
  });

  it("keeps unsent attachments and removes successfully consumed ones", async () => {
    const value = host();
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    await Promise.all([
      port.stage({ id: "sent", file: file("sent.txt"), source: "upload" }),
      port.stage({ id: "retry", file: file("retry.txt"), source: "upload" }),
    ]);

    port.beginSend(["sent", "retry"]);
    expect(port.canLeave(["sent", "retry"])).toBe(false);
    port.syncLive([]);
    port.settleSend({
      attachmentIds: ["sent", "retry"],
      keepAttachmentIds: ["retry"],
    });

    expect(port.canLeave(["retry"])).toBe(true);
    await vi.waitFor(() =>
      expect(value.remove).toHaveBeenCalledWith({
        channel,
        attachmentId: "sent",
      })
    );
    expect(value.remove).not.toHaveBeenCalledWith({
      channel,
      attachmentId: "retry",
    });
  });

  it("settles a successful send after its port is invalidated", async () => {
    const value = host();
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    await port.stage({ id: "sent", file: file(), source: "upload" });
    port.beginSend(["sent"]);

    invalidateLocalAttachmentDraftHost(value);
    port.settleSend({ attachmentIds: ["sent"], keepAttachmentIds: [] });

    await vi.waitFor(() =>
      expect(value.remove).toHaveBeenCalledWith({
        channel,
        attachmentId: "sent",
      })
    );
  });

  it("cleans up an ordinary write that finishes after invalidation", async () => {
    let finishStage: (() => void) | undefined;
    const value = host({
      stage: vi.fn(
        () =>
          new Promise<LocalAttachmentDraftMetadata>((resolve) => {
            finishStage = () => resolve(metadata("stale"));
          })
      ),
    });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    const staging = port.stage({
      id: "stale",
      file: file(),
      source: "upload",
    });
    await vi.waitFor(() => expect(value.stage).toHaveBeenCalledOnce());

    invalidateLocalAttachmentDraftHost(value);
    finishStage?.();

    expect(await staging).toBe(false);
    expect(value.remove).toHaveBeenCalledWith({
      channel,
      attachmentId: "stale",
    });
  });

  it("does not let an older send settlement delete a newer draft generation", async () => {
    const value = host();
    install(value);
    const sendingPort = createChatComposerAttachmentDraftPort(channel)!;
    await sendingPort.stage({
      id: "shared",
      file: file("old.txt"),
      source: "upload",
    });
    sendingPort.beginSend(["shared"]);

    const newerPort = createChatComposerAttachmentDraftPort(channel)!;
    await newerPort.stage({
      id: "shared",
      file: file("new.txt"),
      source: "upload",
    });
    sendingPort.settleSend({
      attachmentIds: ["shared"],
      keepAttachmentIds: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(value.remove).not.toHaveBeenCalled();
    expect(newerPort.canLeave(["shared"])).toBe(true);
  });

  it("keeps send ownership until durable removal finishes", async () => {
    let finishRemove: (() => void) | undefined;
    const value = host({
      list: vi.fn(async () => [metadata("sent")]),
      read: vi.fn(async () => ({
        attachment: metadata("sent"),
        bytes: new Uint8Array([1, 2, 3]),
      })),
      remove: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishRemove = resolve;
          })
      ),
    });
    install(value);
    const sendingPort = createChatComposerAttachmentDraftPort(channel)!;
    await sendingPort.stage({ id: "sent", file: file(), source: "upload" });
    sendingPort.beginSend(["sent"]);
    sendingPort.settleSend({
      attachmentIds: ["sent"],
      keepAttachmentIds: [],
    });
    await vi.waitFor(() => expect(value.remove).toHaveBeenCalledOnce());

    const reopenedPort = createChatComposerAttachmentDraftPort(channel)!;
    expect((await reopenedPort.restore()).attachments).toEqual([]);
    expect(value.read).not.toHaveBeenCalled();

    finishRemove?.();
  });

  it("does not return an attachment consumed while its restore read is pending", async () => {
    let finishRead: (() => void) | undefined;
    const value = host({
      list: vi.fn(async () => [metadata("sent")]),
      read: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          finishRead = resolve;
        });
        return {
          attachment: metadata("sent"),
          bytes: new Uint8Array([1, 2, 3]),
        };
      }),
    });
    install(value);
    const restoringPort = createChatComposerAttachmentDraftPort(channel)!;
    const restoring = restoringPort.restore();
    await vi.waitFor(() => expect(value.read).toHaveBeenCalledOnce());

    const sendingPort = createChatComposerAttachmentDraftPort(channel)!;
    sendingPort.beginSend(["sent"]);
    sendingPort.settleSend({
      attachmentIds: ["sent"],
      keepAttachmentIds: [],
    });
    finishRead?.();

    expect((await restoring).attachments).toEqual([]);
  });

  it("does not reactivate an older host disposed out of order", () => {
    const oldHost = host();
    const newHost = host();
    const disposeOld = installLocalAttachmentDraftHost(oldHost);
    const disposeNew = installLocalAttachmentDraftHost(newHost);

    disposeOld();
    expect(createChatComposerAttachmentDraftPort(channel)).toBeDefined();
    disposeNew();
    expect(createChatComposerAttachmentDraftPort(channel)).toBeUndefined();
  });

  it("discards a staging attachment after the user confirms navigation", async () => {
    let finishStage: (() => void) | undefined;
    const value = host({
      stage: vi.fn(
        () =>
          new Promise<LocalAttachmentDraftMetadata>((resolve) => {
            finishStage = () => resolve(metadata("attachment-a"));
          })
      ),
    });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    const staging = port.stage({
      id: "attachment-a",
      file: file(),
      source: "upload",
    });

    await vi.waitFor(() => expect(value.stage).toHaveBeenCalledOnce());
    port.discardUnready(["attachment-a"]);
    finishStage?.();
    await staging;

    expect(port.canLeave(["attachment-a"])).toBe(true);
    expect(value.remove).toHaveBeenCalledWith({
      channel,
      attachmentId: "attachment-a",
    });
  });

  it("does not persist a staging attachment cancelled during a slow byte read", async () => {
    const bytes = deferred<ArrayBuffer>();
    const readStarted = deferred<void>();
    const slowFile = {
      name: "slow.txt",
      type: "text/plain",
      size: 3,
      lastModified: 123,
      arrayBuffer: () => {
        readStarted.resolve();
        return bytes.promise;
      },
    } as File;
    const value = host();
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    const staging = port.stage({
      id: "slow",
      file: slowFile,
      source: "upload",
    });
    await readStarted.promise;

    port.syncLive([]);
    bytes.resolve(new Uint8Array([1, 2, 3]).buffer);

    expect(await staging).toBe(true);
    expect(value.stage).not.toHaveBeenCalled();
    const reopenedPort = createChatComposerAttachmentDraftPort(channel)!;
    expect((await reopenedPort.restore()).attachments).toEqual([]);
  });

  it("clears a failed draft after the user confirms navigation", async () => {
    const value = host({
      stage: vi.fn(async () => {
        throw new Error("quota exceeded");
      }),
    });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    await port.stage({ id: "failed", file: file(), source: "upload" });

    expect(port.canLeave(["failed"])).toBe(false);
    port.discardUnready(["failed"]);
    expect(port.canLeave(["failed"])).toBe(true);
  });

  it("does not discard an attachment owned by an in-flight send", async () => {
    const value = host();
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    await port.stage({ id: "sending", file: file(), source: "upload" });

    port.beginSend(["sending"]);
    port.discardUnready(["sending"]);

    expect(value.remove).not.toHaveBeenCalled();
  });

  it("does not block on attachment ids that were not managed by the draft port", () => {
    install(host());
    const port = createChatComposerAttachmentDraftPort(channel)!;

    expect(port.canLeave(["preview-only"])).toBe(true);
  });

  it("keeps positions monotonic after an earlier attachment is removed", async () => {
    const value = host();
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    await port.stage({
      id: "first",
      file: file("first.txt"),
      source: "upload",
    });
    await port.stage({
      id: "second",
      file: file("second.txt"),
      source: "upload",
    });
    port.syncLive(["second"]);
    await port.stage({
      id: "third",
      file: file("third.txt"),
      source: "upload",
    });

    expect(
      vi
        .mocked(value.stage)
        .mock.calls.map(([input]) => input.attachment.position)
    ).toEqual([0, 1, 2]);
  });

  it("does not mark a failed local write durable after send recovery", async () => {
    const value = host({
      stage: vi.fn(async () => {
        throw new Error("quota exceeded");
      }),
    });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    await port.stage({ id: "failed", file: file(), source: "upload" });

    port.beginSend(["failed"]);
    port.settleSend({
      attachmentIds: ["failed"],
      keepAttachmentIds: ["failed"],
    });

    expect(port.canLeave(["failed"])).toBe(false);
  });

  it("keeps a failed draft guarded while an in-flight send owns it", async () => {
    const write = deferred<LocalAttachmentDraftMetadata>();
    const value = host({ stage: vi.fn(() => write.promise) });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    const staging = port.stage({
      id: "failed-send",
      file: file(),
      source: "upload",
    });
    await vi.waitFor(() => expect(value.stage).toHaveBeenCalledOnce());

    port.beginSend(["failed-send"]);
    write.reject(new Error("quota exceeded"));
    expect(await staging).toBe(false);
    port.syncLive(["other"]);
    port.settleSend({
      attachmentIds: ["failed-send"],
      keepAttachmentIds: ["failed-send"],
    });

    expect(port.canLeave(["failed-send"])).toBe(false);
  });

  it("removes a consumed attachment after its pending write lands", async () => {
    let finishStage: (() => void) | undefined;
    const value = host({
      stage: vi.fn(
        () =>
          new Promise<LocalAttachmentDraftMetadata>((resolve) => {
            finishStage = () => resolve(metadata("pending"));
          })
      ),
    });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    const staging = port.stage({
      id: "pending",
      file: file(),
      source: "upload",
    });
    await vi.waitFor(() => expect(value.stage).toHaveBeenCalledOnce());

    port.beginSend(["pending"]);
    port.settleSend({ attachmentIds: ["pending"], keepAttachmentIds: [] });
    finishStage?.();
    await staging;

    expect(value.remove).toHaveBeenCalledTimes(1);
  });

  it("keeps a draft when a pending write finishes before failed-send settlement", async () => {
    let finishStage: (() => void) | undefined;
    const value = host({
      stage: vi.fn(
        () =>
          new Promise<LocalAttachmentDraftMetadata>((resolve) => {
            finishStage = () => resolve(metadata("retry"));
          })
      ),
    });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    const staging = port.stage({ id: "retry", file: file(), source: "upload" });
    await vi.waitFor(() => expect(value.stage).toHaveBeenCalledOnce());

    port.beginSend(["retry"]);
    port.syncLive([]);
    finishStage?.();
    await staging;
    port.settleSend({ attachmentIds: ["retry"], keepAttachmentIds: ["retry"] });

    expect(value.remove).not.toHaveBeenCalled();
    expect(port.canLeave(["retry"])).toBe(true);
  });

  it("retains a draft after a transient restore read failure", async () => {
    const value = host({
      list: vi.fn(async () => [metadata("busy")]),
      read: vi.fn(async () => {
        throw Object.assign(new Error("busy"), { code: "EBUSY" });
      }),
    });
    install(value);

    const port = createChatComposerAttachmentDraftPort(channel)!;
    expect(await port.restore()).toEqual({
      attachments: [],
      failedCount: 1,
    });
    port.syncLive([]);
    expect(value.remove).not.toHaveBeenCalled();
  });

  it("rechecks send ownership after each restore read", async () => {
    const firstRead = deferred<void>();
    const secondRead = deferred<void>();
    const value = host({
      list: vi.fn(async () => [
        metadata("first", { position: 0 }),
        metadata("second", { position: 1 }),
      ]),
      read: vi.fn(async ({ attachmentId }) => {
        await (attachmentId === "first"
          ? firstRead.promise
          : secondRead.promise);
        return {
          attachment: metadata(attachmentId, {
            position: attachmentId === "first" ? 0 : 1,
          }),
          bytes: new Uint8Array([1, 2, 3]),
        };
      }),
    });
    install(value);
    const restoringPort = createChatComposerAttachmentDraftPort(channel)!;
    const restoring = restoringPort.restore();
    await vi.waitFor(() => expect(value.read).toHaveBeenCalledTimes(1));

    const sendingPort = createChatComposerAttachmentDraftPort(channel)!;
    sendingPort.beginSend(["first"]);
    firstRead.resolve();
    await vi.waitFor(() => expect(value.read).toHaveBeenCalledTimes(2));
    sendingPort.settleSend({
      attachmentIds: ["first"],
      keepAttachmentIds: ["first"],
    });
    secondRead.resolve();

    expect((await restoring).attachments.map(({ id }) => id)).toEqual([
      "second",
    ]);
  });

  it("filters attachments consumed after their restore read completed", async () => {
    const secondRead = deferred<void>();
    const value = host({
      list: vi.fn(async () => [
        metadata("first", { position: 0 }),
        metadata("second", { position: 1 }),
      ]),
      read: vi.fn(async ({ attachmentId }) => {
        if (attachmentId === "second") await secondRead.promise;
        return {
          attachment: metadata(attachmentId, {
            position: attachmentId === "first" ? 0 : 1,
          }),
          bytes: new Uint8Array([1, 2, 3]),
        };
      }),
    });
    install(value);
    const restoringPort = createChatComposerAttachmentDraftPort(channel)!;
    const restoring = restoringPort.restore();
    await vi.waitFor(() => expect(value.read).toHaveBeenCalledTimes(2));

    const sendingPort = createChatComposerAttachmentDraftPort(channel)!;
    sendingPort.beginSend(["first"]);
    sendingPort.settleSend({
      attachmentIds: ["first"],
      keepAttachmentIds: [],
    });
    await vi.waitFor(() =>
      expect(value.remove).toHaveBeenCalledWith({
        channel,
        attachmentId: "first",
      })
    );
    secondRead.resolve();

    expect((await restoring).attachments.map(({ id }) => id)).toEqual([
      "second",
    ]);
  });

  it("does not restore an attachment owned by another port's active send", async () => {
    const value = host({
      list: vi.fn(async () => [metadata("sending")]),
      read: vi.fn(async () => ({
        attachment: metadata("sending"),
        bytes: new Uint8Array([1, 2, 3]),
      })),
    });
    install(value);
    const sendingPort = createChatComposerAttachmentDraftPort(channel)!;
    await sendingPort.stage({ id: "sending", file: file(), source: "upload" });
    sendingPort.beginSend(["sending"]);

    const reopenedPort = createChatComposerAttachmentDraftPort(channel)!;
    const restored = await reopenedPort.restore();

    expect(restored.attachments).toEqual([]);
    sendingPort.settleSend({
      attachmentIds: ["sending"],
      keepAttachmentIds: [],
    });
  });

  it("keeps send ownership shared after an earlier send has settled", async () => {
    const value = host({
      list: vi.fn(async () => [metadata("second-send")]),
      read: vi.fn(async () => ({
        attachment: metadata("second-send"),
        bytes: new Uint8Array([1, 2, 3]),
      })),
    });
    install(value);
    const sendingPort = createChatComposerAttachmentDraftPort(channel)!;

    sendingPort.beginSend([]);
    sendingPort.settleSend({ attachmentIds: [], keepAttachmentIds: [] });
    await sendingPort.stage({
      id: "second-send",
      file: file("second-send.txt"),
      source: "upload",
    });
    sendingPort.beginSend(["second-send"]);

    const reopenedPort = createChatComposerAttachmentDraftPort(channel)!;
    expect((await reopenedPort.restore()).attachments).toEqual([]);

    sendingPort.settleSend({
      attachmentIds: ["second-send"],
      keepAttachmentIds: [],
    });
  });

  it("retains a draft when read metadata does not match the list result", async () => {
    const value = host({
      list: vi.fn(async () => [metadata("corrupt")]),
      read: vi.fn(async () => ({
        attachment: metadata("different-id"),
        bytes: new Uint8Array([1, 2, 3]),
      })),
    });
    install(value);

    const port = createChatComposerAttachmentDraftPort(channel)!;
    expect(await port.restore()).toEqual({
      attachments: [],
      failedCount: 1,
    });
    port.syncLive([]);
    expect(value.remove).not.toHaveBeenCalled();
  });

  it("removes a draft whose stored byte length is corrupt", async () => {
    const value = host({
      list: vi.fn(async () => [metadata("corrupt")]),
      read: vi.fn(async () => ({
        attachment: metadata("corrupt"),
        bytes: new Uint8Array([1, 2]),
      })),
    });
    install(value);

    expect(
      await createChatComposerAttachmentDraftPort(channel)!.restore()
    ).toEqual({
      attachments: [],
      failedCount: 1,
    });
    await vi.waitFor(() =>
      expect(value.remove).toHaveBeenCalledWith({
        channel,
        attachmentId: "corrupt",
      })
    );
  });

  it("does not clobber a staging id when restore listing resolves later", async () => {
    let finishList: (() => void) | undefined;
    const value = host({
      list: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          finishList = resolve;
        });
        return [metadata("shared", { position: 4 })];
      }),
      read: vi.fn(async () => ({
        attachment: metadata("shared", { position: 4 }),
        bytes: new Uint8Array([1, 2, 3]),
      })),
    });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    const restoring = port.restore();
    await vi.waitFor(() => expect(value.list).toHaveBeenCalledOnce());
    const staging = port.stage(
      { id: "shared", file: file(), source: "upload" },
      4
    );
    finishList?.();
    await staging;

    expect((await restoring).attachments).toEqual([]);
    expect(value.read).not.toHaveBeenCalled();
    expect(port.canLeave(["shared"])).toBe(true);
  });

  it("assigns new positions after in-flight restore metadata", async () => {
    let finishList: (() => void) | undefined;
    const value = host({
      list: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          finishList = resolve;
        });
        return [metadata("restored", { position: 0 })];
      }),
      read: vi.fn(async () => ({
        attachment: metadata("restored", { position: 0 }),
        bytes: new Uint8Array([1, 2, 3]),
      })),
    });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    const restoring = port.restore();
    await vi.waitFor(() => expect(value.list).toHaveBeenCalledOnce());
    const staging = port.stage({
      id: "recovered",
      file: file("recovered.txt"),
      source: "upload",
    });

    finishList?.();
    await Promise.all([restoring, staging]);

    expect(value.stage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: expect.objectContaining({ id: "recovered", position: 1 }),
      })
    );
  });

  it("ignores non-finite host positions when assigning the next draft position", async () => {
    const value = host({
      list: vi.fn(async () => [metadata("invalid", { position: Number.NaN })]),
      read: vi.fn(async () => ({
        attachment: metadata("invalid", { position: Number.NaN }),
        bytes: new Uint8Array([1, 2, 3]),
      })),
    });
    install(value);
    const port = createChatComposerAttachmentDraftPort(channel)!;
    await port.restore();
    await port.stage({
      id: "next",
      file: file("next.txt"),
      source: "upload",
    });

    expect(value.stage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: expect.objectContaining({
          id: "next",
          position: expect.any(Number),
        }),
      })
    );
    const stagedPosition = vi.mocked(value.stage).mock.calls[0][0].attachment
      .position;
    expect(Number.isFinite(stagedPosition)).toBe(true);
  });

  it("restores attachments by their explicit position", async () => {
    const value = host({
      list: vi.fn(async () => [
        metadata("second", { position: 1 }),
        metadata("first", { position: 0 }),
      ]),
      read: vi.fn(async ({ attachmentId }) => ({
        attachment: metadata(attachmentId, {
          position: attachmentId === "first" ? 0 : 1,
        }),
        bytes: new Uint8Array([1, 2, 3]),
      })),
    });
    install(value);

    const { attachments: restored } =
      await createChatComposerAttachmentDraftPort(channel)!.restore();

    expect(restored.map(({ id }) => id)).toEqual(["first", "second"]);
  });
});
