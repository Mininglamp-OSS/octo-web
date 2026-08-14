import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { X } from "lucide-react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import TiptapMention from "@tiptap/extension-mention";
import { createMentionSuggestion } from "../adapters/tiptap/mentionSuggestion";
import { createEmojiSuggestionExtension } from "../adapters/tiptap/emojiSuggestion";
import clazz from "classnames";
import {
  MemberInfo,
  buildMemberInfos,
  buildMentionRegex,
  parseMentionMarkers,
} from "../adapters/tiptap/mentionResolve";
import "./ChatComposer.css";
import { Notification } from "@douyinfe/semi-ui";
import SlashCommandMenu, { BotCommand } from "../../../Components/SlashCommandMenu";
import VoiceInputIndicator from "./voice/VoiceInputIndicator";
import { Maximize2, Minimize2 } from "lucide-react";
import IconClick from "../../../Components/IconClick";
import mentionAllIcon from "./assets/mention.png";
import {
  AttachmentNode,
  AttachmentAttributes,
  getFileIcon,
  formatFileSize,
  videoPlayIcon,
} from "../adapters/tiptap/AttachmentNode";
import { t as translate, useI18n } from "../../../i18n";
import {
  announceContextAfterSendReady,
  invokeReadySend,
  restoreComposeSnapshot,
} from "../application/sendFlow";
import { ChatComposerController } from "../application/ChatComposerController";
import { ChatComposerCoordinator } from "../application/ChatComposerCoordinator";
import type {
  AttachmentFile,
  ChatMention,
  ChatComposerSendResult,
  ChatSendOutcome,
  ChatSendRequest,
  ChatSendSettlement,
  EditorContentBlock,
  PendingSendDraft,
  SendDraftSnapshot,
  SendTargetSnapshot,
  UnsentEditorBlock,
} from "../domain";
import { rejectChatComposerSend } from "../domain";
import {
  ChatComposerAttachmentStore,
  type EditorComposePart,
  type EditorComposePartRegistry,
} from "../editor";
import {
  type ComposeRecoveryRecord,
  type RecoveredComposeHydration,
} from "../recovery";
import {
  type ChatPendingAttachmentPreview,
  type ChatPendingComposeItem,
} from "./chatPendingComposeRenderRegistry";
import {
  createDefaultChatComposerExtensions,
  type DefaultChatComposerExtensions,
} from "./createDefaultChatComposerExtensions";
export type {
  AttachmentFile,
  EditorContentBlock,
} from "../domain";
import {
  consumeCompose,
  buildComposeRecoveryDocument,
  ComposeDoc,
  ComposeRestoreUnavailableError,
  type ConsumedComposeRecovery,
  type TopAttachmentLike,
} from "../application/composeConsume";
import {
  imageBlockToPasteFile,
  restoreOctoRichTextClipboardToEditor,
} from "../clipboard/richTextPaste";
import {
  decideComposerPaste,
  snapshotComposerClipboard,
  type ComposerPasteDecision,
} from "../clipboard/clipboardPipeline";
import { createComposerStarterKit } from "../adapters/tiptap/editorKit";
import {
  getRestoredBlockMarkerIds,
  markRestoredBlocks,
  RestorePrefixTracker,
} from "../adapters/tiptap/restorePrefixTracker";
import { decideComposerKeyboard } from "../keyboard";
import type {
  ChatComposerMember,
  ChatComposerViewHost,
  ChatComposerVoiceContext,
} from "../ports";

import { MAX_MESSAGE_LENGTH } from "../domain/constants";

// placeholder 格式化所需的平台快捷键标识（模块级常量，避免重复计算）
const ALT_KEY = /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌥' : 'Alt';

/** 根据频道类型和名称生成 placeholder 文本 */
function buildPlaceholder(isDirect: boolean, name: string, t: typeof translate): string {
  if (isDirect) {
    return name
      ? t("base.messageInput.placeholder.directWithName", { values: { name } })
      : t("base.messageInput.placeholder.direct");
  } else {
    return name
      ? t("base.messageInput.placeholder.replyWithName", { values: { name, shortcut: ALT_KEY } })
      : t("base.messageInput.placeholder.reply", { values: { shortcut: ALT_KEY } });
  }
}

// 从编辑器中提取附件节点（纯函数，避免闭包问题）
function extractAttachmentsFromEditor(
  editorInstance: any
): AttachmentAttributes[] {
  if (!editorInstance) return [];
  const json = editorInstance.getJSON();
  const attachments: AttachmentAttributes[] = [];

  function traverse(node: any) {
    if (node.type === "attachment" && node.attrs) {
      attachments.push(node.attrs as AttachmentAttributes);
    }
    if (node.content) {
      node.content.forEach(traverse);
    }
  }

  traverse(json);
  return attachments;
}

/**
 * 编辑器内容块类型：文本段落或粘贴图片/文件。
 * 用于按顺序发送编辑器中穿插的文本和媒体。
 */
const TIPTAP_BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'blockquote', 'codeBlock',
  'orderedList', 'bulletList', 'listItem',
  'table', 'tableRow', 'tableCell', 'tableHeader',
  'horizontalRule',
]);

function escapeTrailingMarkdownImageBang(text: string): string {
  if (!text.endsWith("!")) return text;

  let precedingBackslashes = 0;
  for (let index = text.length - 2; index >= 0; index -= 1) {
    if (text[index] !== "\\") break;
    precedingBackslashes += 1;
  }
  return precedingBackslashes % 2 === 0
    ? `${text.slice(0, -1)}\\!`
    : text;
}

function extractOrderedBlocks(
  editorInstance: any,
  attachmentFilesMap: Map<string, File>,
  members: readonly ChatComposerMember[] | undefined,
  composePartRegistry: EditorComposePartRegistry,
): {
  blocks: EditorContentBlock[];
  snapshot: ComposeDoc;
  editorParts: EditorComposePart[];
} {
  const json = editorInstance.getJSON() as ComposeDoc;
  if (!json.content) return { blocks: [], snapshot: json, editorParts: [] };

  const composePartContext = { attachmentFiles: attachmentFilesMap };
  const capturedParts = composePartRegistry.capture(
    json,
    composePartContext,
  );
  capturedParts.forEach((part) =>
    composePartRegistry.assertSettlementSupported(part),
  );
  const capturedPartByNode = new Map(
    capturedParts.map((part) => [composePartRegistry.sourceNode(part), part]),
  );

  const blocks: EditorContentBlock[] = [];
  let pendingTextParts: string[] = [];

  function flushText() {
    const joined = stripInvisibleChars(pendingTextParts.join(""));
    if (joined.trim() !== "") {
      const { content, mention } = formatMentionTextV2(joined, members);
      blocks.push({ type: "text", text: content, restoreText: joined, mention });
    }
    pendingTextParts = [];
  }

  function processNode(node: any): void {
    const part = capturedPartByNode.get(node);
    if (part) {
      flushText();
      blocks.push(composePartRegistry.toSendBlock(part));
      return;
    }

    if (node.type === "text") {
      const serialized = serializeEditorTextNodeForSend(node);
      if (serialized.startsWith("[") && pendingTextParts.length > 0) {
        const previousIndex = pendingTextParts.length - 1;
        pendingTextParts[previousIndex] = escapeTrailingMarkdownImageBang(
          pendingTextParts[previousIndex],
        );
      }
      pendingTextParts.push(serialized);
      return;
    }
    if (node.type === "mention") {
      // send path: tag node-origin broadcast sentinels as trusted
      pendingTextParts.push(
        serializeMentionMarker(node.attrs.id, node.attrs.label, true)
      );
      return;
    }
    if (node.type === "hardBreak") {
      pendingTextParts.push("\n");
      return;
    }

    if (node.content) {
      for (let i = 0; i < node.content.length; i++) {
        const child = node.content[i];
        if (i > 0 && TIPTAP_BLOCK_TYPES.has(child.type)) {
          pendingTextParts.push("\n");
        }
        processNode(child);
      }
    }
  }

  for (let blockIdx = 0; blockIdx < json.content.length; blockIdx++) {
    if (blockIdx > 0) {
      pendingTextParts.push("\n");
    }
    processNode(json.content[blockIdx]);
  }

  flushText();

  return {
    blocks,
    snapshot: json,
    editorParts: capturedParts,
  };
}

