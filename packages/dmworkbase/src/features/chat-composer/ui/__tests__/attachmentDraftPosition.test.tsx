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
