import React from "react";
import "./index.css";
import { MessageCell } from "../MessageCell";
import MessageBase from "../Base";
import WKApp from "../../App";
import { FileContent } from "./FileContent";
import { downloadFile } from "../../Utils/download";
import { WKSDK, Task, TaskStatus, MessageStatus } from "wukongimjssdk";
import { Toast, Tooltip } from "@douyinfe/semi-ui";
import WKModal from "../../Components/WKModal";
import MarkdownContent from "../Text/MarkdownContent";
import MessageRow from "../../ui/message/MessageRow";
import { getFileMessageUI } from "../../bridge/message/useFileMessageUI";
import { isMessageSelectable } from "../../Service/messageSelection";
import { isSafeUrl } from "../../Utils/security";
import { isDriveTransferSupportedChannel } from "../../Service/SpacePrefix";
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
  /** 该 IM 文件是否已存进云盘。undefined = 未查过/查询中。挂载时批量查一次。 */
  imTransferred?: { exists: boolean; file_id?: number; space_id?: string; parent_id?: number };
}

export class FileCell extends MessageCell<any, FileCellState> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  private _task?: RestartableTask;
  private _mounted = false;
  private _unsubscribeConfig?: () => void;
  private _checkInFlight = false;

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
    this._mounted = true;
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

    // 挂载时查询转存状态：多条消息在钩子层微批合并成一次批量请求。
    // 群/子区/私聊统一支持（源码 source_key 已带 channelType 区分）。
    // 自己刚发出的消息在收到 send-ack 前 messageID 为空 / status===Wait
    // (vm.ts:updateMessageStatusBySendAck 才写入 server messageID)——此时
    // 服务端还没这条消息，跳过查询避免 empty-msg_id 污染 batch 请求。
    // ack 后 componentDidUpdate 会补一次查询。
    this.runTransferredCheck();

    // drive_on 是异步 appconfig 拉下来的：conversation 打开时可能还没到位，
    // 此刻 runTransferredCheck 会因 !remoteConfig.driveOn 短路。订阅 config
    // 变更让 mount 后 driveOn 翻转的那一刻触发一次 forceUpdate → componentDidUpdate
    // 会看到 imTransferred===undefined 补查询。#1261 review round 6 spec req 3.
    //
    // 正确 API 路径是 WKApp.remoteConfig.addConfigChangeListener (类 WKRemoteConfig
    // 的 instance 方法，见 App.tsx:389)；WKApp 本身没有这个静态方法。round 7 P0-1
    // 抓到过一次 `WKApp.addConfigChangeListener is not a function`。
    this._unsubscribeConfig = WKApp.remoteConfig.addConfigChangeListener(() => {
      if (this._mounted) this.forceUpdate();
    });
  }

  componentDidUpdate() {
    // 处理两种"迟到"场景（reviewer 抓的 P1-2 + spec req 3）：
    //   a) 自己刚发的文件 mount 时 messageID 为空，跳过了查询；ack 落地后需要补一次
    //   b) drive_on 是异步 appconfig 拉下来的，mount 时 remoteConfig?.driveOn=false
    //      导致 runTransferredCheck 内部短路了；appconfig 到位后需要补一次
    // 早先版本用 prevProps 对比状态位来触发，但 vm.ts:updateMessageStatusBySendAck
    // 是 **in-place mutate 同一 MessageWrap 对象**（clientMsgNo 作 React key、
    // 引用不换），prevProps.message === this.props.message，所以对比 messageID/status
    // 永远拿不到"从空到有"的过渡。改成用 state 判定：只要 imTransferred 还是
    // undefined（= 查询没成功产生结果），每次 update 都试一次；runTransferredCheck
    // 自带 isMessagePersisted + driveOn 短路，重复调用是安全的（微批合并 + 同一
    // sourceKey dedupe waiters）。
    if (this.state.imTransferred === undefined) {
      this.runTransferredCheck();
    }
  }

  // isMessagePersisted：消息已被服务端 ack、拥有 server messageID，可作 im_msg_id
  // 参与云盘转存 / 已存查询。发送中(Wait) / 失败(Fail) / 无 messageID 时为 false。
  private isMessagePersisted(): boolean {
    const { message } = this.props;
    return Boolean(message.messageID) && message.status === MessageStatus.Normal;
  }

  private runTransferredCheck(): void {
    // In-flight guard：多次 render 都可能进 componentDidUpdate 触发这里；
    // 若前一次查询还在飞就跳过，避免每 re-render 都开一次新 batch，也避免
    // backend unhealthy 时无 backoff 地无限重试（#1261 review round 7 P1-1）。
    if (this._checkInFlight) return;
    if (!this.isMessagePersisted()) return;
    const { message } = this.props;
    // 只在支持的 channelType 上查询——防止 CustomerService 等未支持类型
    // 白发一次 backend 请求命中 404，且与图标 gate 一致（图标不显示时也
    // 不该查）。#1261 review round 6 P1-3.
    if (!isDriveTransferSupportedChannel(message.channel.channelType)) return;
    const check = WKApp.checkDriveTransferred;
    if (!check || !WKApp.remoteConfig?.driveOn) return;

    this._checkInFlight = true;
    check({
      im_group_no: message.channel.channelID,
      im_channel_type: message.channel.channelType,
      im_msg_id: message.messageID,
    })
      .then((entry) => {
        if (!this._mounted) return;
        // 竞态守卫：转存/更早的查询若已把状态设为"已存"，不要被这次
        // mount 时的 in-flight 查询覆盖回未存态。
        if (this.state.imTransferred?.exists === true) return;
        this.setState({
          imTransferred: entry
            ? {
                exists: true,
                file_id: entry.file_id,
                space_id: entry.space_id,
                parent_id: entry.parent_id,
              }
            : { exists: false },
        });
      })
      .catch(() => {
        // 失败也置终止态：componentDidUpdate 通过 `imTransferred===undefined`
        // 判定要不要重跑，若保持 undefined 会每 re-render 都重试、放大后端
        // unhealthy 下的抖动。置 `{ exists: false }` 视觉上按"未存"渲染，
        // 与 backend 明确返回未存等价；#1261 review round 7 P1-1.
        if (!this._mounted) return;
        if (this.state.imTransferred?.exists === true) return;
        this.setState({ imTransferred: { exists: false } });
      })
      .finally(() => {
        this._checkInFlight = false;
      });
  }

  componentWillUnmount() {
    super.componentWillUnmount();
    this._mounted = false;
    WKSDK.shared().taskManager.removeListener(this._taskListener);
    if (this._unsubscribeConfig) {
      this._unsubscribeConfig();
      this._unsubscribeConfig = undefined;
    }
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

  handleSaveToDrive = async () => {
    const { message } = this.props;
    const { t } = this.context;
    const content = message.content as FileContent;
    // 防御式：本 handler 只能在 icon gate 已放行时被调（icon 会在
    // isMessagePersisted 为 false 时拦截 onClick），这里再检查一次防止
    // 未来被别的入口误调（例如 keyboard trigger / a11y 路径）导致把空
    // im_msg_id 传给后端。
    if (!this.isMessagePersisted()) return;
    // 已存过 → 直接在云盘中查看，不再转存。查看只依赖 file_id + space_id，
    // 与文件 URL 无关，所以放在 URL 安全校验之前——避免 URL 畸形时把
    // 已转存文件的"在云盘查看"也误拦掉。本期定位到空间根目录。
    const known = this.state.imTransferred;
    if (known?.exists && known.file_id && known.space_id) {
      WKApp.openDriveFile?.({
        space_id: known.space_id,
        file_id: known.file_id,
      });
      return;
    }
    // 未存 → 需要转存，此时才校验 URL（转存依赖消息附件）。
    const url = this.getFileURL(content);
    if (!url || !isSafeUrl(url)) {
      Toast.error(t("base.messageFile.saveToDriveFailed"));
      return;
    }
    const save = WKApp.saveMessageToDrive;
    if (!save) return;
    try {
      const result = await save({
        im_group_no: message.channel.channelID,
        im_channel_type: message.channel.channelType,
        im_msg_id: message.messageID,
      });
      // 转存成功：立即把状态切到"已存"，下次点击/hover 直接走查看分支。
      this.setState({
        imTransferred: {
          exists: true,
          file_id: result.file_id,
          space_id: result.space_id,
          parent_id: result.parent_id,
        },
      });
      Toast.success(t("base.messageFile.saveToDriveSuccess"));
    } catch {
      Toast.error(t("base.messageFile.saveToDriveFailed"));
    }
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
                  width="16"
                  height="16"
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
                <div className="wk-message-file-meta-row">
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
                  <div className="wk-message-file-actions">
                    {WKApp.saveMessageToDrive && WKApp.remoteConfig?.driveOn && isDriveTransferSupportedChannel(message.channel.channelType) && (
                      <Tooltip
                        content={
                          !this.isMessagePersisted()
                            ? t("base.messageFile.saveToDrivePendingAck")
                            : this.state.imTransferred?.exists
                              ? t("base.messageFile.viewInDrive")
                              : t("base.messageFile.saveToDrive")
                        }
                        position="top"
                      >
                        <div
                          className="wk-message-file-action"
                          aria-label={
                            !this.isMessagePersisted()
                              ? t("base.messageFile.saveToDrivePendingAck")
                              : this.state.imTransferred?.exists
                                ? t("base.messageFile.viewInDrive")
                                : t("base.messageFile.saveToDrive")
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            // 未 ack / 无 server messageID：静默拦截点击，避免把
                            // 空 im_msg_id 传给后端(#1261 review round 3 flagged case)。
                            // 视觉上与下载按钮口径一致（始终高亮、运行时静默返回），
                            // hover tooltip 提示原因。
                            if (!this.isMessagePersisted()) return;
                            this.handleSaveToDrive();
                          }}
                        >
                          {this.state.imTransferred?.exists ? (
                            <svg
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
                              <polyline points="9 12 11 14 15 10" />
                            </svg>
                          ) : (
                            <svg
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
                              <polyline points="16 16 12 12 8 16" />
                              <line x1="12" y1="12" x2="12" y2="21" />
                            </svg>
                          )}
                        </div>
                      </Tooltip>
                    )}
                    <Tooltip content={t("base.conversation.file.download")} position="top">
                      <div
                        className="wk-message-file-action"
                        aria-label={t("base.conversation.file.download")}
                        onClick={(e) => {
                          e.stopPropagation(); // 阻止冒泡，避免触发预览
                          this.handleDownload();
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
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
                    </Tooltip>
                  </div>
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
