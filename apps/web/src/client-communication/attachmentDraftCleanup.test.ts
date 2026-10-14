import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatComposerAttachmentDraftPort } from "@octo/base/src/features/chat-composer/local-drafts";
import { installClientLocalAttachmentDrafts } from "./localAttachmentDrafts";
import type { DraftOpenResult, LocalAttachmentDraftBridge } from "./attachmentDraftContract";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

const channel = { id: "c", type: 2 };
const item = (id = "x") => ({ id, file: new File([id], `${id}.txt`), source: "upload" as const });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
};
const disposers: Array<() => void> = [];
function fixture() {
  const disk = new Map<string, DraftOpenResult["attachments"][number]>();
  let lease = 0, revision = 0;
  const api: LocalAttachmentDraftBridge = {
    version: 4,
    open: vi.fn(async () => ({ leaseId: String(++lease), attachments: [...disk.values()], failedCount: 0 })),
    stage: vi.fn(async ({ attachment, bytes }) => {
      const metadata = { ...attachment, revision: String(++revision), createdAt: 1, updatedAt: 1 };
      disk.set(attachment.id, { attachment: metadata, bytes: new Uint8Array(bytes) });
      return metadata;
    }),
    remove: vi.fn(async ({ leaseId, attachments }) => {
      if (leaseId !== String(lease)) throw new Error("expired lease");
      for (const { id, revision } of attachments) if (disk.get(id)?.attachment.revision === revision) disk.delete(id);
    }),
    prepareSend: vi.fn(async ({ requestId }) => ({ sendId: requestId })),
    settleSend: vi.fn(async () => { disk.clear(); }),
  };
  let command!: Parameters<OctoBuddyCommunicationBridge["onCommand"]>[0];
  const dispose = installClientLocalAttachmentDrafts({ attachmentDrafts: api,
    onCommand: listener => { command = listener; return () => {}; } }, "a");
  disposers.push(dispose);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return { api, disk, command, dispose, port: () => createChatComposerAttachmentDraftPort(channel)! };
}
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); vi.restoreAllMocks(); });