// Strip zero-width and invisible Unicode characters
const INVISIBLE_CHARS_RE =
  /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD\u2060\u2061\u2062\u2063\u2064\u034F\u061C\u180E]/g;
function stripInvisibleChars(text: string): string {
  return text.replace(INVISIBLE_CHARS_RE, "");
}

/**
 * 防手滑提示（YUJ-3539）：粘贴到聊天框的明文疑似 API 密钥时弹一条引导通知，
 * 提供「去保存」动作 → 打开密钥管理新增弹窗并本地预填该明文（不发送）。
 *
 * 注意：detectedValue 是用户自己刚粘贴的明文，只在本机本地预填，不经任何网络/聊天流。
 */
function notifySecretPaste(
  detectedValue: string,
  openSecretCreate: (value: string) => void,
): void {
  Notification.warning({
    className: "wk-octo-notification",
    title: <span className="wk-octo-notification__title">{translate("base.secrets.pasteGuard.title")}</span>,
    content: <span className="wk-octo-notification__body">{translate("base.secrets.pasteGuard.content")}</span>,
    duration: 8,
    showClose: true,
    onClick: () => openSecretCreate(detectedValue),
  });
}


export interface ChatComposerProps {
  host: ChatComposerViewHost;
  /** Instance-scoped extensions selected once when this composer mounts. */
  extensions?: DefaultChatComposerExtensions<any>;
  /**
   * 发送回调接收同步捕获的完整 request，并返回显式 outcome。outcome 精确声明
   * editor、顶部附件、编辑器块和 reply/edit target 哪些保持消费、哪些需要恢复。
   *
   * `editorConsumed` 表示消息已入队并出现在消息列表，不表示服务端已 ack。
   * 已入队但 ack 失败/超时的消息仍保持消费，由消息气泡提供失败与重发状态。
   *
   * compose 在 send 开始时就被同步消费（清空编辑器 + 移除本次顶部附件），失败
   * 才还原，所以 await 期间用户新输入的草稿不会被旧 send 干扰。
   */
  onSend?: (
    request: ChatSendRequest<any>,
  ) => ChatSendOutcome | Promise<ChatSendOutcome>;
  /**
   * 同步取走并清除 reply/edit 目标（横幅同时收起），返回的快照会被透传给
   * onSend；发送未入队时 MessageInput 调 `restore()` 复位 (octo-web#1280)。
   */
  onCaptureSendTarget?: () => SendTargetSnapshot | undefined;
  /** Capture draft state before this send enters the serial queue. */
  onCaptureSendDraft?: () => Omit<SendDraftSnapshot, "draftText">;
  /** Runs after editor/attachment settlement and before the attempt is released. */
  onSendSettled?: (
    settlement: ChatSendSettlement,
  ) => void | Promise<void>;
  /** Preserve a consumed compose when its original editor was destroyed. */
  onComposeRecovery?: (recovery: ComposeRecoveryRecord) => boolean;
  /** Recover consumed composes transferred from an earlier editor instance. */
  recoveredComposes?: ComposeRecoveryRecord[];
  onRecoveredComposes?: (hydration: RecoveredComposeHydration) => void;
  onRestoreRecoveredTarget?: (target: {
    replyMessage?: unknown;
    handlerType: number;
  }) => void;
  members?: Array<ChatComposerMember>;
  onInputRef?: any;
  onAddAttachment?: (
    fnc: (files: File[], source?: "paste" | "upload") => void | Promise<void>
  ) => void;
  onAddPendingAttachments?: (
    files: File[],
    source?: "paste" | "upload"
  ) => boolean | Promise<boolean>;
  hideMention?: boolean;
  toolbar?: JSX.Element;
  /** Extra action nodes rendered inside the actionbox, before voice input */
  extraActions?: React.ReactNode;
  onContext?: (ctx: MessageInputContext) => void;
  topView?: JSX.Element;
  botCommands?: BotCommand[];
  getChatContext?: () => ChatComposerVoiceContext | Promise<ChatComposerVoiceContext>;
  onExpandChange?: (expanded: boolean) => void;
  /** Called when Alt+Enter is pressed in the editor */
  onAltEnter?: () => void;
}



export interface MentionEntity {
  uid: string;
  offset: number;
  length: number;
}

export class MentionModel implements ChatMention {
  all: boolean = false;
  uids?: Array<string>;
  entities?: MentionEntity[];
  /**
   * Three-state mention flags. Sent to server alongside literal "@所有人" / "@所有AI"
   * text. Server normalizes legacy `all=1` into `humans=1` outbound, so renderers
   * may see either field set; both must be honored.
   *
   * - humans: 1 → "@所有人" should be highlighted on receivers
   * - ais:    1 → "@所有AI"  should be highlighted on receivers
   *
   * Stored as 0|1 to match the wire protocol (RFC: mention-three-state v1).
   */
  humans?: number;
  ais?: number;
}

// Sentinel uids used by the @-dropdown sticky top items + voice transcription.
// `-1` is the legacy "@所有人" (all=1). `-2` / `-3` are the new three-state items.
// The canonical definitions live in Utils/mentionRender so the shared
// dropdown helper (`buildMentionDropdownItems`) and unit tests can reuse
// them without an import cycle through this large editor module.
import {
  buildMentionDropdownItems,
} from "../../../Utils/mentionRender";
import {
  parseSendMentionText,
  serializeEditorTextNodeForSend,
  serializeMentionMarker,
  stripTrustMark,
  parseDraftToContent,
  parseConsumedTextToContent,
} from "../adapters/tiptap/mentionSendParse";
import type { SendParseMember } from "../adapters/tiptap/mentionSendParse";

// 解析 @[uid:name] 格式的 mention（send 边界）。安全核心在纯函数 parseSendMentionText：
// 仅当广播 sentinel 携带 node-origin 信任标记时才路由广播，伪造的字面文本降级为纯文本。
function formatMentionTextV2(
  text: string,
  subscribers: readonly ChatComposerMember[] | undefined,
): {
  content: string;
  mention?: MentionModel;
} {
  const members = (subscribers ?? []) as unknown as SendParseMember[];
  const parsed = parseSendMentionText(text, members);
  if (!parsed.mention) return { content: parsed.content };

  const p = parsed.mention;
  const mention = new MentionModel();
  mention.all = p.all;
  mention.uids = p.uids.length > 0 ? p.uids : undefined;
  mention.entities = p.entities.length > 0 ? p.entities : undefined;
  if (p.humans) mention.humans = 1;
  if (p.ais) mention.ais = 1;
  return { content: parsed.content, mention };
}

