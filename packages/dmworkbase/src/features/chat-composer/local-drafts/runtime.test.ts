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

    const restored = await port.restore();

    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ id: "paste-a", source: "paste" });
    expect(restored[0].file.name).toBe("capture.png");
    expect(restored[0].file.type).toBe("image/png");
    expect(port.canLeave(["paste-a"])).toBe(true);
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

    expect(port.canLeave([])).toBe(true);
    expect(value.remove).toHaveBeenCalledWith({
      channel,
      attachmentId: "attachment-a",
    });
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

    const restored = await createChatComposerAttachmentDraftPort(channel)!.restore();

    expect(restored.map(({ id }) => id)).toEqual(["first", "second"]);
  });
});
