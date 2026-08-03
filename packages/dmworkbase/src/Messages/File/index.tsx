import React from "react";
import "./index.css";
import { MessageCell } from "../MessageCell";
import MessageBase from "../Base";
import WKApp from "../../App";
import { FileContent } from "./FileContent";
import { downloadFile } from "../../Utils/download";
import { WKSDK, Task, TaskStatus } from "wukongimjssdk";
import { Toast } from "@douyinfe/semi-ui";
import WKModal from "../../Components/WKModal";
import MarkdownContent from "../Text/MarkdownContent";
import MessageRow from "../../ui/message/MessageRow";
import { getFileMessageUI } from "../../bridge/message/useFileMessageUI";
import { isMessageSelectable } from "../../Service/messageSelection";
import { isSafeUrl } from "../../Utils/security";
import { I18nContext } from "../../i18n";

export { FileContent } from "./FileContent";

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function getFileIconInfo(
  extension: string,
  name?: string
): { color: string; label: string } {
  const ext = getExtension(extension, name);
  switch (ext) {
    case "pdf":
      return { color: "#EF4444", label: "PDF" };
    case "doc":
    case "docx":
      return { color: "#3B82F6", label: "DOC" };
    case "xls":
    case "xlsx":
      return { color: "#22C55E", label: "XLS" };
    case "ppt":
    case "pptx":
      return { color: "#F97316", label: "PPT" };
    case "zip":
    case "rar":
    case "7z":
    case "tar":
    case "gz":
      return { color: "#EAB308", label: "ZIP" };
    case "mp3":
    case "wav":
    case "flac":
    case "aac":
      return { color: "#A855F7", label: "MP3" };
    case "mp4":
    case "avi":
    case "mov":
    case "mkv":
      return { color: "#EC4899", label: "MP4" };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "bmp":
    case "webp":
      return { color: "#14B8A6", label: "IMG" };
    case "txt":
    case "md":
      return { color: "#6B7280", label: "TXT" };
    default:
      return { color: "#9CA3AF", label: "FILE" };
  }
}

