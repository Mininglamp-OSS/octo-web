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
import WKSDK, { Channel, ChannelTypePerson, Subscriber } from "wukongimjssdk";
import hotkeys from "hotkeys-js";
import WKApp from "../../App";
import "./index.css";
import { Notification } from "@douyinfe/semi-ui";
import SlashCommandMenu, { BotCommand } from "../SlashCommandMenu";
import VoiceInputIndicator from "./VoiceInputIndicator";
import { ChatContextResult } from "../Conversation/chatContext";
import { Maximize2, Minimize2 } from "lucide-react";
import IconClick from "../IconClick";
import mentionAllIcon from "./mention.png";
import { AttachmentNode, AttachmentAttributes } from "./AttachmentNode";

// 文件类型图标
import defaultIcon from "../../assets/files/default.svg";
import docIcon from "../../assets/files/doc.svg";
import excelIcon from "../../assets/files/excel.svg";
import gifIcon from "../../assets/files/gif.svg";
import pdfIcon from "../../assets/files/pdf.svg";
import videoIcon from "../../assets/files/video.svg";
import zipIcon from "../../assets/files/zip.svg";
import videoPlayIcon from "../../assets/files/video2.svg";

const MAX_MESSAGE_LENGTH = 5000;

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

// Strip zero-width and invisible Unicode characters
const INVISIBLE_CHARS_RE =
  /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD\u2060\u2061\u2062\u2063\u2064\u034F\u061C\u180E]/g;
function stripInvisibleChars(text: string): string {
  return text.replace(INVISIBLE_CHARS_RE, "");
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
  onSend?: (
    text: string,
    mention?: MentionModel,
    attachments?: AttachmentFile[]
  ) => void;
  members?: Array<Subscriber>;
  onInputRef?: any;
  onInsertText?: (fnc: OnInsertFnc) => void;
  onAddMention?: (fnc: OnAddMentionFnc) => void;
  onAddAttachment?: (
    fnc: (files: File[], source?: "paste" | "upload") => void
  ) => void;
  hideMention?: boolean;
  toolbar?: JSX.Element;
  onContext?: (ctx: MessageInputContext) => void;
  topView?: JSX.Element;
  botCommands?: BotCommand[];
  getChatContext?: () => ChatContextResult;
  onExpandChange?: (expanded: boolean) => void;
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
}

// 解析 @[uid:name] 格式的 mention
function formatMentionTextV2(text: string): {
  content: string;
  mention?: MentionModel;
} {
  const entities: MentionEntity[] = [];
  const uids: string[] = [];
  let result = "";
  let cursor = 0;
  let all = false;

  const placeholderPattern = /@\[([^:]+):([^\]]+)\]/g;
  let match;

  while ((match = placeholderPattern.exec(text)) !== null) {
    const uid = match[1];
    const name = match[2];

    // 添加 match 之前的普通文本
    result += text.slice(cursor, match.index);

    // 计算当前 @ 符号的实际位置
    const atName =
      uid === "-1"
        ? "@所有人"
        : membersRef.current?.find((m) => m.uid === uid)?.name
        ? `@${membersRef.current.find((m) => m.uid === uid)!.name}`
        : `@${name}`;
    const offset = result.length;

    if (uid === "-1") {
      all = true;
      result += "@所有人";
    } else {
      uids.push(uid);
      entities.push({
        uid,
        offset,
        length: atName.length,
      });
      result += atName;
    }

    cursor = match.index + match[0].length;
  }

  // 添加剩余文本
  result += text.slice(cursor);

  if (all || entities.length > 0) {
    const mention = new MentionModel();
    mention.all = all;
    mention.uids = uids.length > 0 ? uids : undefined;
    mention.entities = entities.length > 0 ? entities : undefined;
    return { content: result, mention };
  }

  return { content: result };
}

export interface MessageInputContext {
  insertText: (text: string) => void;
  addMention: (uid: string, name: string) => void;
  addAttachment: (files: File[], source?: "paste" | "upload") => void;
  getAttachmentFiles: () => File[];
  text: () => string | undefined;
  focus: () => void;
}

interface MemberInfo {
  uid: string;
  name: string;
}

