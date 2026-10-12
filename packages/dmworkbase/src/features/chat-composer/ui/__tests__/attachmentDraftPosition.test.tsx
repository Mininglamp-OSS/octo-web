import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatComposerAttachmentDraftPort } from "../../local-drafts/contract";
import ChatComposer, { type MessageInputContext } from "../ChatComposer";
import { createTestViewHost } from "./testViewHost";

vi.mock("../../../../App", () => ({
  default: {
    mittBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    shared: { avatarChannel: vi.fn() },
    dataSource: { commonDataSource: { getImageURL: vi.fn(() => "") } },
  },
}));

vi.mock("react-virtuoso", () => ({ Virtuoso: () => null, TableVirtuoso: () => null }));

describe("attachment draft positions", () => {
  it("continues positions when files are added in separate batches", async () => {
    let context: MessageInputContext | undefined;
    const stage = vi.fn().mockResolvedValue(undefined);
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
        onContext={(next) => { context = next; }}
      />
    );
    await waitFor(() => expect(context).toBeDefined());

    await act(async () => {
      await context!.addAttachment([new File(["a"], "a.txt")], "upload");
      await context!.addAttachment([new File(["b"], "b.txt")], "upload");
    });

    expect(stage).toHaveBeenCalledTimes(2);
  });
});
