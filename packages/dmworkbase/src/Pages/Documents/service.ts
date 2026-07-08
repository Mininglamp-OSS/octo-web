import { initialDocumentState } from "./mock";
import type {
  ArchiveMessageFileInput,
  DocumentAsset,
  DocumentKind,
  DocumentState,
  DocumentSummary,
  DocumentViewer,
} from "./types";

export const DEFAULT_DOCUMENT_VIEWER: DocumentViewer = {
  uid: "",
  name: "",
  accessibleChannelIds: [],
  accessibleSpaceNames: [],
};

export const DEMO_DOCUMENT_ACCESS = {
  accessibleChannelIds: ["group-product-plan", "u-liwei"],
  accessibleSpaceNames: ["产品部公共空间", "产品归档空间"],
};

export interface DocumentRepository {
  load(viewer?: DocumentViewer): Promise<DocumentState>;
  archiveMessageFile(input: ArchiveMessageFileInput, spaceName: string, viewer?: DocumentViewer): Promise<DocumentState>;
  renameFile(fileId: string, name: string, viewer?: DocumentViewer): Promise<DocumentState>;
  moveFileToSpace(fileId: string, spaceName: string, viewer?: DocumentViewer): Promise<DocumentState>;
  deleteFile(fileId: string, viewer?: DocumentViewer): Promise<DocumentState>;
  restoreFile(fileId: string, viewer?: DocumentViewer): Promise<DocumentState>;
  deletePermanently(fileId: string, viewer?: DocumentViewer): Promise<DocumentState>;
}

function cloneState(state: DocumentState): DocumentState {
  return JSON.parse(JSON.stringify(state)) as DocumentState;
}

