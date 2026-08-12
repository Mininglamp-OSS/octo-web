import { describe, expect, it, vi } from "vitest";
import { ChatComposerAttachmentStore } from "../attachmentStore";

interface TopItem {
  id: string;
  previewUrl?: string;
}

describe("ChatComposerAttachmentStore", () => {
  it("transfers top attachment ownership without revoking previews", () => {
    const revokeObjectURL = vi.fn();
    const store = new ChatComposerAttachmentStore<TopItem>({ revokeObjectURL });
    store.appendTopAttachment({ id: "a", previewUrl: "blob:a" });

    const taken = store.takeTopAttachments();

    expect(taken).toEqual([{ id: "a", previewUrl: "blob:a" }]);
    expect(store.snapshotTopAttachments()).toEqual([]);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    expect(store.restoreTopAttachments(taken)).toBe(1);
    expect(store.snapshotTopAttachments()).toEqual(taken);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("restores in order and ignores IDs already owned by the composer", () => {
    const store = new ChatComposerAttachmentStore<TopItem>();
    store.appendTopAttachment({ id: "live" });

    expect(
      store.restoreTopAttachments(
        [{ id: "a" }, { id: "live" }, { id: "a" }, { id: "b" }],
        0,
      ),
    ).toBe(2);
    expect(store.snapshotTopAttachments().map(({ id }) => id)).toEqual([
      "a",
      "b",
      "live",
    ]);
  });

  it("takes only the IDs captured by the send attempt", () => {
    const store = new ChatComposerAttachmentStore<TopItem>();
    store.appendTopAttachment({ id: "a" });
    store.appendTopAttachment({ id: "b" });

    expect(store.takeTopAttachments(["a"])).toEqual([{ id: "a" }]);
    expect(store.snapshotTopAttachments()).toEqual([{ id: "b" }]);
  });

  it("releases only previews still owned by remove or clear", () => {
    const revokeObjectURL = vi.fn();
    const store = new ChatComposerAttachmentStore<TopItem>({ revokeObjectURL });
    store.appendTopAttachment({ id: "a", previewUrl: "blob:a" });
    store.appendTopAttachment({ id: "b", previewUrl: "blob:shared" });
    store.appendTopAttachment({ id: "c", previewUrl: "blob:shared" });

    expect(store.removeTopAttachment("a")).toBe(true);
    store.clear();

    expect(revokeObjectURL.mock.calls.flat()).toEqual([
      "blob:a",
      "blob:shared",
    ]);
  });

  it("owns the inline file map and publishes immutable top snapshots", () => {
    const store = new ChatComposerAttachmentStore<TopItem>();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const file = new File(["x"], "x.png", { type: "image/png" });

    store.addInlineFile("inline", file);
    store.appendTopAttachment({ id: "top" });

    expect(store.attachmentFiles.get("inline")).toBe(file);
    expect(listener).toHaveBeenLastCalledWith([{ id: "top" }]);
    expect(listener.mock.calls.at(-1)?.[0]).not.toBe(
      store.snapshotTopAttachments(),
    );
    unsubscribe();
  });
});