// 解析语音输入中的 @提及，转换为 Tiptap content
function parseMentionMarkers(
  text: string,
  members: MemberInfo[]
): Array<{
  type: string;
  text?: string;
  attrs?: { id: string; label: string };
}> {
  const result: Array<{
    type: string;
    text?: string;
    attrs?: { id: string; label: string };
  }> = [];
  const regex = /@(\S+?)(?=\s|$)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    const matchStart = match.index;

    // 添加 @ 之前的普通文本
    if (matchStart > lastIndex) {
      result.push({ type: "text", text: text.slice(lastIndex, matchStart) });
    }

    const isAll = name === "所有人" || name.toLowerCase() === "all";
    const member = members.find(
      (m) => m.name === name || m.name.toLowerCase() === name.toLowerCase()
    );

    if (isAll) {
      result.push({
        type: "mention",
        attrs: { id: "-1", label: "所有人" },
      });
      result.push({ type: "text", text: " " });
    } else if (member) {
      result.push({
        type: "mention",
        attrs: { id: member.uid, label: member.name },
      });
      result.push({ type: "text", text: " " });
    } else {
      // 未识别的 @，保留原文
      result.push({ type: "text", text: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // 添加剩余文本
  if (lastIndex < text.length) {
    result.push({ type: "text", text: text.slice(lastIndex) });
  }

  return result;
}

// 保持 membersRef 在模块级别供 formatMentionTextV2 使用
let membersRef: React.MutableRefObject<Array<Subscriber> | undefined>;

// 从 Tiptap JSON 提取 mentions
function extractMentionsFromEditor(editor: any): string {
  const json = editor.getJSON();
  let result = "";

  function traverse(node: any) {
    if (node.type === "text") {
      result += node.text;
    } else if (node.type === "mention") {
      const uid = node.attrs.id;
      const label = node.attrs.label;
      result += `@[${uid}:${label}]`;
    } else if (node.type === "hardBreak") {
      result += "\n";
    } else if (node.content) {
      node.content.forEach(traverse);
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

// 根据文件名和类型获取文件图标
function getFileIcon(name: string, type: string): string {
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx > 0 ? name.substring(dotIdx + 1).toLowerCase() : "";

  if (
    type.startsWith("video/") ||
    ["mp4", "avi", "mov", "mkv", "webm"].includes(ext)
  ) {
    return videoIcon;
  }
  if (ext === "gif") {
    return gifIcon;
  }
  if (ext === "pdf") {
    return pdfIcon;
  }
  if (["doc", "docx"].includes(ext)) {
    return docIcon;
  }
  if (["xls", "xlsx"].includes(ext)) {
    return excelIcon;
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return zipIcon;
  }

  return defaultIcon;
}

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MessageInput: React.FC<MessageInputProps> = (props) => {
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

  // 动态生成 placeholder
  const placeholder = useMemo(() => {
    const channel = props.context.channel();
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
    const name = channelInfo?.title || channelInfo?.name || "";

    if (channel.channelType === ChannelTypePerson) {
      return name ? `对 ${name} 发送消息` : "发送消息";
    } else {
      return name ? `在 ${name} 中回复...` : "输入消息...";
    }
  }, [props.context]);
  const localMembersRef = useRef(props.members);
  const sendRef = useRef<(() => void) | null>(null);
  const mentionActiveRef = useRef(false);
  const botCommandsRef = useRef(props.botCommands);
  // editorHandleKeyDownRef 持有最新的键盘处理函数，通过 useEffect 更新
  const editorHandleKeyDownRef = useRef<
    ((view: any, event: KeyboardEvent) => boolean) | null
  >(null);

  // 更新模块级别的 membersRef
  membersRef = localMembersRef;

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
            if (!localMembersRef.current)
              return [
                {
                  uid: "-1",
                  name: "所有人",
                  icon: mentionAllIcon,
                  isBot: false,
                },
              ];

            const items = localMembersRef.current.map((member) => ({
              uid: member.uid,
              name: member.name,
              icon: WKApp.shared.avatarChannel(
                new Channel(member.uid, ChannelTypePerson)
              ),
              isBot:
                WKSDK.shared().channelManager.getChannelInfo(
                  new Channel(member.uid, ChannelTypePerson)
                )?.orgData?.robot === 1,
            }));

            items.unshift({
              uid: "-1",
              name: "所有人",
              icon: mentionAllIcon,
              isBot: false,
            });

            return items.filter((item) =>
              item.name.toLowerCase().includes(query.toLowerCase())
            );
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

      // 检测是否多行（检查是否有换行符或多个段落，或有附件节点）
      const json = editor.getJSON();
      const paragraphs = json.content || [];
      const hasMultipleParagraphs = paragraphs.length > 1;
      const hasNewline = text.includes("\n");
      // 检查编辑器内是否有附件节点
      const hasAttachments = extractAttachmentsFromEditor(editor).length > 0;
      setIsMultiLine(hasMultipleParagraphs || hasNewline || hasAttachments);
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
      setIsMultiLine(
        hasMultipleParagraphs || hasNewline || hasEditorAttachments
      );
    }
  }, [topAttachments.length, editor]);

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
        addMention,
        addAttachment,
        getAttachmentFiles,
        text: () => (editor ? extractMentionsFromEditor(editor) : undefined),
        focus: () => editor?.commands.focus(),
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
        editor.commands.insertContent(text);
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

  const send = useCallback(() => {
    if (!editor) return;

    const text = editor.getText();
    if (text.length > MAX_MESSAGE_LENGTH) {
      Notification.error({
        content: `输入内容长度不能大于${MAX_MESSAGE_LENGTH}字符！`,
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

    // 合并编辑器附件和顶部附件区附件
    const topAttachmentFiles: AttachmentFile[] = topAttachments.map((a) => ({
      id: a.id,
      file: a.file,
    }));
    const allAttachments = [...editorAttachments, ...topAttachmentFiles];

    const hasText = text.trim() !== "";
    const hasAttachments = allAttachments.length > 0;

    if (props.onSend && (hasText || hasAttachments)) {
      // 从编辑器提取带格式的文本（包含 @[uid:name] 格式的 mention）
      const formattedText = extractMentionsFromEditor(editor);
      const { content, mention } = formatMentionTextV2(formattedText);
      props.onSend(
        content,
        mention,
        allAttachments.length > 0 ? allAttachments : undefined
      );
    }

    // 清理编辑器附件文件引用和图片预览 URL
    attachmentAttrs.forEach((attr) => {
      attachmentFilesRef.current.delete(attr.id);
      // 释放图片预览 URL，避免内存泄漏
      if (attr.previewUrl) {
        URL.revokeObjectURL(attr.previewUrl);
      }
    });

    // 清理顶部附件区
    topAttachments.forEach((item) => {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
    setTopAttachments([]);

    editor.commands.clearContent();

    if (expanded) {
      setExpanded(false);
      props.onExpandChange?.(false);
    }
  }, [editor, expanded, topAttachments, props.onSend, props.onExpandChange]);

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
                            title="移除"
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
                title="斜杠命令"
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

            {/* 语音输入 */}
            <VoiceInputIndicator
              onTranscribed={(text: string, shouldReplace: boolean) => {
                if (!editor) return;

                const hasMention = /@\S+?(?=\s|$)/.test(text);

                if (hasMention && props.members && props.members.length > 0) {
                  const memberInfos: MemberInfo[] = props.members.map((s) => ({
                    uid: s.uid,
                    name: s.remark || s.name || s.uid,
                  }));
                  for (const s of props.members) {
                    if (s.name && s.remark && s.remark !== s.name) {
                      memberInfos.push({ uid: s.uid, name: s.name });
                    }
                  }

                  const content = parseMentionMarkers(text, memberInfos);

                  if (shouldReplace) {
                    editor.commands.setContent({
                      type: "doc",
                      content: [{ type: "paragraph", content }],
                    });
                  } else {
                    editor.commands.insertContent(content);
                  }
                } else {
                  if (shouldReplace) {
                    editor.commands.setContent(text);
                  } else {
                    editor.commands.insertContent(text);
                  }
                }

                editor.commands.focus();
              }}
              getCurrentText={() => editor?.getText() || ""}
              getChatContext={props.getChatContext}
            />

            {/* 展开/收起按钮 */}
            <IconClick
              size="sm"
              title={expanded ? "收起" : "展开输入框"}
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
