import React, { useEffect, useRef, useState } from "react";
import {
  Typography,
  Select,
  Button,
  Avatar,
  Tag,
  Spin,
  Toast,
  Dropdown,
  DatePicker,
  InputNumber,
} from "@douyinfe/semi-ui";
import {
  ArrowLeft,
  Trash2,
  CornerDownRight,
  Send,
  MoreHorizontal,
  CircleSlash,
  Pencil,
  Check,
  Square,
  RotateCcw,
  Bell,
  BellOff,
  Paperclip,
  AtSign,
  Plus,
  ChevronRight,
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
  updateComment,
  previewCommentTriggers,
} from "../api/issueApi";
import {
  listSubscribers,
  subscribeIssue,
  unsubscribeIssue,
  addCommentReaction,
  removeCommentReaction,
  addIssueReaction,
  removeIssueReaction,
  resolveComment,
  unresolveComment,
  listTimeline,
} from "../api/collabApi";
import { uploadAttachment } from "../api/attachmentApi";
import { listRuns, rerunIssue, cancelTask } from "../api/runsApi";
import AssigneePicker from "../ui/AssigneePicker";
import LabelEditor from "../ui/LabelEditor";
import { useRunConfirm } from "../ui/RunConfirmModal";
import { useAssigneeCandidates } from "../ui/useAssigneeCandidates";
import LoopMarkdown from "../ui/LoopMarkdown";
import AutoGrowTextarea from "../ui/AutoGrowTextarea";
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
import "./issueDetail.css";

