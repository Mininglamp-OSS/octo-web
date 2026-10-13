import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatComposerAttachmentDraftPort } from "@octo/base/src/features/chat-composer/local-drafts";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";
import { installClientLocalAttachmentDrafts } from "./localAttachmentDrafts";

const channel = { id: "channel-a", type: 2 };
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Keep persisted data independent of host installations, as in the Client IPC store.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "attachment-space-lifecycle-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  let listener!: Parameters<OctoBuddyCommunicationBridge["onCommand"]>[0];
  const directory = (spaceId: string, target: typeof channel) => {
    const path = join(root, spaceId, `${target.type}-${target.id}`);
    mkdirSync(path, { recursive: true });
    return path;
  };
  const bridge: OctoBuddyCommunicationBridge = {
    localAttachmentDraftsVersion: 2,
    stageAttachmentDraft: vi.fn(async ({ spaceId, channel: target, attachment, bytes }) => {
      const metadata = { ...attachment, createdAt: 100, updatedAt: 100 };
      writeFileSync(join(directory(spaceId, target), attachment.id), JSON.stringify({
        attachment: metadata, bytes: Array.from(new Uint8Array(bytes)),
      }));
      return metadata;
    }),
    listAttachmentDrafts: vi.fn(async ({ spaceId, channel: target }) => {
      const path = directory(spaceId, target);
      return readdirSync(path).map((id) => JSON.parse(readFileSync(join(path, id), "utf8")).attachment);
    }),
    readAttachmentDraft: vi.fn(async ({ spaceId, channel: target, attachmentId }) => {
      const record = JSON.parse(readFileSync(join(directory(spaceId, target), attachmentId), "utf8"));
      return { attachment: record.attachment, bytes: new Uint8Array(record.bytes) };
    }),
    removeAttachmentDraft: vi.fn(async ({ spaceId, channel: target, attachmentId }) => {
      rmSync(join(directory(spaceId, target), attachmentId), { force: true });
    }),
    onCommand: vi.fn((callback) => { listener = callback; return () => {}; }),
  };
  const install = () => {
    const dispose = installClientLocalAttachmentDrafts(bridge, "space-a");
    cleanups.push(dispose);
    return dispose;
  };
  install();
  return {
    bridge, install,
    command: (command: Parameters<typeof listener>[0]) => listener(command),
    switchTo: (id: string) => listener({ type: "spaceChanged", space: { id, name: id } }),
    port: (target = channel) => createChatComposerAttachmentDraftPort(target)!,
    diskIds: async (spaceId = "space-a") => (await bridge.listAttachmentDrafts!({ spaceId, channel })).map(({ id }) => id),
  };
}

