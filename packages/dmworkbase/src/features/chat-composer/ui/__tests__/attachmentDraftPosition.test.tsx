import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ChatComposerAttachmentDraftPort,
  LocalAttachmentDraftHost,
  LocalAttachmentDraftMetadata,
} from "../../local-drafts/contract";
import {
  createChatComposerAttachmentDraftPort,
  installLocalAttachmentDraftHost,
} from "../../local-drafts/runtime";
import ChatComposer, { type MessageInputContext } from "../ChatComposer";
import { createTestViewHost } from "./testViewHost";

vi.mock("../../../../App", () => ({
  default: {
    mittBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    shared: { avatarChannel: vi.fn() },
    dataSource: { commonDataSource: { getImageURL: vi.fn(() => "") } },
  },
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: () => null,
  TableVirtuoso: () => null,
}));

describe("attachment draft positions", () => {
  it("drives the production leave guard from staging to durable", async () => {
    let context: MessageInputContext | undefined;
    let finishStage: (() => void) | undefined;
    const stage = vi.fn(
      ({ attachment }: Parameters<LocalAttachmentDraftHost["stage"]>[0]) =>
        new Promise<LocalAttachmentDraftMetadata>((resolve) => {
          finishStage = () =>
            resolve({
              ...attachment,
              createdAt: 1,
              updatedAt: 1,
            });
        })
    );
    const host: LocalAttachmentDraftHost = {
      version: 1,
      stage,
      list: vi.fn(async () => []),
      read: vi.fn(async () => {
        throw new Error("not found");
      }),
      remove: vi.fn(async () => {}),
    };
    const dispose = installLocalAttachmentDraftHost(host);
    const attachmentDrafts = createChatComposerAttachmentDraftPort({
      id: "guard-channel",
      type: 2,
    })!;
    try {
      render(
        <ChatComposer
          host={createTestViewHost()}
          attachmentDrafts={attachmentDrafts}
          onContext={(next) => {
            context = next;
          }}
        />
      );
      await waitFor(() => expect(context).toBeDefined());

      let adding: Promise<void> | undefined;
      act(() => {
        adding = Promise.resolve(
          context!.addAttachment([new File(["a"], "guard.txt")], "upload")
        );
      });
      await waitFor(() => expect(stage).toHaveBeenCalledOnce());
      expect(context!.canLeaveWithAttachments()).toBe(false);

      finishStage?.();
      await act(async () => {
        await adding;
      });
      expect(context!.canLeaveWithAttachments()).toBe(true);
    } finally {
      dispose();
    }
  });

  it("restores a persisted attachment once through StrictMode replay", async () => {
    const restoredFile = new File(["restored"], "restored.txt", {
      type: "text/plain",
    });
    const restore = vi.fn().mockResolvedValue({
      attachments: [
        {
          id: "restored-id",
          file: restoredFile,
          source: "upload",
          position: 2,
        },
      ],
      failedCount: 0,
    });
    const syncLive = vi.fn();
    const attachmentDrafts: ChatComposerAttachmentDraftPort = {
      restore,
      stage: vi.fn().mockResolvedValue(true),
      syncLive,
      discardUnready: vi.fn(),
      beginSend: vi.fn(),
      settleSend: vi.fn(),
      canLeave: vi.fn(() => true),
    };

    render(
      <React.StrictMode>
        <ChatComposer
          host={createTestViewHost()}
          attachmentDrafts={attachmentDrafts}
        />
      </React.StrictMode>
    );

    await waitFor(() =>
      expect(document.body.textContent).toContain("restored.txt")
    );
    expect(restore).toHaveBeenCalledTimes(1);
    expect(attachmentDrafts.stage).not.toHaveBeenCalled();
    expect(syncLive).toHaveBeenCalledWith(
      expect.arrayContaining(["restored-id"])
    );
  });

  it("keeps an empty composer single-line after an empty restore", async () => {
    const attachmentDrafts: ChatComposerAttachmentDraftPort = {
      restore: vi.fn().mockResolvedValue({ attachments: [], failedCount: 0 }),
      stage: vi.fn(), syncLive: vi.fn(), discardUnready: vi.fn(),
      beginSend: vi.fn(), settleSend: vi.fn(), canLeave: vi.fn(() => true),
    };
    const view = render(<ChatComposer host={createTestViewHost()} attachmentDrafts={attachmentDrafts} />);
    await act(async () => { await Promise.resolve(); });
    expect(attachmentDrafts.restore).toHaveBeenCalledOnce();
    expect(view.container.querySelector(".wk-messageinput-card--multiline")).toBeNull();
  });

  it.each([false, true])("preserves a partially applied restore while video waits (unmount=%s)", async (unmount) => {
    const records: LocalAttachmentDraftMetadata[] = [
      { id: "first", name: "first.txt", mimeType: "text/plain", source: "upload", position: 0 },
      { id: "video", name: "clip.mp4", mimeType: "video/mp4", source: "upload", position: 1 },
      { id: "paste", name: "paste.png", mimeType: "image/png", source: "paste", position: 2 },
    ].map((item) => ({ ...item, size: 1, lastModified: 1, createdAt: 1, updatedAt: 1 })) as LocalAttachmentDraftMetadata[];
    const disk = new Map(records.map((item) => [item.id, item]));
    const host: LocalAttachmentDraftHost = {
      version: 1, stage: vi.fn(),
      list: vi.fn(async () => [...disk.values()]),
      read: vi.fn(async ({ attachmentId }) => ({
        attachment: disk.get(attachmentId)!, bytes: new Uint8Array([1]),
      })),
      remove: vi.fn(async ({ attachmentId }) => { disk.delete(attachmentId); }),
    };
    const dispose = installLocalAttachmentDraftHost(host);
    const port = createChatComposerAttachmentDraftPort({ id: "video-restore", type: 2 })!;
    const createElement = document.createElement.bind(document);
    let video: HTMLVideoElement | undefined;
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag, options) => {
      const element = createElement(tag, options);
      if (tag === "video") video = element as HTMLVideoElement;
      return element;
    });
    let context: MessageInputContext | undefined;
    const view = render(<ChatComposer host={createTestViewHost()} attachmentDrafts={port}
      onContext={(next) => { context = next; }} />);
    try {
      await waitFor(() => expect(video?.onerror).toBeTypeOf("function"));
      await waitFor(() => expect(view.container.textContent).toContain("first.txt"));
      expect([...disk.keys()]).toEqual(["first", "video", "paste"]);
      expect(host.remove).not.toHaveBeenCalled();
      if (unmount) view.unmount();
      await act(async () => { video!.dispatchEvent(new Event("error")); });
      expect([...disk.keys()]).toEqual(["first", "video", "paste"]);
      if (!unmount) {
        await waitFor(() => expect(view.container.textContent).toContain("clip.mp4"));
        expect(view.container.querySelector('[data-type="attachment"]')).not.toBeNull();
        expect(context!.canLeaveWithAttachments()).toBe(true);
      }
    } finally {
      view.unmount(); spy.mockRestore(); dispose();
    }
  });

  it("routes files added in separate batches through draft staging", async () => {
    let context: MessageInputContext | undefined;
    const stage = vi.fn().mockResolvedValue(true);
    const attachmentDrafts: ChatComposerAttachmentDraftPort = {
      restore: vi.fn().mockResolvedValue({ attachments: [], failedCount: 0 }),
      stage,
      syncLive: vi.fn(),
      discardUnready: vi.fn(),
      beginSend: vi.fn(),
      settleSend: vi.fn(),
      canLeave: vi.fn(() => true),
    };
    render(
      <ChatComposer
        host={createTestViewHost()}
        attachmentDrafts={attachmentDrafts}
        onContext={(next) => {
          context = next;
        }}
      />
    );
    await waitFor(() => expect(context).toBeDefined());

    await act(async () => {
      await context!.addAttachment([new File(["a"], "a.txt")], "upload");
      await context!.addAttachment([new File(["b"], "b.txt")], "upload");
    });

    expect(stage).toHaveBeenCalledTimes(2);
    expect(
      stage.mock.calls.map(([attachment]) => attachment.file.name)
    ).toEqual(["a.txt", "b.txt"]);
  });
});
