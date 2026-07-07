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
} from "@douyinfe/semi-ui";
import { Trash2, CornerDownRight, Send } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Issue, IssueComment, IssueStatus, IssuePriority } from "../api/types";
import {
  getIssue,
  updateIssue,
  listComments,
  addComment,
  deleteComment,
} from "../api/issueApi";
import AssigneePicker from "../ui/AssigneePicker";
import {
  ISSUE_STATUS_ORDER,
  ISSUE_STATUS_COLOR,
  PRIORITY_ORDER,
  PRIORITY_COLOR,
} from "../ui/meta";

const { Title, Text } = Typography;

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export interface IssueDetailProps {
  issueId: string;
  onChanged: () => void;
}

/** Issue 详情：字段编辑 + status/priority + assignee 三态 + 评论增删/回复。 */
export default function IssueDetail({ issueId, onChanged }: IssueDetailProps) {
  const { t } = useI18n();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");

  const reload = () => {
    setLoading(true);
    Promise.all([getIssue(issueId), listComments(issueId)])
      .then(([i, c]) => {
        setIssue(i);
        setComments(c);
        setTitleDraft(i?.title ?? "");
        setDescDraft(i?.description ?? "");
      })
      .finally(() => setLoading(false));
  };

  useEffect(reload, [issueId]);

  const patch = async (p: Parameters<typeof updateIssue>[1]) => {
    if (!issue) return;
    const next = await updateIssue(issue.id, p);
    setIssue(next);
    onChanged();
  };

  const saveTitle = () => {
    if (issue && titleDraft.trim() && titleDraft !== issue.title) {
      patch({ title: titleDraft.trim() });
    }
  };
  const saveDesc = () => {
    if (issue && descDraft !== (issue.description ?? "")) {
      patch({ description: descDraft });
    }
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

  if (loading && !issue)
    return (
      <div className="loop-page__center">
        <Spin />
      </div>
    );
  if (!issue) return <Text type="tertiary">{t("loop.detail.notFound")}</Text>;

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
            <Button
              size="small"
              theme="borderless"
              type="danger"
              icon={<Trash2 size={13} />}
            />
          </Popconfirm>
        </div>
      </div>
      <div className="loop-comment__body">{c.content}</div>
      {!reply &&
        repliesOf(c.id).map((r) => renderComment(r, true))}
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
    <div className="loop-detail">
      <div>
        <Text type="tertiary" style={{ fontSize: 12 }}>
          {issue.identifier}
        </Text>
        <Input
          size="large"
          value={titleDraft}
          onChange={setTitleDraft}
          onBlur={saveTitle}
          onEnterPress={saveTitle}
          style={{ fontWeight: 600, marginTop: 2 }}
        />
      </div>

      <div>
        <div className="loop-detail__section-title">
          {t("loop.field.description")}
        </div>
        <TextArea
          value={descDraft}
          onChange={setDescDraft}
          onBlur={saveDesc}
          autosize={{ minRows: 3, maxRows: 8 }}
          placeholder={t("loop.field.descriptionPlaceholder")}
        />
      </div>

      <div>
        <div className="loop-detail__section-title">
          {t("loop.detail.properties")}
        </div>
        <dl className="loop-detail__fields">
          <dt>{t("loop.field.status")}</dt>
          <dd>
            <Select
              value={issue.status}
              onChange={(v) => patch({ status: v as IssueStatus })}
              style={{ width: 160 }}
              size="small"
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
              style={{ width: 160 }}
              size="small"
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
        </dl>
      </div>

      <div>
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
            placeholder={
              replyTo
                ? t("loop.comment.replyingHint")
                : t("loop.comment.placeholder")
            }
            onEnterPress={submitComment}
          />
          <Button
            theme="solid"
            icon={<Send size={14} />}
            onClick={submitComment}
            disabled={!!replyTo}
          >
            {t("loop.comment.send")}
          </Button>
        </div>
      </div>
    </div>
  );
}