export interface MessageInputContext {
  insertText: (text: string) => void;
  /** Insert structured Tiptap inline content at the current composer end. */
  insertContent: (content: JSONContent | JSONContent[]) => void;
  /** Restore draft content (replaces editor content, parses @[uid:label] to mention nodes) */
  restoreDraft: (text: string) => void;
  addMention: (uid: string, name: string) => void;
  addAttachment: (
    files: File[],
    source?: "paste" | "upload"
  ) => void | Promise<void>;
  getAttachmentFiles: () => File[];
  text: () => string | undefined;
  focus: () => void;
  /**
   * Programmatically trigger send (same as pressing Enter).
   *
   * Returns the underlying send promise so an orchestrator (e.g. the Conversation initialCompose
   * consumer) can await completion and inspect the explicit send result. Keyboard/Enter callers
   * ignore the result, so this does not change interactive send behaviour.
   */
  send: () => Promise<ChatComposerSendResult>;
  /** Clear editor content without sending */
  clear: () => void;
  /**
   * Number of composes that were handed to `onSend` and have not settled yet
   * (octo-web#1280).
   *
   * This covers both pre-enqueue and post-enqueue work so draft persistence and
   * the visible pending preview retain each compose until `onSend` settles.
   */
  pendingSendCount: () => number;
  /** Composes that have been consumed but do not have a local bubble yet. */
  pendingPreEnqueueCount: () => number;
  /** Attempt-owned drafts of all unsettled composes, including empty drafts. */
  pendingSendDrafts: () => PendingSendDraft[];
  /** Attempt-owned drafts that have not produced all local bubbles yet. */
  pendingPreEnqueueDrafts: () => PendingSendDraft[];
  /** Plain text of every unsettled compose, newest last. */
  pendingSendText: () => string;
}

// MemberInfo / buildMentionRegex / parseMentionMarkers / buildMemberInfos live
// in the Tiptap mention adapter so the editor and unit tests share one implementation.

// `trusted` is set on the send path so node-origin broadcast sentinels are
// tagged with MENTION_TRUST_MARK (text-origin grammar is neutralized). The
// draft/read path (`text()`) leaves it false → canonical, mark-free markers
// that round-trip back into mention nodes on restore (octo-web#330).
function extractMentionsFromEditor(editor: any, trusted = false): string {
  const json = editor.getJSON();
  let result = "";

  function traverse(node: any) {
    if (node.type === "text") {
      const serialized = trusted
        ? serializeEditorTextNodeForSend(node)
        : stripTrustMark(node.text || "");
      if (trusted && serialized.startsWith("[")) {
        result = escapeTrailingMarkdownImageBang(result);
      }
      result += serialized;
    } else if (node.type === "mention") {
      result += serializeMentionMarker(node.attrs.id, node.attrs.label, trusted);
    } else if (node.type === "hardBreak") {
      result += "\n";
    } else if (node.content) {
      node.content.forEach((child: any, idx: number) => {
        if (idx > 0 && TIPTAP_BLOCK_TYPES.has(child.type)) {
          result += "\n";
        }
        traverse(child);
      });
    }
  }

  if (json.content) {
    json.content.forEach((block: any, i: number) => {
      if (i > 0) result += "\n";
      traverse(block);
    });
  }

  return stripInvisibleChars(result);
}

// 顶部附件区的附件项接口
interface TopAttachmentItem {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  previewUrl?: string;
}

type PendingSendAttachmentPreview = ChatPendingAttachmentPreview;
type PendingSendItem = ChatPendingComposeItem;

// 判断是否为图片类型（模块级别函数）
function isImageFileType(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext);
}

// 判断是否为视频类型（模块级别函数）
function isVideoFileType(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return ["mp4", "avi", "mov", "mkv", "webm"].includes(ext);
}

let attachmentIdSequence = 0;

function createAttachmentId(file: File): string {
  attachmentIdSequence += 1;
  return `${file.name}-${file.size}-${
    file.lastModified
  }-${Date.now()}-${attachmentIdSequence}`;
}