const { Text } = Typography;

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
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [parentCands, setParentCands] = useState<Issue[]>([]); // 父 issue 选择器候选(懒加载)
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [activeRun, setActiveRun] = useState<TaskRun | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [showRuns, setShowRuns] = useState(false); // 「执行日志」折叠展开
  const [editingDesc, setEditingDesc] = useState(false);
  const cands = useAssigneeCandidates();
  const { requestAssign, requestStatus, runConfirmModal } = useRunConfirm();
  const [loading, setLoading] = useState(true);
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [triggerAgents, setTriggerAgents] = useState<CommentTriggerAgent[]>([]); // 这条评论会唤醒的 agent
  const [suppressed, setSuppressed] = useState<Set<string>>(new Set()); // 被用户跳过的 agent id
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
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

  // 父 issue 选择器:下拉展开时懒加载工作区 issue 作候选(排除自己;环检测由后端兜底)。
  const loadParentCands = (open: boolean) => {
    if (!open || parentCands.length) return;
    const token = reqRef.current;
    // ponytail: 取前 100 条工作区 issue + Select 客户端过滤;小工作区够用,
    // 大工作区需服务端 search-as-you-type,留给 UI 重做。
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

  // @提及:选中候选(成员/AI队友/AI小队)→ 往草稿插入 mention markdown。
  // 后端 util.MentionRe 认 [@Label](mention://<type>/<id>);插入草稿后 previewCommentTriggers 会反映"将唤醒"。
  const insertMention = (c: AssigneeCandidate) => {
    // label 剥掉 []:名字里的方括号会破坏 markdown 链接语法 [label](url);id 才是真引用,label 仅显示。
    const label = c.name.replace(/[[\]]/g, "");
    const token = `[@${label}](mention://${c.type}/${c.id})`;
    setCommentDraft((d) => (d && !d.endsWith(" ") ? d + " " : d) + token + " ");
  };

  // 评论附件:本地持有 File,发送时才带 commentId 上传绑定(见 submitComment),
  // 避免像 issue-first 那样在评论发出前就产生 issue 级孤儿附件。取消/离开=什么都没上传。
  const addPendingFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setPendingFiles((p) => [...p, ...Array.from(files)]);
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

  // 附件渲染(评论/issue 共用):图片内联缩略,其它为带图标的下载链接(用短时 download_url)。
  const renderAttachments = (atts: Attachment[] | null | undefined) => {
    if (!atts?.length) return null;
    return (
      <div className="loop-atts">
        {atts.map((a) =>
          a.content_type.startsWith("image/") ? (
            <a key={a.id} href={a.download_url} target="_blank" rel="noreferrer" className="loop-att loop-att--img">
              <img src={a.download_url} alt={a.filename} />
            </a>
          ) : (
            <a key={a.id} href={a.download_url} target="_blank" rel="noreferrer" className="loop-att">
              <Paperclip size={12} />
              <span>{a.filename}</span>
            </a>
          ),
        )}
      </div>
    );
  };

  const submitComment = async () => {
    const content = commentDraft.trim();
    if (!content || submitting) return;
    const token = reqRef.current;
    // 附件只随顶层评论;回复不带(pendingFiles 属主输入区)。
    const files = replyTo ? [] : pendingFiles;
    const suppressIds = triggerAgents.filter((a) => suppressed.has(a.id)).map((a) => a.id);
    setSubmitting(true);
    try {
      let comment: IssueComment;
      try {
        comment = await addComment(issueId, content, replyTo, suppressIds);
      } catch (e) {
        // 评论未创建:保留草稿/待发文件供重试。
        Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
        return;
      }
      // 评论已创建 → 立即清理输入态,避免后续附件上传失败时用户重复提交同一条评论。
      setCommentDraft("");
      setReplyTo(null);
      setTriggerAgents([]);
      setSuppressed(new Set());
      if (!replyTo) setPendingFiles([]);
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
        if (!replyTo) setPendingFiles(failedFiles);
        Toast.error(t("loop.toast.commentAttachFailed", { values: { count: failedFiles.length } }));
      } else {
        Toast.success(t("loop.toast.commentAdded"));
      }
      await reloadComments(token);
    } finally {
      setSubmitting(false);
    }
  };

  // 顶层评论输入时防抖预览"会唤醒哪些 agent"(回复暂不预览)。
  useEffect(() => {
    const content = commentDraft.trim();
    // 预览更新时把 suppressed 裁剪到当前触发集,避免"移除又重提及"的 agent 带着旧的跳过意图。
    const prune = (ids: string[]) => setSuppressed((s) => new Set([...s].filter((id) => ids.includes(id))));
    if (!content || replyTo) { setTriggerAgents([]); prune([]); return; }
    let cancelled = false;
    const h = setTimeout(() => {
      previewCommentTriggers(issueId, content, null)
        .then((a) => { if (cancelled) return; setTriggerAgents(a); prune(a.map((x) => x.id)); })
        .catch(() => { if (cancelled) return; setTriggerAgents([]); prune([]); });
    }, 400);
    return () => { cancelled = true; clearTimeout(h); };
  }, [commentDraft, replyTo, issueId]);

  const toggleSuppress = (id: string) =>
    setSuppressed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const removeComment = (id: string) => {
    const token = reqRef.current;
    // 删除失败→报错(否则静默);删除成功→先弹 commentDeleted(刷新前),再刷新评论列表。
    return mutateThenRefresh(
      () => deleteComment(id),
      () => reloadComments(token),
      () => Toast.success(t("loop.toast.commentDeleted")),
    );
  };

  const saveEdit = async (id: string) => {
    const content = editDraft.trim();
    if (!content) return;
    const token = reqRef.current;
    try {
      await updateComment(id, content);
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.editFailed"));
      return;
    }
    // 编辑已落库；重拉以回填 directory 名字/头像。重拉失败不应报“编辑失败”。
    setEditingId(null);
    await reloadComments(token);
    Toast.success(t("loop.toast.commentUpdated"));
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

  // 右上角 ··· 菜单：快速改 status / priority / assignee（对齐产品设计）。
  const renderMoreMenu = () => (
    <Dropdown.Menu>
      <Dropdown
        position="leftTop"
        trigger="hover"
        clickToHide
        render={
          <Dropdown.Menu>
            {ISSUE_STATUS_ORDER.map((s) => (
              <Dropdown.Item key={s} active={issue?.status === s} onClick={() => issue && requestStatus(issue, s, (extra) => patch({ status: s, ...extra }))}>
                <Tag color={ISSUE_STATUS_COLOR[s]} size="small">{t(`loop.status.${s}`)}</Tag>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        }
      >
        <Dropdown.Item onClick={(e) => e.stopPropagation()}>{t("loop.menu.changeStatus")}</Dropdown.Item>
      </Dropdown>
      <Dropdown
        position="leftTop"
        trigger="hover"
        clickToHide
        render={
          <Dropdown.Menu>
            {PRIORITY_ORDER.map((p) => (
              <Dropdown.Item key={p} active={issue?.priority === p} onClick={() => patch({ priority: p })}>
                <Tag color={PRIORITY_COLOR[p]} size="small">{t(`loop.priority.${p}`)}</Tag>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        }
      >
        <Dropdown.Item onClick={(e) => e.stopPropagation()}>{t("loop.menu.changePriority")}</Dropdown.Item>
      </Dropdown>
      <Dropdown
        position="leftTop"
        trigger="hover"
        clickToHide
        render={
          <Dropdown.Menu>
            <Dropdown.Item icon={<CircleSlash size={13} />} onClick={() => patch({ assignee_id: null, assignee_type: null })}>
              {t("loop.assignee.unassigned")}
            </Dropdown.Item>
            {(["member", "agent", "squad"] as const).map((type) => {
              const items = cands.filter((c) => c.type === type);
              if (!items.length) return null;
              return (
                <React.Fragment key={type}>
                  <Dropdown.Divider />
                  <Dropdown.Title>{t(`loop.assignee.${type}`)}</Dropdown.Title>
                  {items.map((c) => (
                    <Dropdown.Item key={c.id} active={issue?.assignee_id === c.id} onClick={() => issue && requestAssign(issue, c.type, c.id, c.name, (extra) => patch({ assignee_id: c.id, assignee_type: c.type, ...extra }))}>
                      {c.name}
                    </Dropdown.Item>
                  ))}
                </React.Fragment>
              );
            })}
          </Dropdown.Menu>
        }
      >
        <Dropdown.Item onClick={(e) => e.stopPropagation()}>{t("loop.menu.changeAssignee")}</Dropdown.Item>
      </Dropdown>
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
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);
  const childrenDone = children.filter((c) => c.status === "done").length;
  // issue 附件区只显 issue 级(comment_id 为空);评论附件归各评论下,避免重复。
  const issueAtts = (issue.attachments ?? []).filter((a) => !a.comment_id);

  // 评论渲染（评论 + 其回复；无 emoji 反应）。
  const renderComment = (c: IssueComment, reply = false) => (
    <div key={c.id} className={`loop-comment ${reply ? "is-reply" : ""}`}>
      <div className="loop-comment__head">
        <Avatar size="extra-extra-small" color="light-blue" src={c.author_avatar ?? undefined}>
          {(c.author_name ?? "?").slice(0, 1)}
        </Avatar>
        <Text strong style={{ fontSize: 12 }}>{c.author_name}</Text>
        <time>{fmt(c.created_at)}</time>
        {c.resolved_at && <Tag size="small" color="green">{t("loop.comment.resolved")}</Tag>}
        <div className="loop-comment__actions">
          {!reply && (
            <Button size="small" theme="borderless" icon={<CornerDownRight size={13} />} onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setEditingId(null); }} aria-label={t("loop.comment.reply")} />
          )}
          {!reply && (
            <Button size="small" theme="borderless" icon={c.resolved_at ? <CircleSlash size={13} /> : <Check size={13} />} onClick={() => toggleResolve(c.id, !!c.resolved_at)} aria-label={t(c.resolved_at ? "loop.comment.unresolve" : "loop.comment.resolve")} />
          )}
          <Button size="small" theme="borderless" icon={<Pencil size={13} />} onClick={() => { setEditingId(c.id); setEditDraft(c.content); setReplyTo(null); }} aria-label={t("loop.action.edit")} />
          <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />} onClick={() => confirmDelete({ title: t("loop.comment.deleteConfirm"), okText: t("loop.action.delete"), cancelText: t("loop.action.cancel"), onOk: () => removeComment(c.id) })} aria-label={t("loop.action.delete")} />
        </div>
      </div>
      {editingId === c.id ? (
        <div className="loop-comment__body" style={{ marginTop: 6 }}>
          <AutoGrowTextarea className="loop-field-textarea loop-field-textarea--auto" value={editDraft} onChange={setEditDraft} />
          <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
            <Button size="small" theme="solid" onClick={() => saveEdit(c.id)}>{t("loop.action.save")}</Button>
            <Button size="small" theme="borderless" onClick={() => setEditingId(null)}>{t("loop.action.cancel")}</Button>
          </div>
        </div>
      ) : (
        <div className="loop-comment__body"><LoopMarkdown content={c.content} /></div>
      )}
      {renderAttachments(c.attachments)}
      {!reply && repliesOf(c.id).map((r) => renderComment(r, true))}
      {!reply && replyTo === c.id && (
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <input
            className="loop-field"
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            placeholder={t("loop.comment.replyPlaceholder")}
            onKeyDown={(e) => { if (e.key === "Enter") submitComment(); }}
          />
          <Button icon={<Send size={14} />} onClick={submitComment} aria-label={t("loop.comment.send")} />
        </div>
      )}
    </div>
  );

  // 动态：把活动流(activity) 与顶层评论合并成一条时间线(升序,最新在下、贴近底部输入框),
  // 对齐 Figma —— 不再把「活动」「评论」拆成两个挤在一起的区块。timeline 为 ASC。
  const activities = timeline.filter((e) => e.type === "activity");
  // 活动文案人话化：后端 action 是机器串(如 status_changed),普通运营看不懂。按语义归类成中文；
  // 订阅类噪声直接隐藏(返回 null → 不渲染)；未知归为通用「更新了这个回路」，绝不暴露原始串。
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
  const feed: Array<{ ts: string; node: React.ReactNode }> = [
    ...activities.flatMap((a) => {
      const verb = activityText(a.action);
      if (!verb) return [];
      return [{
        ts: a.created_at,
        node: (
          <div key={`a-${a.id}`} className="loop-feed__act">
            <span className="loop-feed__act-dot" />
            <span className="loop-feed__act-text">
              <strong>{a.actor_name ?? a.actor_id}</strong> {verb}
            </span>
            <time>{fmt(a.created_at)}</time>
          </div>
        ),
      }];
    }),
    ...roots.map((c) => ({ ts: c.created_at, node: renderComment(c) })),
  ].sort((x, y) => new Date(x.ts).getTime() - new Date(y.ts).getTime());

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

          {/* 子回路 */}
          <div className="loop-idp__section">
            <div className="loop-idp__stitle loop-idp__desc-title">
              <span>
                {t("loop.subIssue.title")}
                {children.length > 0 && <em className="loop-idp__count"> {childrenDone} / {children.length}</em>}
              </span>
              <Button
                theme="borderless"
                size="small"
                icon={<Plus size={14} />}
                aria-label={t("loop.subIssue.create")}
                onClick={() => setChildCreateOpen(true)}
              />
            </div>
            {children.length > 0 && (
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
            )}
          </div>

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
              {feed.length === 0 ? (
                <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.comment.empty")}</Text>
              ) : (
                feed.map((it) => it.node)
              )}
            </div>

            {!replyTo && triggerAgents.length > 0 && (
              <div className="loop-idp__wake">
                <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.comment.willWake")}</Text>
                {triggerAgents.map((a) => {
                  const off = suppressed.has(a.id);
                  return (
                    <Tag
                      key={a.id}
                      size="small"
                      color={off ? "grey" : "light-blue"}
                      style={{ cursor: "pointer", opacity: off ? 0.55 : 1, textDecoration: off ? "line-through" : "none" }}
                      onClick={() => toggleSuppress(a.id)}
                    >
                      {a.name}
                    </Tag>
                  );
                })}
                <Text type="tertiary" style={{ fontSize: 11 }}>{t("loop.comment.tapToSuppress")}</Text>
              </div>
            )}
            {!replyTo && pendingFiles.length > 0 && (
              <div className="loop-atts" style={{ marginTop: 10 }}>
                {pendingFiles.map((f, i) => (
                  <span key={i} className="loop-att loop-att--pending">
                    <Paperclip size={12} />
                    <span>{f.name}</span>
                    <button type="button" aria-label={t("loop.action.delete")} onClick={() => removePendingFile(i)}>×</button>
                  </span>
                ))}
              </div>
            )}

            {/* 评论输入区 */}
            <div className="loop-idp__composer">
              <input
                className="loop-field"
                value={replyTo ? "" : commentDraft}
                disabled={!!replyTo}
                onChange={(e) => setCommentDraft(e.target.value)}
                placeholder={replyTo ? t("loop.comment.replyingHint") : t("loop.comment.placeholder")}
                onKeyDown={(e) => { if (e.key === "Enter") submitComment(); }}
              />
              <Dropdown
                trigger="click"
                clickToHide
                position="topRight"
                render={
                  <Dropdown.Menu>
                    {(["member", "agent", "squad"] as const).map((type) => {
                      const items = cands.filter((c) => c.type === type);
                      if (!items.length) return null;
                      return (
                        <React.Fragment key={type}>
                          <Dropdown.Title>{t(`loop.assignee.${type}`)}</Dropdown.Title>
                          {items.map((c) => (
                            <Dropdown.Item key={c.id} onClick={() => insertMention(c)}>{c.name}</Dropdown.Item>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </Dropdown.Menu>
                }
              >
                <Button theme="borderless" icon={<AtSign size={16} />} disabled={!!replyTo} aria-label={t("loop.mention.add")} />
              </Dropdown>
              <label className="loop-attach-btn" aria-label={t("loop.attach.add")} style={{ opacity: replyTo ? 0.4 : 1 }}>
                <Paperclip size={16} />
                <input
                  type="file"
                  multiple
                  hidden
                  disabled={!!replyTo || submitting}
                  onChange={(e) => { addPendingFiles(e.target.files); e.target.value = ""; }}
                />
              </label>
              <Button theme="solid" icon={<Send size={14} />} onClick={submitComment} loading={submitting} disabled={!!replyTo} aria-label={t("loop.comment.send")} />
            </div>
          </div>
        </div>

        {/* 右侧属性栏 */}
        <aside className="loop-idp__aside">
          <section className="loop-idp__asec">
            <div className="loop-idp__asec-head">{t("loop.detail.properties")}</div>
            <div className="loop-idp__prop">
              <span className="loop-idp__prop-k">{t("loop.field.status")}</span>
              <Select
                value={issue.status}
                onChange={(v) => requestStatus(issue, v as IssueStatus, (extra) => patch({ status: v as IssueStatus, ...extra }))}
                dropdownClassName="loop-fields__dropdown"
                size="small"
                style={{ width: "100%" }}
              >
                {ISSUE_STATUS_ORDER.map((s) => (
                  <Select.Option key={s} value={s}>
                    <Tag color={ISSUE_STATUS_COLOR[s]} size="small">{t(`loop.status.${s}`)}</Tag>
                  </Select.Option>
                ))}
              </Select>
            </div>
            <div className="loop-idp__prop">
              <span className="loop-idp__prop-k">{t("loop.field.priority")}</span>
              <Select
                value={issue.priority}
                onChange={(v) => patch({ priority: v as IssuePriority })}
                dropdownClassName="loop-fields__dropdown"
                size="small"
                style={{ width: "100%" }}
              >
                {PRIORITY_ORDER.map((p) => (
                  <Select.Option key={p} value={p}>
                    <Tag color={PRIORITY_COLOR[p]} size="small">{t(`loop.priority.${p}`)}</Tag>
                  </Select.Option>
                ))}
              </Select>
            </div>
            <div className="loop-idp__prop">
              <span className="loop-idp__prop-k">{t("loop.field.assignee")}</span>
              <AssigneePicker
                value={issue.assignee_id}
                valueName={issue.assignee_name ?? null}
                onChange={(id, type, name) => requestAssign(issue, type, id, name, (extra) => patch({ assignee_id: id, assignee_type: type, ...extra }))}
              />
            </div>
            <div className="loop-idp__prop">
              <span className="loop-idp__prop-k">{t("loop.field.project")}</span>
              <span className="loop-idp__prop-v">{issue.project_name ?? "—"}</span>
            </div>
            <div className="loop-idp__prop">
              <span className="loop-idp__prop-k">{t("loop.field.labels")}</span>
              <LabelEditor issueId={issue.id} labels={issue.labels} onChanged={() => { syncIssue(reqRef.current); onChanged?.(); }} />
            </div>
            <div className="loop-idp__prop">
              <span className="loop-idp__prop-k">{t("loop.field.parent")}</span>
              <Select
                value={issue.parent_issue_id ?? undefined}
                onChange={(v) => patch({ parent_issue_id: (v as string) || "" })}
                onDropdownVisibleChange={loadParentCands}
                dropdownClassName="loop-fields__dropdown"
                placeholder={t("loop.field.noParent")}
                size="small"
                filter
                showClear
                style={{ width: "100%" }}
              >
                {parentCands.map((i) => (
                  <Select.Option key={i.id} value={i.id}>{i.identifier} {i.title}</Select.Option>
                ))}
              </Select>
            </div>
            <div className="loop-idp__prop-row2">
              <div className="loop-idp__prop">
                <span className="loop-idp__prop-k">{t("loop.field.startDate")}</span>
                <DatePicker
                  type="date"
                  format="yyyy-MM-dd"
                  value={issue.start_date ? issue.start_date.slice(0, 10) : undefined}
                  onChange={(_, ds) => patch({ start_date: (ds as string) || "" })}
                  size="small"
                  style={{ width: "100%" }}
                />
              </div>
              <div className="loop-idp__prop">
                <span className="loop-idp__prop-k">{t("loop.field.dueDate")}</span>
                <DatePicker
                  type="date"
                  format="yyyy-MM-dd"
                  value={issue.due_date ? issue.due_date.slice(0, 10) : undefined}
                  onChange={(_, ds) => patch({ due_date: (ds as string) || "" })}
                  size="small"
                  style={{ width: "100%" }}
                />
              </div>
            </div>
            <div className="loop-idp__prop">
              <span className="loop-idp__prop-k">{t("loop.field.stage")}</span>
              <InputNumber
                value={issue.stage ?? undefined}
                onChange={(v) => { if (typeof v === "number") patch({ stage: v }); }}
                min={1}
                size="small"
                style={{ width: "100%" }}
              />
            </div>
          </section>

          <section className="loop-idp__asec">
            <div className="loop-idp__asec-head">{t("loop.detail.detailsTitle")}</div>
            <div className="loop-idp__prop loop-idp__prop--inline">
              <span className="loop-idp__prop-k">{t("loop.field.creator")}</span>
              <span className="loop-idp__prop-v">{issue.creator_name ?? "—"}</span>
            </div>
            <div className="loop-idp__prop loop-idp__prop--inline">
              <span className="loop-idp__prop-k">{t("loop.detail.created")}</span>
              <span className="loop-idp__prop-v loop-idp__prop-v--muted">{fmt(issue.created_at)}</span>
            </div>
            <div className="loop-idp__prop loop-idp__prop--inline">
              <span className="loop-idp__prop-k">{t("loop.detail.updated")}</span>
              <span className="loop-idp__prop-v loop-idp__prop-v--muted">{fmt(issue.updated_at)}</span>
            </div>
          </section>

          <section className="loop-idp__asec">
            <div className="loop-idp__asec-head">{t("loop.detail.execLog")}</div>
            {runs.length === 0 ? (
              <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.run.empty")}</Text>
            ) : (
              <>
                <button type="button" className="loop-idp__runs-toggle" onClick={() => setShowRuns((s) => !s)}>
                  <ChevronRight size={13} className={`loop-idp__runs-chevron${showRuns ? " is-open" : ""}`} />
                  {t("loop.run.showHistory", { values: { count: runs.length } })}
                </button>
                {showRuns && (
                  <div className="loop-idp__tasks">
                    {runs.map((r) => {
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
                    })}
                  </div>
                )}
              </>
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
    </div>
  );
}
