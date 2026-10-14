import { afterEach, describe, expect, it, vi } from "vitest";
import { createClientAttachmentDraftPort } from "./attachmentDraftPort";
import { installClientLocalAttachmentDrafts } from "./localAttachmentDrafts";
import { createChatComposerAttachmentDraftPort } from "@octo/base/src/features/chat-composer/local-drafts";
import type { LocalAttachmentDraftBridge } from "./attachmentDraftContract";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";
const context = { spaceId: "a", channel: { id: "c", type: 2 } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const api: LocalAttachmentDraftBridge = {
    version: 4,
    open: vi.fn(async () => ({ leaseId: "lease", attachments: [], failedCount: 0 })),
    stage: vi.fn(async ({ attachment }) => ({ ...attachment, revision: "revision", createdAt: 1, updatedAt: 1 })),
    remove: vi.fn(async () => {}), prepareSend: vi.fn(async ({ requestId }) => ({ sendId: requestId })), settleSend: vi.fn(async () => {}),
  };
  let active = true;
  return { api, port: createClientAttachmentDraftPort(api, context, () => active), deactivate: () => { active = false; } };
}
const item = (id = "x") => ({ id, file: new File(["x"], `${id}.txt`), source: "upload" as const });
afterEach(() => vi.restoreAllMocks());

