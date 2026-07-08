import React from "react";
import { Table, Select, Tag, Typography } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import type { Issue, IssueStatus, IssuePriority } from "../api/types";
import { updateIssue } from "../api/issueApi";
import AssigneePicker from "../ui/AssigneePicker";
import {
  ISSUE_STATUS_ORDER,
  ISSUE_STATUS_COLOR,
  PRIORITY_ORDER,
  PRIORITY_COLOR,
} from "../ui/meta";

const { Text } = Typography;

export interface IssueListProps {
  issues: Issue[];
  onOpen: (id: string) => void;
  onChanged: () => void;
}

/** 列表视图：行内改 status/priority/assignee。 */
export default function IssueList({
  issues,
  onOpen,
  onChanged,
}: IssueListProps) {
  const { t } = useI18n();

  const patch = async (id: string, p: Parameters<typeof updateIssue>[1]) => {
    await updateIssue(id, p);
    onChanged();
  };

  const columns = [
    {
      title: "ID",
      dataIndex: "identifier",
      width: 96,
      render: (v: string) => (
        <Text type="tertiary" style={{ fontSize: 12 }}>
          {v}
        </Text>
      ),
    },
    {
      title: t("loop.field.title"),
      dataIndex: "title",
      render: (v: string, r: Issue) => (
        <span className="loop-cell-title" onClick={() => onOpen(r.id)}>
          {v}
        </span>
      ),
    },
    {
      title: t("loop.field.status"),
      dataIndex: "status",
      width: 150,
      render: (v: IssueStatus, r: Issue) => (
        <Select
          value={v}
          size="small"
          borderless
          onChange={(nv) => patch(r.id, { status: nv as IssueStatus })}
          style={{ width: 130 }}
        >
          {ISSUE_STATUS_ORDER.map((s) => (
            <Select.Option key={s} value={s}>
              <Tag color={ISSUE_STATUS_COLOR[s]} size="small">
                {t(`loop.status.${s}`)}
              </Tag>
            </Select.Option>
          ))}
        </Select>
      ),
    },
    {
      title: t("loop.field.priority"),
      dataIndex: "priority",
      width: 130,
      render: (v: IssuePriority, r: Issue) => (
        <Select
          value={v}
          size="small"
          borderless
          onChange={(nv) => patch(r.id, { priority: nv as IssuePriority })}
          style={{ width: 110 }}
        >
          {PRIORITY_ORDER.map((p) => (
            <Select.Option key={p} value={p}>
              <Tag color={PRIORITY_COLOR[p]} size="small">
                {t(`loop.priority.${p}`)}
              </Tag>
            </Select.Option>
          ))}
        </Select>
      ),
    },
    {
      title: t("loop.field.assignee"),
      dataIndex: "assignee_id",
      width: 180,
      render: (_v: string, r: Issue) => (
        <AssigneePicker
          size="small"
          value={r.assignee_id}
          valueName={r.assignee_name ?? null}
          onChange={(id, type) => patch(r.id, { assignee_id: id, assignee_type: type })}
        />
      ),
    },
    {
      title: t("loop.field.project"),
      dataIndex: "project_name",
      width: 130,
      render: (v: string | null) => <Text>{v ?? "—"}</Text>,
    },
  ];

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={issues}
      pagination={false}
      size="small"
    />
  );
}
