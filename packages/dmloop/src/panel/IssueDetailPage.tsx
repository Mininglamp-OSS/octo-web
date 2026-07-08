import React, { useEffect, useState } from "react";
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
} from "@douyinfe/semi-ui";
import {
  ArrowLeft,
  Trash2,
  CornerDownRight,
  Send,
  Circle,
  CheckCircle2,
  XCircle,
  Loader,
  MoreHorizontal,
  CircleSlash,
} from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type {
  Issue,
  IssueComment,
  AgentTask,
  IssueStatus,
  IssuePriority,
  TaskStatus,
  AssigneeCandidate,
} from "../api/types";
import {
  getIssue,
  updateIssue,
  listComments,
  addComment,
  deleteComment,
  listTasks,
  listAssigneeCandidates,
} from "../api/issueApi";
import AssigneePicker from "../ui/AssigneePicker";
import {
  ISSUE_STATUS_ORDER,
  ISSUE_STATUS_COLOR,
  PRIORITY_ORDER,
  PRIORITY_COLOR,
} from "../ui/meta";
import "./issueDetail.css";

const { Title, Text } = Typography;

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const TASK_ICON: Record<TaskStatus, React.ReactNode> = {
  queued: <Circle size={13} color="#8590a6" />,
  running: <Loader size={13} color="#3b82f6" />,
  completed: <CheckCircle2 size={13} color="#23a55a" />,
  failed: <XCircle size={13} color="#e5484d" />,
  cancelled: <Circle size={13} color="#8590a6" />,
};

export interface IssueDetailPageProps {
  issueId: string;
  onChanged?: () => void;
}

/**
 * Issue 独立详情页（1:1 复刻 multica）：主体(标题/描述/评论) + 右侧属性栏 + 执行日志。
 * 渲染在右主栏（routeRight.push），顶部返回按钮 pop 回列表/看板。
 */
