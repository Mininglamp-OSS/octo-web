import React, { useEffect, useRef, useState } from "react";
import {
  Typography,
  Select,
  Button,
  Avatar,
  Spin,
  Toast,
  Dropdown,
  Modal,
  DatePicker,
  InputNumber,
  Tooltip,
} from "@douyinfe/semi-ui";
import {
  ArrowLeft,
  Trash2,
  Send,
  MoreHorizontal,
  Copy,
  CircleSlash,
  Check,
  Square,
  RotateCcw,
  Bell,
  BellOff,
  Paperclip,
  FileText,
  Plus,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type {
  Issue,
  IssueComment,
  IssueSubscriber,
  TimelineEntry,
  Attachment,
  AssigneeCandidate,
  TaskRun,
  IssueStatus,
  IssuePriority,
  Project,
  CommentTriggerAgent,
} from "../api/types";
import {
  getIssue,
  updateIssue,
  enrichIssue,
  deleteIssue,
  listComments,
  listChildren,
  listIssues,
  addComment,
  deleteComment,
} from "../api/issueApi";
import {
  listSubscribers,
  subscribeIssue,
  unsubscribeIssue,
  resolveComment,
  unresolveComment,
  listTimeline,
} from "../api/collabApi";
import { uploadAttachment } from "../api/attachmentApi";
import { listProjects } from "../api/projectApi";
import { listRuns, rerunIssue, cancelTask } from "../api/runsApi";
import AssigneePicker from "../ui/AssigneePicker";
import LabelEditor from "../ui/LabelEditor";
import { useRunConfirm } from "../ui/RunConfirmModal";
import { useAssigneeCandidates } from "../ui/useAssigneeCandidates";
import LoopMarkdown from "../ui/LoopMarkdown";
import AutoGrowTextarea from "../ui/AutoGrowTextarea";
import CommentComposer, { type CommentComposerHandle } from "../ui/CommentComposer";
import { useCommentTriggerPreview } from "../ui/useCommentTriggerPreview";
import { buildRepliesByParent, collectThreadReplies } from "../ui/threadReplies";
import LoopAttachments from "../ui/LoopAttachments";
import { confirmDelete } from "../ui/confirmDelete";
import RunDetailModal from "./RunDetailModal";
import CreateIssueModal from "../ui/CreateIssueModal";
import {
  ISSUE_STATUS_ORDER,
  ISSUE_STATUS_COLOR,
  ISSUE_STATUS_ICON,
  ISSUE_STATUS_HEX,
  PRIORITY_ORDER,
  PRIORITY_COLOR,
  PRIORITY_ICON,
  PRIORITY_HEX,
  RUN_STATUS_HEX,
  RUN_STATUS_HEX_FALLBACK,
  isActiveRun,
} from "../ui/meta";
import LoopTag from "../ui/LoopTag";
import LoopButton from "../ui/LoopButton";
import "./issueDetail.css";

const { Text } = Typography;

// 触发提示 chip(放评论框卡片内左下角):单个 agent → 头像 + 「发送后开始工作」;多个 → 头像叠 +
// 「发送后 N 个智能体开始工作」。点击切换本次跳过(变暗)。new-comment 与 reply 共用。
function WakeChips({ agents, suppressed, onToggle }: {
  agents: CommentTriggerAgent[];
  suppressed: Set<string>;
  onToggle: (id: string) => void;
}) {
  const { t } = useI18n();
  if (agents.length === 0) return null;
  if (agents.length === 1) {
    const a = agents[0];
    const off = suppressed.has(a.id);
    return (
      <Tooltip content={off ? t("loop.comment.triggerClickRestore") : t("loop.comment.triggerClickSkip")} position="top">
        <button type="button" className={`loop-wake-chip${off ? " is-off" : ""}`} aria-pressed={off} onClick={() => onToggle(a.id)}>
          <Avatar size="extra-extra-small" color="light-blue">{a.name.slice(0, 1).toUpperCase()}</Avatar>
          <span>{off ? t("loop.comment.triggerWontStart") : t("loop.comment.triggerWillStart")}</span>
        </button>
      </Tooltip>
    );
  }
  const active = agents.filter((a) => !suppressed.has(a.id)).length;
  return (
    <>
      <span className="loop-wake-stack">
        {agents.map((a) => {
          const off = suppressed.has(a.id);
          return (
            <Tooltip key={a.id} content={`${a.name} · ${off ? t("loop.comment.triggerClickRestore") : t("loop.comment.triggerClickSkip")}`} position="top">
              <button type="button" className={`loop-wake-ava${off ? " is-off" : ""}`} aria-pressed={off} onClick={() => onToggle(a.id)}>
                <Avatar size="extra-extra-small" color="light-blue">{a.name.slice(0, 1).toUpperCase()}</Avatar>
              </button>
            </Tooltip>
          );
        })}
      </span>
      <span className="loop-wake-text">
        {active === 0 ? t("loop.comment.triggerNoneStart") : t("loop.comment.triggerWillStartCount", { values: { count: active } })}
      </span>
    </>
  );
}

// 线程回复输入:懒挂载——默认只显示占位入口,点击才挂 tiptap 编辑器(避免一个 issue 的 N 条评论
// 各常驻一个富编辑器)。回评归到线程根评论;@ agent 同样预览「发送后开始工作」并可本次跳过。
function ThreadReply({
  onSubmit,
  placeholder,
  sendLabel,
  candidates,
  issueId,
  parentId,
}: {
  // 返回 null:评论未创建(保留草稿+文件供重试);返回 File[]:已建,数组=上传失败的附件(空=全成功)。
  onSubmit: (content: string, files: File[], suppressIds: string[]) => Promise<File[] | null>;
  placeholder: string;
  sendLabel: string;
  candidates: AssigneeCandidate[];
  issueId: string;
  parentId: string;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [suppressed, setSuppressed] = useState<Set<string>>(new Set());
  const composerRef = useRef<CommentComposerHandle>(null);
  const triggerAgents = useCommentTriggerPreview(issueId, draft, parentId);

  // keep suppressed pruned to the current wake set (a removed-then-re-added agent
  // shouldn't carry its old skip intent).
  useEffect(() => {
    setSuppressed((prev) => {
      const next = new Set([...prev].filter((id) => triggerAgents.some((a) => a.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [triggerAgents]);

  const toggleSuppress = (id: string) =>
    setSuppressed((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const submit = async () => {
    const c = draft.trim();
    if ((!c && files.length === 0) || busy) return;
    setBusy(true);
    const suppressIds = triggerAgents.filter((a) => suppressed.has(a.id)).map((a) => a.id);
    const res = await onSubmit(c, files, suppressIds);
    setBusy(false);
    if (res === null) return; // 未创建:保留草稿与文件
    setDraft("");
    composerRef.current?.clear();
    setFiles(res);
    setSuppressed(new Set());
  };

  if (!active) {
    return (
      <div className="loop-cmt__reply">
        <button type="button" className="loop-cmt__reply-stub" onClick={() => setActive(true)}>{placeholder}</button>
      </div>
    );
  }

  return (
    <div className="loop-cmt__reply">
      <CommentComposer
        ref={composerRef}
        candidates={candidates}
        placeholder={placeholder}
        onChange={setDraft}
        onSubmit={submit}
        submitOnEnter
        autoFocus
        disabled={busy}
        footerLeft={<WakeChips agents={triggerAgents} suppressed={suppressed} onToggle={toggleSuppress} />}
        footerRight={
          <>
            <label className="loop-attach-btn" aria-label={t("loop.attach.add")}>
              <Paperclip size={16} />
              <input
                type="file"
                multiple
                hidden
                disabled={busy}
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (picked.length) setFiles((p) => [...p, ...picked]);
                }}
              />
            </label>
            <LoopButton size="sm" icon={<Send size={14} />} onClick={submit} loading={busy} disabled={!draft.trim() && files.length === 0} aria-label={sendLabel} />
          </>
        }
      />
      {files.length > 0 && (
        <div className="loop-filechips">
          {files.map((f, i) => (
            <div key={i} className="loop-filechip">
              <FileText size={16} className="loop-filechip__icon" />
              <span className="loop-filechip__name">{f.name}</span>
              <button type="button" className="loop-filechip__act" onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))} aria-label={t("loop.action.delete")}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export interface IssueDetailPageProps {
  issueId: string;
  onChanged?: () => void;
}

/**
 * Issue 独立详情页（对齐产品设计）：主体(标题/描述/评论) + 右侧属性栏 + 执行日志。
 * 渲染在右主栏（routeRight.push），顶部返回按钮 pop 回列表/看板。
 */
export default function IssueDetailPage({ issueId, onChanged }: IssueDetailPageProps) {
  const { t } = useI18n();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [subscribers, setSubscribers] = useState<IssueSubscriber[]>([]);
  // 订阅者列表是否已成功加载:未加载/加载失败时"我是否已订阅"不可判定,菜单回退到两项都显示。
  const [subLoaded, setSubLoaded] = useState(false);
  const [children, setChildren] = useState<Issue[]>([]);
  const [childCreateOpen, setChildCreateOpen] = useState(false); // 新建子 issue 弹窗
  const [propsOpen, setPropsOpen] = useState(false); // 「编辑属性」弹窗(标签/父回路/日期/阶段)
  const [parentCands, setParentCands] = useState<Issue[]>([]); // 父 issue 选择器候选(懒加载)
  const [projects, setProjects] = useState<Project[]>([]); // 项目候选(内联项目 popup)
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [activeRun, setActiveRun] = useState<TaskRun | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [showRuns, setShowRuns] = useState(false); // 「执行日志」折叠展开
  const [collapsedSecs, setCollapsedSecs] = useState<Set<string>>(new Set()); // 右栏分区折叠
  // 动态块展开态：最后一个动态块默认展开(第一次进来即见最新动态,对标产品设计);
  // expandedActs=被显式展开的(非默认块),collapsedActs=被显式折叠的(默认块)。二者覆盖默认。
  const [expandedActs, setExpandedActs] = useState<Set<string>>(new Set());
  const [collapsedActs, setCollapsedActs] = useState<Set<string>>(new Set());
  const [editingDesc, setEditingDesc] = useState(false);
  const cands = useAssigneeCandidates();
  const { requestAssign, requestStatus, runConfirmModal } = useRunConfirm();
  const [loading, setLoading] = useState(true);
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const mainComposerRef = useRef<CommentComposerHandle>(null);
  const triggerAgents = useCommentTriggerPreview(issueId, commentDraft, null); // 这条评论会唤醒的 agent
  const [suppressed, setSuppressed] = useState<Set<string>>(new Set()); // 被用户跳过的 agent id
  const [busyRunId, setBusyRunId] = useState<string | null>(null); // 正在重跑的 task,防双击
  const [pendingFiles, setPendingFiles] = useState<File[]>([]); // 评论输入区:待随评论提交的本地文件(发送时才上传)
  const [uploading, setUploading] = useState(false); // issue 附件上传中
  const [submitting, setSubmitting] = useState(false); // 评论提交中(含附件上传),防重复提交

  // 每次 reload 递增;异步响应回来前先比对 token,丢弃 issueId 原地切换后到达的旧请求结果,
  // 防止慢请求(issue A)在切到 B 后把 A 的数据写进 B 的视图(导航竞态)。
  const reqRef = useRef(0);

  const reload = () => {
    const token = ++reqRef.current;
    const fresh = () => token === reqRef.current;
    setLoading(true);
    // 重置随 issueId 变化的异步辅助 state:避免 issueId 原地切换时(如后续点子项跳转)
    // 短暂残留上一个 issue 的子列表、订阅者、父候选(旧候选还会漏掉新的自己)。
    setChildren([]);
    setSubscribers([]);
    setSubLoaded(false);
    setParentCands([]);
    setTimeline([]);
    Promise.all([getIssue(issueId), listComments(issueId), listRuns(issueId)])
      .then(([i, c, r]) => {
        if (!fresh()) return;
        setIssue(i);
        setComments(c);
        setRuns(r);
        setTitleDraft(i?.title ?? "");
        setDescDraft(i?.description ?? "");
      })
      .catch(() => { if (fresh()) Toast.error(t("loop.detail.notFound")); })
      .finally(() => { if (fresh()) setLoading(false); });
    // 订阅者、子 issue、时间线旁路加载:失败不影响主体渲染;同样按 token 丢弃过期响应。
    listSubscribers(issueId).then((s) => { if (fresh()) { setSubscribers(s); setSubLoaded(true); } }).catch(() => {});
    listChildren(issueId).then((c) => { if (fresh()) setChildren(c); }).catch(() => {});
    listTimeline(issueId).then((tl) => { if (fresh()) setTimeline(tl); }).catch(() => {});
  };

  useEffect(reload, [issueId]);

  // 项目候选:内联「项目」popup 用;工作区级、随详情挂载取一次。
  useEffect(() => {
    listProjects().then(setProjects).catch(() => {});
  }, []);

  const patch = async (p: Parameters<typeof updateIssue>[1]) => {
    if (!issue) return;
    try {
      const updated = await updateIssue(issue.id, p);
      // PUT 响应不带 labels/reactions/attachments(仅 list/detail 端点回填);re-enrich 修回
      // assignee_name/project_name 等展示字段(按新值重算),labels/reactions/attachments 保留当前值,避免编辑后被清空。
      setIssue({
        ...(await enrichIssue(updated)),
        labels: updated.labels ?? issue.labels,
        reactions: updated.reactions ?? issue.reactions,
        attachments: updated.attachments ?? issue.attachments,
      });
      Toast.success(t("loop.toast.saved"));
      onChanged?.();
    } catch (e) {
      // 后端可能拒绝(如父 issue 环检测、非法日期):给出反馈,避免静默失败。
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    }
  };

  // 轻量刷新 issue(标签挂/摘、反应后重取 detail,含最新 labels/reactions;不重置草稿、不整页 loading)。
  // token 由调用方在 mutation 前捕获传入:issueId 原地切换后到达的旧结果丢弃(同 reload)。
  const syncIssue = (token: number) =>
    getIssue(issueId).then((i) => { if (token === reqRef.current) setIssue(i); }).catch(() => {});

  // 变更后重取评论并写状态;token 同样由调用方在 mutation 前捕获传入(避免切 issue 后旧评论写进新视图)。
  const reloadComments = async (token: number) => {
    const c = await listComments(issueId);
    if (token === reqRef.current) setComments(c);
  };

  // 父 issue 选择器:「编辑属性」弹窗展开时懒加载工作区 issue 作候选(排除自己;环检测由后端兜底)。
  const loadParentCands = () => {
    if (parentCands.length) return;
    const token = reqRef.current;
    listIssues({ limit: 100 })
      .then((r) => { if (token === reqRef.current) setParentCands(r.issues.filter((i) => i.id !== issueId)); })
      .catch(() => {});
  };

  // 订阅/取消订阅(后端默认操作调用者本人、幂等)。
  const toggleSubscribe = async (on: boolean) => {
    const token = reqRef.current;
    try {
      await (on ? subscribeIssue : unsubscribeIssue)(issueId);
    } catch (e) {
      // mutation 失败:服务端状态未变,不动本地订阅态。
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
      return;
    }
    Toast.success(t(on ? "loop.subscribe.subscribed" : "loop.subscribe.unsubscribed"));
    // mutation 成功后刷新确认新状态;刷新失败则把订阅态标记为"未知"(subLoaded=false),
    // 菜单回退到两项都显示——否则会留下过期的"已知"态(如刚订阅成功但列表还是旧的空),
    // 导致服务端已订阅、菜单却只显示「订阅」、藏了「取消订阅」(即本修复要防的回归)。
    try {
      const s = await listSubscribers(issueId);
      if (token === reqRef.current) { setSubscribers(s); setSubLoaded(true); }
    } catch {
      if (token === reqRef.current) setSubLoaded(false);
    }
  };

  // 当前 octo 成员是否已订阅:subscriber 现在带 octo_uid(仅 member 有),与
  // loginInfo.uid 比对即可判定,无需前端反查 member↔user 映射(去桥后仍成立)。
  // 三态:列表未成功加载、或后端未透出 octo_uid(前后端独立上线的版本错配窗口)时
  // "我是否已订阅"不可判定 → selfKnown=false,菜单回退到"订阅+取消订阅"两项都显示,
  // 避免已订阅用户在此期间够不到 unsubscribe(#645 单一 toggle 的回归)。
  const myUid = WKApp.loginInfo.uid;
  const memberSubs = subscribers.filter((s) => s.user_type === "member");
  const octoUidSkew = memberSubs.length > 0 && memberSubs.every((s) => s.octo_uid == null);
  const selfKnown = subLoaded && !octoUidSkew && !!myUid;
  const amSubscribed = !!myUid && memberSubs.some((s) => s.octo_uid === myUid);
  const subscribeItem = (
    <Dropdown.Item icon={<Bell size={13} />} onClick={() => toggleSubscribe(true)}>
      {t("loop.subscribe.subscribe")}
    </Dropdown.Item>
  );
  const unsubscribeItem = (
    <Dropdown.Item icon={<BellOff size={13} />} onClick={() => toggleSubscribe(false)}>
      {t("loop.subscribe.unsubscribe")}
    </Dropdown.Item>
  );

  // 写操作与"写后刷新"分离的通用漏斗:只有写失败才报错并中止;写成功后先跑同步的成功处理
  // (onOk:toast / 本地 state,不会抛),再刷新——刷新失败不当作写失败、不误报、也不 strand 已成功的写。
  // 收敛这一类 async 写(reaction / resolve / 删评论),杜绝"写+刷新同一 try"导致刷新失败误报或漏处理
  // (原则:修一类而非单点)。
  const mutateThenRefresh = async (
    mutate: () => Promise<unknown>,
    refresh: () => Promise<unknown>,
    onOk?: () => void,
  ) => {
    try {
      await mutate();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
      return;
    }
    onOk?.();
    try {
      await refresh();
    } catch {
      /* 刷新失败:写已成功,不误报;下次 reload 自愈 */
    }
  };

  // 评论 resolve/unresolve:后端「一线程至多一条 resolved」会清同线程兄弟,操作后重拉评论即可。
  // (resolve 只发实时事件、不写 activity_log,故活动流无需刷新。)
  const toggleResolve = (commentId: string, resolved: boolean) => {
    const token = reqRef.current;
    return mutateThenRefresh(
      () => (resolved ? unresolveComment : resolveComment)(commentId),
      () => reloadComments(token),
    );
  };

  // 评论附件:本地持有 File,发送时才带 commentId 上传绑定(见 submitComment),
  // 避免像 issue-first 那样在评论发出前就产生 issue 级孤儿附件。取消/离开=什么都没上传。
  const addPendingFiles = (files: FileList | null) => {
    if (!files?.length) return;
    // 同步捕获数组:调用点随后会 e.target.value="" 清空 FileList,若在 setState 更新函数里再读会丢多选文件。
    const arr = Array.from(files);
    setPendingFiles((p) => [...p, ...arr]);
  };
  const removePendingFile = (idx: number) => setPendingFiles((p) => p.filter((_, i) => i !== idx));

  // issue 附件:issue 已存在,选完即刻带 issueId 上传绑定并重取详情读回。
  const uploadForIssue = async (files: FileList | null) => {
    if (!files?.length) return;
    const token = reqRef.current;
    setUploading(true);
    let failed = 0;
    try {
      // 逐文件隔离:一个失败不影响其余(与 submitComment 一致),否则首个失败会漏传后续文件。
      for (const f of Array.from(files)) {
        try {
          await uploadAttachment(f, { issueId });
        } catch {
          failed++;
        }
      }
    } finally {
      if (failed) Toast.error(t("loop.toast.attachFailed", { values: { count: failed } }));
      // 先解锁再触发重取(syncIssue 自带 catch、fire-and-forget):即使重取失败也不会把上传按钮永久卡在 disabled。
      setUploading(false);
      syncIssue(token);
    }
  };

  // 附件渲染(评论/issue 共用):图片内联缩略,其它为带图标的下载链接。
  // 走 LoopAttachments:带鉴权取字节转 object URL —— download_url 是 auth-only,
  // 原生 <img src> 带不上 token,且 octo-web 下 /api 代理到别的后端会 404(裂图)。
  const renderAttachments = (atts: Attachment[] | null | undefined) => (
    <LoopAttachments attachments={atts} />
  );

  const submitComment = async () => {
    const content = commentDraft.trim();
    if (!content || submitting) return;
    const token = reqRef.current;
    const files = pendingFiles;
    const suppressIds = triggerAgents.filter((a) => suppressed.has(a.id)).map((a) => a.id);
    setSubmitting(true);
    try {
      let comment: IssueComment;
      try {
        comment = await addComment(issueId, content, null, suppressIds);
      } catch (e) {
        // 评论未创建:保留草稿/待发文件供重试。
        Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
        return;
      }
      // 评论已创建 → 立即清理输入态,避免后续附件上传失败时用户重复提交同一条评论。
      setCommentDraft("");
      mainComposerRef.current?.clear();
      setSuppressed(new Set());
      setPendingFiles([]);
      // 把待发文件带 commentId 绑到已建评论;单个失败只记录、不回滚评论。
      const failedFiles: File[] = [];
      for (const f of files) {
        try {
          await uploadAttachment(f, { commentId: comment.id });
        } catch {
          failedFiles.push(f);
        }
      }
      // 先做失败回填 + 文案(同步、不会抛),再刷新评论列表:reloadComments await listComments 可能抛,
      // 若放在其后,reload 失败会跳过回填 → 失败文件再次丢失(#647 评审抓到的排序缺口)。
      if (failedFiles.length) {
        // 评论已建成功、仅附件失败:把失败文件放回输入区(否则文件对象被丢弃、永久丢失且无重试入口),
        // 并用区分于"评论失败"的文案——避免误导用户以为整条评论没发出去。
        setPendingFiles(failedFiles);
        Toast.error(t("loop.toast.commentAttachFailed", { values: { count: failedFiles.length } }));
      } else {
        Toast.success(t("loop.toast.commentAdded"));
      }
      await reloadComments(token);
    } finally {
      setSubmitting(false);
    }
  };

  // 预览更新时把 suppressed 裁剪到当前触发集,避免"移除又重提及"的 agent 带着旧的跳过意图。
  useEffect(() => {
    setSuppressed((s) => {
      const next = new Set([...s].filter((id) => triggerAgents.some((a) => a.id === id)));
      return next.size === s.size ? s : next;
    });
  }, [triggerAgents]);

  const toggleSuppress = (id: string) =>
    setSuppressed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // 线程回复:回评归到根评论(parent=rootId)。附件在评论创建后带 commentId 绑定(逐个隔离)。
  // 返回 null:评论未创建(输入框保留草稿+全部文件);返回失败附件列表:评论已建,
  // 仅这些附件上传失败——与 submitComment 一致地回填失败文件而非静默丢弃(#668 评审)。
  const replyToThread = async (rootId: string, content: string, files: File[], suppressIds: string[]): Promise<File[] | null> => {
    const token = reqRef.current;
    let comment: IssueComment;
    try {
      comment = await addComment(issueId, content, rootId, suppressIds);
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
      return null;
    }
    const failedFiles: File[] = [];
    for (const f of files) {
      try { await uploadAttachment(f, { commentId: comment.id }); } catch { failedFiles.push(f); }
    }
    if (failedFiles.length) Toast.error(t("loop.toast.commentAttachFailed", { values: { count: failedFiles.length } }));
    else Toast.success(t("loop.toast.commentAdded"));
    try { await reloadComments(token); } catch { /* 刷新失败:下次 reload 自愈 */ }
    return failedFiles;
  };

  const removeComment = (id: string) => {
    const token = reqRef.current;
    // 删除失败→报错(否则静默);删除成功→先弹 commentDeleted(刷新前),再刷新评论列表。
    return mutateThenRefresh(
      () => deleteComment(id),
      () => reloadComments(token),
      () => Toast.success(t("loop.toast.commentDeleted")),
    );
  };

  const handleDeleteIssue = () => {
    if (!issue) return;
    confirmDelete({
      title: t("loop.confirm.deleteIssue"),
      okText: t("loop.action.delete"),
      cancelText: t("loop.action.cancel"),
      onOk: async () => {
        try {
          await deleteIssue(issue.id);
          Toast.success(t("loop.toast.deleted"));
          onChanged?.();
          back();
        } catch (e) {
          Toast.error((e as Error)?.message ?? t("loop.toast.deleteFailed"));
        }
      },
    });
  };

  const back = () => WKApp.routeRight.pop();

  const openRun = (run: TaskRun) => {
    setActiveRun(run);
    setRunOpen(true);
  };

  // 打开子回路详情（递归复用本页，key 隔离跨 issue 陈旧写入）。
  const openChild = (id: string) => {
    WKApp.routeRight.push(<IssueDetailPage key={id} issueId={id} onChanged={onChanged} />);
  };

  const reloadRuns = () => listRuns(issueId).then(setRuns).catch(() => {});

  // 重跑该 task 的 agent（后端按 task_id 新建一次 fresh run）。busyRunId 防双击重复派单。
  const rerun = async (taskId: string) => {
    if (busyRunId) return;
    setBusyRunId(taskId);
    try {
      await rerunIssue(issueId, taskId);
      Toast.success(t("loop.run.rerunStarted"));
      await reloadRuns();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    } finally {
      setBusyRunId(null);
    }
  };

  // 终止运行中的 task，二次确认。
  const cancelRun = (taskId: string) => {
    confirmDelete({
      title: t("loop.run.cancelConfirm"),
      okText: t("loop.run.stop"),
      cancelText: t("loop.action.cancel"),
      onOk: async () => {
        try {
          await cancelTask(issueId, taskId);
          Toast.success(t("loop.run.cancelled"));
          await reloadRuns();
        } catch (e) {
          Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
        }
      },
    });
  };

  const saveDesc = async () => {
    if (descDraft !== (issue?.description ?? "")) await patch({ description: descDraft });
    setEditingDesc(false);
  };

  // 右上角 ··· 菜单：编辑属性(标签/父回路/日期/阶段) / 新建子回路 / 订阅 / 删除。
  // 状态/优先级/负责人/项目 改走右栏内联点击 popup(对标产品设计),不在此重复。
  const renderMoreMenu = () => (
    <Dropdown.Menu>
      <Dropdown.Item icon={<SlidersHorizontal size={13} />} onClick={() => { loadParentCands(); setPropsOpen(true); }}>
        {t("loop.menu.editProps")}
      </Dropdown.Item>
      <Dropdown.Item icon={<Plus size={13} />} onClick={() => setChildCreateOpen(true)}>
        {t("loop.subIssue.create")}
      </Dropdown.Item>
      <Dropdown.Divider />
      {/* 订阅态不可判定(未加载/加载失败/后端未透出 octo_uid)时两项都显示,保证 unsubscribe 可达 */}
      {!selfKnown ? (
        <>
          {subscribeItem}
          {unsubscribeItem}
        </>
      ) : amSubscribed ? (
        unsubscribeItem
      ) : (
        subscribeItem
      )}
      <Dropdown.Divider />
      <Dropdown.Item type="danger" icon={<Trash2 size={13} />} onClick={handleDeleteIssue}>
        {t("loop.menu.deleteIssue")}
      </Dropdown.Item>
    </Dropdown.Menu>
  );

  if (loading && !issue) {
    return (
      <div className="loop-idp">
        <div className="loop-idp__center">
          <Spin />
        </div>
      </div>
    );
  }
  if (!issue) {
    return (
      <div className="loop-idp">
        <div className="loop-idp__topbar">
          <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>
            {t("loop.detail.back")}
          </Button>
        </div>
        <div className="loop-idp__center">
          <Text type="tertiary">{t("loop.detail.notFound")}</Text>
        </div>
      </div>
    );
  }

  const roots = comments.filter((c) => !c.parent_id);
  // Every descendant of a thread root, flattened chronologically. Not just
  // direct children: an agent reply nests under the member comment that
  // triggered it (a grandchild of the root), so direct-children-only would drop
  // every agent answer from the thread. See collectThreadReplies.
  const repliesByParent = buildRepliesByParent(comments);
  const repliesOf = (id: string) => collectThreadReplies(id, repliesByParent);
  const childrenDone = children.filter((c) => c.status === "done").length;
  // issue 附件区只显 issue 级(comment_id 为空);评论附件归各评论下,避免重复。
  const issueAtts = (issue.attachments ?? []).filter((a) => !a.comment_id);
  const StatusIcon = ISSUE_STATUS_ICON[issue.status];
  const PriIcon = PRIORITY_ICON[issue.priority];
  const secOpen = (k: string) => !collapsedSecs.has(k);
  const toggleSec = (k: string) =>
    setCollapsedSecs((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // 评论线程(对标产品设计)：主评论为首行,其所有回评都是同级平铺行(分隔线区分先后,不缩进)；
  // 卡片底部一个回复输入。任何回评都归到主评论(parent=root),视觉上像一张「主评论 + 评审意见」表。
  const renderRow = (c: IssueComment, isRoot: boolean, rootId: string) => (
    <div key={c.id} className={`loop-cmt__row${isRoot ? " is-root" : ""}`}>
      <div className="loop-cmt__head">
        <Avatar size="extra-extra-small" color="light-blue" src={c.author_avatar ?? undefined}>
          {[...(c.author_name ?? "?")][0]}
        </Avatar>
        <Text strong style={{ fontSize: 13 }}>{c.author_name}</Text>
        <time>{fmt(c.created_at)}</time>
        {c.resolved_at && <span className="loop-cmt__resolved">{t("loop.comment.resolved")}</span>}
        <div className="loop-cmt__actions">
          <Dropdown
            trigger="click"
            position="bottomRight"
            clickToHide
            render={
              <Dropdown.Menu>
                <Dropdown.Item icon={<Copy size={13} />} onClick={() => { navigator.clipboard?.writeText(c.content)?.then(() => Toast.success(t("loop.run.copied"))).catch(() => {}); }}>
                  {t("loop.action.copy")}
                </Dropdown.Item>
                <Dropdown.Item icon={c.resolved_at ? <CircleSlash size={13} /> : <Check size={13} />} onClick={() => toggleResolve(c.id, !!c.resolved_at)}>
                  {t(c.resolved_at ? "loop.comment.unresolve" : "loop.comment.resolve")}
                </Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item type="danger" icon={<Trash2 size={13} />} onClick={() => confirmDelete({ title: t("loop.comment.deleteConfirm"), okText: t("loop.action.delete"), cancelText: t("loop.action.cancel"), onOk: () => removeComment(c.id) })}>
                  {t("loop.action.delete")}
                </Dropdown.Item>
              </Dropdown.Menu>
            }
          >
            <Button size="small" theme="borderless" icon={<MoreHorizontal size={15} />} aria-label={t("loop.action.more")} />
          </Dropdown>
        </div>
      </div>
      <div className="loop-cmt__body"><LoopMarkdown content={c.content} /></div>
      {renderAttachments(c.attachments)}
    </div>
  );

  const renderComment = (root: IssueComment) => (
    <div key={root.id} className="loop-cmt">
      {renderRow(root, true, root.id)}
      {repliesOf(root.id).map((r) => renderRow(r, false, root.id))}
      <ThreadReply
        onSubmit={(content, files, suppressIds) => replyToThread(root.id, content, files, suppressIds)}
        placeholder={t("loop.comment.replyPlaceholder")}
        sendLabel={t("loop.comment.send")}
        candidates={cands}
        issueId={issueId}
        parentId={root.id}
      />
    </div>
  );

  // 动态：把活动流(activity) 与顶层评论合并成一条时间线(升序,最新在下、贴近底部输入框),
  // 对齐 Figma —— 不再把「活动」「评论」拆成两个挤在一起的区块。timeline 为 ASC。
  const activities = timeline.filter((e) => e.type === "activity");
  // 活动文案人话化：后端 action 是机器串(如 status_changed),普通运营看不懂。按语义归类成中文；
  // 订阅类噪声直接隐藏(返回 null → 不渲染、不计数)；未知归为通用「更新了这个回路」，绝不暴露原始串。
  const activityText = (action?: string): string | null => {
    if (!action) return null;
    const a = action.toLowerCase();
    if (a.includes("subscrib") || a.includes("view")) return null;
    if (a.includes("creat")) return t("loop.activityAction.created");
    if (a.includes("status")) return t("loop.activityAction.statusChanged");
    if (a.includes("priorit")) return t("loop.activityAction.priorityChanged");
    if (a.includes("assign")) return t("loop.activityAction.assigneeChanged");
    if (a.includes("project")) return t("loop.activityAction.projectChanged");
    if (a.includes("title")) return t("loop.activityAction.titleChanged");
    if (a.includes("descri")) return t("loop.activityAction.descriptionChanged");
    if (a.includes("label")) return t("loop.activityAction.labelChanged");
    if (a.includes("due") || a.includes("date")) return t("loop.activityAction.dateChanged");
    if (a.includes("reopen")) return t("loop.activityAction.reopened");
    if (a.includes("clos") || a.includes("complet") || a.includes("done")) return t("loop.activityAction.completed");
    return t("loop.activityAction.generic");
  };

  // 执行记录单行(运行中/历史 复用)：状态点 + agent 名 + 触发摘要 + 状态文字 + 终止/重跑。
  const renderRunRow = (r: TaskRun) => {
    const active = isActiveRun(r.status);
    return (
      <div key={r.id} className="loop-idp__task">
        <button className="loop-idp__run" onClick={() => openRun(r)}>
          <span
            className={`loop-idp__run-dot${active ? " is-active" : ""}`}
            style={{ background: RUN_STATUS_HEX[r.status] ?? RUN_STATUS_HEX_FALLBACK }}
          />
          <span className="loop-idp__task-main">
            <strong>{r.agent_name ?? r.agent_id ?? "—"}</strong>
            <small>{r.trigger_summary || fmt(r.dispatched_at ?? r.created_at)}</small>
          </span>
          <span className="loop-idp__run-status" style={{ color: RUN_STATUS_HEX[r.status] ?? RUN_STATUS_HEX_FALLBACK }}>
            {t(`loop.taskStatus.${r.status}`)}
          </span>
        </button>
        <Button
          size="small"
          theme="borderless"
          type={active ? "danger" : "tertiary"}
          loading={!active && busyRunId === r.id}
          icon={active ? <Square size={13} /> : <RotateCcw size={13} />}
          aria-label={t(active ? "loop.run.stop" : "loop.run.rerun")}
          onClick={() => (active ? cancelRun(r.id) : rerun(r.id))}
        />
      </div>
    );
  };
  // 运行中/排队中重点常显在外;仅终态归入「显示历史运行」折叠(对标产品设计)。
  const activeRuns = runs.filter((r) => isActiveRun(r.status));
  const pastRuns = runs.filter((r) => !isActiveRun(r.status));

  // 动态区(对标产品设计)：根评论与「有意义的活动」按时间升序合并；连续活动归并成一个折叠动态块，
  // 评论各自独立成卡片。噪声活动(activityText 为 null)先过滤，不进块、不计数。
  const visibleActs = activities.filter((a) => activityText(a.action) !== null);
  type FeedNode = { ts: string; c?: IssueComment; a?: TimelineEntry };
  const seq: FeedNode[] = [
    ...roots.map((c) => ({ ts: c.created_at, c })),
    ...visibleActs.map((a) => ({ ts: a.created_at, a })),
  ].sort((x, y) => new Date(x.ts).getTime() - new Date(y.ts).getTime());
  type FeedGroup =
    | { kind: "comment"; comment: IssueComment }
    | { kind: "acts"; id: string; entries: TimelineEntry[] };
  const feedGroups: FeedGroup[] = [];
  for (const n of seq) {
    if (n.c) {
      feedGroups.push({ kind: "comment", comment: n.c });
    } else if (n.a) {
      const last = feedGroups[feedGroups.length - 1];
      if (last && last.kind === "acts") last.entries.push(n.a);
      else feedGroups.push({ kind: "acts", id: n.a.id, entries: [n.a] });
    }
  }

  // 最后一个动态块默认展开(用户可再折叠);其余默认折叠(用户可再展开)。
  let lastActsId: string | null = null;
  for (const g of feedGroups) if (g.kind === "acts") lastActsId = g.id;
  const isActsOpen = (id: string) =>
    collapsedActs.has(id) ? false : (expandedActs.has(id) || id === lastActsId);
  const toggleActs = (id: string, open: boolean) => {
    if (open) {
      setCollapsedActs((s) => new Set(s).add(id));
      setExpandedActs((s) => { const n = new Set(s); n.delete(id); return n; });
    } else {
      setExpandedActs((s) => new Set(s).add(id));
      setCollapsedActs((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  // 单个折叠动态块：折叠时只一行「N 条动态」(chevron-right,小灰字);展开显示每条活动小行。
  const renderActsBlock = (g: { id: string; entries: TimelineEntry[] }) => {
    const open = isActsOpen(g.id);
    return (
      <div key={`acts-${g.id}`} className="loop-acts">
        <button type="button" className="loop-acts__toggle" onClick={() => toggleActs(g.id, open)}>
          <ChevronRight size={13} className={`loop-acts__chevron${open ? " is-open" : ""}`} />
          <span>{t("loop.activity.count", { values: { count: g.entries.length } })}</span>
        </button>
        {open && (
          <div className="loop-acts__list">
            {g.entries.map((a) => (
              <div key={a.id} className="loop-acts__item">
                <span className="loop-acts__dot" />
                <span className="loop-acts__text">
                  <strong>{a.actor_name ?? a.actor_id}</strong> {activityText(a.action)}
                </span>
                <time>{fmt(a.created_at)}</time>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="loop-idp">
      <div className="loop-idp__topbar">
        <div className="loop-idp__crumbs">
          <button className="loop-idp__crumb" onClick={back}>
            {issue.project_name ?? t("loop.nav.issue")}
          </button>
          <ChevronRight size={14} className="loop-idp__crumb-sep" />
          <span className="loop-idp__crumb-cur">
            <span className="loop-idp__crumb-id">{issue.identifier}</span>
            <span className="loop-idp__crumb-title">{issue.title}</span>
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <Button className="loop-idp__boardbtn" theme="borderless" onClick={back}>
          {t("loop.detail.board")}
        </Button>
        <Dropdown trigger="click" position="bottomRight" render={renderMoreMenu()} clickToHide>
          <Button icon={<MoreHorizontal size={18} />} theme="borderless" aria-label="more" />
        </Dropdown>
      </div>

      <div className="loop-idp__body">
        {/* 主体 */}
        <div className="loop-idp__main">
          <input
            className="loop-field loop-field--lg loop-idp__title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => titleDraft.trim() && titleDraft !== issue.title && patch({ title: titleDraft.trim() })}
          />

          {/* 描述：紧贴标题的段落（点击进入编辑），无独立分区标题，对齐 Figma */}
          {editingDesc ? (
            <AutoGrowTextarea
              className="loop-field-textarea loop-field-textarea--lg loop-field-textarea--auto"
              value={descDraft}
              onChange={setDescDraft}
              onBlur={saveDesc}
              autoFocus
              placeholder={t("loop.field.descriptionPlaceholder")}
            />
          ) : (
            <div className="loop-idp__desc" onClick={() => setEditingDesc(true)}>
              {issue.description ? (
                <LoopMarkdown content={issue.description} />
              ) : (
                <span className="loop-idp__desc-empty">{t("loop.field.descriptionPlaceholder")}</span>
              )}
            </div>
          )}

          {/* issue 附件 + 工具栏（附件上传） */}
          {issueAtts.length > 0 && renderAttachments(issueAtts)}
          <div className="loop-idp__toolbar">
            <label className="loop-attach-btn" aria-label={t("loop.attach.add")}>
              {uploading ? <Spin size="small" /> : <Paperclip size={15} />}
              <input
                type="file"
                multiple
                hidden
                disabled={uploading}
                onChange={(e) => { uploadForIssue(e.target.files); e.target.value = ""; }}
              />
            </label>
          </div>

          {/* 子回路：仅当确有子回路时才展示整个模块(空则不显示,避免突兀的孤零标题) */}
          {children.length > 0 && (
            <div className="loop-idp__section">
              <div className="loop-idp__stitle loop-idp__desc-title">
                <span>
                  {t("loop.subIssue.title")}
                  <em className="loop-idp__count"> {childrenDone} / {children.length}</em>
                </span>
                <Button
                  theme="borderless"
                  size="small"
                  icon={<Plus size={14} />}
                  aria-label={t("loop.subIssue.create")}
                  onClick={() => setChildCreateOpen(true)}
                />
              </div>
              <div className="loop-subissues">
                {children.map((c) => {
                  const SIcon = ISSUE_STATUS_ICON[c.status];
                  const PIcon = PRIORITY_ICON[c.priority];
                  return (
                    <div key={c.id} className="loop-subissue" onClick={() => openChild(c.id)}>
                      <SIcon size={14} strokeWidth={2} style={{ color: ISSUE_STATUS_HEX[c.status] }} />
                      <span className="loop-subissue__id">{c.identifier}</span>
                      <span className="loop-subissue__title">{c.title}</span>
                      <span className="loop-subissue__spacer" />
                      <PIcon size={14} strokeWidth={2} style={{ color: PRIORITY_HEX[c.priority] }} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 动态：活动 + 评论 合并时间线 */}
          <div className="loop-idp__section loop-idp__feed-sec">
            <div className="loop-idp__feed-head">
              <span className="loop-idp__stitle">{t("loop.activity.title")}</span>
              <button
                type="button"
                className="loop-idp__subbtn"
                onClick={() => toggleSubscribe(!(selfKnown && amSubscribed))}
              >
                {selfKnown && amSubscribed ? <BellOff size={13} /> : <Bell size={13} />}
                {selfKnown && amSubscribed ? t("loop.subscribe.unsubscribe") : t("loop.subscribe.subscribe")}
              </button>
            </div>

            <div className="loop-feed">
              {feedGroups.length === 0 ? (
                <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.comment.empty")}</Text>
              ) : (
                feedGroups.map((g) =>
                  g.kind === "comment" ? renderComment(g.comment) : renderActsBlock(g),
                )
              )}
            </div>

            {/* 新建评论：独立区块(分割线 + 多行 textarea),明确区别于上方逐条回复 */}
            <div className="loop-idp__newcomment">
              <CommentComposer
                ref={mainComposerRef}
                candidates={cands}
                placeholder={t("loop.comment.placeholder")}
                onChange={setCommentDraft}
                onSubmit={submitComment}
                footerLeft={<WakeChips agents={triggerAgents} suppressed={suppressed} onToggle={toggleSuppress} />}
                footerRight={
                  <>
                    <label className="loop-attach-btn" aria-label={t("loop.attach.add")}>
                      <Paperclip size={16} />
                      <input type="file" multiple hidden disabled={submitting} onChange={(e) => { addPendingFiles(e.target.files); e.target.value = ""; }} />
                    </label>
                    <LoopButton size="sm" icon={<Send size={14} />} onClick={submitComment} loading={submitting} disabled={!commentDraft.trim() && pendingFiles.length === 0} aria-label={t("loop.comment.send")} />
                  </>
                }
              />
              {pendingFiles.length > 0 && (
                <div className="loop-filechips">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="loop-filechip">
                      <FileText size={16} className="loop-filechip__icon" />
                      <span className="loop-filechip__name">{f.name}</span>
                      <button type="button" className="loop-filechip__act" aria-label={t("loop.action.delete")} onClick={() => removePendingFile(i)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右侧属性栏（只读展示,对齐 Figma 29-1593；改属性走右上角 ⋯ 菜单，对标产品设计） */}
        <aside className="loop-idp__aside">
          <section className="loop-idp__asec">
            <button type="button" className="loop-idp__asec-head" onClick={() => toggleSec("props")}>
              <ChevronRight size={13} className={`loop-idp__asec-chevron${secOpen("props") ? " is-open" : ""}`} />
              {t("loop.detail.properties")}
            </button>
            {secOpen("props") && (
              <div className="loop-idp__asec-body">
                {/* 状态：点击值弹 popup 改(对标产品设计) */}
                <div className="loop-idp__prop loop-idp__prop--inline">
                  <span className="loop-idp__prop-k">{t("loop.field.status")}</span>
                  <Dropdown
                    trigger="click"
                    position="bottomRight"
                    clickToHide
                    render={
                      <Dropdown.Menu>
                        {ISSUE_STATUS_ORDER.map((s) => (
                          <Dropdown.Item key={s} active={issue.status === s} onClick={() => requestStatus(issue, s, (extra) => patch({ status: s, ...extra }))}>
                            <LoopTag tone={ISSUE_STATUS_COLOR[s]}>{t(`loop.status.${s}`)}</LoopTag>
                          </Dropdown.Item>
                        ))}
                      </Dropdown.Menu>
                    }
                  >
                    <button type="button" className="loop-idp__prop-edit">
                      <StatusIcon size={14} strokeWidth={2} style={{ color: ISSUE_STATUS_HEX[issue.status] }} />
                      {t(`loop.status.${issue.status}`)}
                      <ChevronDown size={12} className="loop-idp__prop-caret" />
                    </button>
                  </Dropdown>
                </div>
                {/* 优先级 */}
                <div className="loop-idp__prop loop-idp__prop--inline">
                  <span className="loop-idp__prop-k">{t("loop.field.priority")}</span>
                  <Dropdown
                    trigger="click"
                    position="bottomRight"
                    clickToHide
                    render={
                      <Dropdown.Menu>
                        {PRIORITY_ORDER.map((p) => (
                          <Dropdown.Item key={p} active={issue.priority === p} onClick={() => patch({ priority: p })}>
                            <LoopTag tone={PRIORITY_COLOR[p]}>{t(`loop.priority.${p}`)}</LoopTag>
                          </Dropdown.Item>
                        ))}
                      </Dropdown.Menu>
                    }
                  >
                    <button type="button" className="loop-idp__prop-edit">
                      <PriIcon size={14} strokeWidth={2} style={{ color: PRIORITY_HEX[issue.priority] }} />
                      {t(`loop.priority.${issue.priority}`)}
                      <ChevronDown size={12} className="loop-idp__prop-caret" />
                    </button>
                  </Dropdown>
                </div>
                {/* 负责人：复用 AssigneePicker(自带点击 popup + 三态) */}
                <div className="loop-idp__prop loop-idp__prop--inline">
                  <span className="loop-idp__prop-k">{t("loop.field.assignee")}</span>
                  <AssigneePicker
                    size="small"
                    value={issue.assignee_id}
                    valueName={issue.assignee_name ?? null}
                    onChange={(id, type, name) => requestAssign(issue, type, id, name, (extra) => patch({ assignee_id: id, assignee_type: type, ...extra }))}
                  />
                </div>
                {/* 项目 */}
                <div className="loop-idp__prop loop-idp__prop--inline">
                  <span className="loop-idp__prop-k">{t("loop.field.project")}</span>
                  <Dropdown
                    trigger="click"
                    position="bottomRight"
                    clickToHide
                    render={
                      <Dropdown.Menu>
                        <Dropdown.Item active={!issue.project_id} onClick={() => patch({ project_id: null })}>
                          {t("loop.field.noProject")}
                        </Dropdown.Item>
                        {projects.length > 0 && <Dropdown.Divider />}
                        {projects.map((p) => (
                          <Dropdown.Item key={p.id} active={issue.project_id === p.id} onClick={() => patch({ project_id: p.id })}>
                            {p.icon} {p.title}
                          </Dropdown.Item>
                        ))}
                      </Dropdown.Menu>
                    }
                  >
                    <button type="button" className="loop-idp__prop-edit loop-idp__prop-edit--text">
                      {issue.project_name ?? t("loop.field.noProject")}
                      <ChevronDown size={12} className="loop-idp__prop-caret" />
                    </button>
                  </Dropdown>
                </div>
              </div>
            )}
          </section>

          <section className="loop-idp__asec">
            <button type="button" className="loop-idp__asec-head" onClick={() => toggleSec("detail")}>
              <ChevronRight size={13} className={`loop-idp__asec-chevron${secOpen("detail") ? " is-open" : ""}`} />
              {t("loop.detail.detailsTitle")}
            </button>
            {secOpen("detail") && (
              <div className="loop-idp__asec-body">
                <div className="loop-idp__prop loop-idp__prop--inline">
                  <span className="loop-idp__prop-k">{t("loop.field.creator")}</span>
                  <span className="loop-idp__prop-person">
                    <Avatar size="extra-extra-small" color="light-blue" src={issue.creator_avatar ?? undefined}>
                      {[...(issue.creator_name ?? "?")][0]}
                    </Avatar>
                    {issue.creator_name ?? "—"}
                  </span>
                </div>
                <div className="loop-idp__prop loop-idp__prop--inline">
                  <span className="loop-idp__prop-k">{t("loop.detail.created")}</span>
                  <span className="loop-idp__prop-v loop-idp__prop-v--muted">{fmt(issue.created_at)}</span>
                </div>
                <div className="loop-idp__prop loop-idp__prop--inline">
                  <span className="loop-idp__prop-k">{t("loop.detail.updated")}</span>
                  <span className="loop-idp__prop-v loop-idp__prop-v--muted">{fmt(issue.updated_at)}</span>
                </div>
              </div>
            )}
          </section>

          <section className="loop-idp__asec">
            <button type="button" className="loop-idp__asec-head" onClick={() => toggleSec("runs")}>
              <ChevronRight size={13} className={`loop-idp__asec-chevron${secOpen("runs") ? " is-open" : ""}`} />
              {t("loop.detail.execLog")}
            </button>
            {secOpen("runs") && (
              <div className="loop-idp__asec-body">
                {runs.length === 0 ? (
                  <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.run.empty")}</Text>
                ) : (
                  <>
                    {/* 运行中/排队中 —— 重点常显 */}
                    {activeRuns.length > 0 && (
                      <div className="loop-idp__tasks">
                        {activeRuns.map(renderRunRow)}
                      </div>
                    )}
                    {/* 历史(终态) —— 折叠 */}
                    {pastRuns.length > 0 && (
                      <>
                        <button type="button" className="loop-idp__runs-toggle" onClick={() => setShowRuns((s) => !s)}>
                          <ChevronRight size={13} className={`loop-idp__runs-chevron${showRuns ? " is-open" : ""}`} />
                          {t("loop.run.showHistory", { values: { count: pastRuns.length } })}
                        </button>
                        {showRuns && <div className="loop-idp__tasks">{pastRuns.map(renderRunRow)}</div>}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        </aside>
      </div>

      <RunDetailModal run={activeRun} visible={runOpen} onClose={() => setRunOpen(false)} />
      {runConfirmModal}
      <CreateIssueModal
        visible={childCreateOpen}
        parentIssueId={issueId}
        onClose={() => setChildCreateOpen(false)}
        onCreated={() => {
          Toast.success(t("loop.toast.created"));
          // 只刷新子列表(非整页 reload,避免详情主体闪 loading);key-remount 已隔离跨 issue 陈旧写入。
          listChildren(issueId).then(setChildren).catch(() => {});
          // 通知父级:新子 issue 改变了父看板的子进度/计数,不刷父会陈旧。
          onChanged?.();
        }}
      />

      {/* 编辑属性弹窗：标签 / 父回路 / 开始/截止日期 / 阶段（侧栏保持只读，编辑走 ⋯ → 此弹窗） */}
      <Modal
        className="loop-modal"
        title={t("loop.menu.editProps")}
        visible={propsOpen}
        onCancel={() => setPropsOpen(false)}
        footer={null}
        width={460}
      >
        <div className="loop-fields">
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.field.labels")}</div>
            <LabelEditor issueId={issue.id} labels={issue.labels} onChanged={() => { syncIssue(reqRef.current); onChanged?.(); }} />
          </div>
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.field.parent")}</div>
            <Select
              value={issue.parent_issue_id ?? undefined}
              onChange={(v) => patch({ parent_issue_id: (v as string) || "" })}
              dropdownClassName="loop-fields__dropdown"
              placeholder={t("loop.field.noParent")}
              filter
              showClear
              style={{ width: "100%" }}
            >
              {parentCands.map((i) => (
                <Select.Option key={i.id} value={i.id}>{i.identifier} {i.title}</Select.Option>
              ))}
            </Select>
          </div>
          <div className="loop-fields__row">
            <div className="loop-fields__inline">
              <div style={{ flex: 1 }}>
                <div className="loop-fields__label">{t("loop.field.startDate")}</div>
                <DatePicker
                  type="date"
                  format="yyyy-MM-dd"
                  value={issue.start_date ? issue.start_date.slice(0, 10) : undefined}
                  onChange={(_, ds) => patch({ start_date: (ds as string) || "" })}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div className="loop-fields__label">{t("loop.field.dueDate")}</div>
                <DatePicker
                  type="date"
                  format="yyyy-MM-dd"
                  value={issue.due_date ? issue.due_date.slice(0, 10) : undefined}
                  onChange={(_, ds) => patch({ due_date: (ds as string) || "" })}
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          </div>
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.field.stage")}</div>
            <InputNumber
              value={issue.stage ?? undefined}
              onChange={(v) => { if (typeof v === "number") patch({ stage: v }); }}
              min={1}
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