describe("Client draft editor adapter", () => {
  it("keeps browser and incomplete/older Client capabilities on the leave-confirmation path", () => {
    for (const capability of [undefined, { version: 2 }, { ...fixture().api, version: 3 }, { version: 4 }]) {
      const dispose = installClientLocalAttachmentDrafts({ attachmentDrafts: capability, onCommand: vi.fn() } as unknown as OctoBuddyCommunicationBridge, "a");
      expect(createChatComposerAttachmentDraftPort(context.channel)).toBeUndefined();
      dispose();
    }
  });
  it("invalidates old UI ports on space changes and makes logout terminal", async () => {
    const { api } = fixture();
    let command!: Parameters<OctoBuddyCommunicationBridge["onCommand"]>[0];
    const off = vi.fn();
    const dispose = installClientLocalAttachmentDrafts({ attachmentDrafts: api, onCommand: listener => { command = listener; return off; } }, "a");
    try {
      const old = createChatComposerAttachmentDraftPort(context.channel)!;
      command({ type: "spaceChanged", space: { id: "b", name: "B" } });
      expect(await old.stage(item())).toBe(false);
      await createChatComposerAttachmentDraftPort(context.channel)!.restore();
      expect(api.open).toHaveBeenCalledWith({ ...context, spaceId: "b" });
      command({ type: "sessionRevoked" });
      command({ type: "spaceChanged", space: { id: "a", name: "A" } });
      expect(createChatComposerAttachmentDraftPort(context.channel)).toBeUndefined();
      expect(off).toHaveBeenCalledOnce();
    } finally { dispose(); }
  });
  it("waits for persistence before reserving the exact revision and protects UI consumption", async () => {
    const { api, port } = fixture();
    const write = deferred<Awaited<ReturnType<typeof api.stage>>>();
    vi.mocked(api.stage).mockReturnValue(write.promise);
    const staging = port.stage(item());
    const sending = port.beginSend(["x"]);
    port.syncLive([]);
    expect(port.canLeave(["x"])).toBe(false);
    await vi.waitFor(() => expect(api.stage).toHaveBeenCalledOnce());
    expect(api.prepareSend).not.toHaveBeenCalled();
    write.resolve({ ...vi.mocked(api.stage).mock.calls[0][0].attachment, revision: "r2", createdAt: 1, updatedAt: 1 });
    await staging; await sending.ready;
    expect(api.prepareSend).toHaveBeenCalledWith({ leaseId: "lease", requestId: expect.any(String), attachments: [{ id: "x", revision: "r2" }] });
    expect(api.remove).not.toHaveBeenCalled();
    await sending.settle([]);
    expect(api.settleSend).toHaveBeenCalledWith({ sendId: expect.any(String), keepAttachmentIds: [] });
  });
  it("reserves by identity after a failed save without blocking the in-memory file", async () => {
    const { api, port } = fixture();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.stage).mockRejectedValue(new Error("quota"));
    expect(await port.stage(item())).toBe(false);
    expect(port.canLeave(["x"])).toBe(false);
    const sending = port.beginSend(["x"]);
    await sending.ready;
    await sending.settle(["x"]);
    expect(api.prepareSend).toHaveBeenCalledWith({ leaseId: "lease", requestId: expect.any(String), attachments: [{ id: "x" }] });
  });
  it("retains a pending write when a captured send is rejected after switching space", async () => {
    const f = fixture();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const write = deferred<Awaited<ReturnType<typeof f.api.stage>>>();
    vi.mocked(f.api.stage).mockReturnValue(write.promise);
    const staging = f.port.stage(item());
    const sending = f.port.beginSend(["x"]);
    f.port.syncLive([]);
    await vi.waitFor(() => expect(f.api.stage).toHaveBeenCalledOnce());
    f.deactivate();
    write.resolve({ ...vi.mocked(f.api.stage).mock.calls[0][0].attachment, revision: "r", createdAt: 1, updatedAt: 1 });
    expect(await staging).toBe(true);
    await expect(sending.ready).rejects.toThrow("editor expired");
    await sending.settle(["x"]);
    expect(f.api.remove).not.toHaveBeenCalled();
    expect(f.api.prepareSend).not.toHaveBeenCalled();
  });
  it("settles concurrent attempts using their own Client tokens", async () => {
    const { api, port } = fixture();
    await port.stage(item("one")); await port.stage(item("two"));
    const first = port.beginSend(["one"]), second = port.beginSend(["two"]);
    await Promise.all([first.ready, second.ready]);
    await second.settle(["two"]); await first.settle([]);
    expect(vi.mocked(api.settleSend).mock.calls.map(([input]) => input)).toEqual([
      { sendId: vi.mocked(api.prepareSend).mock.calls[1][0].requestId, keepAttachmentIds: ["two"] }, { sendId: vi.mocked(api.prepareSend).mock.calls[0][0].requestId, keepAttachmentIds: [] },
    ]);
  });
  it("preserves restored files until actually seen in the editor, then removes explicit deletions", async () => {
    const { api, port } = fixture();
    const metadata = { id: "x", revision: "r", position: 10, name: "x.txt", size: 1, source: "upload" as const, mimeType: "text/plain", lastModified: 1, createdAt: 1, updatedAt: 1 };
    vi.mocked(api.open).mockResolvedValue({ leaseId: "lease", attachments: [{ attachment: metadata, bytes: new Uint8Array([1]) }], failedCount: 0 });
    expect((await port.restore()).attachments.map(item => item.id)).toEqual(["x"]);
    port.syncLive([]); port.syncLive([]);
    expect(api.remove).not.toHaveBeenCalled();
    port.syncLive(["x"]); port.syncLive([]);
    await vi.waitFor(() => expect(api.remove).toHaveBeenCalledWith({ leaseId: "lease", attachments: [{ id: "x", revision: "r" }] }));
  });
  it("drops a late restore after the editor's space expires", async () => {
    const f = fixture();
    const opening = deferred<Awaited<ReturnType<typeof f.api.open>>>();
    vi.mocked(f.api.open).mockReturnValue(opening.promise);
    const restoring = f.port.restore(); f.deactivate();
    opening.resolve({ leaseId: "old", attachments: [], failedCount: 0 });
    expect((await restoring).attachments).toEqual([]);
  });
  it("allows the captured send to settle after UI invalidation", async () => {
    const f = fixture();
    await f.port.stage(item()); const sending = f.port.beginSend(["x"]); await sending.ready;
    f.deactivate();
    await sending.settle(["x"]);
    expect(f.api.settleSend).toHaveBeenCalledWith({ sendId: expect.any(String), keepAttachmentIds: ["x"] });
  });
});
