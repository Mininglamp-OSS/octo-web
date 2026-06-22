import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { X } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TiptapMention from "@tiptap/extension-mention";
import { createMentionSuggestion } from "./mentionSuggestion";
import ConversationContext from "../Conversation/context";
import clazz from "classnames";
import WKSDK, { Channel, ChannelInfo, ChannelTypePerson, Subscriber } from "wukongimjssdk";
import hotkeys from "hotkeys-js";
import WKApp from "../../App";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import {
  MemberInfo,
  buildMemberInfos,
  buildMentionRegex,
  parseMentionMarkers,
} from "./mentionResolve";
import "./index.css";
import { Notification } from "@douyinfe/semi-ui";
import SlashCommandMenu, { BotCommand } from "../SlashCommandMenu";
import VoiceInputIndicator from "./VoiceInputIndicator";
import { ChatContextResult } from "../Conversation/chatContext";
import { Maximize2, Minimize2 } from "lucide-react";
import IconClick from "../IconClick";
import mentionAllIcon from "./mention.png";
import {
  AttachmentNode,
  AttachmentAttributes,
  getFileIcon,
  formatFileSize,
  videoPlayIcon,
} from "./AttachmentNode";
import { t as translate, useI18n } from "../../i18n";
import { runSendWithCleanup, SendResultDetail } from "./sendFlow";
import { extractOctoRichTextClipboardPayloadFromHtml } from "../../Utils/richTextClipboard";
import {
  imageBlockToPasteFile,
  restoreOctoRichTextClipboardToEditor,
} from "./richTextPaste";
import { handleSecretPaste } from "./secretPasteDetect";

const MAX_MESSAGE_LENGTH = 5000;

// placeholder 格式化所需的平台快捷键标识（模块级常量，避免重复计算）
const ALT_KEY = /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌥' : 'Alt';

/** 根据频道类型和名称生成 placeholder 文本 */
function buildPlaceholder(channel: Channel, name: string, t: typeof translate): string {
  if (channel.channelType === ChannelTypePerson) {
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
export type EditorContentBlock =
  | { type: "text"; text: string; mention?: MentionModel }
  | { type: "image"; id: string; file: File }
  | { type: "file"; id: string; file: File };

const TIPTAP_BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'blockquote', 'codeBlock',
  'orderedList', 'bulletList', 'listItem',
  'table', 'tableRow', 'tableCell', 'tableHeader',
  'horizontalRule',
]);