export default function IssueDetailPage({ issueId, onChanged }: IssueDetailPageProps) {
  const { t } = useI18n();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [cands, setCands] = useState<AssigneeCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");

  const reload = () => {
    setLoading(true);
    Promise.all([getIssue(issueId), listComments(issueId), listTasks(issueId)])
      .then(([i, c, tk]) => {
        setIssue(i);
        setComments(c);
        setTasks(tk);
        setTitleDraft(i?.title ?? "");
        setDescDraft(i?.description ?? "");
      })
      .catch(() => Toast.error(t("loop.detail.notFound")))
      .finally(() => setLoading(false));
  };

  useEffect(reload, [issueId]);
  useEffect(() => { listAssigneeCandidates().then(setCands); }, []);

  const patch = async (p: Parameters<typeof updateIssue>[1]) => {
    if (!issue) return;
    const next = await updateIssue(issue.id, p);
    setIssue(next);
    onChanged?.();
  };

  const submitComment = async () => {
    const content = commentDraft.trim();
    if (!content) return;
    await addComment(issueId, content, replyTo);
    setCommentDraft("");
    setReplyTo(null);
    setComments(await listComments(issueId));
    Toast.success(t("loop.toast.commentAdded"));
  };

  const removeComment = async (id: string) => {
    await deleteComment(id);
    setComments(await listComments(issueId));
    Toast.success(t("loop.toast.commentDeleted"));
  };

  const back = () => WKApp.routeRight.pop();

  // 右上角 ··· 菜单：快速改 status / priority / assignee（1:1 复刻 multica）。
  const renderMoreMenu = () => (
    <Dropdown.Menu>
      <Dropdown
        position="leftTop"
        trigger="hover"
        render={
          <Dropdown.Menu>
            {ISSUE_STATUS_ORDER.map((s) => (
              <Dropdown.Item key={s} active={issue?.status === s} onClick={() => patch({ status: s })}>
                <Tag color={ISSUE_STATUS_COLOR[s]} size="small">{t(`loop.status.${s}`)}</Tag>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        }
      >
        <Dropdown.Item>{t("loop.menu.changeStatus")}</Dropdown.Item>
      </Dropdown>
      <Dropdown
        position="leftTop"
        trigger="hover"
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
        <Dropdown.Item>{t("loop.menu.changePriority")}</Dropdown.Item>
      </Dropdown>
      <Dropdown
        position="leftTop"
        trigger="hover"
        render={
          <Dropdown.Menu>
            <Dropdown.Item icon={<CircleSlash size={13} />} onClick={() => patch({ assignee_id: null })}>
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
                    <Dropdown.Item key={c.id} active={issue?.assignee_id === c.id} onClick={() => patch({ assignee_id: c.id })}>
                      {c.name}
                    </Dropdown.Item>
                  ))}
                </React.Fragment>
              );
            })}
          </Dropdown.Menu>
        }
      >
        <Dropdown.Item>{t("loop.menu.changeAssignee")}</Dropdown.Item>
      </Dropdown>
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

  const renderComment = (c: IssueComment, reply = false) => (
    <div key={c.id} className={`loop-comment ${reply ? "is-reply" : ""}`}>
      <div className="loop-comment__head">
        <Avatar size="extra-extra-small" color="light-blue">
          {c.author_name.slice(0, 1)}
        </Avatar>
        <Text strong style={{ fontSize: 12 }}>
          {c.author_name}
        </Text>
        <time>{fmt(c.created_at)}</time>
        <div className="loop-comment__actions">
          {!reply && (
            <Button
              size="small"
              theme="borderless"
              icon={<CornerDownRight size={13} />}
              onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
            >
              {t("loop.comment.reply")}
            </Button>
          )}
          <Popconfirm
            title={t("loop.comment.deleteConfirm")}
            onConfirm={() => removeComment(c.id)}
          >
            <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />} />
          </Popconfirm>
        </div>
      </div>
      <div className="loop-comment__body">{c.content}</div>
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
        <Dropdown trigger="click" position="bottomRight" render={renderMoreMenu()}>
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

          <div className="loop-idp__section">
            <div className="loop-detail__section-title">{t("loop.field.description")}</div>
            <TextArea
              value={descDraft}
              onChange={setDescDraft}
              onBlur={() => descDraft !== (issue.description ?? "") && patch({ description: descDraft })}
              autosize={{ minRows: 3, maxRows: 12 }}
              placeholder={t("loop.field.descriptionPlaceholder")}
            />
          </div>

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
                  onChange={(v) => patch({ status: v as IssueStatus })}
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
                  valueName={issue.assignee_name}
                  onChange={(id) => patch({ assignee_id: id })}
                />
              </dd>
              <dt>{t("loop.field.project")}</dt>
              <dd>
                <Text>{issue.project_name ?? "—"}</Text>
              </dd>
              <dt>{t("loop.field.creator")}</dt>
              <dd>
                <Text>{issue.creator_name}</Text>
              </dd>
              <dt>{t("loop.detail.created")}</dt>
              <dd>
                <Text type="tertiary" style={{ fontSize: 12 }}>{fmt(issue.created_at)}</Text>
              </dd>
            </dl>
          </div>

          <div className="loop-idp__aside-card">
            <div className="loop-detail__section-title">
              {t("loop.detail.execLog")} ({tasks.length})
            </div>
            {tasks.length === 0 ? (
              <Text type="tertiary" style={{ fontSize: 12 }}>
                {t("loop.detail.execEmpty")}
              </Text>
            ) : (
              <div className="loop-idp__tasks">
                {tasks.map((tk) => (
                  <div key={tk.id} className="loop-idp__task">
                    {TASK_ICON[tk.status]}
                    <span className="loop-idp__task-main">
                      <strong>{tk.agent_name ?? "—"}</strong>
                      <small>{tk.trigger_summary}</small>
                    </span>
                    <Tag size="small" color={tk.status === "failed" ? "red" : tk.status === "running" ? "blue" : tk.status === "completed" ? "green" : "grey"}>
                      {t(`loop.taskStatus.${tk.status}`)}
                    </Tag>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
