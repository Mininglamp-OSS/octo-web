import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createChatComposerAttachmentDraftPort,
} from "@octo/base/src/features/chat-composer/local-drafts";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";
import { installClientLocalAttachmentDrafts } from "./localAttachmentDrafts";

const channel = { id: "channel-a", type: 2 };
let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
});

function bridge(): OctoBuddyCommunicationBridge {
  return {
    localAttachmentDraftsVersion: 2,
    stageAttachmentDraft: vi.fn<
      NonNullable<OctoBuddyCommunicationBridge["stageAttachmentDraft"]>
    >(),
    listAttachmentDrafts: vi.fn<
      NonNullable<OctoBuddyCommunicationBridge["listAttachmentDrafts"]>
    >(),
    readAttachmentDraft: vi.fn<
      NonNullable<OctoBuddyCommunicationBridge["readAttachmentDraft"]>
    >(),
    removeAttachmentDraft: vi.fn<
      NonNullable<OctoBuddyCommunicationBridge["removeAttachmentDraft"]>
    >(),
    onCommand: vi.fn(() => () => {}),
  };
}

describe("Client local attachment draft capability", () => {
  it("rejects partial capability exposure and preserves the browser fallback", () => {
    dispose = installClientLocalAttachmentDrafts({
      localAttachmentDraftsVersion: 2,
      stageAttachmentDraft: vi.fn(),
    }, "space-a");

    expect(createChatComposerAttachmentDraftPort(channel)).toBeUndefined();
  });

  it("rejects a complete legacy V1 bridge and preserves the browser fallback", () => {
    const legacyBridge = {
      ...bridge(),
      localAttachmentDraftsVersion: 1,
    } as unknown as OctoBuddyCommunicationBridge;

    dispose = installClientLocalAttachmentDrafts(legacyBridge, "space-a");

    expect(createChatComposerAttachmentDraftPort(channel)).toBeUndefined();
  });

  it("installs only a complete versioned bridge and disposes it with the UI", () => {
    const value = bridge();
    dispose = installClientLocalAttachmentDrafts(value, "space-a");
    const port = createChatComposerAttachmentDraftPort(channel);

    expect(port).toBeDefined();
    dispose();
    dispose = undefined;
    expect(createChatComposerAttachmentDraftPort(channel)).toBeUndefined();
  });

  it("invalidates stale ports on space change while keeping the capability installed", async () => {
    let commandListener: Parameters<OctoBuddyCommunicationBridge["onCommand"]>[0] | undefined;
    const value = bridge();
    value.onCommand = vi.fn((listener) => {
      commandListener = listener;
      return () => { commandListener = undefined; };
    });
    dispose = installClientLocalAttachmentDrafts(value, "space-a");
    const stalePort = createChatComposerAttachmentDraftPort(channel)!;

    commandListener?.({ type: "spaceChanged", space: { id: "space-b", name: "B" } });

    expect(await stalePort.stage({
      id: "stale",
      file: new File(["x"], "x.txt"),
      source: "upload",
    })).toBe(false);
    expect(createChatComposerAttachmentDraftPort(channel)).toBeDefined();
  });

  it("binds each installed host and stale settlement to its original space", async () => {
    let commandListener: Parameters<
      OctoBuddyCommunicationBridge["onCommand"]
    >[0] | undefined;
    const value = bridge();
    value.stageAttachmentDraft = vi.fn(async ({ attachment }) => ({
      ...attachment,
      createdAt: 100,
      updatedAt: 100,
    }));
    value.removeAttachmentDraft = vi.fn(async () => {});
    value.onCommand = vi.fn((listener) => {
      commandListener = listener;
      return () => {
        commandListener = undefined;
      };
    });
    dispose = installClientLocalAttachmentDrafts(value, "space-a");
    const spaceAPort = createChatComposerAttachmentDraftPort(channel)!;
    await spaceAPort.stage({
      id: "shared",
      file: new File(["a"], "a.txt"),
      source: "upload",
    });
    spaceAPort.beginSend(["shared"]);

    commandListener?.({
      type: "spaceChanged",
      space: { id: "space-b", name: "B" },
    });
    const spaceBPort = createChatComposerAttachmentDraftPort(channel)!;
    await spaceBPort.stage({
      id: "shared",
      file: new File(["b"], "b.txt"),
      source: "upload",
    });
    spaceAPort.settleSend({
      attachmentIds: ["shared"],
      keepAttachmentIds: [],
    });

    await vi.waitFor(() =>
      expect(value.removeAttachmentDraft).toHaveBeenCalledWith({
        channel,
        attachmentId: "shared",
        spaceId: "space-a",
      })
    );
    expect(value.stageAttachmentDraft).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        attachment: expect.objectContaining({ id: "shared", name: "b.txt" }),
        spaceId: "space-b",
      })
    );
    expect(value.removeAttachmentDraft).not.toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space-b" })
    );
  });

  it("invalidates stale ports and removes the capability on session revocation", async () => {
    let commandListener: Parameters<OctoBuddyCommunicationBridge["onCommand"]>[0] | undefined;
    const value = bridge();
    value.onCommand = vi.fn((listener) => {
      commandListener = listener;
      return () => { commandListener = undefined; };
    });
    dispose = installClientLocalAttachmentDrafts(value, "space-a");
    const stalePort = createChatComposerAttachmentDraftPort(channel)!;

    commandListener?.({ type: "sessionRevoked" });

    expect(await stalePort.stage({
      id: "stale",
      file: new File(["x"], "x.txt"),
      source: "upload",
    })).toBe(false);
    expect(createChatComposerAttachmentDraftPort(channel)).toBeUndefined();
  });
});
