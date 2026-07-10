import React, { useEffect, useRef, useState } from "react";
import {
  Typography,
  Input,
  Select,
  Button,
  Avatar,
  Tag,
  Spin,
  Toast,
  Popconfirm,
  TextArea,
  Dropdown,
  DatePicker,
  InputNumber,
  Progress,
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
  SmilePlus,
  Bell,
  BellOff,
} from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type {
  Issue,
  IssueComment,
  IssueSubscriber,
  TimelineEntry,
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
import { listRuns, rerunIssue, cancelTask } from "../api/runsApi";
import AssigneePicker from "../ui/AssigneePicker";
import LabelEditor from "../ui/LabelEditor";
import { useRunConfirm } from "../ui/RunConfirmModal";
import { useAssigneeCandidates } from "../ui/useAssigneeCandidates";
import LoopMarkdown from "../ui/LoopMarkdown";
import { confirmDelete } from "../ui/confirmDelete";
import RunDetailModal from "./RunDetailModal";
import {
  ISSUE_STATUS_ORDER,
  ISSUE_STATUS_COLOR,
  PRIORITY_ORDER,
  PRIORITY_COLOR,
  RUN_STATUS_COLOR,
  isActiveRun,
} from "../ui/meta";
import "./issueDetail.css";

const { Title, Text } = Typography;

// 反应选择器的固定 emoji 集(轻量,够验证能力;完整 picker 留给 UI 重做)。
const REACTION_EMOJIS = ["👍", "❤️", "🎉", "😄", "🚀", "👀"];

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
  const [children, setChildren] = useState<Issue[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [parentCands, setParentCands] = useState<Issue[]>([]); // 父 issue 选择器候选(懒加载)
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [activeRun, setActiveRun] = useState<TaskRun | null>(null);
  const [runOpen, setRunOpen] = useState(false);
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
    listSubscribers(issueId).then((s) => { if (fresh()) setSubscribers(s); }).catch(() => {});
    listChildren(issueId).then((c) => { if (fresh()) setChildren(c); }).catch(() => {});
    listTimeline(issueId).then((tl) => { if (fresh()) setTimeline(tl); }).catch(() => {});
  };

  useEffect(reload, [issueId]);

  const patch = async (p: Parameters<typeof updateIssue>[1]) => {
    if (!issue) return;
    try {
      const updated = await updateIssue(issue.id, p);
      // PUT 响应不带 labels/reactions(仅 list/detail 端点回填);re-enrich 修回 assignee_name/
      // project_name 等展示字段(按新值重算),labels/reactions 保留当前值,避免编辑后被清空。
      setIssue({
        ...(await enrichIssue(updated)),
        labels: updated.labels ?? issue.labels,
        reactions: updated.reactions ?? issue.reactions,
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

  // 订阅/取消订阅(后端默认操作调用者本人、幂等);两项都常驻,不猜"我是否已订阅"。
  const toggleSubscribe = async (on: boolean) => {
    const token = reqRef.current;
    try {
      await (on ? subscribeIssue : unsubscribeIssue)(issueId);
      const s = await listSubscribers(issueId);
      if (token === reqRef.current) setSubscribers(s);
      Toast.success(t(on ? "loop.subscribe.subscribed" : "loop.subscribe.unsubscribed"));
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    }
  };

  // 评论 emoji 反应:选择器点 emoji=加,已有 chip 点击=删自己那条(后端按 actor+emoji 定位)。
  const reactComment = async (commentId: string, emoji: string, add: boolean) => {
    const token = reqRef.current;
    try {
      await (add ? addCommentReaction : removeCommentReaction)(commentId, emoji);
      await reloadComments(token);
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    }
  };

  // issue 级 emoji 反应:同评论,读回走 getIssue 的 issue.reactions(syncIssue 重取详情)。
  const reactIssue = async (emoji: string, add: boolean) => {
    const token = reqRef.current;
    try {
      await (add ? addIssueReaction : removeIssueReaction)(issueId, emoji);
      await syncIssue(token);
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    }
  };

  // 评论 resolve/unresolve:后端「一线程至多一条 resolved」会清同线程兄弟,操作后重拉评论即可。
  // (resolve 只发实时事件、不写 activity_log,故活动流无需刷新。)
  const toggleResolve = async (commentId: string, resolved: boolean) => {
    const token = reqRef.current;
    try {
      await (resolved ? unresolveComment : resolveComment)(commentId);
      await reloadComments(token);
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    }
  };

  const submitComment = async () => {
    const content = commentDraft.trim();
    if (!content) return;
    const token = reqRef.current;
    const suppressIds = triggerAgents.filter((a) => suppressed.has(a.id)).map((a) => a.id);
    await addComment(issueId, content, replyTo, suppressIds);
    setCommentDraft("");
    setReplyTo(null);
    setTriggerAgents([]);
    setSuppressed(new Set());
    await reloadComments(token);
    Toast.success(t("loop.toast.commentAdded"));
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

  const removeComment = async (id: string) => {
    const token = reqRef.current;
    await deleteComment(id);
    await reloadComments(token);
    Toast.success(t("loop.toast.commentDeleted"));
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
      <Dropdown.Item icon={<Bell size={13} />} onClick={() => toggleSubscribe(true)}>
        {t("loop.subscribe.subscribe")}
      </Dropdown.Item>
      <Dropdown.Item icon={<BellOff size={13} />} onClick={() => toggleSubscribe(false)}>
        {t("loop.subscribe.unsubscribe")}
      </Dropdown.Item>
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
  // 活动流只取 activity 类(评论已在评论区渲染,避免重复)。filter 返回新数组,reverse 不改原 state。倒序:最新在上。
  const activities = timeline.filter((e) => e.type === "activity").reverse();

  // emoji 反应条(评论 + issue 通用):按 emoji 分组显示计数(点=删自己那条)+ 选择器加新反应。
  const renderReactionBar = (
    reactions: Array<{ emoji: string }> | null | undefined,
    onToggle: (emoji: string, add: boolean) => void,
  ) => {
    const groups = new Map<string, number>();
    (reactions ?? []).forEach((rx) => groups.set(rx.emoji, (groups.get(rx.emoji) ?? 0) + 1));
    return (
      <div className="loop-comment__reactions">
        {[...groups.entries()].map(([emoji, n]) => (
          <button key={emoji} type="button" className="loop-reaction" onClick={() => onToggle(emoji, false)}>
            <span>{emoji}</span>
            <b>{n}</b>
          </button>
        ))}
        <Dropdown
          trigger="click"
          clickToHide
          position="topLeft"
          render={
            <div className="loop-reaction-picker">
              {REACTION_EMOJIS.map((e) => (
                <button key={e} type="button" onClick={() => onToggle(e, true)}>{e}</button>
              ))}
            </div>
          }
        >
          <button type="button" className="loop-reaction loop-reaction--add" aria-label={t("loop.reaction.add")}>
            <SmilePlus size={13} />
          </button>
        </Dropdown>
      </div>
    );
  };

  const renderComment = (c: IssueComment, reply = false) => (
    <div key={c.id} className={`loop-comment ${reply ? "is-reply" : ""}`}>
      <div className="loop-comment__head">
        <Avatar size="extra-extra-small" color="light-blue" src={c.author_avatar ?? undefined}>
          {(c.author_name ?? "?").slice(0, 1)}
        </Avatar>
        <Text strong style={{ fontSize: 12 }}>
          {c.author_name}
        </Text>
        <time>{fmt(c.created_at)}</time>
        {c.resolved_at && <Tag size="small" color="green">{t("loop.comment.resolved")}</Tag>}
        <div className="loop-comment__actions">
          {!reply && (
            <Button
              size="small"
              theme="borderless"
              icon={<CornerDownRight size={13} />}
              onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setEditingId(null); }}
            >
              {t("loop.comment.reply")}
            </Button>
          )}
          {!reply && (
            <Button
              size="small"
              theme="borderless"
              icon={c.resolved_at ? <CircleSlash size={13} /> : <Check size={13} />}
              onClick={() => toggleResolve(c.id, !!c.resolved_at)}
            >
              {t(c.resolved_at ? "loop.comment.unresolve" : "loop.comment.resolve")}
            </Button>
          )}
          <Button
            size="small"
            theme="borderless"
            icon={<Pencil size={13} />}
            onClick={() => { setEditingId(c.id); setEditDraft(c.content); setReplyTo(null); }}
          />
          <Button
            size="small"
            theme="borderless"
            type="danger"
            icon={<Trash2 size={13} />}
            onClick={() => confirmDelete({ title: t("loop.comment.deleteConfirm"), okText: t("loop.action.delete"), cancelText: t("loop.action.cancel"), onOk: () => removeComment(c.id) })}
          />
        </div>
      </div>
      {editingId === c.id ? (
        <div className="loop-comment__body" style={{ marginTop: 6 }}>
          <TextArea value={editDraft} onChange={setEditDraft} autosize={{ minRows: 2, maxRows: 10 }} />
          <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
            <Button size="small" theme="solid" onClick={() => saveEdit(c.id)}>{t("loop.action.save")}</Button>
            <Button size="small" theme="borderless" onClick={() => setEditingId(null)}>{t("loop.action.cancel")}</Button>
          </div>
        </div>
      ) : (
        <div className="loop-comment__body"><LoopMarkdown content={c.content} /></div>
      )}
      {renderReactionBar(c.reactions, (emoji, add) => reactComment(c.id, emoji, add))}
      {!reply && repliesOf(c.id).map((r) => renderComment(r, true))}
      {!reply && replyTo === c.id && (
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <Input
            value={commentDraft}
            onChange={setCommentDraft}
            placeholder={t("loop.comment.replyPlaceholder")}
            onEnterPress={submitComment}
          />
          <Button icon={<Send size={14} />} onClick={submitComment} />
        </div>
      )}
    </div>
  );

  return (
    <div className="loop-idp">
      <div className="loop-idp__topbar">
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>
          {t("loop.detail.back")}
        </Button>
        <Text type="tertiary" style={{ fontSize: 12 }}>
          {issue.project_name ? `${issue.project_name} · ` : ""}
          {issue.identifier}
        </Text>
        <div style={{ flex: 1 }} />
        <Dropdown trigger="click" position="bottomRight" render={renderMoreMenu()} clickToHide>
          <Button icon={<MoreHorizontal size={18} />} theme="borderless" aria-label="more" />
        </Dropdown>
      </div>

      <div className="loop-idp__body">
        {/* 主体 */}
        <div className="loop-idp__main">
          <Input
            size="large"
            value={titleDraft}
            onChange={setTitleDraft}
            onBlur={() => titleDraft.trim() && titleDraft !== issue.title && patch({ title: titleDraft.trim() })}
            style={{ fontWeight: 600, fontSize: 20 }}
          />

          {/* issue 级 emoji 反应条 */}
          {renderReactionBar(issue.reactions, reactIssue)}

          <div className="loop-idp__section">
            <div className="loop-detail__section-title loop-idp__desc-title">
              <span>{t("loop.field.description")}</span>
              {editingDesc ? (
                <Button size="small" theme="borderless" icon={<Check size={13} />} onClick={saveDesc}>
                  {t("loop.action.save")}
                </Button>
              ) : (
                <Button size="small" theme="borderless" icon={<Pencil size={13} />} onClick={() => setEditingDesc(true)}>
                  {t("loop.action.edit")}
                </Button>
              )}
            </div>
            {editingDesc ? (
              <TextArea
                value={descDraft}
                onChange={setDescDraft}
                onBlur={saveDesc}
                autosize={{ minRows: 4, maxRows: 20 }}
                placeholder={t("loop.field.descriptionPlaceholder")}
              />
            ) : issue.description ? (
              <LoopMarkdown content={issue.description} />
            ) : (
              <Text type="tertiary" style={{ fontSize: 13 }}>{t("loop.field.descriptionPlaceholder")}</Text>
            )}
          </div>

          {children.length > 0 && (
            <div className="loop-idp__section">
              <div className="loop-detail__section-title">
                {t("loop.subIssue.title")} ({childrenDone}/{children.length})
              </div>
              <Progress
                percent={Math.round((childrenDone / children.length) * 100)}
                style={{ marginBottom: 10 }}
              />
              <div className="loop-subissues">
                {children.map((c) => (
                  <div key={c.id} className="loop-subissue">
                    <Tag color={ISSUE_STATUS_COLOR[c.status]} size="small">
                      {t(`loop.status.${c.status}`)}
                    </Tag>
                    <span className="loop-subissue__id">{c.identifier}</span>
                    <span className="loop-subissue__title">{c.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activities.length > 0 && (
            <div className="loop-idp__section">
              <div className="loop-detail__section-title">
                {t("loop.activity.title")} ({activities.length})
              </div>
              <div className="loop-activities">
                {activities.map((a) => (
                  <div key={a.id} className="loop-activity">
                    <Avatar size="extra-extra-small" color="light-blue" src={a.actor_avatar ?? undefined}>
                      {(a.actor_name ?? "?").slice(0, 1)}
                    </Avatar>
                    <Text style={{ fontSize: 12 }}>
                      <strong>{a.actor_name ?? a.actor_id}</strong>{" "}
                      {/* ponytail: 原样展示 action(如 status_changed);细化文案映射留给 UI 重做 */}
                      <Text type="tertiary">{(a.action ?? "").replace(/_/g, " ")}</Text>
                    </Text>
                    <time>{fmt(a.created_at)}</time>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="loop-idp__section">
            <div className="loop-detail__section-title">
              {t("loop.detail.comments")} ({comments.length})
            </div>
            <div className="loop-comments">
              {roots.length === 0 && (
                <Text type="tertiary" style={{ fontSize: 12 }}>
                  {t("loop.comment.empty")}
                </Text>
              )}
              {roots.map((c) => renderComment(c))}
            </div>
            {!replyTo && triggerAgents.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10, alignItems: "center" }}>
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
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <Input
                value={replyTo ? "" : commentDraft}
                disabled={!!replyTo}
                onChange={setCommentDraft}
                placeholder={replyTo ? t("loop.comment.replyingHint") : t("loop.comment.placeholder")}
                onEnterPress={submitComment}
              />
              <Button theme="solid" icon={<Send size={14} />} onClick={submitComment} disabled={!!replyTo}>
                {t("loop.comment.send")}
              </Button>
            </div>
          </div>
        </div>

        {/* 右侧属性栏 */}
        <aside className="loop-idp__aside">
          <div className="loop-idp__aside-card">
            <div className="loop-detail__section-title">{t("loop.detail.properties")}</div>
            <dl className="loop-idp__props">
              <dt>{t("loop.field.status")}</dt>
              <dd>
                <Select
                  value={issue.status}
                  onChange={(v) => requestStatus(issue, v as IssueStatus, (extra) => patch({ status: v as IssueStatus, ...extra }))}
                  size="small"
                  style={{ width: "100%" }}
                >
                  {ISSUE_STATUS_ORDER.map((s) => (
                    <Select.Option key={s} value={s}>
                      <Tag color={ISSUE_STATUS_COLOR[s]} size="small">
                        {t(`loop.status.${s}`)}
                      </Tag>
                    </Select.Option>
                  ))}
                </Select>
              </dd>
              <dt>{t("loop.field.priority")}</dt>
              <dd>
                <Select
                  value={issue.priority}
                  onChange={(v) => patch({ priority: v as IssuePriority })}
                  size="small"
                  style={{ width: "100%" }}
                >
                  {PRIORITY_ORDER.map((p) => (
                    <Select.Option key={p} value={p}>
                      <Tag color={PRIORITY_COLOR[p]} size="small">
                        {t(`loop.priority.${p}`)}
                      </Tag>
                    </Select.Option>
                  ))}
                </Select>
              </dd>
              <dt>{t("loop.field.assignee")}</dt>
              <dd>
                <AssigneePicker
                  value={issue.assignee_id}
                  valueName={issue.assignee_name ?? null}
                  onChange={(id, type, name) => requestAssign(issue, type, id, name, (extra) => patch({ assignee_id: id, assignee_type: type, ...extra }))}
                />
              </dd>
              <dt>{t("loop.field.project")}</dt>
              <dd>
                <Text>{issue.project_name ?? "—"}</Text>
              </dd>
              <dt>{t("loop.field.labels")}</dt>
              <dd>
                <LabelEditor issueId={issue.id} labels={issue.labels} onChanged={() => { syncIssue(reqRef.current); onChanged?.(); }} />
              </dd>
              <dt>{t("loop.field.parent")}</dt>
              <dd>
                <Select
                  value={issue.parent_issue_id ?? undefined}
                  onChange={(v) => patch({ parent_issue_id: (v as string) || "" })}
                  onDropdownVisibleChange={loadParentCands}
                  placeholder={t("loop.field.noParent")}
                  size="small"
                  filter
                  showClear
                  style={{ width: "100%" }}
                >
                  {parentCands.map((i) => (
                    <Select.Option key={i.id} value={i.id}>
                      {i.identifier} {i.title}
                    </Select.Option>
                  ))}
                </Select>
              </dd>
              <dt>{t("loop.field.startDate")}</dt>
              <dd>
                <DatePicker
                  type="date"
                  format="yyyy-MM-dd"
                  value={issue.start_date ? issue.start_date.slice(0, 10) : undefined}
                  onChange={(_, ds) => patch({ start_date: (ds as string) || "" })}
                  size="small"
                  style={{ width: "100%" }}
                />
              </dd>
              <dt>{t("loop.field.dueDate")}</dt>
              <dd>
                <DatePicker
                  type="date"
                  format="yyyy-MM-dd"
                  value={issue.due_date ? issue.due_date.slice(0, 10) : undefined}
                  onChange={(_, ds) => patch({ due_date: (ds as string) || "" })}
                  size="small"
                  style={{ width: "100%" }}
                />
              </dd>
              <dt>{t("loop.field.stage")}</dt>
              <dd>
                <InputNumber
                  value={issue.stage ?? undefined}
                  // 仅在有效数字时提交:编辑中退格清空会以空值触发 onChange,
                  // 忽略它可避免误发 stage=null(unstage)+ 竞态。清 stage 待 UI 重做。
                  onChange={(v) => { if (typeof v === "number") patch({ stage: v }); }}
                  min={1}
                  size="small"
                  style={{ width: "100%" }}
                />
              </dd>
              <dt>{t("loop.field.creator")}</dt>
              <dd>
                <Text>{issue.creator_name}</Text>
              </dd>
              <dt>{t("loop.detail.created")}</dt>
              <dd>
                <Text type="tertiary" style={{ fontSize: 12 }}>{fmt(issue.created_at)}</Text>
              </dd>
              <dt>{t("loop.subscribe.label")}</dt>
              <dd>
                <Text type="tertiary" style={{ fontSize: 12 }}>{subscribers.length}</Text>
              </dd>
            </dl>
          </div>

          <div className="loop-idp__aside-card">
            <div className="loop-detail__section-title">
              {t("loop.run.title")} ({runs.length})
            </div>
            {runs.length === 0 ? (
              <Text type="tertiary" style={{ fontSize: 12 }}>
                {t("loop.run.empty")}
              </Text>
            ) : (
              <div className="loop-idp__tasks">
                {runs.map((r) => {
                  const active = isActiveRun(r.status);
                  return (
                    <div key={r.id} className="loop-idp__task">
                      <button className="loop-idp__run" onClick={() => openRun(r)}>
                        <span className="loop-idp__task-main">
                          <strong>{r.agent_name ?? r.agent_id ?? "—"}</strong>
                          <small>{r.trigger_summary || fmt(r.dispatched_at ?? r.created_at)}</small>
                        </span>
                        <Tag size="small" color={RUN_STATUS_COLOR[r.status] ?? "grey"}>
                          {t(`loop.taskStatus.${r.status}`)}
                        </Tag>
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
          </div>
        </aside>
      </div>

      <RunDetailModal run={activeRun} visible={runOpen} onClose={() => setRunOpen(false)} />
      {runConfirmModal}
    </div>
  );
}
