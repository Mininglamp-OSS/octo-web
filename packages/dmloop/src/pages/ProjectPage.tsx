import React, { useCallback, useEffect, useState } from "react";
import {
  Typography,
  Input,
  Button,
  Table,
  Tag,
  Select,
  Spin,
  Empty,
  SideSheet,
  Toast,
  Popconfirm,
  TextArea,
} from "@douyinfe/semi-ui";
import { Search, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Project, ProjectStatus, IssuePriority } from "../api/types";
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
} from "../api/projectApi";
import {
  PROJECT_STATUS_ORDER,
  PROJECT_STATUS_COLOR,
  PRIORITY_ORDER,
  PRIORITY_COLOR,
} from "../ui/meta";

const { Title, Text } = Typography;

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="loop-progress">
      <div className="loop-progress__bar">
        <div className="loop-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <Text type="tertiary" style={{ fontSize: 12 }}>
        {done}/{total}
      </Text>
    </div>
  );
}

export default function ProjectPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [active, setActive] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  const [dTitle, setDTitle] = useState("");
  const [dDesc, setDDesc] = useState("");
  const [dStatus, setDStatus] = useState<ProjectStatus>("planned");
  const [dPriority, setDPriority] = useState<IssuePriority>("none");

  const reload = useCallback(() => {
    setLoading(true);
    listProjects({ keyword })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [keyword]);
  useEffect(reload, [reload]);

  const openDetail = async (id: string) => {
    const p = await getProject(id);
    if (!p) return;
    setActive(p);
    setCreating(false);
    setDTitle(p.title);
    setDDesc(p.description ?? "");
    setDStatus(p.status);
    setDPriority(p.priority);
  };

  const openCreate = () => {
    setActive(null);
    setCreating(true);
    setDTitle("");
    setDDesc("");
    setDStatus("planned");
    setDPriority("none");
  };

  const save = async () => {
    if (!dTitle.trim()) {
      Toast.warning(t("loop.validate.titleRequired"));
      return;
    }
    const payload = {
      title: dTitle.trim(),
      description: dDesc,
      status: dStatus,
      priority: dPriority,
    };
    if (creating) {
      await createProject(payload);
      Toast.success(t("loop.toast.created"));
    } else if (active) {
      await updateProject(active.id, payload);
      Toast.success(t("loop.toast.saved"));
    }
    setActive(null);
    setCreating(false);
    reload();
  };

  const remove = async (id: string) => {
    await deleteProject(id);
    Toast.success(t("loop.toast.deleted"));
    reload();
  };

  const columns = [
    {
      title: t("loop.field.name"),
      dataIndex: "title",
      render: (v: string, r: Project) => (
        <span className="loop-cell-title" onClick={() => openDetail(r.id)}>
          {r.icon} {v}
        </span>
      ),
    },
    {
      title: t("loop.field.status"),
      dataIndex: "status",
      width: 120,
      render: (v: ProjectStatus) => (
        <Tag color={PROJECT_STATUS_COLOR[v]} size="small">
          {t(`loop.projectStatus.${v}`)}
        </Tag>
      ),
    },
    {
      title: t("loop.field.priority"),
      dataIndex: "priority",
      width: 100,
      render: (v: IssuePriority) => (
        <Tag color={PRIORITY_COLOR[v]} size="small">
          {t(`loop.priority.${v}`)}
        </Tag>
      ),
    },
    {
      title: t("loop.project.progress"),
      dataIndex: "issue_count",
      width: 170,
      render: (_v: number, r: Project) => (
        <Progress done={r.done_count} total={r.issue_count} />
      ),
    },
    {
      title: t("loop.project.lead"),
      dataIndex: "lead_name",
      width: 120,
      render: (v: string | null) => <Text>{v ?? "—"}</Text>,
    },
    {
      title: "",
      dataIndex: "id",
      width: 60,
      render: (v: string) => (
        <Popconfirm title={t("loop.confirm.delete")} onConfirm={() => remove(v)}>
          <Button
            theme="borderless"
            type="danger"
            size="small"
            icon={<Trash2 size={14} />}
          />
        </Popconfirm>
      ),
    },
  ];

  const editing = creating || !!active;

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.project")}</Title>
        <div className="loop-page__spacer" />
        <Input
          prefix={<Search size={14} />}
          placeholder={t("loop.search.project")}
          value={keyword}
          onChange={setKeyword}
          showClear
          style={{ width: 220 }}
        />
        <Button theme="solid" icon={<Plus size={14} />} onClick={openCreate}>
          {t("loop.action.newProject")}
        </Button>
      </div>
      <div className="loop-page__body">
        {loading ? (
          <div className="loop-page__center">
            <Spin />
          </div>
        ) : rows.length === 0 ? (
          <div className="loop-page__center">
            <Empty description={t("loop.empty.project")} />
          </div>
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={rows}
            pagination={false}
            size="small"
          />
        )}
      </div>

      <SideSheet
        title={
          creating ? t("loop.action.newProject") : t("loop.detail.projectTitle")
        }
        visible={editing}
        onCancel={() => {
          setActive(null);
          setCreating(false);
        }}
        width={480}
        footer={
          <Button theme="solid" onClick={save}>
            {t("loop.action.save")}
          </Button>
        }
      >
        <div className="loop-detail">
          <div>
            <div className="loop-detail__section-title">
              {t("loop.field.title")}
            </div>
            <Input value={dTitle} onChange={setDTitle} />
          </div>
          <div>
            <div className="loop-detail__section-title">
              {t("loop.field.description")}
            </div>
            <TextArea
              value={dDesc}
              onChange={setDDesc}
              autosize={{ minRows: 3, maxRows: 8 }}
            />
          </div>
          <dl className="loop-detail__fields">
            <dt>{t("loop.field.status")}</dt>
            <dd>
              <Select
                value={dStatus}
                onChange={(v) => setDStatus(v as ProjectStatus)}
                style={{ width: 180 }}
                size="small"
              >
                {PROJECT_STATUS_ORDER.map((s) => (
                  <Select.Option key={s} value={s}>
                    {t(`loop.projectStatus.${s}`)}
                  </Select.Option>
                ))}
              </Select>
            </dd>
            <dt>{t("loop.field.priority")}</dt>
            <dd>
              <Select
                value={dPriority}
                onChange={(v) => setDPriority(v as IssuePriority)}
                style={{ width: 180 }}
                size="small"
              >
                {PRIORITY_ORDER.map((p) => (
                  <Select.Option key={p} value={p}>
                    {t(`loop.priority.${p}`)}
                  </Select.Option>
                ))}
              </Select>
            </dd>
          </dl>
        </div>
      </SideSheet>
    </div>
  );
}