function extractOrderedBlocks(
  editorInstance: any,
  attachmentFilesMap: Map<string, File>
): EditorContentBlock[] {
  if (!editorInstance) return [];
  const json = editorInstance.getJSON();
  if (!json.content) return [];

  const blocks: EditorContentBlock[] = [];
  let pendingTextParts: string[] = [];

  function flushText() {
    const joined = stripInvisibleChars(pendingTextParts.join(""));
    if (joined.trim() !== "") {
      const { content, mention } = formatMentionTextV2(joined);
      blocks.push({ type: "text", text: content, mention });
    }
    pendingTextParts = [];
  }

  function processNode(node: any): void {
    if (node.type === "attachment" && node.attrs) {
      const file = attachmentFilesMap.get(node.attrs.id);
      if (file) {
        flushText();
        const blockType = file.type.startsWith("image/") ? "image" : "file";
        blocks.push({ type: blockType, id: node.attrs.id, file });
      }
      return;
    }

    if (node.type === "text") {
      pendingTextParts.push(stripTrustMark(node.text || ""));
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

  return blocks;
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
function notifySecretPaste(detectedValue: string): void {
  Notification.warning({
    title: translate("base.secrets.pasteGuard.title"),
    content: translate("base.secrets.pasteGuard.content"),
    duration: 8,
    showClose: true,
    onClick: () => {
      WKApp.mittBus.emit("wk:open-secrets", { create: true, value: detectedValue });
    },
  });
}


export type OnInsertFnc = (text: string) => void;
export type OnAddMentionFnc = (uid: string, name: string) => void;

// 附件数据（用于发送）
export interface AttachmentFile {
  id: string;
  file: File;
}

interface MessageInputProps {
  context: ConversationContext;
  /**
   * 发送回调。返回值决定是否清空编辑器/附件：
   *   - resolve `true`（或 `undefined`/`void`，向后兼容）→ 发送成功，清空编辑器
   *     草稿与全部本次附件；
   *   - resolve `false` → 发送失败/未发送，保留编辑器内容、附件引用与预览 URL；
   *   - resolve `{ editorConsumed, consumedTopIds }` → 部分成功：可表达「顶部
   *     附件已发出但编辑器混排失败需保留」，仅清掉已消费的 top 附件，避免重试
   *     重复发送 (octo-web#227 Jerry-Xin non-blocking)。
   * 必须在 send 内被 `await`，否则同步清理会先于异步发送结果丢掉混排草稿。
   * 注意 (第二轮 octo-web#227)：清理是 snapshot-aware 的——onSend 返回成功后，
   * 仅当编辑器内容仍等于发送时的快照才会清空；用户在 await 期间输入的新草稿
   * 不会被旧 send 误删。
   */
  onSend?: (
    text: string,
    mention?: MentionModel,
    attachments?: AttachmentFile[],
    /** 顶部附件区文件（通过上传按钮添加），优先于编辑器内容发送 */
    topFiles?: AttachmentFile[],
    /** 编辑器中按文档顺序排列的内容块（文本段和粘贴图片交替） */
    editorBlocks?: EditorContentBlock[]
  ) => void | boolean | SendResultDetail | Promise<void | boolean | SendResultDetail>;
  members?: Array<Subscriber>;
  onInputRef?: any;
  onInsertText?: (fnc: OnInsertFnc) => void;
  onAddMention?: (fnc: OnAddMentionFnc) => void;
  onAddAttachment?: (
    fnc: (files: File[], source?: "paste" | "upload") => void
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
  getChatContext?: () => ChatContextResult | Promise<ChatContextResult>;
  onExpandChange?: (expanded: boolean) => void;
  /** Called when Alt+Enter is pressed in the editor */
  onAltEnter?: () => void;
}



export interface MentionEntity {
  uid: string;
  offset: number;
  length: number;
}

export class MentionModel {
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
} from "../../Utils/mentionRender";
import {
  parseSendMentionText,
  serializeMentionMarker,
  stripTrustMark,
  parseDraftToContent,
} from "./mentionSendParse";
import type { SendParseMember } from "./mentionSendParse";

// 解析 @[uid:name] 格式的 mention（send 边界）。安全核心在纯函数 parseSendMentionText：
// 仅当广播 sentinel 携带 node-origin 信任标记时才路由广播，伪造的字面文本降级为纯文本。
function formatMentionTextV2(text: string): {
  content: string;
  mention?: MentionModel;
} {
  const members = (membersRef.current ?? []) as unknown as SendParseMember[];
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
  /** Restore draft content (replaces editor content, parses @[uid:label] to mention nodes) */
  restoreDraft: (text: string) => void;
  addMention: (uid: string, name: string) => void;
  addAttachment: (files: File[], source?: "paste" | "upload") => void;
  getAttachmentFiles: () => File[];
  text: () => string | undefined;
  focus: () => void;
  /** Programmatically trigger send (same as pressing Enter) */
  send: () => void;
  /** Clear editor content without sending */
  clear: () => void;
}

// MemberInfo / buildMentionRegex / parseMentionMarkers / buildMemberInfos live
// in ./mentionResolve so the editor and unit tests share one implementation.

// 保持 membersRef 在模块级别供 formatMentionTextV2 使用
let membersRef: React.MutableRefObject<Array<Subscriber> | undefined>;

// `trusted` is set on the send path so node-origin broadcast sentinels are
// tagged with MENTION_TRUST_MARK (text-origin grammar is neutralized). The
// draft/read path (`text()`) leaves it false → canonical, mark-free markers
// that round-trip back into mention nodes on restore (octo-web#330).
function extractMentionsFromEditor(editor: any, trusted = false): string {
  const json = editor.getJSON();
  let result = "";

  function traverse(node: any) {
    if (node.type === "text") {
      result += stripTrustMark(node.text || "");
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

const MessageInput: React.FC<MessageInputProps> = (props) => {
  const { t } = useI18n();
  const [slashMenuVisible, setSlashMenuVisible] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const previousScopeRef = useRef<string>("all");
  // 附件文件映射：id -> File（用于编辑器内的粘贴图片）
  const attachmentFilesRef = useRef<Map<string, File>>(new Map());
  // 顶部附件区的附件列表（非图片文件 + 上传的图片）
  const [topAttachments, setTopAttachments] = useState<TopAttachmentItem[]>([]);

  // 动态生成 placeholder（channelInfo 异步加载后通过 listener 自动更新）
  const [placeholder, setPlaceholder] = useState(() => {
    const channel = props.context.channel();
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
    return buildPlaceholder(channel, channelInfo?.title || "", t);
  });

  useEffect(() => {
    const channel = props.context.channel();
    let aborted = false;

    const updateName = (name: string) => {
      if (aborted) return;
      setPlaceholder(buildPlaceholder(channel, name, t));
    };

    // 监听 channelInfo 更新（SDK fetch 完成后会通知）
    const listener = (channelInfo: ChannelInfo) => {
      if (channelInfo.channel.isEqual(channel)) {
        updateName(channelInfo.title || "");
      }
    };
    WKSDK.shared().channelManager.addListener(listener);

    // 检查本地缓存；没有则主动 fetch（fetch 完成后 listener 会收到通知）
    const cached = WKSDK.shared().channelManager.getChannelInfo(channel);
    if (cached) {
      updateName(cached.title || "");
    } else {
      WKSDK.shared().channelManager.fetchChannelInfo(channel).catch(() => {});
    }

    return () => {
      aborted = true;
      WKSDK.shared().channelManager.removeListener(listener);
    };
  }, [props.context, t]);

  const memberInfos = useMemo<MemberInfo[]>(
    () => buildMemberInfos(props.members),
    [props.members],
  );

  const localMembersRef = useRef(props.members);
  const isDirectChannelRef = useRef(
    props.context.channel().channelType === ChannelTypePerson,
  );
  const sendRef = useRef<(() => void | Promise<void>) | null>(null);
  // 发送进行中标志：onSend 现在被 await，发送窗口内防止重复触发 (octo-web#227)。
  const sendingRef = useRef(false);
  const mentionActiveRef = useRef(false);
  const botCommandsRef = useRef(props.botCommands);
  // editorHandleKeyDownRef 持有最新的键盘处理函数，通过 useEffect 更新
  const editorHandleKeyDownRef = useRef<
    ((view: any, event: KeyboardEvent) => boolean) | null
  >(null);
  const editorHandlePasteRef = useRef<
    ((view: any, event: ClipboardEvent) => boolean) | null
  >(null);

  // 更新模块级别的 membersRef
  membersRef = localMembersRef;
  isDirectChannelRef.current =
    props.context.channel().channelType === ChannelTypePerson;

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
      StarterKit.configure({
        // 只保留基础功能，禁用富文本格式
        bold: false,
        italic: false,
        code: false,
        heading: false,
        blockquote: false,
        horizontalRule: false,
        codeBlock: false,
        strike: false,
      }),
      Placeholder.configure({
        placeholder,
      }),
      AttachmentNode,
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
                WKApp.shared.avatarChannel(
                  new Channel(member.uid, ChannelTypePerson),
                ),
              externalResolver: (member) =>
                resolveExternalForViewer({
                  homeSpaceId: member.orgData?.home_space_id,
                  homeSpaceName: member.orgData?.home_space_name,
                  isExternalLegacy: member.orgData?.is_external,
                  sourceSpaceNameLegacy: member.orgData?.source_space_name,
                }),
              stickyIcon: mentionAllIcon,
              includeBroadcastMentions: !isDirectChannelRef.current,
            });
          },
          (active) => {
            mentionActiveRef.current = active;
          }
        ),
        renderLabel({ options, node }) {
          return `@${node.attrs.label}`;
        },
      }),
    ],
    content: "",
    editorProps: {
      // ProseMirror 级别的键盘处理，在所有 keymap 之前执行
      handleKeyDown: (_view, event) => {
        return editorHandleKeyDownRef.current?.(_view, event) ?? false;
      },
      // 防手滑（YUJ-3539，Jerry-Xin/lml2468 P0-1）：检测到粘贴明文像 API 密钥
      // （sk-/bf-/app- 开头）时，**硬拦截这次粘贴**——明文绝不进编辑器，因此也不
      // 可能被后续 send（editor.getText()）读到发进聊天；同时弹引导提示去密钥管理
      // 保存。preventDefault + 返回 true 阻断 ProseMirror 默认粘贴，仅本地预填新增
      // 弹窗，绝不把明文发送出去。
      handlePaste: (_view, event) => {
        const pasted = event.clipboardData?.getData("text/plain") ?? "";
        const blocked = handleSecretPaste(pasted, notifySecretPaste);
        if (blocked) {
          event.preventDefault();
          return true; // 已处理：阻断默认粘贴，明文不进编辑器
        }
        return editorHandlePasteRef.current?.(_view, event) ?? false;
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

  // 设置hotkeys scope
  useEffect(() => {
    const scope = "messageInput";
    previousScopeRef.current = hotkeys.getScope();
    hotkeys.filter = function (event) {
      return true;
    };
    hotkeys.setScope(scope);

    return () => {
      hotkeys.setScope(previousScopeRef.current);
    };
  }, []);

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
        const id = `${file.name}-${file.size}-${
          file.lastModified
        }-${Date.now()}`;

        // 判断是否为粘贴的图片（只有粘贴的图片才放入编辑器）
        const isPastedImage = source === "paste" && isImageFile(file);

        if (isPastedImage && editor) {
          // 粘贴的图片：插入到编辑器作为富文本元素
          attachmentFilesRef.current.set(id, file);
          const previewUrl = URL.createObjectURL(file);

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

          setTopAttachments((prev) => [...prev, item]);
        }
      }

      // 插入附件后切换到多行模式
      setIsMultiLine(true);
    },
    [editor]
  );

  useEffect(() => {
    editorHandlePasteRef.current = (_view: any, event: ClipboardEvent) => {
      if (!editor || !event.clipboardData) return false;
      const payload = extractOctoRichTextClipboardPayloadFromHtml(
        event.clipboardData.getData("text/html")
      );
      if (!payload) return false;

      event.preventDefault();
      const beforePasteContent = JSON.stringify(editor.getJSON());
      const addRichTextPasteAttachment =
        props.onAddPendingAttachments || addAttachment;
      restoreOctoRichTextClipboardToEditor(
        payload,
        editor,
        addRichTextPasteAttachment,
        {
          imageBlockToFile: (block) =>
            imageBlockToPasteFile(
              block,
              WKApp.dataSource.commonDataSource.getImageURL.bind(
                WKApp.dataSource.commonDataSource
              )
            ),
          // Validate pasted mentions against the live channel roster so a
          // forged clipboard payload cannot inject mentions for non-members
          // or broadcast-routing sentinels (octo-web#330).
          members: buildMemberInfos(localMembersRef.current),
        }
      ).catch(() => {
        if (
          payload.plain &&
          JSON.stringify(editor.getJSON()) === beforePasteContent
        ) {
          editor.commands.insertContent(payload.plain);
        }
      });
      return true;
    };
  }, [addAttachment, editor, props.onAddPendingAttachments]);

  // 移除顶部附件区的附件
  const removeTopAttachment = useCallback((id: string) => {
    setTopAttachments((prev) => {
      const item = prev.find((a) => a.id === id);
      if (item?.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

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

  // 组件卸载时清理顶部附件区的预览 URL，避免内存泄漏
  useEffect(() => {
    return () => {
      topAttachments.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 动态更新 placeholder
  useEffect(() => {
    if (editor) {
      editor.extensionManager.extensions
        .filter((ext) => ext.name === "placeholder")
        .forEach((ext) => {
          (ext.options as any).placeholder = placeholder;
          editor.view.dispatch(editor.state.tr);
        });
    }
  }, [editor, placeholder]);

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
          .map((attr) => attachmentFilesRef.current.get(attr.id))
          .filter((f): f is File => f !== undefined)
      : [];

    // 顶部附件区的附件
    const topFiles = topAttachments.map((a) => a.file);

    return [...editorFiles, ...topFiles];
  }, [editor, topAttachments]);

  // 导出 context 方法
  useEffect(() => {
    if (props.onInsertText) {
      props.onInsertText(insertText);
    }
    if (props.onContext) {
      props.onContext({
        insertText,
        restoreDraft,
        addMention,
        addAttachment,
        getAttachmentFiles,
        text: () => (editor ? extractMentionsFromEditor(editor) : undefined),
        focus: () => editor?.commands.focus(),
        send: () => sendRef.current?.(),
        clear: () => {
          editor?.commands.clearContent(true);
          setTopAttachments((prev) => {
            prev.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
            return [];
          });
          attachmentFilesRef.current.clear();
        },
      });
    }
  }, [
    editor,
    props.onInsertText,
    props.onContext,
    addAttachment,
    getAttachmentFiles,
  ]);

  // 导出 addMention 方法
  useEffect(() => {
    if (props.onAddMention) {
      props.onAddMention(addMention);
    }
  }, [editor, props.onAddMention]);

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

  const send = useCallback(async () => {
    if (!editor) return;
    // 重入保护：onSend 现在被 await，发送期间可能再次触发 Enter/快捷键，
    // 避免同一份草稿被发送两次 (octo-web#227)。
    if (sendingRef.current) return;

    const text = editor.getText();
    if (text.length > MAX_MESSAGE_LENGTH) {
      Notification.error({
        content: t("base.messageInput.validation.maxLength", { values: { max: MAX_MESSAGE_LENGTH } }),
      });
      return;
    }

    // 从编辑器提取附件（粘贴的图片）
    const attachmentAttrs = extractAttachmentsFromEditor(editor);
    const editorAttachments: AttachmentFile[] = attachmentAttrs
      .map((attr) => {
        const file = attachmentFilesRef.current.get(attr.id);
        if (file) {
          return { id: attr.id, file };
        }
        return null;
      })
      .filter((a): a is AttachmentFile => a !== null);

    // 顶部附件区文件（通过上传按钮添加）
    const topAttachmentFiles: AttachmentFile[] = topAttachments.map((a) => ({
      id: a.id,
      file: a.file,
    }));

    // 兼容旧 allAttachments（保留向后兼容）
    const allAttachments = [...editorAttachments, ...topAttachmentFiles];

    const hasText = text.trim() !== "";
    const hasAttachments = allAttachments.length > 0;

    // 没有 onSend 或没有任何内容时无需发送，直接退出（不清空，保持现状）。
    if (!props.onSend || (!hasText && !hasAttachments)) {
      return;
    }

    // 从编辑器提取带格式的文本（包含 @[uid:name] 格式的 mention）。
    // trusted=true：仅 node-origin 广播 sentinel 才被信任标记，伪造文本无法路由广播。
    const formattedText = extractMentionsFromEditor(editor, true);
    const { content, mention } = formatMentionTextV2(formattedText);

    // 提取编辑器中有序内容块（文本段和粘贴图片按文档顺序交替）
    const orderedBlocks = extractOrderedBlocks(editor, attachmentFilesRef.current);

    // ⚠️ 关键修复 (octo-web#227, Jerry-Xin P1 第二轮)：
    // round 1 已把同步清理改成「await onSend、仅成功才清」，避免混排上传失败
    // 丢整条草稿。但 await 期间编辑器仍可编辑，onSend 可能耗时数秒（上传图片 +
    // 等 ack），用户趁发送 pending 时打的下一条草稿，会被上一条 send 成功后的
    // 清理误删。本轮改为 snapshot-aware：
    //   • 发送前对编辑器文档拍 JSON 快照 (editorSnapshot)；成功回来时只有当
    //     编辑器内容仍 === 快照（用户没开始新草稿）才 clearContent，否则保留。
    //   • 顶部附件按本次实际消费的 id 精确移除，绝不 setTopAttachments([])
    //     全清，等待期间新加的附件因此不丢。
    //   • onSend 可返回 { editorConsumed, consumedTopIds } 表达「顶部附件已发、
    //     但编辑器混排失败」，让已发文件不被重试重复 (Jerry-Xin non-blocking)。
    // 编排逻辑在纯函数 runSendWithCleanup，便于单测覆盖各竞态场景。
    const editorSnapshot = JSON.stringify(editor.getJSON());
    const consumedAttachmentAttrs = attachmentAttrs;
    const topItemsAtSend = topAttachments;
    const allTopIds = topItemsAtSend.map((item) => item.id);
    sendingRef.current = true;
    try {
      await runSendWithCleanup(
        () =>
          props.onSend!(
            content,
            mention,
            allAttachments.length > 0 ? allAttachments : undefined,
            topAttachmentFiles.length > 0 ? topAttachmentFiles : undefined,
            orderedBlocks.length > 0 ? orderedBlocks : undefined
          ),
        allTopIds,
        {
          isEditorUnchanged: () =>
            JSON.stringify(editor.getJSON()) === editorSnapshot,
          deleteEditorAttachmentRefs: () => {
            consumedAttachmentAttrs.forEach((attr) => {
              attachmentFilesRef.current.delete(attr.id);
            });
          },
          revokeEditorPreviewUrls: () => {
            consumedAttachmentAttrs.forEach((attr) => {
              if (attr.previewUrl) {
                URL.revokeObjectURL(attr.previewUrl);
              }
            });
          },
          clearEditor: () => editor.commands.clearContent(),
          removeTopAttachments: (ids: string[]) => {
            const idSet = new Set(ids);
            // 先 revoke 被消费项的预览 URL（避免内存泄漏），用拍快照时的列表
            // 取 previewUrl，再按 id 过滤当前 state——保留等待期间新加的附件。
            topItemsAtSend.forEach((item: TopAttachmentItem) => {
              if (idSet.has(item.id) && item.previewUrl) {
                URL.revokeObjectURL(item.previewUrl);
              }
            });
            setTopAttachments((prev: TopAttachmentItem[]) =>
              prev.filter((a: TopAttachmentItem) => !idSet.has(a.id))
            );
          },
          collapseExpanded: () => {
            if (expanded) {
              setExpanded(false);
              props.onExpandChange?.(false);
            }
          },
        }
      );
    } finally {
      sendingRef.current = false;
    }
  }, [editor, expanded, topAttachments, props.onSend, props.onExpandChange, t]);

  // 更新 sendRef
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

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
      if (slashMenuVisible) {
        const filtered = getFilteredSlashCommands();
        if (event.key === "Escape") {
          setSlashMenuVisible(false);
          return true;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashActiveIndex(
            (prev) => (prev + 1) % Math.max(1, filtered.length)
          );
          return true;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashActiveIndex(
            (prev) =>
              (prev - 1 + Math.max(1, filtered.length)) %
              Math.max(1, filtered.length)
          );
          return true;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          if (filtered.length > 0) {
            handleSlashSelect(filtered[slashActiveIndex]);
          } else {
            setSlashMenuVisible(false);
            sendRef.current?.();
          }
          return true;
        }
        return false;
      }

      if (event.key === "Enter" && event.altKey) {
        event.preventDefault();
        props.onAltEnter?.();
        return true;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        if (mentionActiveRef.current) return false;
        sendRef.current?.();
        return true;
      }

      return false;
    };
  }, [
    slashMenuVisible,
    slashActiveIndex,
    getFilteredSlashCommands,
    handleSlashSelect,
  ]);

  const toggleExpand = useCallback(() => {
    const next = !expanded;
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

export default MessageInput;
