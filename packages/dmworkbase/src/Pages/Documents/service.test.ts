import { describe, expect, it } from "vitest";
import { MockDocumentRepository, createDocumentSummary } from "./service";

const chenViewer = {
  uid: "u-chenyi",
  name: "陈一",
  accessibleChannelIds: ["group-product-plan", "u-liwei"],
  accessibleSpaceNames: ["产品部公共空间", "产品归档空间"],
};

describe("DocumentRepository", () => {
  it("does not expose a direct upload entry from the document center", () => {
    const repo = new MockDocumentRepository();

    expect("uploadFile" in repo).toBe(false);
  });

  it("returns only files visible to the current viewer", async () => {
    const repo = new MockDocumentRepository();

    const state = await repo.load(chenViewer);

    expect(state.files.map((file) => file.id)).toEqual([
      "DOC-240617-002",
      "DOC-240617-003",
    ]);
    expect(state.files.some((file) => file.name.includes("仅张沐可见"))).toBe(false);
  });

  it("keeps source conversation, message and sender metadata on visible files", async () => {
    const repo = new MockDocumentRepository();

    const state = await repo.load(chenViewer);
    const file = state.files.find((item) => item.id === "DOC-240617-002");

    expect(file).toMatchObject({
      sourceName: "产品方案讨论群",
      sourceChannelId: "group-product-plan",
      sourceMessageId: "MSG-240615-002",
      sourceMessageSeq: 4208,
      sourceSenderUid: "u-chenyi",
      sourceSenderName: "陈一",
      sourceSentAt: "2026-06-15 15:26",
    });
  });

  it("renames and moves visible files without changing their source metadata", async () => {
    const repo = new MockDocumentRepository();

    await repo.renameFile("DOC-240617-002", "文件空间需求清单.xlsx", chenViewer);
    const moved = await repo.moveFileToSpace("DOC-240617-002", "产品归档空间", chenViewer);
    const file = moved.files.find((item) => item.id === "DOC-240617-002");

    expect(file).toMatchObject({
      name: "文件空间需求清单.xlsx",
      spaceName: "产品归档空间",
      status: "archived",
      visibility: "space",
      sourceName: "产品方案讨论群",
      sourceMessageSeq: 4208,
    });
  });

  it("moves files through trash, restores them and permanently deletes them", async () => {
    const repo = new MockDocumentRepository();

    const deleted = await repo.deleteFile("DOC-240617-002", chenViewer);
    expect(deleted.files.find((file) => file.id === "DOC-240617-002")?.status).toBe("deleted");

    const restored = await repo.restoreFile("DOC-240617-002", chenViewer);
    expect(restored.files.find((file) => file.id === "DOC-240617-002")?.status).toBe("archived");

    await repo.deleteFile("DOC-240617-002", chenViewer);
    const purged = await repo.deletePermanently("DOC-240617-002", chenViewer);
    expect(purged.files.some((file) => file.id === "DOC-240617-002")).toBe(false);
  });

  it("rejects operations for files that are not visible to the viewer", async () => {
    const repo = new MockDocumentRepository();

    await expect(repo.renameFile("DOC-240617-001", "hidden.pdf", chenViewer)).rejects.toThrow(
      "Document file not found",
    );
  });
});

describe("createDocumentSummary", () => {
  it("summarizes only files visible to the viewer", async () => {
    const repo = new MockDocumentRepository();
    const state = await repo.load(chenViewer);

    expect(createDocumentSummary(state)).toEqual({
      activeFiles: 2,
      spaceFiles: 1,
      conversationFiles: 1,
    });
  });
});