/** 文件类型图标，对齐 Figma 设计稿 */
function FileTypeIcon({
  extension,
  name,
}: {
  extension: string;
  name?: string;
}) {
  const ext = getExtension(extension, name);

  // PDF
  if (ext === "pdf") {
    return (
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="40" height="40" rx="8" fill="#FEE2E2" />
        <path
          d="M12 10C12 8.9 12.9 8 14 8H24L30 14V30C30 31.1 29.1 32 28 32H14C12.9 32 12 31.1 12 30V10Z"
          fill="#EF4444"
        />
        <path d="M24 8L30 14H26C24.9 14 24 13.1 24 12V8Z" fill="#FCA5A5" />
        <text
          x="20"
          y="26"
          textAnchor="middle"
          fill="white"
          fontSize="7"
          fontWeight="700"
          fontFamily="sans-serif"
        >
          PDF
        </text>
      </svg>
    );
  }

  // DOC/DOCX
  if (ext === "doc" || ext === "docx") {
    return (
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="40" height="40" rx="8" fill="#DBEAFE" />
        <path
          d="M12 10C12 8.9 12.9 8 14 8H24L30 14V30C30 31.1 29.1 32 28 32H14C12.9 32 12 31.1 12 30V10Z"
          fill="#3B82F6"
        />
        <path d="M24 8L30 14H26C24.9 14 24 13.1 24 12V8Z" fill="#93C5FD" />
        <text
          x="20"
          y="26"
          textAnchor="middle"
          fill="white"
          fontSize="6.5"
          fontWeight="700"
          fontFamily="sans-serif"
        >
          DOC
        </text>
      </svg>
    );
  }

  // XLS/XLSX
  if (ext === "xls" || ext === "xlsx") {
    return (
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="40" height="40" rx="8" fill="#DCFCE7" />
        <path
          d="M12 10C12 8.9 12.9 8 14 8H24L30 14V30C30 31.1 29.1 32 28 32H14C12.9 32 12 31.1 12 30V10Z"
          fill="#22C55E"
        />
        <path d="M24 8L30 14H26C24.9 14 24 13.1 24 12V8Z" fill="#86EFAC" />
        <text
          x="20"
          y="26"
          textAnchor="middle"
          fill="white"
          fontSize="6.5"
          fontWeight="700"
          fontFamily="sans-serif"
        >
          XLS
        </text>
      </svg>
    );
  }

  // PPT/PPTX
  if (ext === "ppt" || ext === "pptx") {
    return (
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="40" height="40" rx="8" fill="#FFEDD5" />
        <path
          d="M12 10C12 8.9 12.9 8 14 8H24L30 14V30C30 31.1 29.1 32 28 32H14C12.9 32 12 31.1 12 30V10Z"
          fill="#F97316"
        />
        <path d="M24 8L30 14H26C24.9 14 24 13.1 24 12V8Z" fill="#FDba74" />
        <text
          x="20"
          y="26"
          textAnchor="middle"
          fill="white"
          fontSize="6.5"
          fontWeight="700"
          fontFamily="sans-serif"
        >
          PPT
        </text>
      </svg>
    );
  }

  // ZIP/压缩包
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return (
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="40" height="40" rx="8" fill="#FEF9C3" />
        <path
          d="M12 10C12 8.9 12.9 8 14 8H24L30 14V30C30 31.1 29.1 32 28 32H14C12.9 32 12 31.1 12 30V10Z"
          fill="#EAB308"
        />
        <path d="M24 8L30 14H26C24.9 14 24 13.1 24 12V8Z" fill="#FDE047" />
        <text
          x="20"
          y="26"
          textAnchor="middle"
          fill="white"
          fontSize="6.5"
          fontWeight="700"
          fontFamily="sans-serif"
        >
          ZIP
        </text>
      </svg>
    );
  }

  // 通用文件
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="40" height="40" rx="8" fill="#F3F4F6" />
      <path
        d="M12 10C12 8.9 12.9 8 14 8H24L30 14V30C30 31.1 29.1 32 28 32H14C12.9 32 12 31.1 12 30V10Z"
        fill="#9CA3AF"
      />
      <path d="M24 8L30 14H26C24.9 14 24 13.1 24 12V8Z" fill="#D1D5DB" />
      <line
        x1="16"
        y1="20"
        x2="26"
        y2="20"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="16"
        y1="24"
        x2="22"
        y2="24"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function getExtension(extension: string, name?: string): string {
  // 优先从文件名后缀提取: 服务端返回的 extension 字段不可靠 (可能为空、
  // 或是 "file" 等占位值, 见 issue #143), 用文件名后缀更稳妥。
  //
  // 边界:
  //   - dot > 0       : 排除前导点的 dotfile (如 ".env" / ".bashrc"),
  //                     这类文件按 POSIX 语义没有"扩展名", 该 fallback。
  //   - dot < len-1   : 排除尾部点 (如 "report."), 提取出来是空串, 也该 fallback。
  if (name) {
    const dot = name.lastIndexOf(".");
    if (dot > 0 && dot < name.length - 1) {
      return name.substring(dot + 1).toLowerCase();
    }
  }
  // fallback: 文件名无可用后缀 (Makefile / Dockerfile / .env / report.) 时
  // 才用 extension
  const ext = (extension || "").toLowerCase();
  if (ext) return ext;
  return "";
}

interface FileUrlSource {
  url?: string;
  remoteUrl?: string;
}