async function stage(port: ReturnType<typeof createChatComposerAttachmentDraftPort>, id = "shared", content = "a") {
  expect(await port!.stage({ id, file: new File([content], `${content}.txt`), source: "upload" })).toBe(true);
}
async function restoredIds(port: ReturnType<typeof createChatComposerAttachmentDraftPort>) {
  return (await port!.restore()).attachments.map(({ id }) => id);
}
async function drainMutations() {
  // Let the I/O promise and the send-settlement continuation both finish.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Client attachment draft session/space transitions", () => {
  it("restores an ordinary persisted draft after repeated space round trips", async () => {
    const f = fixture();
    await stage(f.port());
    for (let index = 0; index < 3; index += 1) {
      f.switchTo("space-b");
      expect(await restoredIds(f.port())).toEqual([]);
      f.switchTo("space-a");
      expect(await restoredIds(f.port())).toEqual(["shared"]);
    }
  });

  it.each(["pending", "consumed", "retained", "delete-failed"] as const)(
    "preserves %s send state across A → B → A and permits the original owner's settlement",
    async (outcome) => {
      const f = fixture();
      const owner = f.port();
      await stage(owner);
      owner.beginSend(["shared"]);
      if (outcome === "delete-failed") {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.mocked(f.bridge.removeAttachmentDraft!).mockRejectedValueOnce(new Error("disk busy"));
      }
      f.switchTo("space-b");
      await stage(f.port(), "shared", "b");
      if (outcome !== "pending") {
        owner.settleSend({ attachmentIds: ["shared"], keepAttachmentIds: outcome === "retained" ? ["shared"] : [] });
        await drainMutations();
      }
      // A's sending/consumed maps must never suppress B with the same channel/id.
      expect(await restoredIds(f.port())).toEqual(["shared"]);
      f.switchTo("space-a");
      expect(await restoredIds(f.port())).toEqual(outcome === "retained" ? ["shared"] : []);
      expect(await f.diskIds()).toEqual(outcome === "consumed" ? [] : ["shared"]);
      // Reinstalling A must not reactivate the original port's UI operations.
      expect(await restoredIds(owner)).toEqual([]);
      expect(await owner.stage({ id: "stale", file: new File(["x"], "x.txt"), source: "upload" })).toBe(false);
      if (outcome === "pending") {
        owner.settleSend({ attachmentIds: ["shared"], keepAttachmentIds: [] });
        await drainMutations();
        expect(await f.diskIds()).toEqual([]);
        expect(await restoredIds(f.port())).toEqual([]);
      }
      expect(await f.diskIds("space-b")).toEqual(["shared"]);
    },
  );

  it("restores a retained send after its owner settles on the reopened space", async () => {
    const f = fixture();
    const owner = f.port();
    await stage(owner);
    owner.beginSend(["shared"]);
    f.switchTo("space-b");
    f.switchTo("space-a");
    const reopened = f.port();
    expect(await restoredIds(reopened)).toEqual([]);
    owner.settleSend({ attachmentIds: ["shared"], keepAttachmentIds: ["shared"] });
    expect(await restoredIds(reopened)).toEqual(["shared"]);
  });

  it.each([false, true])("suppresses send cleanup pending across a round trip, including rejection=%s", async (reject) => {
    const f = fixture();
    const removal = deferred();
    const realRemove = f.bridge.removeAttachmentDraft!;
    f.bridge.removeAttachmentDraft = vi.fn(async (input) => { await removal.promise; await realRemove(input); });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const owner = f.port();
    await stage(owner);
    owner.beginSend(["shared"]);
    owner.settleSend({ attachmentIds: ["shared"], keepAttachmentIds: [] });
    f.switchTo("space-b");
    f.switchTo("space-a");
    expect(await restoredIds(f.port())).toEqual([]);
    if (reject) removal.reject(new Error("disk busy"));
    else removal.resolve();
    await drainMutations();
    f.switchTo("space-b");
    f.switchTo("space-a");
    expect(await restoredIds(f.port())).toEqual([]);
    expect(await f.diskIds()).toEqual(reject ? ["shared"] : []);
  });

  it.each([false, true])("keeps a pending ordinary deletion hidden across a round trip (reject=%s)", async (reject) => {
    const f = fixture();
    const removal = deferred();
    const realRemove = f.bridge.removeAttachmentDraft!;
    f.bridge.removeAttachmentDraft = vi.fn(async (input) => { await removal.promise; await realRemove(input); });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const owner = f.port();
    await stage(owner);
    owner.syncLive([]);
    f.switchTo("space-b");
    f.switchTo("space-a");
    const reopened = f.port();
    expect(await restoredIds(reopened)).toEqual([]);
    if (reject) removal.reject(new Error("disk busy"));
    else removal.resolve();
    await drainMutations();
    expect(await restoredIds(reopened)).toEqual(reject ? ["shared"] : []);
    expect(await f.diskIds()).toEqual(reject ? ["shared"] : []);
  });

  it("serializes a replacement generation behind old-space deletion without deleting the replacement", async () => {
    const f = fixture();
    const removal = deferred();
    const started = deferred();
    const realRemove = f.bridge.removeAttachmentDraft!;
    f.bridge.removeAttachmentDraft = vi.fn(async (input) => {
      started.resolve(); await removal.promise; await realRemove(input);
    });
    const owner = f.port();
    await stage(owner);
    owner.beginSend(["shared"]);
    owner.settleSend({ attachmentIds: ["shared"], keepAttachmentIds: [] });
    await started.promise;
    f.switchTo("space-b");
    f.switchTo("space-a");
    const replacement = stage(f.port(), "shared", "replacement");
    await drainMutations();
    expect(f.bridge.stageAttachmentDraft).toHaveBeenCalledTimes(1);
    removal.resolve();
    await replacement;
    const restored = (await f.port().restore()).attachments;
    expect(restored.map(({ file }) => file.name)).toEqual(["replacement.txt"]);
  });

  it("isolates ownership between channel types as well as spaces", async () => {
    const f = fixture();
    const owner = f.port();
    await stage(owner);
    owner.beginSend(["shared"]);
    const otherChannel = { ...channel, type: 1 };
    await stage(f.port(otherChannel));
    f.switchTo("space-b");
    f.switchTo("space-a");
    expect(await restoredIds(f.port())).toEqual([]);
    expect(await restoredIds(f.port(otherChannel))).toEqual(["shared"]);
  });

  it.each(["sessionRevoked", "dispose"] as const)("clears all spaces on %s and fences stale send settlement", async (termination) => {
    const f = fixture();
    const ownerA = f.port();
    await stage(ownerA);
    ownerA.beginSend(["shared"]);
    f.switchTo("space-b");
    const ownerB = f.port();
    await stage(ownerB, "shared", "b");
    ownerB.beginSend(["shared"]);
    if (termination === "sessionRevoked") f.command({ type: "sessionRevoked" });
    else cleanups.at(-1)!();
    expect(createChatComposerAttachmentDraftPort(channel)).toBeUndefined();
    f.install();
    ownerA.settleSend({ attachmentIds: ["shared"], keepAttachmentIds: [] });
    ownerB.settleSend({ attachmentIds: ["shared"], keepAttachmentIds: [] });
    await drainMutations();
    expect(f.bridge.removeAttachmentDraft).not.toHaveBeenCalled();
    expect(await restoredIds(f.port())).toEqual(["shared"]);
    f.switchTo("space-b");
    expect(await restoredIds(f.port())).toEqual(["shared"]);
  });

  it("clears consumed suppression for a new session even when unlink previously failed", async () => {
    const f = fixture();
    const owner = f.port();
    await stage(owner);
    owner.beginSend(["shared"]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(f.bridge.removeAttachmentDraft!).mockRejectedValueOnce(new Error("disk busy"));
    owner.settleSend({ attachmentIds: ["shared"], keepAttachmentIds: [] });
    await drainMutations();
    expect(await restoredIds(f.port())).toEqual([]);
    f.command({ type: "sessionRevoked" });
    f.install();
    // Only renderer memory is tested here; real Client logout also clears disk.
    expect(await restoredIds(f.port())).toEqual(["shared"]);
  });

  it("does not start queued deletion after session revocation", async () => {
    const f = fixture();
    const owner = f.port();
    await stage(owner);
    owner.beginSend(["shared"]);
    owner.settleSend({ attachmentIds: ["shared"], keepAttachmentIds: [] });
    f.command({ type: "sessionRevoked" });
    await drainMutations();
    expect(f.bridge.removeAttachmentDraft).not.toHaveBeenCalled();
    expect(await f.diskIds()).toEqual(["shared"]);
  });

  it.each(["spaceChanged", "sessionRevoked"] as const)("discards partially collected restore results on %s", async (type) => {
    const f = fixture();
    await stage(f.port(), "first");
    await stage(f.port(), "second");
    const read = deferred();
    const started = deferred();
    const realRead = f.bridge.readAttachmentDraft!;
    f.bridge.readAttachmentDraft = vi.fn(async (input) => {
      if (input.attachmentId === "second") { started.resolve(); await read.promise; }
      return realRead(input);
    });
    const restoring = f.port().restore();
    await started.promise;
    if (type === "spaceChanged") { f.switchTo("space-b"); f.switchTo("space-a"); }
    else f.command({ type: "sessionRevoked" });
    read.resolve();
    expect((await restoring).attachments).toEqual([]);
  });
});
