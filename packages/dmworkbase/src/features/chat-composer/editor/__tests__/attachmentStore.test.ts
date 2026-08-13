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

  it("keeps leased inline resources alive when the live composer is cleared", () => {
    const revokeObjectURL = vi.fn();
    const store = new ChatComposerAttachmentStore<TopItem>({ revokeObjectURL });
    const file = new File(["x"], "x.png", { type: "image/png" });
    store.addInlineFile("inline", file, "blob:inline");
    store.takeInlineAttachments(["inline"]);

    store.clear();

    expect(store.inlineResource("inline")).toEqual({
      file,
      previewUrl: "blob:inline",
      leased: true,
    });
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("makes a restored inline lease live and releases it on clear", () => {
    const revokeObjectURL = vi.fn();
    const store = new ChatComposerAttachmentStore<TopItem>({ revokeObjectURL });
    const file = new File(["x"], "x.png", { type: "image/png" });
    store.addInlineFile("inline", file, "blob:inline");
    store.takeInlineAttachments(["inline"]);
    store.restoreInlineAttachments(["inline"]);

    store.clear();

    expect(store.inlineResource("inline")).toEqual({ leased: false });
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:inline");
  });

  it("disposes an inline attachment once using its owned preview URL", () => {
    const revokeObjectURL = vi.fn();
    const store = new ChatComposerAttachmentStore<TopItem>({ revokeObjectURL });
    const file = new File(["x"], "x.png", { type: "image/png" });
    store.addInlineFile("inline", file, "blob:owned");
    store.takeInlineAttachments(["inline"]);

    store.disposeInlineAttachment("inline", "blob:fallback");
    store.clear();

    expect(store.inlineResource("inline")).toEqual({ leased: false });
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:owned");
  });

  it("uses a fallback URL when disposing an untracked inline resource", () => {
    const revokeObjectURL = vi.fn();
    const store = new ChatComposerAttachmentStore<TopItem>({ revokeObjectURL });

    store.disposeInlineAttachment("missing", "blob:fallback");

    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fallback");
  });

  it("fails closed when an existing or leased inline resource is replaced", () => {
    const store = new ChatComposerAttachmentStore<TopItem>();
    const first = new File(["1"], "first.png", { type: "image/png" });
    const second = new File(["2"], "second.png", { type: "image/png" });
    store.addInlineFile("inline", first, "blob:first");

    expect(() =>
      store.addInlineFile("inline", second, "blob:second"),
    ).toThrow("already registered");

    store.takeInlineAttachments(["inline"]);
    expect(() =>
      store.addInlineFile("inline", first, "blob:first"),
    ).toThrow("cannot replace leased");
  });

  it("owns preview-only recovery resources", () => {
    const revokeObjectURL = vi.fn();
    const store = new ChatComposerAttachmentStore<TopItem>({ revokeObjectURL });
    store.addInlinePreviewUrl("inline", "blob:inline");

    store.clear();

    expect(store.inlineResource("inline")).toEqual({ leased: false });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:inline");
  });

  it("hands inline and top resources to recovery without revoking them", () => {
    const revokeObjectURL = vi.fn();
    const store = new ChatComposerAttachmentStore<TopItem>({ revokeObjectURL });
    const file = new File(["x"], "x.png", { type: "image/png" });
    store.addInlineFile("inline", file, "blob:inline");
    store.takeInlineAttachments(["inline"]);
    store.appendTopAttachment({ id: "top", previewUrl: "blob:top" });

    store.handoffInlineAttachments(["inline"]);
    store.handoffTopAttachments(["top"]);
    store.clear();

    expect(store.inlineResource("inline")).toEqual({ leased: false });
    expect(store.snapshotTopAttachments()).toEqual([]);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
