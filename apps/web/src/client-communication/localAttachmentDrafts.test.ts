import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createChatComposerAttachmentDraftPort,
  type LocalAttachmentDraftHost,
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
    localAttachmentDraftsVersion: 1,
    stageAttachmentDraft: vi.fn<LocalAttachmentDraftHost["stage"]>(),
    listAttachmentDrafts: vi.fn<LocalAttachmentDraftHost["list"]>(),
    readAttachmentDraft: vi.fn<LocalAttachmentDraftHost["read"]>(),
    removeAttachmentDraft: vi.fn<LocalAttachmentDraftHost["remove"]>(),
    onCommand: vi.fn(() => () => {}),
  };
}

describe("Client local attachment draft capability", () => {
  it("rejects partial capability exposure and preserves the browser fallback", () => {
    dispose = installClientLocalAttachmentDrafts({
      localAttachmentDraftsVersion: 1,
      stageAttachmentDraft: vi.fn(),
    }, "space-a");

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
