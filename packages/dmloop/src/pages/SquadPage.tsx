import React, { useCallback, useEffect, useState } from "react";
import {
  Typography,
  Input,
  Button,
  Table,
  Avatar,
  Tag,
  Select,
  Spin,
  Empty,
  SideSheet,
  Toast,
  Popconfirm,
  TextArea,
} from "@douyinfe/semi-ui";
import { Search, Plus, Trash2, Users, UserPlus } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Squad, AssigneeCandidate } from "../api/types";
import {
  listSquads,
  getSquad,
  createSquad,
  updateSquad,
  deleteSquad,
  addSquadMember,
  removeSquadMember,
} from "../api/squadApi";
import { listAssigneeCandidates } from "../api/issueApi";
import { ASSIGNEE_TYPE_COLOR } from "../ui/meta";

const { Title, Text } = Typography;

export default function SquadPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Squad[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [active, setActive] = useState<Squad | null>(null);
  const [creating, setCreating] = useState(false);
  const [dName, setDName] = useState("");
  const [dDesc, setDDesc] = useState("");
  const [dInstr, setDInstr] = useState("");
  const [cands, setCands] = useState<AssigneeCandidate[]>([]);
  const [addPick, setAddPick] = useState<string | undefined>();

  const reload = useCallback(() => {
    setLoading(true);
    listSquads({ keyword })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [keyword]);
  useEffect(reload, [reload]);
  useEffect(() => {
    listAssigneeCandidates().then(setCands);
  }, []);

  const openDetail = async (id: string) => {
    const s = await getSquad(id);
    if (!s) return;
    setActive(s);
    setCreating(false);
    setDName(s.name);
    setDDesc(s.description);
    setDInstr(s.instructions);
  };

  const openCreate = () => {
    setActive(null);
    setCreating(true);
    setDName("");
    setDDesc("");
    setDInstr("");
  };

  const save = async () => {
    if (!dName.trim()) {
      Toast.warning(t("loop.validate.nameRequired"));
      return;
    }
    const payload = {
      name: dName.trim(),
      description: dDesc,
      instructions: dInstr,
    };
    if (creating) {
      await createSquad(payload);
      Toast.success(t("loop.toast.created"));
      setCreating(false);
    } else if (active) {
      const next = await updateSquad(active.id, payload);
      setActive(next);
      Toast.success(t("loop.toast.saved"));
    }
    reload();
  };

  const remove = async (id: string) => {
    await deleteSquad(id);
    Toast.success(t("loop.toast.deleted"));
    reload();
  };

  const addMember = async () => {
    if (!active || !addPick) return;
    const next = await addSquadMember(active.id, addPick);
    setActive(next);
    setAddPick(undefined);
    reload();
  };

  const dropMember = async (memberId: string) => {
    if (!active) return;
    const next = await removeSquadMember(active.id, memberId);
    setActive(next);
    reload();
  };

  const columns = [
    {
      title: t("loop.field.name"),
      dataIndex: "name",
      render: (v: string, r: Squad) => (
        <span
          className="loop-cell-title"
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          onClick={() => openDetail(r.id)}
        >
          <Avatar size="extra-small" color="purple">
            <Users size={14} />
          </Avatar>
          <span>
            <div>{v}</div>
            <Text type="tertiary" style={{ fontSize: 12 }}>
              {r.description}
            </Text>
          </span>
        </span>
      ),
    },
    {
      title: t("loop.squad.leader"),
      dataIndex: "leader_name",
      width: 150,
    },
    {
      title: t("loop.squad.members"),
      dataIndex: "members",
      width: 110,
      render: (_v: unknown, r: Squad) => <Text>{r.members.length}</Text>,
    },
    {
      title: t("loop.field.creator"),
      dataIndex: "creator_name",
      width: 130,
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
  const availCands = cands.filter(
    (c) => !active?.members.some((m) => m.member_id === c.id),
  );

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.squad")}</Title>
        <div className="loop-page__spacer" />
        <Input
          prefix={<Search size={14} />}
          placeholder={t("loop.search.squad")}
          value={keyword}
          onChange={setKeyword}
          showClear
          style={{ width: 220 }}
        />
        <Button theme="solid" icon={<Plus size={14} />} onClick={openCreate}>
          {t("loop.action.newSquad")}
        </Button>
      </div>
      <div className="loop-page__body">
        {loading ? (
          <div className="loop-page__center">
            <Spin />
          </div>
        ) : rows.length === 0 ? (
          <div className="loop-page__center">
            <Empty description={t("loop.empty.squad")} />
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
        title={creating ? t("loop.action.newSquad") : t("loop.detail.squadTitle")}
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
            <Input value={dName} onChange={setDName} />
          </div>
          <div>
            <div className="loop-detail__section-title">
              {t("loop.field.description")}
            </div>
            <Input value={dDesc} onChange={setDDesc} />
          </div>
          <div>
            <div className="loop-detail__section-title">
              {t("loop.squad.instructions")}
            </div>
            <TextArea
              value={dInstr}
              onChange={setDInstr}
              autosize={{ minRows: 3, maxRows: 8 }}
            />
          </div>

          {!creating && active && (
            <div>
              <div className="loop-detail__section-title">
                {t("loop.squad.members")} ({active.members.length})
              </div>
              <div className="loop-comments">
                {active.members.map((m) => (
                  <div
                    key={m.member_id}
                    className="loop-comment"
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <Avatar size="extra-extra-small" color="light-blue">
                      {m.member_name.slice(0, 1)}
                    </Avatar>
                    <Text>{m.member_name}</Text>
                    <Tag color={ASSIGNEE_TYPE_COLOR[m.member_type]} size="small">
                      {t(`loop.assignee.${m.member_type}`)}
                    </Tag>
                    {m.role === "leader" && (
                      <Tag color="amber" size="small">
                        {t("loop.squad.roleLeader")}
                      </Tag>
                    )}
                    {m.role !== "leader" && (
                      <Button
                        theme="borderless"
                        type="danger"
                        size="small"
                        style={{ marginLeft: "auto" }}
                        icon={<Trash2 size={13} />}
                        onClick={() => dropMember(m.member_id)}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <Select
                  placeholder={t("loop.squad.addMember")}
                  value={addPick}
                  onChange={(v) => setAddPick(v as string)}
                  style={{ flex: 1 }}
                  size="small"
                >
                  {availCands.map((c) => (
                    <Select.Option key={c.id} value={c.id}>
                      {c.name} · {t(`loop.assignee.${c.type}`)}
                    </Select.Option>
                  ))}
                </Select>
                <Button
                  icon={<UserPlus size={14} />}
                  onClick={addMember}
                  disabled={!addPick}
                >
                  {t("loop.squad.add")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SideSheet>
    </div>
  );
}