// 解析文件内容块的可用下载 URL: 拼接 baseURL + 相对路径绝对化 + 安全校验。
// 任一环节失败返回 ""，方便调用方一次性判断。生产环境 apiURL 是 /api/v1/，
// 直接喂给 isSafeUrl 会被 new URL() 拒掉，必须先绝对化。
export function resolveSafeFileUrl(content: FileUrlSource): string {
  const rawUrl = content.url || content.remoteUrl || "";
  if (!rawUrl) return "";
  let fileUrl = WKApp.dataSource.commonDataSource.getFileURL(rawUrl);
  if (!fileUrl) return "";
  if (!fileUrl.startsWith("http")) {
    fileUrl = window.location.origin + "/" + fileUrl.replace(/^\//, "");
  }
  return isSafeUrl(fileUrl) ? fileUrl : "";
}

function isPreviewable(extension: string, name?: string): boolean {
  const ext = getExtension(extension, name);
  return [
    "pdf",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "bmp",
    "webp",
    "md",
    "txt",
  ].includes(ext);
}

function isTextFile(extension: string, name?: string): boolean {
  const ext = getExtension(extension, name);
  return ["md", "txt"].includes(ext);
}

const SMALL_FILE_THRESHOLD = 1024 * 1024; // 1MB 以下不显示进度条

/** task 自身支持的重试接口（MediaMessageUploadTask 实现） */
interface RestartableTask extends Task {
  restart(): Promise<void>;
}

interface FileCellState {
  uploadProgress: number; // 0~100 整数百分比
  uploadStatus: TaskStatus | null;
  textPreviewVisible: boolean;
  textPreviewContent: string;
  textPreviewName: string;
  textPreviewExt: string;
}

export class FileCell extends MessageCell<any, FileCellState> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  private _task?: RestartableTask;

  private _taskListener = (task: Task) => {
    const { message } = this.props;
    if (task.id !== message.clientMsgNo) return;
    this.setState({
      uploadProgress: task.progress(),
      uploadStatus: task.status,
    });
  };

  constructor(props: any) {
    super(props);
    this.state = {
      uploadProgress: 0,
      uploadStatus: null,
      textPreviewVisible: false,
      textPreviewContent: "",
      textPreviewName: "",
      textPreviewExt: "",
    };
  }

  componentDidMount() {
    super.componentDidMount();
    const { message } = this.props;
    const content = message.content as FileContent;
    // 小文件不显示进度，跳过订阅
    if (content.size >= SMALL_FILE_THRESHOLD) {
      // taskManager 通过 addListener 订阅；初始 task 状态通过首次回调获取
      WKSDK.shared().taskManager.addListener(this._taskListener);
      // 存 task 引用供重试使用（addTask 时 task 已调 start，此处仅读取）
      const allListeners = (WKSDK.shared().taskManager as any).taskMap as
        | Map<string, Task>
        | undefined;
      const found = allListeners?.get(message.clientMsgNo) as
        | RestartableTask
        | undefined;
      if (found) {
        this._task = found;
        this.setState({
          uploadProgress: found.progress(),
          uploadStatus: found.status,
        });
      }
    }
  }

  componentWillUnmount() {
    super.componentWillUnmount();
    WKSDK.shared().taskManager.removeListener(this._taskListener);
  }

  getFileURL(content: FileContent): string {
    const rawUrl = content.url || content.remoteUrl || "";
    if (rawUrl !== "") {
      const fileUrl = WKApp.dataSource.commonDataSource.getFileURL(rawUrl);
      // Ensure we have an absolute URL
      if (fileUrl && !fileUrl.startsWith("http")) {
        return window.location.origin + "/" + fileUrl.replace(/^\//, "");
      }
      return fileUrl;
    }
    return "";
  }

  handleDownload = async () => {
    const { message } = this.props;
    const content = message.content as FileContent;
    const url = this.getFileURL(content);
    if (!url || !isSafeUrl(url)) return;

    await downloadFile(url, content.name || "file");
  };

  handlePreview = () => {
    const { message } = this.props;
    const content = message.content as FileContent;

    const url = this.getFileURL(content);

    if (!url || !isSafeUrl(url)) {
      return;
    }

    const ext = getExtension(content.extension, content.name);

    // 所有文件都发送预览事件，由面板决定如何渲染（支持的显示内容，不支持的显示提示）
    const previewData = {
      url,
      name: content.name || this.context.t("base.messageFile.unknownFile"),
      extension: ext,
      size: content.size,
      // 携带来源频道信息（用于判断是否在子区面板内触发）
      sourceChannelId: message.channel.channelID,
      sourceChannelType: message.channel.channelType,
      // 消息 ID（用于标记激活态）
      messageId: message.messageID,
      // 回复功能所需字段
      messageSeq: message.messageSeq,
      fromUID: message.fromUID,
      conversationDigest: message.content.conversationDigest,
    };
    WKApp.mittBus.emit("wk:file-preview", previewData);
  };

  handleTextPreview = async (url: string, name: string, extension: string) => {
    const TEXT_PREVIEW_LIMIT = 5 * 1024 * 1024; // 5MB
    try {
      const response = await fetch(url);
      if (!response.ok) {
        Toast.error(this.context.t("base.messageFile.previewFailed"));
        return;
      }
      const contentLength = parseInt(
        response.headers.get("Content-Length") || "0",
        10
      );
      if (contentLength > TEXT_PREVIEW_LIMIT) {
        alert("File too large to preview");
        return;
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > TEXT_PREVIEW_LIMIT) {
        alert("File too large to preview");
        return;
      }
      const text = new TextDecoder("utf-8").decode(buffer);
      this.setState({
        textPreviewVisible: true,
        textPreviewContent: text,
        textPreviewName: name,
        textPreviewExt: extension.toLowerCase(),
      });
    } catch {
      Toast.error(this.context.t("base.messageFile.previewFailed"));
    }
  };

  render() {
    const { message, context } = this.props;
    const content = message.content as FileContent;
    const { t } = this.context;
    const iconInfo = getFileIconInfo(content.extension, content.name);
    const canPreview = isPreviewable(content.extension, content.name);
    const { uploadProgress, uploadStatus } = this.state;

    const isUploading =
      content.size >= SMALL_FILE_THRESHOLD &&
      uploadStatus !== null &&
      uploadStatus !== TaskStatus.success &&
      uploadStatus !== TaskStatus.fail &&
      uploadStatus !== TaskStatus.cancel;

    const isFailed =
      content.size >= SMALL_FILE_THRESHOLD && uploadStatus === TaskStatus.fail;

    // 上传中：显示进度条
    if (isUploading) {
      const pct = Math.round(uploadProgress);
      return (
        <MessageBase context={context} message={message}>
          <div className="wk-message-file wk-message-file--uploading">
            <div className="wk-message-file-icon">
              <FileTypeIcon extension={content.extension} name={content.name} />
            </div>
            <div className="wk-message-file-info">
              <div className="wk-message-file-name" title={content.name}>
                {content.name || t("base.messageFile.uploading")}
              </div>
              <div className="wk-message-file-progress-bar">
                <div
                  className="wk-message-file-progress-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="wk-message-file-progress-text">{pct}%</div>
            </div>
          </div>
        </MessageBase>
      );
    }

    // 上传失败：显示失败提示 + 重试按钮
    if (isFailed) {
      return (
        <MessageBase context={context} message={message}>
          <div className="wk-message-file wk-message-file--failed">
            <div className="wk-message-file-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <rect width="40" height="40" rx="8" fill="#FEE2E2" />
                <path
                  d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                  fill="#EF4444"
                  transform="translate(8,8) scale(0.9)"
                />
                <line
                  x1="20"
                  y1="18"
                  x2="20"
                  y2="23"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <line
                  x1="20"
                  y1="27"
                  x2="20.01"
                  y2="27"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="wk-message-file-info">
              <div className="wk-message-file-name" title={content.name}>
                {content.name || t("base.messageFile.uploadFailed")}
              </div>
              <div className="wk-message-file-meta">
                <span className="wk-message-file-failed-text">{t("base.messageFile.uploadFailed")}</span>
              </div>
              <div className="wk-message-file-retry-hint">{t("base.messageFile.retryHint")}</div>
            </div>
            <div className="wk-message-file-actions">
              <div
                className="wk-message-file-action"
                title={t("base.messageFile.retry")}
                onClick={() => {
                  if (!this._task) {
                    Toast.warning(t("base.messageFile.uploadTaskExpired"));
                    return;
                  }
                  this._task.restart();
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 .49-3.5" />
                </svg>
              </div>
            </div>
          </div>
        </MessageBase>
      );
    }

    const uiProps = getFileMessageUI(message);
    const selectionMode = context.editOn();
    const selectable = isMessageSelectable(message);
    // 检查是否为当前正在预览的文件
    const isActive =
      context.getActivePreviewMessageId?.() === message.messageID;

    return (
      <>
        <MessageRow
          {...uiProps.row}
          onContextMenu={(event) => context.showContextMenus(message, event)}
          isActive={context.isContextMenuOpen(message.message)}
          selectionMode={selectionMode}
          showCheckbox={selectionMode && selectable}
          isSelected={selectable && !!message.checked}
          onSelect={selectable
            ? (selected) => context.checkeMessage(message.message, selected)
            : undefined
          }
          onAvatarClick={(e) => context.onTapAvatar(message.fromUID, e)}
          onSenderNameClick={() => context.showUser(message.fromUID)}
        >
          <div>
            <div
              className={`wk-message-file wk-message-file--clickable${
                isActive ? " wk-message-file--active" : ""
              }`}
              onClick={this.handlePreview}
              title={t("base.messageFile.preview")}
            >
              <div className="wk-message-file-icon">
                <FileTypeIcon
                  extension={content.extension}
                  name={content.name}
                />
              </div>
              <div className="wk-message-file-info">
                <div className="wk-message-file-name" title={content.name}>
                  {content.name || t("base.messageFile.unknownFile")}
                </div>
                <div className="wk-message-file-meta">
                  <span className="wk-message-file-size">
                    {formatFileSize(content.size)}
                  </span>
                  {content.extension && (
                    <span className="wk-message-file-ext">
                      {content.extension.toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
              <div className="wk-message-file-actions">
                <div
                  className="wk-message-file-action"
                  title={t("base.conversation.file.download")}
                  onClick={(e) => {
                    e.stopPropagation(); // 阻止冒泡，避免触发预览
                    this.handleDownload();
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </div>
              </div>
            </div>
            {content.caption && (
              <div className="wk-message-file-caption">{content.caption}</div>
            )}
          </div>
        </MessageRow>
        <WKModal
          className="wk-base-modal"
          visible={this.state.textPreviewVisible}
          title={this.state.textPreviewName}
          size="lg"
          onCancel={() => this.setState({ textPreviewVisible: false })}
        >
          <div className="wk-text-file-preview">
            {this.state.textPreviewExt === "md" ? (
              <MarkdownContent content={this.state.textPreviewContent} />
            ) : (
              <pre className="wk-text-file-preview-plain">
                {this.state.textPreviewContent}
              </pre>
            )}
          </div>
        </WKModal>
      </>
    );
  }
}
