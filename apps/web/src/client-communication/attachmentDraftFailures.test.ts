import { afterEach, describe, expect, it, vi } from "vitest";
import { createClientAttachmentDraftPort } from "./attachmentDraftPort";
import type { LocalAttachmentDraftBridge } from "./attachmentDraftContract";
const context = { spaceId: "a", channel: { id: "c", type: 2 } };
const file = (id = "x") => ({ id, file: new File([id], `${id}.txt`), source: "paste" as const });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
};
function fixture(timeoutMs = 10_000) {
  const api: LocalAttachmentDraftBridge = {
    version: 4, open: vi.fn(async () => ({ leaseId: "lease", attachments: [], failedCount: 0 })),
    stage: vi.fn(async ({ attachment }) => ({ ...attachment, revision: crypto.randomUUID(), createdAt: 1, updatedAt: 1 })),
    remove: vi.fn(async () => {}), prepareSend: vi.fn(async ({ requestId }) => ({ sendId: requestId })), settleSend: vi.fn(async () => {}),
  };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return { api, port: createClientAttachmentDraftPort(api, context, () => true, timeoutMs) };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Client draft failure and undo boundaries", () => {
  it("retries both a rejected lease and a rejected stage in the same editor", async () => {
    const { api, port } = fixture();
    vi.mocked(api.open).mockRejectedValueOnce(new Error("IPC"));
    expect(await port.stage(file())).toBe(false);
    vi.mocked(api.stage).mockRejectedValueOnce(new Error("disk"));
    expect(await port.stage(file())).toBe(false);
    expect(await port.stage(file())).toBe(true);
    expect(api.open).toHaveBeenCalledTimes(2);
    expect(api.stage).toHaveBeenCalledTimes(2);
    await port.beginSend(["x"]).ready;
  });
  it("reconciles deletion during retained-send settlement and blocks navigation until confirmed", async () => {
    const { api, port } = fixture();
    await port.stage(file());
    const send = port.beginSend(["x"]); await send.ready;
    port.syncLive([]); // consume-first is not an explicit deletion
    expect(api.remove).not.toHaveBeenCalled();
    port.syncLive(["x"]); // send failure restores the editor node
    const settling = deferred(), removing = deferred();
    vi.mocked(api.settleSend).mockReturnValueOnce(settling.promise);
    vi.mocked(api.remove).mockReturnValueOnce(removing.promise);
    const settled = send.settle(["x"]);
    port.syncLive([]); // user explicitly deletes the restored node
    await vi.waitFor(() => expect(api.remove).toHaveBeenCalledOnce());
    expect(port.canLeave([])).toBe(false);
    settling.resolve(); removing.resolve(); await settled;
    expect(port.canLeave([])).toBe(true);
  });
  it("keeps failed removal unsafe and awaits an explicit navigation retry", async () => {
    const { api, port } = fixture();
    await port.stage(file());
    vi.mocked(api.remove).mockRejectedValueOnce(new Error("disk"));
    port.syncLive([]);
    await vi.waitFor(() => expect(api.remove).toHaveBeenCalledOnce());
    expect(port.canLeave([])).toBe(false);
    const retry = deferred(); vi.mocked(api.remove).mockReturnValueOnce(retry.promise);
    let completed = false;
    const leaving = Promise.resolve(port.discardUnready([])).then(() => { completed = true; });
    await vi.waitFor(() => expect(api.remove).toHaveBeenCalledTimes(2));
    expect(completed).toBe(false);
    retry.resolve(); await leaving;
    expect(port.canLeave([])).toBe(true);
  });
  it.each([false, true])("re-stages undo-restored nodes after deletion (pending=%s)", async pending => {
    const { api, port } = fixture();
    await port.stage(file());
    const removal = deferred();
    if (pending) vi.mocked(api.remove).mockReturnValueOnce(removal.promise);
    port.syncLive([]);
    await vi.waitFor(() => expect(api.remove).toHaveBeenCalledOnce());
    port.syncLive(["x"], [file()]);
    removal.resolve();
    await vi.waitFor(() => expect(api.stage).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(port.canLeave(["x"])).toBe(true));
    const send = port.beginSend(["x"]); await send.ready; await send.settle([]);
  });
  it("re-stages a same-tick undo before send even before live-sync runs", async () => {
    const { api, port } = fixture(); await port.stage(file());
    port.syncLive([]);
    await vi.waitFor(() => expect(api.remove).toHaveBeenCalledOnce());
    const send = port.beginSend(["x"], [file()]); await send.ready;
    expect(api.stage).toHaveBeenCalledTimes(2);
    expect(api.prepareSend).toHaveBeenCalledWith(expect.objectContaining({ attachments: [{ id: "x", revision: expect.any(String) }] }));
    await send.settle([]);
  });
  it("retries failed settlement with the returned opaque token before another send", async () => {
    const { api, port } = fixture();
    await port.stage(file());
    vi.mocked(api.prepareSend).mockResolvedValueOnce({ sendId: "native-reservation" });
    const first = port.beginSend(["x"]); await first.ready;
    vi.mocked(api.settleSend).mockRejectedValueOnce(new Error("lost reply"));
    await expect(first.settle(["x"])).rejects.toThrow("lost reply");
    expect(port.canLeave(["x"])).toBe(false);
    const second = port.beginSend(["x"]); await second.ready;
    expect(api.settleSend).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.settleSend).mock.calls.slice(0, 2)).toEqual([
      [{ sendId: "native-reservation", keepAttachmentIds: ["x"] }],
      [{ sendId: "native-reservation", keepAttachmentIds: ["x"] }],
    ]);
    expect(api.prepareSend).toHaveBeenCalledTimes(2);
    await second.settle([]); await second.settle([]);
    expect(api.settleSend).toHaveBeenCalledTimes(3);
  });
  it("does not release the first owner's lock on overlapping-id submission", async () => {
    const { api, port } = fixture(); await port.stage(file());
    const first = port.beginSend(["x"]); await first.ready;
    const duplicate = port.beginSend(["x"]);
    await expect(duplicate.ready).rejects.toThrow("already being submitted");
    await duplicate.settle([]);
    await expect(port.beginSend(["x"]).ready).rejects.toThrow("already being submitted");
    expect(api.prepareSend).toHaveBeenCalledOnce();
    await first.settle(["x"]);
    await port.beginSend(["x"]).ready;
  });
  it("does not make a permanently failed settlement block unrelated attachment sends", async () => {
    const { api, port } = fixture(); await port.stage(file());
    const first = port.beginSend(["x"]); await first.ready;
    const failedId = vi.mocked(api.prepareSend).mock.calls[0][0].requestId;
    vi.mocked(api.settleSend).mockImplementation(async ({ sendId }) => {
      if (sendId === failedId) throw new Error("permanent settlement failure");
    });
    await expect(first.settle([])).rejects.toThrow("permanent");
    await port.stage(file("new"));
    const next = port.beginSend(["new"]); await next.ready; await next.settle([]);
    expect(api.prepareSend).toHaveBeenCalledTimes(2);
    expect(port.canLeave([])).toBe(false);
    await expect(port.discardUnready([])).rejects.toThrow("permanent");
    expect(port.canLeave([])).toBe(true);
  });
  it("attempts all removals despite permanent settlement failure and releases a confirmed discard", async () => {
    const { api, port } = fixture(); await port.stage(file()); await port.stage(file("delete"));
    const send = port.beginSend(["x"]); await send.ready;
    vi.mocked(api.settleSend).mockRejectedValue(new Error("settlement offline"));
    await expect(send.settle([])).rejects.toThrow("offline");
    vi.mocked(api.remove).mockRejectedValue(new Error("removal offline"));
    port.syncLive([]);
    await vi.waitFor(() => expect(api.remove).toHaveBeenCalledOnce());
    expect(port.canLeave([])).toBe(false);
    await expect(port.discardUnready([])).rejects.toThrow("offline");
    expect(api.remove).toHaveBeenCalledTimes(2);
    expect(port.canLeave([])).toBe(true);
  });
  it("bounds confirmed discard even when cleanup never replies", async () => {
    const { api, port } = fixture(50); await port.stage(file());
    const send = port.beginSend(["x"]); await send.ready;
    vi.useFakeTimers();
    vi.mocked(api.settleSend).mockImplementation(() => new Promise(() => {}));
    const failed = expect(send.settle([])).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(51); await failed;
    const discard = expect(port.discardUnready([])).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(51); await discard;
    expect(port.canLeave([])).toBe(true);
  });
  it("does not let an invalidated port veto navigation", async () => {
    const { api } = fixture(); let active = true;
    const port = createClientAttachmentDraftPort(api, context, () => active);
    await port.stage(file());
    vi.mocked(api.remove).mockRejectedValue(new Error("expired"));
    port.syncLive([]);
    await vi.waitFor(() => expect(api.remove).toHaveBeenCalledOnce());
    expect(port.canLeave([])).toBe(false);
    active = false;
    expect(port.canLeave([])).toBe(true);
  });
  it("allows a mixed compose with unstaged ids to use Client-confirmed reservation", async () => {
    const { api, port } = fixture(); await port.stage(file("good"));
    const send = port.beginSend(["good", "undo", "quota"]); await send.ready;
    expect(api.prepareSend).toHaveBeenCalledWith(expect.objectContaining({ attachments: [
      { id: "good", revision: expect.any(String) }, { id: "undo" }, { id: "quota" },
    ] }));
    await send.settle([]);
  });
  it("bounds a hung reservation and cancels it using the same request id", async () => {
    const { api, port } = fixture(50); await port.stage(file());
    vi.useFakeTimers();
    vi.mocked(api.prepareSend).mockReturnValueOnce(new Promise(() => {}));
    const send = port.beginSend(["x"]);
    const rejected = expect(send.ready).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(51); await rejected;
    await send.settle(["x"]);
    expect(api.settleSend).toHaveBeenCalledWith({ sendId: vi.mocked(api.prepareSend).mock.calls[0][0].requestId, keepAttachmentIds: ["x"] });
    await port.beginSend(["x"]).ready;
  });
});
