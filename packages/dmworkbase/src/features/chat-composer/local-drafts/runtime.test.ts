import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LocalAttachmentDraftHost,
  LocalAttachmentDraftMetadata,
} from "./contract";
import {
  createChatComposerAttachmentDraftPort,
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

afterEach(() => {
  while (disposals.length > 0) disposals.pop()?.();
  vi.restoreAllMocks();
});

describe("local attachment draft runtime", () => {
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

    expect((await restoring).attachments.map(({ id }) => id)).toEqual(["first", "second"]);
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
    await port.stage({ id: "first", file: file("first.txt"), source: "upload" });
    await port.stage({ id: "second", file: file("second.txt"), source: "upload" });
    port.syncLive(["second"]);
    await port.stage({ id: "third", file: file("third.txt"), source: "upload" });

    expect(vi.mocked(value.stage).mock.calls.map(([input]) => input.attachment.position))
      .toEqual([0, 1, 2]);
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
    port.settleSend({ attachmentIds: ["failed"], keepAttachmentIds: ["failed"] });

    expect(port.canLeave(["failed"])).toBe(false);
  });

  it("removes a consumed attachment again after its pending write lands", async () => {
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
    const staging = port.stage({ id: "pending", file: file(), source: "upload" });
    await vi.waitFor(() => expect(value.stage).toHaveBeenCalledOnce());

    port.beginSend(["pending"]);
    port.settleSend({ attachmentIds: ["pending"], keepAttachmentIds: [] });
    finishStage?.();
    await staging;

    expect(value.remove).toHaveBeenCalledTimes(2);
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

    expect(await createChatComposerAttachmentDraftPort(channel)!.restore()).toEqual({
      attachments: [],
      failedCount: 1,
    });
    expect(value.remove).not.toHaveBeenCalled();
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
    sendingPort.settleSend({ attachmentIds: ["sending"], keepAttachmentIds: [] });
  });

  it("does not clobber a staging id when restore listing resolves later", async () => {
    let finishList: (() => void) | undefined;
    const value = host({
      list: vi.fn(async () => {
        await new Promise<void>((resolve) => { finishList = resolve; });
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
    await port.stage({ id: "shared", file: file(), source: "upload" }, 4);
    finishList?.();

    expect((await restoring).attachments).toEqual([]);
    expect(value.read).not.toHaveBeenCalled();
    expect(port.canLeave(["shared"])).toBe(true);
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
