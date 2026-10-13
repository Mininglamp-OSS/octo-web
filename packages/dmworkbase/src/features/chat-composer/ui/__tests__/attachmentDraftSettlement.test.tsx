import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatComposerCoordinator } from "../../application/ChatComposerCoordinator";
import { createChatSendOutcome } from "../../domain";
import type { ChatComposerAttachmentDraftPort } from "../../local-drafts/contract";
import ChatComposer, { type MessageInputContext } from "../ChatComposer";
import { createTestViewHost } from "./testViewHost";

vi.mock("../../../../App", () => ({ default: {
  mittBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  shared: { avatarChannel: vi.fn() },
  dataSource: { commonDataSource: { getImageURL: vi.fn(() => "") } },
} }));
vi.mock("react-virtuoso", () => ({ Virtuoso: () => null, TableVirtuoso: () => null }));
afterEach(() => vi.restoreAllMocks());

describe("composer attachment draft send settlement", () => {
  it.each(["consumed", "retained", "rejected", "throws"] as const)(
    "maps the coordinator's %s result to durable draft ownership",
    async (mode) => {
      const drafts: ChatComposerAttachmentDraftPort = {
        restore: vi.fn(async () => ({ attachments: [], failedCount: 0 })),
        stage: vi.fn(async () => true), syncLive: vi.fn(),
        discardUnready: vi.fn(), beginSend: vi.fn(), settleSend: vi.fn(),
        canLeave: vi.fn(() => true),
      };
      let context!: MessageInputContext;
      let inlineIds: string[] = [];
      let topIds: string[] = [];
      const submit = vi.spyOn(ChatComposerCoordinator.prototype, "submit").mockImplementation(async (input) => {
        inlineIds = vi.mocked(drafts.stage).mock.calls.flatMap(([attachment]) =>
          attachment.source === "paste" ? [attachment.id] : []);
        topIds = input.topFiles.map(({ id }) => id);
        if (mode === "throws") throw new Error("capture failed");
        if (mode === "rejected") return { kind: "rejected", reason: "unsupported-content", editorConsumed: false };
        return {
          kind: "attempted", attemptId: "attempt", editorConsumed: mode === "consumed",
          outcome: createChatSendOutcome({
            consumedTopIds: [topIds[0]],
            unsentEditorBlocks: [{ type: "attachment", id: inlineIds[1] }],
          }),
        };
      });
      const view = render(<ChatComposer host={createTestViewHost()} attachmentDrafts={drafts}
        onSend={async () => createChatSendOutcome()} onContext={(next) => { context = next; }} />);
      try {
        await waitFor(() => expect(context).toBeDefined());
        await act(async () => {
          await context.addAttachment([
            new File(["a"], "a.png", { type: "image/png" }),
            new File(["b"], "b.png", { type: "image/png" }),
          ], "paste");
          await context.addAttachment([new File(["c"], "c.txt"), new File(["d"], "d.txt")], "upload");
        });
        await act(async () => {
          const result = context.send();
          if (mode === "throws") await expect(result).rejects.toThrow("capture failed");
          else await result;
        });
        expect(submit).toHaveBeenCalledOnce();
        expect(inlineIds).toHaveLength(2);
        expect(topIds).toHaveLength(2);
        const allIds = [...inlineIds, ...topIds];
        expect(drafts.beginSend).toHaveBeenCalledWith(expect.arrayContaining(allIds));
        const keep = mode === "rejected" || mode === "throws" ? allIds
          : [topIds[1], ...(mode === "consumed" ? [inlineIds[1]] : inlineIds)];
        expect(drafts.settleSend).toHaveBeenCalledOnce();
        const settled = vi.mocked(drafts.settleSend).mock.calls[0][0];
        expect([...settled.attachmentIds].sort()).toEqual(allIds.sort());
        expect([...settled.keepAttachmentIds].sort()).toEqual(keep.sort());
      } finally { view.unmount(); }
    }
  );
});