function nowText() {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return formatter.format(new Date()).replace(/\//g, "-");
}

function appendFlow(file: DocumentAsset, flowText: string) {
  file.flow = [...file.flow, flowText];
}

function getDocumentKind(extension: string): DocumentKind {
  const ext = extension.toLowerCase().replace(/^\./, "");
  if (["pdf"].includes(ext)) return "pdf";
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (["zip", "rar", "7z"].includes(ext)) return "zip";
  return "doc";
}

function canViewerSeeFile(file: DocumentAsset, viewer: DocumentViewer) {
  if (file.uploaderUid === viewer.uid || file.owner === viewer.name) return true;
  if (file.access.userUids?.includes(viewer.uid)) return true;
  if (file.access.channelIds?.some((id) => viewer.accessibleChannelIds.includes(id))) return true;
  if (file.access.spaceNames?.some((name) => viewer.accessibleSpaceNames.includes(name))) return true;
  return false;
}

function findVisibleFile(state: DocumentState, fileId: string, viewer: DocumentViewer) {
  const file = state.files.find((item) => item.id === fileId && canViewerSeeFile(item, viewer));
  if (!file) {
    throw new Error(`Document file not found: ${fileId}`);
  }
  return file;
}

function createVisibleState(state: DocumentState, viewer: DocumentViewer): DocumentState {
  const files = state.files.filter((file) => canViewerSeeFile(file, viewer));
  const visibleSpaceNames = new Set([
    ...viewer.accessibleSpaceNames,
    ...files.map((file) => file.spaceName).filter((spaceName) => spaceName !== "会话文件"),
  ]);

  return {
    files: cloneState({ files, spaces: [] }).files,
    spaces: state.spaces
      .filter((space) => visibleSpaceNames.has(space.name))
      .map((space) => ({
        ...space,
        fileCount: files.filter((file) => file.status !== "deleted" && file.spaceName === space.name).length,
      })),
  };
}

function touchFile(file: DocumentAsset) {
  file.lastAccessAt = nowText();
}

export function createDocumentSummary(state: DocumentState): DocumentSummary {
  const activeFiles = state.files.filter((file) => file.status !== "deleted").length;
  const spaceFiles = state.files.filter((file) => file.status === "archived").length;
  const conversationFiles = state.files.filter((file) => file.status === "conversation").length;

  return {
    activeFiles,
    spaceFiles,
    conversationFiles,
  };
}

export class MockDocumentRepository implements DocumentRepository {
  private state: DocumentState;

  constructor(seed: DocumentState = initialDocumentState) {
    this.state = cloneState(seed);
  }

  async load(viewer: DocumentViewer = DEFAULT_DOCUMENT_VIEWER) {
    return createVisibleState(this.state, viewer);
  }

  async archiveMessageFile(
    input: ArchiveMessageFileInput,
    spaceName: string,
    viewer: DocumentViewer = DEFAULT_DOCUMENT_VIEWER,
  ) {
    const next = cloneState(this.state);
    const existing = next.files.find((item) => item.id === input.id);
    const createdAt = input.createdAt || input.sourceSentAt || nowText();

    if (existing) {
      findVisibleFile(next, existing.id, viewer);
      existing.status = "archived";
      existing.visibility = "space";
      existing.spaceName = spaceName;
      existing.access.spaceNames = Array.from(new Set([...(existing.access.spaceNames || []), spaceName]));
      touchFile(existing);
      appendFlow(existing, `保存到${spaceName}`);
      this.state = next;
      return this.load(viewer);
    }

    const file: DocumentAsset = {
      id: input.id,
      name: input.name || "未命名文件",
      kind: getDocumentKind(input.extension),
      extension: input.extension,
      size: input.size,
      url: input.url,
      owner: viewer.name,
      uploader: input.uploader,
      uploaderUid: input.uploaderUid,
      sourceName: input.sourceName,
      sourceChannelId: input.sourceChannelId,
      sourceChannelType: input.sourceChannelType,
      sourceType: input.sourceType,
      sourceMessageId: input.sourceMessageId,
      sourceMessageSeq: input.sourceMessageSeq,
      sourceSenderUid: input.sourceSenderUid,
      sourceSenderName: input.sourceSenderName,
      sourceSentAt: input.sourceSentAt,
      sourcePreviewText: input.sourcePreviewText,
      spaceName,
      visibility: "space",
      status: "archived",
      createdAt,
      lastAccessAt: nowText(),
      downloads: 0,
      previewable: input.previewable ?? !["zip", "rar", "7z"].includes(input.extension.toLowerCase().replace(/^\./, "")),
      flow: [`来自${input.sourceName}`, `保存到${spaceName}`],
      access: {
        userUids: Array.from(new Set([viewer.uid, input.uploaderUid, input.sourceSenderUid])),
        channelIds: [input.sourceChannelId],
        spaceNames: [spaceName],
      },
    };

    next.files.unshift(file);
    this.state = next;
    return this.load(viewer);
  }

  async renameFile(fileId: string, name: string, viewer: DocumentViewer = DEFAULT_DOCUMENT_VIEWER) {
    const next = cloneState(this.state);
    const file = findVisibleFile(next, fileId, viewer);
    const nextName = name.trim();

    if (!nextName) {
      throw new Error("Document name is required");
    }

    file.name = nextName;
    touchFile(file);
    appendFlow(file, `重命名为${nextName}`);
    this.state = next;
    return this.load(viewer);
  }

  async moveFileToSpace(fileId: string, spaceName: string, viewer: DocumentViewer = DEFAULT_DOCUMENT_VIEWER) {
    const next = cloneState(this.state);
    const file = findVisibleFile(next, fileId, viewer);
    const targetSpace = next.spaces.find((space) => space.name === spaceName);

    if (!targetSpace || !viewer.accessibleSpaceNames.includes(spaceName)) {
      throw new Error(`Document space not found: ${spaceName}`);
    }

    file.status = "archived";
    file.visibility = "space";
    file.spaceName = spaceName;
    file.access.spaceNames = Array.from(new Set([...(file.access.spaceNames || []), spaceName]));
    touchFile(file);
    appendFlow(file, `移动到${spaceName}`);
    this.state = next;
    return this.load(viewer);
  }

  async deleteFile(fileId: string, viewer: DocumentViewer = DEFAULT_DOCUMENT_VIEWER) {
    const next = cloneState(this.state);
    const file = findVisibleFile(next, fileId, viewer);

    file.status = "deleted";
    touchFile(file);
    appendFlow(file, "移到回收站");
    this.state = next;
    return this.load(viewer);
  }

  async restoreFile(fileId: string, viewer: DocumentViewer = DEFAULT_DOCUMENT_VIEWER) {
    const next = cloneState(this.state);
    const file = findVisibleFile(next, fileId, viewer);

    file.status = file.spaceName === "会话文件" ? "conversation" : "archived";
    file.visibility = file.spaceName === "会话文件" ? "conversation" : "space";
    touchFile(file);
    appendFlow(file, "从回收站恢复");
    this.state = next;
    return this.load(viewer);
  }

  async deletePermanently(fileId: string, viewer: DocumentViewer = DEFAULT_DOCUMENT_VIEWER) {
    const next = cloneState(this.state);
    findVisibleFile(next, fileId, viewer);

    next.files = next.files.filter((file) => file.id !== fileId);
    this.state = next;
    return this.load(viewer);
  }
}

export const documentRepository = new MockDocumentRepository();