describe("session-owned attachment cleanup", () => {
  it("retains a deletion dropped before Client across confirmation and remount until IPC recovers", async () => {
    const f = fixture(), first = f.port(); await first.stage(item());
    const remove = vi.mocked(f.api.remove).getMockImplementation()!;
    vi.mocked(f.api.remove).mockRejectedValue(new Error("IPC dropped before Client"));
    first.syncLive([]);
    await vi.waitFor(() => expect(f.api.remove).toHaveBeenCalledOnce());
    await expect(first.discardUnready([])).rejects.toThrow("IPC dropped");
    expect(first.canLeave([])).toBe(true);
    expect(f.disk.size).toBe(1);
    const returned = f.port();
    expect((await returned.restore()).attachments).toEqual([]);
    expect(f.disk.size).toBe(1); // Not hidden merely because the fake host deleted it.
    vi.mocked(f.api.remove).mockImplementation(remove);
    // A fresh port must retry the original deletion and reacquire its lease.
    expect((await f.port().restore()).attachments).toEqual([]);
    expect(f.disk.size).toBe(0);
  });

  it("keeps scope-specific failed requests across space switches", async () => {
    const f = fixture(), port = f.port(); await port.stage(item());
    vi.mocked(f.api.remove).mockRejectedValue(new Error("offline"));
    port.syncLive([]); await vi.waitFor(() => expect(f.api.remove).toHaveBeenCalledOnce());
    await expect(port.discardUnready([])).rejects.toThrow("offline");
    f.command({ type: "spaceChanged", space: { id: "b", name: "B" } });
    const removals = vi.mocked(f.api.remove).mock.calls.length;
    const otherSpace = f.port(); await otherSpace.restore();
    expect(f.api.open).toHaveBeenLastCalledWith({ spaceId: "b", channel });
    expect(f.api.remove).toHaveBeenCalledTimes(removals);
    expect(otherSpace.canLeave([])).toBe(true);
    f.command({ type: "spaceChanged", space: { id: "a", name: "A" } });
    expect((await f.port().restore()).attachments).toEqual([]);
  });

  it("does not turn an in-flight save into deletion on confirmation", async () => {
    const f = fixture(), port = f.port(), writing = deferred();
    const stage = vi.mocked(f.api.stage).getMockImplementation()!;
    vi.mocked(f.api.stage).mockImplementation(async input => { await writing.promise; return stage(input); });
    const saved = port.stage(item());
    await vi.waitFor(() => expect(f.api.stage).toHaveBeenCalledOnce());
    await port.discardUnready(["x"]);
    writing.resolve(); expect(await saved).toBe(true);
    expect(f.api.remove).not.toHaveBeenCalled();
    expect(f.disk.size).toBe(1);
    expect(port.canLeave(["x"])).toBe(true);
  });

  it("does not waive a settlement created while an earlier confirmation is pending", async () => {
    const f = fixture(), port = f.port(), removal = deferred();
    await port.stage(item()); await port.stage(item("send"));
    const send = port.beginSend(["send"]); await send.ready;
    vi.mocked(f.api.remove).mockImplementation(async () => { await removal.promise; throw new Error("remove offline"); });
    port.syncLive(["send"]);
    await vi.waitFor(() => expect(f.api.remove).toHaveBeenCalledOnce());
    const leaving = expect(port.discardUnready([])).rejects.toThrow("remove offline");
    vi.mocked(f.api.settleSend).mockRejectedValue(new Error("settle offline"));
    const settled = expect(send.settle([])).rejects.toThrow("remove offline");
    await vi.waitFor(() => expect(f.api.settleSend).toHaveBeenCalledOnce());
    removal.resolve(); await leaving; await settled;
    expect(port.canLeave([])).toBe(false);
  });

  it("cannot open a new account lease after disposal while a removal awaits staging", async () => {
    const f = fixture(), port = f.port(), writing = deferred();
    const stage = vi.mocked(f.api.stage).getMockImplementation()!;
    vi.mocked(f.api.stage).mockImplementation(async input => { await writing.promise; return stage(input); });
    const saved = port.stage(item());
    await vi.waitFor(() => expect(f.api.stage).toHaveBeenCalledOnce());
    port.syncLive([]); f.dispose(); writing.resolve(); await saved;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.api.open).toHaveBeenCalledOnce();
    expect(f.api.remove).not.toHaveBeenCalled();
  });

  it("uses fresh restore snapshots after a consumed send", async () => {
    const f = fixture(); await f.port().stage(item());
    const port = f.port(); expect((await port.restore()).attachments).toHaveLength(1);
    const send = port.beginSend(["x"]); await send.ready; await send.settle([]);
    expect((await port.restore()).attachments).toEqual([]);
    expect((await f.port().restore()).attachments).toEqual([]);
  });

  it("coalesces a repeated settle with a restore retry", async () => {
    const f = fixture(), port = f.port(); await port.stage(item());
    const send = port.beginSend(["x"]); await send.ready;
    vi.mocked(f.api.settleSend).mockRejectedValueOnce(new Error("offline"));
    await expect(send.settle([])).rejects.toThrow("offline");
    const pending = deferred(); vi.mocked(f.api.settleSend).mockReturnValue(pending.promise);
    const restored = f.port().restore(), settled = send.settle([]);
    await vi.waitFor(() => expect(f.api.settleSend).toHaveBeenCalledTimes(2));
    f.disk.clear(); pending.resolve(); await restored; await settled;
    expect(f.api.settleSend).toHaveBeenCalledTimes(2);
  });

  it("does not leak a send lock when secure randomness throws", async () => {
    const f = fixture(), port = f.port(); await port.stage(item());
    const random = vi.spyOn(crypto, "getRandomValues").mockImplementationOnce(() => { throw new Error("unavailable"); });
    const send = port.beginSend(["x"]);
    await expect(send.ready).rejects.toThrow("unavailable"); await send.settle(["x"]);
    random.mockRestore();
    const retry = port.beginSend(["x"]); await retry.ready; await retry.settle([]);
  });
});
