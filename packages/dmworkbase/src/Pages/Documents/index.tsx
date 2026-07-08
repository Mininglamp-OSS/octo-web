import React, { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Eye,
  FolderOpen,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { Button, Input, Modal, Select, Toast } from "@douyinfe/semi-ui";
import { Channel } from "wukongimjssdk";
import WKApp from "../../App";
import { ShowConversationOptions } from "../../EndpointCommon";
import FilePreviewPanel, { type FilePreviewInfo } from "../../Components/FilePreviewPanel";
import { wkConfirm } from "../../Components/WKModal";
import { useI18n } from "../../i18n";
import { formatFileSize, getFileIconInfo } from "../../Messages/File";
import { downloadFile } from "../../Utils/download";
import { createDocumentSummary, DEFAULT_DOCUMENT_VIEWER, DEMO_DOCUMENT_ACCESS, documentRepository } from "./service";
import type { DocumentAsset, DocumentSpace, DocumentState, DocumentTab, DocumentViewer } from "./types";
import "./index.css";

type Translate = ReturnType<typeof useI18n>["t"];

function getTabOptions(translate: Translate): Array<{ key: DocumentTab; label: string }> {
  return [
    { key: "recent", label: translate("base.documents.tabs.recent") },
    { key: "conversation", label: translate("base.documents.tabs.conversation") },
    { key: "space", label: translate("base.documents.tabs.space") },
    { key: "sent", label: translate("base.documents.tabs.sent") },
    { key: "trash", label: translate("base.documents.tabs.trash") },
  ];
}

function getCurrentDocumentViewer(): DocumentViewer {
  const loginInfo = WKApp.loginInfo as typeof WKApp.loginInfo & { uid?: string };
  const uid = loginInfo.uid || "";
  const name = loginInfo.name || uid;

  return {
    ...DEFAULT_DOCUMENT_VIEWER,
    uid,
    name,
    accessibleChannelIds: uid ? DEMO_DOCUMENT_ACCESS.accessibleChannelIds : [],
    accessibleSpaceNames: uid ? DEMO_DOCUMENT_ACCESS.accessibleSpaceNames : [],
  };
}

function useDocumentState(viewer: DocumentViewer) {
  const [state, setState] = useState<DocumentState | null>(null);

  const reload = async () => {
    const next = await documentRepository.load(viewer);
    setState(next);
    return next;
  };

  useEffect(() => {
    reload();
  }, []);

  return { state, setState, reload };
}

function getStatusText(file: DocumentAsset, translate: Translate) {
  if (file.status === "deleted") return translate("base.documents.status.deleted");
  if (file.status === "archived") return translate("base.documents.status.archived");
  return translate("base.documents.status.conversation");
}

function getSourceTypeText(file: DocumentAsset, translate: Translate) {
  if (file.sourceType === "direct") return translate("base.documents.sourceType.direct");
  if (file.sourceType === "group") return translate("base.documents.sourceType.group");
  return translate("base.documents.sourceType.app");
}

function filterFiles(files: DocumentAsset[], tab: DocumentTab, keyword: string, kind: string, viewer: DocumentViewer) {
  const query = keyword.trim().toLowerCase();

  return files
    .filter((file) => {
      if (tab === "trash") return file.status === "deleted";
      if (file.status === "deleted") return false;
      if (tab === "conversation") return file.status === "conversation";
      if (tab === "space") return file.status === "archived";
      if (tab === "sent") return file.uploaderUid === viewer.uid;
      return true;
    })
    .filter((file) => (kind === "all" ? true : file.kind === kind))
    .filter((file) => {
      if (!query) return true;
      return [file.name, file.uploader, file.sourceName, file.spaceName].some((text) =>
        text.toLowerCase().includes(query),
      );
    })
    .sort((a, b) => b.lastAccessAt.localeCompare(a.lastAccessAt));
}

function FileBadge({ file }: { file: DocumentAsset }) {
  const info = getFileIconInfo(file.extension, file.name);

  return (
    <div className="wk-docs-file-badge" style={{ color: info.color }}>
      <span>{info.label}</span>
    </div>
  );
}

function StatusPill({ file, t }: { file: DocumentAsset; t: Translate }) {
  return <span className={`wk-docs-status wk-docs-status-${file.status}`}>{getStatusText(file, t)}</span>;
}

function openWorkspace() {
  const page = WKApp.route.get("/documents/workspace");
  if (page && React.isValidElement(page)) {
    WKApp.routeRight.replaceToRoot(page);
  }
}

function toPreviewInfo(file: DocumentAsset): FilePreviewInfo {
  return {
    url: file.url,
    name: file.name,
    extension: file.extension,
    size: file.size,
    sourceChannelId: file.sourceChannelId,
    sourceChannelType: file.sourceChannelType,
    messageId: file.sourceMessageId,
    messageSeq: file.sourceMessageSeq,
    fromUID: file.sourceSenderUid,
    conversationDigest: file.sourcePreviewText || file.name,
  };
}

export default function DocumentsPage() {
  const { t } = useI18n();
  const viewer = useMemo(() => getCurrentDocumentViewer(), []);
  const { state } = useDocumentState(viewer);
  const [keyword, setKeyword] = useState("");

  const summary = useMemo(() => (state ? createDocumentSummary(state) : null), [state]);
  const recentFiles = useMemo(() => {
    if (!state) return [];
    return filterFiles(state.files, "recent", keyword, "all", viewer).slice(0, 5);
  }, [state, keyword, viewer]);

  return (
    <div className="wk-docs-entry">
      <div className="wk-docs-entry-header">
        <div>
          <h1>{t("base.documents.entry.title")}</h1>
          <p>{t("base.documents.entry.subtitle")}</p>
        </div>
        <button className="wk-docs-icon-button" aria-label={t("base.documents.openCenter")} onClick={openWorkspace}>
          <FolderOpen size={18} />
        </button>
      </div>

      <label className="wk-docs-search">
        <Search size={16} />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t("base.documents.search.entryPlaceholder")}
        />
      </label>

      {summary && (
        <div className="wk-docs-entry-metrics">
          <div>
            <strong>{summary.activeFiles}</strong>
            <span>{t("base.documents.summary.available")}</span>
          </div>
          <div>
            <strong>{summary.spaceFiles}</strong>
            <span>{t("base.documents.summary.spaceFiles")}</span>
          </div>
          <div>
            <strong>{summary.conversationFiles}</strong>
            <span>{t("base.documents.summary.conversationFiles")}</span>
          </div>
        </div>
      )}

      <section className="wk-docs-entry-section">
        <div className="wk-docs-section-title">
          <span>{t("base.documents.sections.recentAccess")}</span>
          <button onClick={openWorkspace}>{t("base.documents.actions.all")}</button>
        </div>
        <div className="wk-docs-compact-list">
          {recentFiles.map((file: DocumentAsset) => (
            <button key={file.id} className="wk-docs-compact-file" onClick={openWorkspace}>
              <FileBadge file={file} />
              <span>
                <strong>{file.name}</strong>
                <em>{file.sourceName}</em>
              </span>
              <StatusPill file={file} t={t} />
            </button>
          ))}
        </div>
      </section>

      <section className="wk-docs-entry-section">
        <div className="wk-docs-section-title">
          <span>{t("base.documents.sections.spaces")}</span>
        </div>
        <div className="wk-docs-space-list">
          {state?.spaces.slice(0, 4).map((space: DocumentSpace) => (
            <button key={space.id} className="wk-docs-space-row" onClick={openWorkspace}>
              <FolderOpen size={16} />
              <span>
                <strong>{space.name}</strong>
                <em>{t("base.documents.space.fileCount", { values: { count: space.fileCount } })}</em>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function DocumentsWorkspace() {
  const { t } = useI18n();
  const viewer = useMemo(() => getCurrentDocumentViewer(), []);
  const { state, setState } = useDocumentState(viewer);
  const [tab, setTab] = useState<DocumentTab>("recent");
  const [keyword, setKeyword] = useState("");
  const [kind, setKind] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targetSpaceName, setTargetSpaceName] = useState("");
  const [previewFile, setPreviewFile] = useState<FilePreviewInfo | null>(null);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameName, setRenameName] = useState("");
  const tabOptions = useMemo(() => getTabOptions(t), [t]);

  const summary = useMemo(() => (state ? createDocumentSummary(state) : null), [state]);
  const visibleFiles = useMemo(() => {
    if (!state) return [];
    return filterFiles(state.files, tab, keyword, kind, viewer);
  }, [state, tab, keyword, kind, viewer]);
  const selectedFile = useMemo(() => {
    return visibleFiles.find((file: DocumentAsset) => file.id === selectedId) || visibleFiles[0] || null;
  }, [selectedId, visibleFiles]);

  useEffect(() => {
    if (!selectedId && visibleFiles[0]) {
      setSelectedId(visibleFiles[0].id);
    }
  }, [selectedId, visibleFiles]);

  useEffect(() => {
    if (!state || !selectedFile) return;
    const existingSpace = state.spaces.find((space: DocumentSpace) => space.name === selectedFile.spaceName);
    setTargetSpaceName(existingSpace?.name || state.spaces[0]?.name || "");
  }, [state, selectedFile?.id, selectedFile?.spaceName]);

  async function apply(nextState: Promise<DocumentState>, message: string) {
    try {
      const next = await nextState;
      setState(next);
      Toast.success(message);
    } catch (error) {
      const fallback = t("base.documents.toast.operationFailed");
      Toast.warning(error instanceof Error && error.message ? error.message : fallback);
    }
  }

  function showPreview(file: DocumentAsset) {
    if (!file.previewable) {
      Toast.warning(t("base.documents.toast.previewUnsupported"));
      return;
    }
    setPreviewFile(toPreviewInfo(file));
  }

  async function download(file: DocumentAsset) {
    await downloadFile(file.url, file.name);
    Toast.success(t("base.documents.toast.downloadStarted", { values: { name: file.name } }));
  }

  function openSource(file: DocumentAsset) {
    try {
      const opts = new ShowConversationOptions();
      opts.initLocateMessageSeq = file.sourceMessageSeq;
      WKApp.endpoints.showConversation(new Channel(file.sourceChannelId, file.sourceChannelType), opts);
      Toast.success(t("base.documents.toast.openingSource", { values: { name: file.sourceName } }));
    } catch (error) {
      Toast.warning(t("base.documents.toast.sourceUnavailable"));
    }
  }

  function moveSelectedFile(file: DocumentAsset) {
    if (!targetSpaceName) {
      Toast.warning(t("base.documents.toast.selectSpace"));
      return;
    }
    apply(
      documentRepository.moveFileToSpace(file.id, targetSpaceName, viewer),
      t("base.documents.toast.moved", { values: { space: targetSpaceName } }),
    );
  }

  function openRename(file: DocumentAsset) {
    setRenameName(file.name);
    setRenameVisible(true);
  }

  async function submitRename() {
    if (!selectedFile) return;
    const nextName = renameName.trim();
    if (!nextName) {
      Toast.warning(t("base.documents.toast.nameRequired"));
      return;
    }
    await apply(documentRepository.renameFile(selectedFile.id, nextName, viewer), t("base.documents.toast.renamed"));
    setRenameVisible(false);
  }

  function confirmDelete(file: DocumentAsset) {
    wkConfirm({
      title: t("base.documents.confirm.trashTitle", { values: { name: file.name } }),
      content: t("base.documents.confirm.trashContent"),
      okText: t("base.documents.actions.moveToTrash"),
      cancelText: t("base.common.cancel"),
      onOk: () => apply(documentRepository.deleteFile(file.id, viewer), t("base.documents.toast.trashed")),
    });
  }

  function confirmPermanentDelete(file: DocumentAsset) {
    wkConfirm({
      title: t("base.documents.confirm.deleteTitle", { values: { name: file.name } }),
      content: t("base.documents.confirm.deleteContent"),
      okText: t("base.documents.actions.delete"),
      cancelText: t("base.common.cancel"),
      onOk: () => apply(documentRepository.deletePermanently(file.id, viewer), t("base.documents.toast.deleted")),
    });
  }

  return (
    <div className="wk-docs-workspace">
      <header className="wk-docs-workspace-header">
        <div>
          <h1>{t("base.documents.workspace.title")}</h1>
          <p>{t("base.documents.workspace.subtitle")}</p>
        </div>
        <div className="wk-docs-header-side">
          {summary && (
            <div className="wk-docs-summary">
              <span>{t("base.documents.summary.availableCount", { values: { count: summary.activeFiles } })}</span>
              <span>{t("base.documents.summary.spaceFileCount", { values: { count: summary.spaceFiles } })}</span>
              <span>
                {t("base.documents.summary.conversationFileCount", {
                  values: { count: summary.conversationFiles },
                })}
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="wk-docs-tabs" role="tablist" aria-label={t("base.documents.tabs.ariaLabel")}>
        {tabOptions.map((item: { key: DocumentTab; label: string }) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            className={tab === item.key ? "active" : ""}
            onClick={() => {
              setTab(item.key);
              setSelectedId(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="wk-docs-main">
        <section className="wk-docs-list-panel">
          <div className="wk-docs-toolbar">
            <Input
              prefix={<Search size={15} />}
              value={keyword}
              onChange={setKeyword}
              placeholder={t("base.documents.search.workspacePlaceholder")}
            />
            <Select value={kind} onChange={(value) => setKind(String(value))} className="wk-docs-kind-select">
              <Select.Option value="all">{t("base.documents.kind.all")}</Select.Option>
              <Select.Option value="pdf">PDF</Select.Option>
              <Select.Option value="doc">{t("base.documents.kind.doc")}</Select.Option>
              <Select.Option value="sheet">{t("base.documents.kind.sheet")}</Select.Option>
              <Select.Option value="image">{t("base.documents.kind.image")}</Select.Option>
              <Select.Option value="zip">{t("base.documents.kind.zip")}</Select.Option>
            </Select>
          </div>

            <div className="wk-docs-file-list" role="list">
              {visibleFiles.map((file: DocumentAsset) => (
                <button
                  key={file.id}
                  className={`wk-docs-file-row ${selectedFile?.id === file.id ? "active" : ""}`}
                  onClick={() => setSelectedId(file.id)}
                >
                  <FileBadge file={file} />
                  <span className="wk-docs-file-main">
                    <strong>{file.name}</strong>
                    <em>
                      {getSourceTypeText(file, t)} · {file.sourceName} · {formatFileSize(file.size)}
                    </em>
                  </span>
                  <span className="wk-docs-file-meta">
                    <StatusPill file={file} t={t} />
                    <small>{file.uploader}</small>
                  </span>
                </button>
              ))}
              {visibleFiles.length === 0 && (
                <div className="wk-docs-empty">{t("base.documents.empty.noMatches")}</div>
              )}
            </div>
        </section>

        <aside className="wk-docs-detail-panel">
            {selectedFile ? (
              <>
                <div className="wk-docs-detail-head">
                  <FileBadge file={selectedFile} />
                  <div>
                    <h2>{selectedFile.name}</h2>
                    <p>{selectedFile.id}</p>
                  </div>
                  <StatusPill file={selectedFile} t={t} />
                </div>

                <div className="wk-docs-actions">
                  <Button icon={<Eye size={15} />} onClick={() => showPreview(selectedFile)}>
                    {t("base.documents.actions.preview")}
                  </Button>
                  <Button icon={<Download size={15} />} onClick={() => download(selectedFile)}>
                    {t("base.documents.actions.download")}
                  </Button>
                  {selectedFile.status !== "deleted" && (
                    <Button icon={<Pencil size={15} />} onClick={() => openRename(selectedFile)}>
                      {t("base.documents.actions.rename")}
                    </Button>
                  )}
                  {selectedFile.sourceChannelId && (
                    <Button icon={<ExternalLink size={15} />} onClick={() => openSource(selectedFile)}>
                      {t("base.documents.actions.openSource")}
                    </Button>
                  )}
                </div>

                <div className="wk-docs-detail-grid">
                  <Info
                    label={t("base.documents.detail.sourceConversation")}
                    value={`${getSourceTypeText(selectedFile, t)} / ${selectedFile.sourceName}`}
                  />
                  <Info
                    label={t("base.documents.detail.sourceMessage")}
                    value={`#${selectedFile.sourceMessageSeq} · ${
                      selectedFile.sourcePreviewText || selectedFile.name
                    }`}
                  />
                  <Info label={t("base.documents.detail.sender")} value={selectedFile.sourceSenderName} />
                  <Info label={t("base.documents.detail.sentAt")} value={selectedFile.sourceSentAt} />
                  <Info label={t("base.documents.detail.space")} value={selectedFile.spaceName} />
                  <Info label={t("base.documents.detail.lastAccess")} value={selectedFile.lastAccessAt} />
                  <Info label={t("base.documents.detail.downloads")} value={`${selectedFile.downloads}`} />
                  <Info label={t("base.documents.detail.size")} value={formatFileSize(selectedFile.size)} />
                </div>

                <section className="wk-docs-operation-card">
                  <h3>{t("base.documents.sections.fileActions")}</h3>
                  <div className="wk-docs-operation-list">
                    {selectedFile.status !== "deleted" && (
                      <div className="wk-docs-archive-row">
                        <Select
                          value={targetSpaceName}
                          onChange={(value) => setTargetSpaceName(String(value))}
                          className="wk-docs-space-select"
                        >
                          {state?.spaces.map((space: DocumentSpace) => (
                            <Select.Option key={space.id} value={space.name}>
                              {space.name}
                            </Select.Option>
                          ))}
                        </Select>
                        <Button
                          theme="solid"
                          icon={<FolderOpen size={15} />}
                          disabled={!targetSpaceName}
                          onClick={() => moveSelectedFile(selectedFile)}
                        >
                          {t("base.documents.actions.moveSpace")}
                        </Button>
                      </div>
                    )}
                    {selectedFile.status !== "deleted" ? (
                      <Button
                        type="danger"
                        icon={<Trash2 size={15} />}
                        onClick={() => confirmDelete(selectedFile)}
                      >
                        {t("base.documents.actions.moveToTrash")}
                      </Button>
                    ) : (
                      <Button
                        icon={<RotateCcw size={15} />}
                        onClick={() =>
                          apply(documentRepository.restoreFile(selectedFile.id, viewer), t("base.documents.toast.restored"))
                        }
                      >
                        {t("base.documents.actions.restore")}
                      </Button>
                    )}
                    {selectedFile.status === "deleted" && (
                      <Button
                        type="danger"
                        icon={<Trash2 size={15} />}
                        onClick={() => confirmPermanentDelete(selectedFile)}
                      >
                        {t("base.documents.actions.delete")}
                      </Button>
                    )}
                  </div>
                </section>

                <section className="wk-docs-flow">
                  <h3>{t("base.documents.sections.fileRecords")}</h3>
                  {selectedFile.flow.map((item: string) => (
                    <div key={item}>
                      <span />
                      <p>{item}</p>
                    </div>
                  ))}
                </section>
              </>
            ) : (
              <div className="wk-docs-empty">{t("base.documents.empty.selectFile")}</div>
            )}
        </aside>
      </div>
      <Modal
        title={t("base.documents.preview.title")}
        visible={Boolean(previewFile)}
        footer={null}
        width={920}
        onCancel={() => setPreviewFile(null)}
      >
        <div className="wk-docs-preview-shell">
          <FilePreviewPanel file={previewFile} onClose={() => setPreviewFile(null)} />
        </div>
      </Modal>
      <Modal
        title={t("base.documents.rename.title")}
        visible={renameVisible}
        okText={t("base.common.save")}
        cancelText={t("base.common.cancel")}
        onOk={submitRename}
        onCancel={() => {
          setRenameVisible(false);
        }}
      >
        <Input value={renameName} onChange={setRenameName} placeholder={t("base.documents.rename.placeholder")} />
      </Modal>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