const ChatComposer: React.FC<ChatComposerProps> = (props) => {
  const { t } = useI18n();
  const hostRef = useRef(props.host);
  hostRef.current = props.host;
  const channelSnapshot = props.host.getChannel();
  const [extensions] = useState(() =>
    props.extensions ?? createDefaultChatComposerExtensions(),
  );
  const [slashMenuVisible, setSlashMenuVisible] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [attachmentStore] = useState(
    () => new ChatComposerAttachmentStore<TopAttachmentItem>(),
  );
  const [controller] = useState(
    () => new ChatComposerController<PendingSendAttachmentPreview>(),
  );
  const [coordinator] = useState(
    () =>
      new ChatComposerCoordinator<PendingSendAttachmentPreview>(controller),
  );
  const composerMountedRef = useRef(true);
  const [topAttachments, setTopAttachments] = useState<TopAttachmentItem[]>([]);
  const [pendingPreEnqueueItems, setPendingPreEnqueueItems] = useState<
    PendingSendItem[]
  >([]);

  useEffect(() => {
    composerMountedRef.current = true;
    const unsubscribe = attachmentStore.subscribe((items) => {
      setTopAttachments([...items]);
    });
    return () => {
      composerMountedRef.current = false;
      unsubscribe();
      attachmentStore.clear();
    };
  }, [attachmentStore]);

  useEffect(
    () =>
      controller.subscribe(({ preEnqueue }) => {
        setPendingPreEnqueueItems(preEnqueue);
      }),
    [controller],
  );

  // 动态生成 placeholder（channelInfo 异步加载后通过 listener 自动更新）
  const [placeholder, setPlaceholder] = useState(() => {
    return buildPlaceholder(
      channelSnapshot.isDirect,
      props.host.getChannelTitle() || "",
      t,
    );
  });

  useEffect(() => {
    let aborted = false;
    const channelKey = channelSnapshot.key;

    const updateName = (name: string) => {
      if (aborted) return;
      if (props.host.getChannel().key !== channelKey) return;
      setPlaceholder(buildPlaceholder(channelSnapshot.isDirect, name, t));
    };

    updateName(props.host.getChannelTitle() || "");
    const unsubscribeChannelTitle = props.host.subscribeChannelTitle(updateName);

    return () => {
      aborted = true;
      unsubscribeChannelTitle();
    };
  }, [channelSnapshot.isDirect, channelSnapshot.key, props.host, t]);

  const memberInfos = useMemo<MemberInfo[]>(
    () => buildMemberInfos(props.members),
    [props.members],
  );
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;

  const localMembersRef = useRef(props.members);
  const isDirectChannelRef = useRef(channelSnapshot.isDirect);
  const sendRef = useRef<(() => Promise<ChatComposerSendResult>) | null>(null);
  // 键盘/Enter 是 fire-and-forget 调用：send() 的同步阶段（快照/清空/取 target）
  // 若抛错会变成 unhandled rejection，这里统一兜住并提示 (#1280 review)。
  const fireAndForgetSend = useCallback(() => {
    try {
      const result = sendRef.current?.();
      if (result && typeof result.catch === "function") {
        result.catch((err: unknown) => {
          console.error("[MessageInput] send rejected", err);
        });
      }
    } catch (err) {
      console.error("[MessageInput] send threw synchronously", err);
    }
  }, []);
  const mentionActiveRef = useRef(false);
  // 表情前缀联想下拉激活标志，激活时 Enter 用于选中而非发送
  const emojiSuggestionActiveRef = useRef(false);
  const botCommandsRef = useRef(props.botCommands);
  // editorHandleKeyDownRef 持有最新的键盘处理函数，通过 useEffect 更新
  const editorHandleKeyDownRef = useRef<
    ((view: any, event: KeyboardEvent) => boolean) | null
  >(null);
  const editorHandlePasteRef = useRef<
    ((
      view: any,
      event: ClipboardEvent,
      decision: ComposerPasteDecision,
    ) => boolean) | null
  >(null);
  const pasteLifecycleRef = useRef(0);

  isDirectChannelRef.current = channelSnapshot.isDirect;

  // 更新 membersRef
  useEffect(() => {
    localMembersRef.current = props.members;
  }, [props.members]);

  // 更新 botCommandsRef
  useEffect(() => {
    botCommandsRef.current = props.botCommands;
  }, [props.botCommands]);

  // 创建编辑器
  const editor = useEditor({
    extensions: [
      createComposerStarterKit(),
      RestorePrefixTracker,
      Placeholder.configure({
        placeholder: () => placeholderRef.current,
      }),
      AttachmentNode,
      ...extensions.editor.tiptap,
      TiptapMention.configure({
        HTMLAttributes: {
          class: "mention",
        },
        suggestion: createMentionSuggestion(
          ({ query }) => {
            // 三态 mention 顶部两个固定项：
            //   - @所有人  → mention.humans=1
            //   - @所有AI → mention.ais=1
            // 只在 query 为空时置顶展示；query 非空时隐藏，避免 Enter
            // 错误地把 @Bob 这种 query 选成 sticky @所有人（PR #59 回归）。
            return buildMentionDropdownItems({
              query,
              members: localMembersRef.current,
              iconResolver: (member) =>
                hostRef.current.resolveMemberAvatar(member.uid),
              externalResolver: (member) =>
                hostRef.current.resolveMemberExternal(member),
              stickyIcon: mentionAllIcon,
              includeBroadcastMentions: !isDirectChannelRef.current,
            });
          },
          (active) => {
            mentionActiveRef.current = active;
          },
          {
            onOpened: () => props.host.track("input_mention_opened"),
            onAiSelected: () =>
              props.host.track("input_mention_ai_selected"),
          },
        ),
        renderLabel({ options, node }) {
          return `@${node.attrs.label}`;
        },
      }),
      // 表情前缀联想：输入中文片段（如「使命」）联想出自定义表情 [使命必达]
      createEmojiSuggestionExtension((active) => {
        emojiSuggestionActiveRef.current = active;
      }),
    ],
    content: "",
    editorProps: {
      // ProseMirror 级别的键盘处理，在所有 keymap 之前执行
      handleKeyDown: (_view, event) => {
        return editorHandleKeyDownRef.current?.(_view, event) ?? false;
      },
      handlePaste: (_view, event) => {
        if (!event.clipboardData) return false;
        const decision = decideComposerPaste(
          snapshotComposerClipboard(event.clipboardData),
        );
        if (decision.kind === "block-secret") {
          event.preventDefault();
          notifySecretPaste(decision.value, (value) =>
            hostRef.current.openSecretCreate(value),
          );
          return true;
        }
        return (
          editorHandlePasteRef.current?.(_view, event, decision) ?? false
        );
      },
    },
    onUpdate: ({ editor }) => {
      const text = stripInvisibleChars(editor.getText());

      // 检查 slash 命令
      if (
        botCommandsRef.current &&
        text.startsWith("/") &&
        !text.includes(" ") &&
        !text.includes("\n")
      ) {
        const filter = text.slice(1);
        setSlashMenuVisible(true);
        setSlashFilter(filter);
        setSlashActiveIndex(0);
      } else {
        setSlashMenuVisible(false);
        setSlashFilter("");
        setSlashActiveIndex(0);
      }

      // 检测是否多行（检查是否有换行符或多个段落，或有附件节点，或文本较长）
      const json = editor.getJSON();
      const paragraphs = json.content || [];
      const hasMultipleParagraphs = paragraphs.length > 1;
      const hasNewline = text.includes("\n");
      // 检查编辑器内是否有附件节点
      const hasAttachments = extractAttachmentsFromEditor(editor).length > 0;
      // 文本较长时也需要垂直排列（阈值：超过 50 个字符）
      const isLongText = text.length > 50;
      setIsMultiLine(
        hasMultipleParagraphs || hasNewline || hasAttachments || isLongText
      );
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta("chatComposerPlaceholder", true));
  }, [editor, placeholder]);

  useEffect(() => {
    pasteLifecycleRef.current += 1;
    return () => {
      pasteLifecycleRef.current += 1;
    };
  }, [channelSnapshot.key, editor]);

  // 使用模块级别的函数
  const isImageFile = isImageFileType;
  const isVideoFile = isVideoFileType;

  // 为视频生成封面（截取第一帧）
  const generateVideoCover = (file: File): Promise<string | undefined> => {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;

      const url = URL.createObjectURL(file);
      video.src = url;

      video.onloadeddata = () => {
        // 跳转到第一帧
        video.currentTime = 0;
      };

      video.onseeked = () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const coverUrl = canvas.toDataURL("image/jpeg", 0.8);
          URL.revokeObjectURL(url);
          resolve(coverUrl);
        } else {
          URL.revokeObjectURL(url);
          resolve(undefined);
        }
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(undefined);
      };
    });
  };

  // 插入附件
  // source: 'paste' = 粘贴进来的图片（作为富文本元素混合在文本中）
  // source: 'upload' = 通过上传按钮选择的文件（放在顶部附件区）
  const addAttachment = useCallback(
    async (files: File[], source: "paste" | "upload" = "upload") => {
      for (const file of files) {
        const id = createAttachmentId(file);

        // 判断是否为粘贴的图片（只有粘贴的图片才放入编辑器）
        const isPastedImage = source === "paste" && isImageFile(file);

        if (isPastedImage && editor) {
          // 粘贴的图片：插入到编辑器作为富文本元素
          const previewUrl = URL.createObjectURL(file);
          attachmentStore.addInlineFile(id, file, previewUrl);

          editor
            .chain()
            .focus()
            .insertContent({
              type: "attachment",
              attrs: {
                id,
                name: file.name,
                size: file.size,
                type: file.type,
                previewUrl,
                source: "paste",
              },
            })
            .run();
        } else {
          // 其他所有附件（非图片文件 + 上传的图片）：放入顶部附件区
          let previewUrl: string | undefined;
          if (isImageFile(file)) {
            previewUrl = URL.createObjectURL(file);
          } else if (isVideoFile(file)) {
            previewUrl = await generateVideoCover(file);
          }

          const item: TopAttachmentItem = {
            id,
            file,
            name: file.name,
            size: file.size,
            type: file.type,
            previewUrl,
          };

          attachmentStore.appendTopAttachment(item);
        }
      }

      // 插入附件后切换到多行模式
      setIsMultiLine(true);
    },
    [attachmentStore, editor]
  );

  useEffect(() => {
    editorHandlePasteRef.current = (
      _view: any,
      event: ClipboardEvent,
      decision: ComposerPasteDecision,
    ) => {
      if (!editor) return false;
      if (decision.kind === "default") return false;

      event.preventDefault();

      const addPastedAttachments = props.onAddPendingAttachments || addAttachment;
      if (decision.kind === "files") {
        Promise.resolve(addPastedAttachments(decision.files, "paste")).catch(
          (err) => console.error("[MessageInput] pasted files failed", err),
        );
        return true;
      }

      const beforePasteContent = JSON.stringify(editor.getJSON());
      const pasteLifecycle = pasteLifecycleRef.current;
      const isPasteActive = () =>
        composerMountedRef.current &&
        pasteLifecycleRef.current === pasteLifecycle &&
        !editor.isDestroyed;
      restoreOctoRichTextClipboardToEditor(
        decision.payload,
        editor,
        addPastedAttachments,
        {
          imageBlockToFile: (block) =>
            imageBlockToPasteFile(
              block,
              (url, opts) => hostRef.current.resolveImageUrl(url, opts),
            ),
          // Validate pasted mentions against the live channel roster so a
          // forged clipboard payload cannot inject mentions for non-members
          // or broadcast-routing sentinels (octo-web#330).
          members: buildMemberInfos(localMembersRef.current),
          isActive: isPasteActive,
        }
      ).catch(() => {
        if (
          isPasteActive() &&
          decision.payload.plain &&
          JSON.stringify(editor.getJSON()) === beforePasteContent
        ) {
          editor.commands.insertContent(decision.payload.plain);
        }
      });
      return true;
    };
  }, [addAttachment, editor, props.onAddPendingAttachments]);

  // 移除顶部附件区的附件
  const removeTopAttachment = useCallback((id: string) => {
    attachmentStore.removeTopAttachment(id);
  }, [attachmentStore]);

  // 监听顶部附件区变化，更新多行模式状态
  useEffect(() => {
    if (topAttachments.length > 0) {
      setIsMultiLine(true);
    } else if (editor) {
      // 当顶部附件区清空后，检查编辑器内是否仍需要多行模式
      const text = editor.getText();
      const json = editor.getJSON();
      const paragraphs = json.content || [];
      const hasMultipleParagraphs = paragraphs.length > 1;
      const hasNewline = text.includes("\n");
      const hasEditorAttachments =
        extractAttachmentsFromEditor(editor).length > 0;
      // 文本较长时也需要垂直排列（阈值：超过 50 个字符）
      const isLongText = text.length > 50;
      setIsMultiLine(
        hasMultipleParagraphs ||
          hasNewline ||
          hasEditorAttachments ||
          isLongText
      );
    }
  }, [topAttachments.length, editor]);

  // 导出 addAttachment 方法
  useEffect(() => {
    if (props.onAddAttachment) {
      props.onAddAttachment(addAttachment);
    }
  }, [addAttachment, props.onAddAttachment]);

  // 获取所有附件文件（编辑器内 + 顶部附件区）
  const getAttachmentFiles = useCallback((): File[] => {
    // 编辑器内的附件（粘贴的图片）
    const editorFiles: File[] = editor
      ? extractAttachmentsFromEditor(editor)
          .map((attr) => attachmentStore.attachmentFiles.get(attr.id))
          .filter((f): f is File => f !== undefined)
      : [];

    // 顶部附件区的附件
    const topFiles = attachmentStore
      .snapshotTopAttachments()
      .map((a) => a.file);

    return [...editorFiles, ...topFiles];
  }, [attachmentStore, editor]);

  const insertText = useCallback(
    (text: string) => {
      if (editor) {
        // 原样追加，不解析 @[uid:label]（与 main 行为一致）
        // mention 格式的反序列化仅在 restoreDraft 中处理
        editor.commands.insertContent(text);
        editor.commands.focus();
      }
    },
    [editor]
  );

  // 专用于草稿恢复的方法，会替换整个编辑器内容
  const restoreDraft = useCallback(
    (text: string) => {
      if (editor) {
        // 解析草稿中的 @[uid:label] 格式为 Tiptap 文档结构
        const content = parseDraftToContent(text);
        // 使用 setContent 替换编辑器内容，避免重复插入
        editor.commands.setContent(content);
        editor.commands.focus();
      }
    },
    [editor]
  );

  const restoreRecoveredComposes = useCallback(() => {
    if (!editor || !props.recoveredComposes?.length) return;

    const prepared: Array<{
      item: ComposeRecoveryRecord;
      document: ComposeDoc | undefined;
    }> = [];
    let preparationFailed = false;
    props.recoveredComposes.forEach((item) => {
      try {
        prepared.push({
          item,
          document: buildComposeRecoveryDocument(
            {
              snapshot: item.snapshot,
              editorAttachments: item.editorAttachments,
              topAttachments: item.topAttachments,
            },
            item.editorBlocks,
            (value) =>
              (parseConsumedTextToContent(value).content ?? []) as ComposeDoc["content"] as never,
            extensions.editor.composeParts,
          ),
        });
      } catch (err) {
        preparationFailed = true;
        console.error("[MessageInput] compose recovery hydration failed", err);
      }
    });
    // Recovery ownership is a batch: acknowledging only the valid subset
    // would overwrite the provisional draft while malformed siblings still
    // depend on it.
    if (preparationFailed) return;

    const preparedFiles = new Map<string, File>();
    const preparedPreviewUrls = new Map<string, string>();
    try {
      prepared.forEach(({ item }) => {
        const previewUrls = new Map(
          item.editorObjectUrls.map(({ id, url }) => [id, url]),
        );
        item.editorAttachments.forEach(({ id, file }) => {
          const existingFile = preparedFiles.get(id);
          if (existingFile && existingFile !== file) {
            throw new Error(`inline attachment already registered: ${id}`);
          }
          const previewUrl = previewUrls.get(id);
          const existingPreviewUrl = preparedPreviewUrls.get(id);
          if (
            existingPreviewUrl &&
            previewUrl &&
            existingPreviewUrl !== previewUrl
          ) {
            throw new Error(
              `inline attachment preview already registered: ${id}`,
            );
          }
          attachmentStore.validateInlineRegistration(id, file, previewUrl);
          preparedFiles.set(id, file);
          if (previewUrl) preparedPreviewUrls.set(id, previewUrl);
        });
        item.editorObjectUrls.forEach(({ id, url }) => {
          const existingPreviewUrl = preparedPreviewUrls.get(id);
          if (existingPreviewUrl && existingPreviewUrl !== url) {
            throw new Error(
              `inline attachment preview already registered: ${id}`,
            );
          }
          attachmentStore.validateInlineRegistration(
            id,
            preparedFiles.get(id),
            url,
          );
          preparedPreviewUrls.set(id, url);
        });
      });
    } catch (err) {
      console.error("[MessageInput] compose recovery hydration failed", err);
      return;
    }

    prepared.forEach(({ item }) => {
      const previewUrls = new Map(
        item.editorObjectUrls.map(({ id, url }) => [id, url]),
      );
      item.editorAttachments.forEach(({ id, file }) => {
        attachmentStore.addInlineFile(id, file, previewUrls.get(id));
      });
      const fileIds = new Set(item.editorAttachments.map(({ id }) => id));
      item.editorObjectUrls.forEach(({ id, url }) => {
        if (fileIds.has(id)) return;
        attachmentStore.addInlinePreviewUrl(id, url);
      });
    });

    let blockOffset = 0;
    prepared.forEach(({ document }) => {
      if (document) {
        const inserted = restoreComposeSnapshot(
          document,
          {
            isEmpty: () => editor.isEmpty,
            setContent: (snapshot) =>
              editor.commands.setContent(snapshot as JSONContent),
            focusEnd: () => editor.commands.focus("end"),
            insertContentAtBlock: (offset, nodes) => {
              const docNode = editor.state.doc;
              const limit = Math.min(offset, docNode.childCount);
              let pos = 0;
              for (let index = 0; index < limit; index += 1) {
                pos += docNode.child(index).nodeSize;
              }
              editor.commands.insertContentAt(pos, nodes as JSONContent[]);
            },
            appendContent: (nodes) =>
              editor.commands.insertContent(nodes as JSONContent[]),
          },
          blockOffset,
        );
        blockOffset += inserted;
      }
    });
    const hydrated = prepared.map(({ item }) => item);

    const recoveredTopAttachments = hydrated.flatMap((item) =>
      item.topAttachments.filter(
        (attachment): attachment is TopAttachmentItem =>
          attachment.file !== undefined,
      ),
    );
    if (recoveredTopAttachments.length > 0) {
      attachmentStore.restoreTopAttachments(recoveredTopAttachments, 0);
    }

    const target = hydrated.find((item) => item.sendTarget)?.sendTarget;
    if (target) props.onRestoreRecoveredTarget?.(target);
    if (hydrated.some((item) => item.expanded)) {
      setExpanded(true);
      props.onExpandChange?.(true);
    }
    if (hydrated.length > 0) {
      props.onRecoveredComposes?.({
        attemptIds: hydrated.map(({ attemptId }) => attemptId),
        draftText: extractMentionsFromEditor(editor) ?? "",
      });
    }
  }, [
    editor,
    attachmentStore,
    props.onExpandChange,
    props.onRecoveredComposes,
    props.onRestoreRecoveredTarget,
    props.recoveredComposes,
    extensions.editor.composeParts,
  ]);

  const addMention = useCallback(
    (uid: string, name: string) => {
      if (editor && name) {
        editor.commands.insertContent({
          type: "mention",
          attrs: { id: uid, label: name },
        });
        editor.commands.insertContent(" ");
      }
    },
    [editor]
  );

  const send = useCallback(async (): Promise<ChatComposerSendResult> => {
    if (!editor) return rejectChatComposerSend("editor-not-ready");

    const text = editor.getText();
    if (text.length > MAX_MESSAGE_LENGTH) {
      Notification.error({
        className: "wk-octo-notification",
        content: t("base.messageInput.validation.maxLength", { values: { max: MAX_MESSAGE_LENGTH } }),
      });
      return rejectChatComposerSend("message-too-long");
    }

    // 从编辑器提取附件（粘贴的图片）
    const attachmentAttrs = extractAttachmentsFromEditor(editor);
    // 顶部附件区文件（通过上传按钮添加）
    const topAttachmentsAtSend = attachmentStore.snapshotTopAttachments();
    const topAttachmentFiles: AttachmentFile[] = topAttachmentsAtSend.map(
      (a) => ({
        id: a.id,
        file: a.file,
      }),
    );
    let orderedBlocks: EditorContentBlock[];
    let capturedEditorCompose: {
      snapshot: ComposeDoc;
      editorParts: EditorComposePart[];
    };
    try {
      const extracted = extractOrderedBlocks(
        editor,
        attachmentStore.attachmentFiles,
        localMembersRef.current,
        extensions.editor.composeParts,
      );
      orderedBlocks = extracted.blocks;
      capturedEditorCompose = {
        snapshot: extracted.snapshot,
        editorParts: extracted.editorParts,
      };
    } catch (err) {
      console.error("[MessageInput] editor compose part is not sendable", err);
      return rejectChatComposerSend("unsupported-content");
    }
    const pendingAttachmentPreviews: PendingSendAttachmentPreview[] = [
      ...attachmentAttrs.map(({ id, name, type, previewUrl }) => ({
        id,
        name,
        type,
        previewUrl,
      })),
      ...topAttachmentsAtSend.map(({ id, name, type, previewUrl }) => ({
        id,
        name,
        type,
        previewUrl,
      })),
    ];

    const hasText = text.trim() !== "";
    const hasAttachments =
      attachmentAttrs.length > 0 || topAttachmentFiles.length > 0;
    const hasEditorBlocks = orderedBlocks.some(
      (block) => block.type !== "text" || block.text.trim() !== "",
    );

    // 没有 onSend 或没有任何内容时无需发送，直接退出（不清空，保持现状）。
    // 视为未发送（editorConsumed=false），供编排器判定真实结果。
    if (!props.onSend) return rejectChatComposerSend("send-host-unavailable");
    if (!hasText && !hasAttachments && !hasEditorBlocks) {
      return rejectChatComposerSend("empty-compose");
    }

    // 从编辑器提取带格式的文本（包含 @[uid:name] 格式的 mention）。
    // trusted=true：仅 node-origin 广播 sentinel 才被信任标记，伪造文本无法路由广播。
    const formattedText = extractMentionsFromEditor(editor, true);
    const { content, mention } = formatMentionTextV2(
      formattedText,
      localMembersRef.current,
    );

    return coordinator.submit(
      {
        text: content,
        mention,
        topFiles: topAttachmentFiles,
        editorBlocks: orderedBlocks,
        pendingAttachments: pendingAttachmentPreviews,
      },
      {
        host: {
          channelKey: () => {
            return hostRef.current.getChannel().key;
          },
          isChannelActive: (channelKey) => {
            return hostRef.current.getChannel().key === channelKey;
          },
          captureSendTarget: () => props.onCaptureSendTarget?.(),
          captureSendDraft: () => props.onCaptureSendDraft?.(),
          getExpanded: () => expanded,
          setExpanded: (nextExpanded) => {
            setExpanded(nextExpanded);
            props.onExpandChange?.(nextExpanded);
          },
          send: props.onSend,
          onSendSettled: props.onSendSettled,
          handoffRecovery: props.onComposeRecovery,
          notifyRestoreError: (err, step) => {
            console.error(`[MessageInput] compose ${step} failed`, err);
            Notification.error({
              className: "wk-octo-notification",
              content:
                err instanceof ComposeRestoreUnavailableError
                  ? t("base.messageInput.send.restoreFailed")
                  : t("base.conversation.message.sendFailed"),
            });
          },
        },
        editor: {
          consume: (context) =>
            consumeCompose({
              composePartRegistry: extensions.editor.composeParts,
              captured: capturedEditorCompose,
              editor: {
                getJSON: () => editor.getJSON() as ComposeDoc,
                getRestoredBlockMarkerIds: () =>
                  getRestoredBlockMarkerIds(editor),
                markRestoredBlocks: (blockOffset, blockCount) =>
                  markRestoredBlocks(editor, blockOffset, blockCount),
                isEmpty: () => editor.isEmpty,
                isDestroyed: () =>
                  !composerMountedRef.current || editor.isDestroyed,
                clearContent: () => editor.commands.clearContent(),
                setContent: (doc) =>
                  editor.commands.setContent(doc as JSONContent),
                insertContentAtBlock: (blockOffset, nodes) => {
                  const docNode = editor.state.doc;
                  const limit = Math.min(blockOffset, docNode.childCount);
                  let pos = 0;
                  for (let i = 0; i < limit; i++) {
                    pos += docNode.child(i).nodeSize;
                  }
                  editor.commands.insertContentAt(
                    pos,
                    nodes as JSONContent[],
                  );
                },
                appendContent: (nodes) =>
                  editor.commands.insertContent(nodes as JSONContent[]),
                focusEnd: () => editor.commands.focus("end"),
              },
              attachmentFiles: attachmentStore.attachmentFiles,
              takeEditorAttachments: (ids) =>
                attachmentStore.takeInlineAttachments(ids),
              restoreEditorAttachments: (ids) =>
                attachmentStore.restoreInlineAttachments(ids),
              disposeEditorAttachment: (id, previewUrl) =>
                attachmentStore.disposeInlineAttachment(id, previewUrl),
              parseTextToNodes: (value) =>
                (parseConsumedTextToContent(value).content ?? []) as ComposeDoc["content"] as never,
              snapshotTopAttachments: () =>
                attachmentStore.snapshotTopAttachments(),
              takeTopAttachments: (ids) =>
                attachmentStore.takeTopAttachments(ids),
              restoreTopAttachments: (items, offset) =>
                attachmentStore.restoreTopAttachments(
                  items as TopAttachmentItem[],
                  offset,
                ),
              getRestoreOffsets: context.getRestoreOffsets,
              onRestored: context.onRestored,
              onRestoreCompose: context.onRestoreCompose,
              onRestoreSendTarget: context.onRestoreSendTarget,
              onRestoreError: context.onRestoreError,
            }),
          handoffRecovery: (recovery) => {
            const editorRecoveryIds = new Set([
              ...recovery.editorAttachments.map(({ id }) => id),
              ...recovery.editorObjectUrls.map(({ id }) => id),
            ]);
            attachmentStore.handoffInlineAttachments([...editorRecoveryIds]);
            attachmentStore.handoffTopAttachments(
              recovery.topAttachments.map(({ id }) => id),
            );
          },
        },
      },
    );
  }, [
    editor,
    attachmentStore,
    expanded,
    props.onSend,
    props.onCaptureSendTarget,
    props.onCaptureSendDraft,
    props.onComposeRecovery,
    props.onSendSettled,
    props.onExpandChange,
    controller,
    coordinator,
    extensions.editor.composeParts,
    t,
  ]);

  // 先接好 sendRef，再导出 context。Conversation 先通过 context 恢复最新草稿，
  // 随后这里把失败 compose 前置合并，避免旧失败内容覆盖更新的草稿。
  useEffect(() => {
    if (!editor) return;

    announceContextAfterSendReady(sendRef, send, () => {
      props.onContext?.({
        insertText,
        insertContent: (content) => {
          editor?.chain().focus("end").insertContent(content).run();
        },
        restoreDraft,
        addMention,
        addAttachment,
        getAttachmentFiles,
        text: () => (editor ? extractMentionsFromEditor(editor) : undefined),
        focus: () => editor?.commands.focus(),
        send: () => invokeReadySend(sendRef.current),
        pendingSendCount: () => controller.pendingSendCount(),
        pendingPreEnqueueCount: () => controller.pendingPreEnqueueCount(),
        pendingSendDrafts: () => controller.pendingSendDrafts(),
        pendingPreEnqueueDrafts: () =>
          controller.pendingPreEnqueueDrafts(),
        pendingSendText: () => controller.pendingSendText(),
        clear: () => {
          editor?.commands.clearContent(true);
          attachmentStore.clear();
        },
      });
      restoreRecoveredComposes();
    });
  }, [
    send,
    editor,
    props.onContext,
    restoreRecoveredComposes,
    insertText,
    restoreDraft,
    addMention,
    addAttachment,
    attachmentStore,
    controller,
    getAttachmentFiles,
  ]);

  const getFilteredSlashCommands = useCallback((): BotCommand[] => {
    const { botCommands } = props;
    if (!botCommands) return [];
    if (!slashFilter) return botCommands;
    const lower = slashFilter.toLowerCase();
    return botCommands.filter(
      (cmd) =>
        cmd.command.toLowerCase().includes(lower) ||
        cmd.description.toLowerCase().includes(lower)
    );
  }, [props.botCommands, slashFilter]);

  const handleSlashSelect = useCallback(
    (cmd: BotCommand) => {
      if (!editor) return;

      editor.commands.setContent(
        `${cmd.command.startsWith("/") ? cmd.command : `/${cmd.command}`} `
      );
      setSlashMenuVisible(false);
      setSlashFilter("");
      setSlashActiveIndex(0);
      editor.commands.focus();
    },
    [editor]
  );

  const handleMenuButtonClick = useCallback(() => {
    setSlashMenuVisible((prev) => !prev);
    setSlashFilter("");
    setSlashActiveIndex(0);
  }, []);

  // 每次状态变更时更新键盘处理函数（通过 ref 保持最新，避免 useEditor 闭包过期）
  useEffect(() => {
    editorHandleKeyDownRef.current = (_view: any, event: KeyboardEvent) => {
      const filteredSlashCommands = slashMenuVisible
        ? getFilteredSlashCommands()
        : [];
      const decision = decideComposerKeyboard({
        key: event.key,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        isComposing: event.isComposing,
        keyCode: event.keyCode,
        slashMenuVisible,
        slashItemCount: filteredSlashCommands.length,
        slashActiveIndex,
        mentionActive: mentionActiveRef.current,
        emojiActive: emojiSuggestionActiveRef.current,
      });
      if (decision.kind === "pass") return false;

      event.preventDefault();
      if (decision.kind === "close-slash") {
        setSlashMenuVisible(false);
      } else if (decision.kind === "move-slash") {
        setSlashActiveIndex(decision.index);
      } else if (decision.kind === "select-slash") {
        handleSlashSelect(filteredSlashCommands[decision.index]);
      } else if (decision.kind === "alt-enter") {
        props.onAltEnter?.();
      } else {
        if (decision.closeSlash) setSlashMenuVisible(false);
        fireAndForgetSend();
      }
      return true;
    };
  }, [
    slashMenuVisible,
    slashActiveIndex,
    getFilteredSlashCommands,
    handleSlashSelect,
    fireAndForgetSend,
    props.onAltEnter,
  ]);

  const toggleExpand = useCallback(() => {
    const next = !expanded;
    if (next) {
      props.host.track("input_expanded");
    }
    props.onExpandChange?.(next);
    setExpanded(next);
    if (next && editor) {
      setTimeout(() => editor.commands.focus(), 100);
    }
  }, [expanded, editor, props.onExpandChange]);

  const { onInputRef, topView, toolbar, botCommands } = props;

  // 检查编辑器内是否有内容或附件
  const editorAttachments = editor ? extractAttachmentsFromEditor(editor) : [];
  const hasValue =
    (editor?.getText().length || 0) > 0 ||
    editorAttachments.length > 0 ||
    topAttachments.length > 0;

  // 设置 inputRef
  useEffect(() => {
    if (onInputRef && editor) {
      onInputRef(editor.view.dom);
    }
  }, [editor, onInputRef]);

  return (
    <div
      className={clazz("wk-messageinput-box", {
        "wk-messageinput-box--expanded": expanded,
      })}
      style={expanded ? { flex: 1 } : undefined}
    >
      {/* 悬浮卡片容器 */}
      <div
        className={clazz("wk-messageinput-card", {
          "wk-messageinput-card--multiline": isMultiLine,
          "wk-messageinput-card--has-topview": !!topView,
        })}
      >
        {/* 引用/编辑条在卡片内部 */}
        {topView && <div className="wk-messageinput-topview">{topView}</div>}

        {/* 发送中内容预览 (octo-web#1280)：输入框在发送开始时就被清空，实际文本
            与附件保持可见；本地气泡出现后立即移除，避免同一内容重复展示。 */}
        {pendingPreEnqueueItems.length > 0 && (
          <div className="wk-messageinput-sending" aria-live="polite">
            {pendingPreEnqueueItems.map((item) => (
              extensions.render.pending.render(item, {
                sendingLabel: t("base.message.sending"),
                renderAttachment: (attachment) =>
                  attachment.previewUrl ? (
                    <img
                      key={attachment.id}
                      className="wk-messageinput-sending-thumbnail"
                      src={attachment.previewUrl}
                      alt={attachment.name}
                    />
                  ) : (
                    <span
                      key={attachment.id}
                      className="wk-messageinput-sending-file"
                      title={attachment.name}
                    >
                      <img
                        src={getFileIcon(attachment.name, attachment.type)}
                        alt=""
                      />
                      <span>{attachment.name}</span>
                    </span>
                  ),
              })
            ))}
          </div>
        )}

        {/* 顶部附件区（非图片文件 + 上传的图片） */}
        {topAttachments.length > 0 && (
          <div className="wk-messageinput-top-attachments">
            <div className="wk-messageinput-top-attachments-scroll">
              {topAttachments.map((item) => {
                const isImage = isImageFileType(item.file);
                const isVideo = isVideoFileType(item.file);
                const icon = getFileIcon(item.name, item.type);

                // 顶部附件区所有类型都使用卡片样式（包括图片）
                return (
                  <div key={item.id} className="wk-attachment-node">
                    <div className="wk-attachment-node-card">
                      <div className="wk-attachment-node-icon">
                        {isImage && item.previewUrl ? (
                          // 图片：显示缩略图
                          <img
                            src={item.previewUrl}
                            alt={item.name}
                            draggable={false}
                            className="wk-attachment-node-image-thumb"
                          />
                        ) : isVideo && item.previewUrl ? (
                          // 视频：显示封面和播放图标
                          <div className="wk-attachment-node-video-cover-wrapper">
                            <img
                              src={item.previewUrl}
                              alt="video cover"
                              draggable={false}
                              className="wk-attachment-node-video-cover"
                            />
                            <img
                              src={videoPlayIcon}
                              alt="play"
                              className="wk-attachment-node-video-play-icon"
                              draggable={false}
                            />
                          </div>
                        ) : (
                          // 其他文件：显示文件图标
                          <img src={icon} alt="file" draggable={false} />
                        )}
                      </div>
                      <div className="wk-attachment-node-info">
                        <div className="wk-attachment-node-name-row">
                          <div
                            className="wk-attachment-node-name"
                            title={item.name}
                          >
                            {item.name}
                          </div>
                          <button
                            className="wk-attachment-node-remove"
                            onClick={() => removeTopAttachment(item.id)}
                            type="button"
                            title={t("base.messageInput.attachment.remove")}
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <div className="wk-attachment-node-size">
                          {formatFileSize(item.size)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 输入行：输入框 + 按钮 */}
        <div
          className="wk-messageinput-row"
          onMouseDown={(e) => {
            // 点击 row 空白区域时聚焦编辑器（排除 actionbox）
            const target = e.target as HTMLElement;
            if (
              editor &&
              !target.closest(".wk-messageinput-actionbox") &&
              !target.closest(".wk-messageinput-editor")
            ) {
              e.preventDefault();
              editor.commands.focus();
            }
          }}
          style={{ cursor: "text" }}
        >
          {/* 输入框区域 */}
          <div
            className="wk-messageinput-inputbox"
            style={{ position: "relative", cursor: "text" }}
          >
            {botCommands && botCommands.length > 0 && (
              <SlashCommandMenu
                commands={botCommands}
                filter={slashFilter}
                visible={slashMenuVisible}
                activeIndex={slashActiveIndex}
                onSelect={handleSlashSelect}
              />
            )}
            {botCommands && botCommands.length > 0 && (
              <div
                className="wk-messageinput-menu-btn"
                onClick={handleMenuButtonClick}
                title={t("base.messageInput.slashCommand")}
              >
                /
              </div>
            )}
            <div className="wk-messageinput-editor">
              <EditorContent editor={editor} />
            </div>
          </div>

          {/* 工具栏在右下角 */}
          <div className="wk-messageinput-actionbox">
            {toolbar}
            {props.extraActions}

            {/* 语音输入 */}
            <VoiceInputIndicator
              voiceHost={props.host.voice}
              onRecordingStarted={() =>
                props.host.track("input_voice_recording_started")
              }
              onTranscribed={(
                text: string,
                replaceMode: "all" | "selection" | "insert",
                savedSelectedText?: string,
                savedSelectionRange?: { from: number; to: number }
              ) => {
                if (!editor) return;

                // Use dynamic regex built from member names to detect mentions
                const hasMention =
                  buildMentionRegex(memberInfos).test(text);

                // Find text position in current doc (handles mention atom nodes)
                const findSelectionRange = (
                  searchText: string
                ): { from: number; to: number } | null => {
                  let found: { from: number; to: number } | null = null;
                  editor.state.doc.descendants((node, pos) => {
                    if (found) return false;
                    if (node.isText && node.text) {
                      const idx = node.text.indexOf(searchText);
                      if (idx !== -1) {
                        found = {
                          from: pos + idx,
                          to: pos + idx + searchText.length,
                        };
                        return false;
                      }
                    }
                  });
                  return found;
                };

                if (hasMention) {
                  const content = parseMentionMarkers(text, memberInfos);

                  if (replaceMode === "all") {
                    // 替换全部内容
                    editor.commands.setContent({
                      type: "doc",
                      content: [{ type: "paragraph", content }],
                    });
                  } else if (replaceMode === "selection" && savedSelectedText) {
                    // 替换选中部分：优先使用保存的位置，文本匹配作为兜底
                    const range =
                      savedSelectionRange ||
                      findSelectionRange(savedSelectedText);
                    if (range) {
                      editor
                        .chain()
                        .setTextSelection(range)
                        .insertContent(content)
                        .run();
                    } else {
                      // 找不到原文本，回退到替换全部
                      editor.commands.setContent({
                        type: "doc",
                        content: [{ type: "paragraph", content }],
                      });
                    }
                  } else {
                    // 插入到光标处
                    editor.commands.insertContent(content);
                  }
                } else {
                  if (replaceMode === "all") {
                    // 替换全部内容
                    editor.commands.setContent(text);
                  } else if (replaceMode === "selection" && savedSelectedText) {
                    // 替换选中部分：优先使用保存的位置，文本匹配作为兜底
                    const range =
                      savedSelectionRange ||
                      findSelectionRange(savedSelectedText);
                    if (range) {
                      editor
                        .chain()
                        .setTextSelection(range)
                        .insertContent(text)
                        .run();
                    } else {
                      // 找不到原文本，回退到替换全部
                      editor.commands.setContent(text);
                    }
                  } else {
                    // 插入到光标处
                    editor.commands.insertContent(text);
                  }
                }

                editor.commands.focus();
              }}
              getCurrentText={() => {
                if (!editor) return "";
                // 序列化编辑器内容为纯文本，处理各类 leaf 节点
                const leafText = (node: any) => {
                  if (node.type.name === "attachment") return "";
                  if (node.type.name === "mention") return `@${node.attrs.label ?? node.attrs.id}`;
                  if (node.type.name === "hardBreak") return "\n";
                  return "";
                };
                return editor.state.doc.textBetween(
                  0,
                  editor.state.doc.content.size,
                  " ",
                  leafText
                );
              }}
              getSelectedText={() => {
                if (!editor) return undefined;
                const { from, to } = editor.state.selection;
                if (from === to) return undefined; // 没有选中文字
                // 序列化编辑器内容为纯文本，处理各类 leaf 节点
                const leafText = (node: any) => {
                  if (node.type.name === "attachment") return "";
                  if (node.type.name === "mention") return `@${node.attrs.label ?? node.attrs.id}`;
                  if (node.type.name === "hardBreak") return "\n";
                  return "";
                };
                const text = editor.state.doc.textBetween(
                  from,
                  to,
                  " ",
                  leafText
                );
                return text || undefined;
              }}
              getSelectionRange={() => {
                if (!editor) return undefined;
                const { from, to } = editor.state.selection;
                if (from === to) return undefined; // 没有选中文字
                return { from, to };
              }}
              getChatContext={props.getChatContext}
              checkIsInputActive={() => {
                // 检查编辑器是否处于聚焦状态，避免多个输入框同时响应语音快捷键
                return editor ? editor.isFocused : false;
              }}
            />

            {/* 展开/收起按钮 */}
            <IconClick
              size="sm"
              title={expanded ? t("base.messageInput.collapse") : t("base.messageInput.expand")}
              onClick={toggleExpand}
              icon={
                expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatComposer;
