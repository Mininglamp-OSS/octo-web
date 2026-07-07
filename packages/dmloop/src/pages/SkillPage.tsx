import React, { useCallback, useEffect, useState } from "react";
import {
  Typography,
  Input,
  Button,
  Table,
  Tag,
  Spin,
  Empty,
  SideSheet,
  Toast,
  Popconfirm,
  TextArea,
} from "@douyinfe/semi-ui";
import { Search, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Skill, SkillSource } from "../api/types";
import {
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
} from "../api/skillApi";

const { Title, Text } = Typography;

const SOURCE_COLOR: Record<SkillSource, "green" | "blue" | "grey"> = {
  github: "green",
  local: "blue",
  workspace: "grey",
};

export default function SkillPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [active, setActive] = useState<Skill | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftContent, setDraftContent] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    listSkills({ keyword })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [keyword]);
  useEffect(reload, [reload]);

  const openDetail = async (id: string) => {
    const s = await getSkill(id);
    if (!s) return;
    setActive(s);
    setCreating(false);
    setDraftName(s.name);
    setDraftDesc(s.description);
    setDraftContent(s.content);
  };

  const openCreate = () => {
    setActive(null);
    setCreating(true);
    setDraftName("");
    setDraftDesc("");
    setDraftContent("");
  };

  const save = async () => {
    if (!draftName.trim()) {
      Toast.warning(t("loop.validate.nameRequired"));
      return;
    }
    if (creating) {
      await createSkill({
        name: draftName.trim(),
        description: draftDesc,
        content: draftContent,
      });
      Toast.success(t("loop.toast.created"));
    } else if (active) {
      await updateSkill(active.id, {
        name: draftName.trim(),
        description: draftDesc,
        content: draftContent,
      });
      Toast.success(t("loop.toast.saved"));
    }
    setActive(null);
    setCreating(false);
    reload();
  };

  const remove = async (id: string) => {
    await deleteSkill(id);
    Toast.success(t("loop.toast.deleted"));
    reload();
  };

  const columns = [
    {
      title: t("loop.field.name"),
      dataIndex: "name",
      render: (v: string, r: Skill) => (
        <span className="loop-cell-title" onClick={() => openDetail(r.id)}>
          {v}
        </span>
      ),
    },
    {
      title: t("loop.field.description"),
      dataIndex: "description",
      render: (v: string) => <Text type="tertiary">{v || "—"}</Text>,
    },
    {
      title: t("loop.skill.source"),
      dataIndex: "source",
      width: 120,
      render: (v: SkillSource) => (
        <Tag color={SOURCE_COLOR[v]} size="small">
          {t(`loop.skill.sourceType.${v}`)}
        </Tag>
      ),
    },
    {
      title: t("loop.skill.usedBy"),
      dataIndex: "used_by",
      width: 100,
      render: (v: number) => <Text>{v}</Text>,
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
        <Title heading={4}>{t("loop.nav.skill")}</Title>
        <div className="loop-page__spacer" />
        <Input
          prefix={<Search size={14} />}
          placeholder={t("loop.search.skill")}
          value={keyword}
          onChange={setKeyword}
          showClear
          style={{ width: 220 }}
        />
        <Button theme="solid" icon={<Plus size={14} />} onClick={openCreate}>
          {t("loop.action.newSkill")}
        </Button>
      </div>
      <div className="loop-page__body">
        {loading ? (
          <div className="loop-page__center">
            <Spin />
          </div>
        ) : rows.length === 0 ? (
          <div className="loop-page__center">
            <Empty description={t("loop.empty.skill")} />
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
        title={creating ? t("loop.action.newSkill") : t("loop.detail.skillTitle")}
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
              {t("loop.field.name")}
            </div>
            <Input value={draftName} onChange={setDraftName} />
          </div>
          <div>
            <div className="loop-detail__section-title">
              {t("loop.field.description")}
            </div>
            <Input value={draftDesc} onChange={setDraftDesc} />
          </div>
          <div>
            <div className="loop-detail__section-title">
              {t("loop.skill.content")}
            </div>
            <TextArea
              value={draftContent}
              onChange={setDraftContent}
              autosize={{ minRows: 6, maxRows: 16 }}
            />
          </div>
        </div>
      </SideSheet>
    </div>
  );
}
