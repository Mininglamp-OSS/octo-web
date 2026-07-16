import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Typography, Button, Select, Avatar, Spin, Modal, Toast, Banner, Dropdown } from "@douyinfe/semi-ui";
import LoopButton from "../ui/LoopButton";
import { Plus, Trash2, Users, Filter, ArrowUp, ArrowDown, ChevronDown, Check } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Squad, AssigneeCandidate } from "../api/types";
import { listSquads, createSquad, addSquadMember, deleteSquad } from "../api/squadApi";
import { listAssigneeCandidates } from "../api/issueApi";
import SquadDetailPage from "../panel/SquadDetailPage";
import { confirmDelete } from "../ui/confirmDelete";
import { avatarColor } from "../ui/meta";
import { formatRelativeTime } from "../ui/time";

const { Text } = Typography;

type Scope = "mine" | "all";
type SortField = "name" | "members" | "created";
type SortDir = "asc" | "desc";

function memberCountOf(s: Squad): number {
  return s.member_count ?? (s.members ?? s.member_preview ?? []).length;
}

/** 按 actor id 聚合成 {id,name,count} 选项列表（领队 / 创建人筛选共用）。 */
function actorOptions(rows: Squad[], idOf: (s: Squad) => string, nameOf: (s: Squad) => string | null | undefined) {
  const m = new Map<string, { id: string; name: string; count: number }>();
  for (const s of rows) {
    const id = idOf(s);
    const e = m.get(id);
    if (e) e.count += 1;
    else m.set(id, { id, name: nameOf(s) ?? id.slice(0, 8), count: 1 });
  }
  return [...m.values()];
}

export default function SquadPage() {
  const { t, format } = useI18n();
  const [rows, setRows] = useState<Squad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("all");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [fLeaders, setFLeaders] = useState<string[]>([]);
  const [fCreators, setFCreators] = useState<string[]>([]);
  const [myMemberId, setMyMemberId] = useState<string | undefined>();

  // create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [nName, setNName] = useState("");
  const [nDesc, setNDesc] = useState("");
  const [nLeader, setNLeader] = useState<string | undefined>();
  const [nMembers, setNMembers] = useState<string[]>([]);
  const [cands, setCands] = useState<AssigneeCandidate[]>([]);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    listSquads().then(setRows).catch((e) => setError(e?.message ?? "load failed")).finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  // 解析「我的」所需的当前用户 member_id（octo_uid===loginInfo.uid），与 Agent 页一致。
  useEffect(() => {
    const uid = WKApp.loginInfo.uid;
    if (!uid) return;
    listAssigneeCandidates()
      .then((cs) => setMyMemberId(cs.find((c) => c.type === "member" && c.octo_uid === uid)?.id))
      .catch(() => setMyMemberId(undefined));
  }, []);

  const openDetail = (id: string) => WKApp.routeRight.push(<SquadDetailPage squadId={id} onChanged={reload} />);

  const scopeCounts = useMemo(() => ({
    mine: rows.filter((s) => !!myMemberId && s.creator_id === myMemberId).length,
    all: rows.length,
  }), [rows, myMemberId]);

  const scopeRows = useMemo(
    () => (scope === "mine" ? rows.filter((s) => !!myMemberId && s.creator_id === myMemberId) : rows),
    [rows, scope, myMemberId],
  );

  const leaderOptions = useMemo(
    () => actorOptions(scopeRows, (s) => s.leader_id, (s) => s.leader_name),
    [scopeRows],
  );

  const creatorOptions = useMemo(
    () => actorOptions(scopeRows, (s) => s.creator_id, (s) => s.creator_name),
    [scopeRows],
  );

  const visible = useMemo(() => {
    const inScope = scopeRows.filter((s) => {
      if (fLeaders.length && !fLeaders.includes(s.leader_id)) return false;
      if (fCreators.length && !fCreators.includes(s.creator_id)) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...inScope].sort((a, b) => {
      if (sortField === "members") return (memberCountOf(a) - memberCountOf(b)) * dir || a.name.localeCompare(b.name);
      if (sortField === "created") return (Date.parse(a.created_at) - Date.parse(b.created_at)) * dir || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name) * dir;
    });
  }, [scopeRows, fLeaders, fCreators, sortField, sortDir]);

  const activeFilterCount = (fLeaders.length ? 1 : 0) + (fCreators.length ? 1 : 0);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const openCreate = () => {
    setCreateOpen(true);
    listAssigneeCandidates().then((cs) => {
      setCands(cs.filter((c) => c.type !== "squad"));
      const firstAgent = cs.find((c) => c.type === "agent");
      if (firstAgent) setNLeader(firstAgent.id);
    }).catch(() => setCands([]));
  };

  const doCreate = async () => {
    if (!nName.trim()) { Toast.warning(t("loop.validate.nameRequired")); return; }
    if (!nLeader) { Toast.warning(t("loop.squad.leaderRequired")); return; }
    setCreating(true);
    try {
      const squad = await createSquad({ name: nName.trim(), description: nDesc.trim() || undefined, leader_id: nLeader });
      // 追加成员：value 为 type:id，避免 agent 与 member 同 id 撞类型；领队不重复加入；单个失败不阻塞其余。
      const extra = nMembers
        .map((key) => cands.find((c) => `${c.type}:${c.id}` === key))
        .filter((c): c is AssigneeCandidate => !!c && !(c.type === "agent" && c.id === nLeader));
      if (extra.length) {
        await Promise.all(extra.map((c) =>
          addSquadMember(squad.id, c.type as "agent" | "member", c.id).catch(() =>
            Toast.warning(t("loop.squad.memberAddFailed", { values: { name: c.name } })))));
      }
      setCreateOpen(false); setNName(""); setNDesc(""); setNMembers([]); setNLeader(undefined);
      Toast.success(t("loop.toast.created"));
      reload();
      openDetail(squad.id);
    } catch (e) { Toast.error((e as Error)?.message ?? "create failed"); }
    finally { setCreating(false); }
  };

  const remove = async (id: string) => {
    try { await deleteSquad(id); Toast.success(t("loop.toast.archived")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? "archive failed"); }
  };
  const askRemove = (e: React.MouseEvent, s: Squad) => {
    e.stopPropagation();
    confirmDelete({ title: t("loop.squad.archiveConfirm"), okText: t("loop.squad.archive"), cancelText: t("loop.action.cancel"), onOk: () => remove(s.id) });
  };

  const agentCands = cands.filter((c) => c.type === "agent");

  const filterMenu = (
    <div className="loop-squad-filter">
      <div className="loop-squad-filter__group">
        <div className="loop-squad-filter__label">{t("loop.squad.leader")}</div>
        {leaderOptions.length === 0 ? <div className="loop-squad-filter__empty">—</div> : leaderOptions.map((o) => (
          <button key={o.id} type="button" className="loop-squad-filter__opt" onClick={() => setFLeaders((p) => toggle(p, o.id))}>
            <span className="loop-squad-filter__check">{fLeaders.includes(o.id) && <Check size={13} />}</span>
            <span className="loop-squad-filter__name">{o.name}</span>
            <span className="loop-squad-filter__count">{o.count}</span>
          </button>
        ))}
      </div>
      <div className="loop-squad-filter__group">
        <div className="loop-squad-filter__label">{t("loop.squad.filterCreator")}</div>
        {creatorOptions.length === 0 ? <div className="loop-squad-filter__empty">—</div> : creatorOptions.map((o) => (
          <button key={o.id} type="button" className="loop-squad-filter__opt" onClick={() => setFCreators((p) => toggle(p, o.id))}>
            <span className="loop-squad-filter__check">{fCreators.includes(o.id) && <Check size={13} />}</span>
            <span className="loop-squad-filter__name">{o.name}</span>
            <span className="loop-squad-filter__count">{o.count}</span>
          </button>
        ))}
      </div>
      {activeFilterCount > 0 && (
        <button type="button" className="loop-squad-filter__clear" onClick={() => { setFLeaders([]); setFCreators([]); }}>
          {t("loop.squad.clearFilters")}
        </button>
      )}
    </div>
  );

  const SORT_LABEL: Record<SortField, string> = {
    name: t("loop.squad.sortName"),
    members: t("loop.squad.sortMembers"),
    created: t("loop.squad.sortCreated"),
  };
  const sortMenu = (
    <div className="loop-squad-sort">
      <div className="loop-squad-filter__label">{t("loop.squad.sortBy")}</div>
      {(["name", "members", "created"] as SortField[]).map((f) => (
        <button key={f} type="button" className="loop-squad-filter__opt" onClick={() => setSortField(f)}>
          <span className="loop-squad-filter__check">{sortField === f && <Check size={13} />}</span>
          <span className="loop-squad-filter__name">{SORT_LABEL[f]}</span>
        </button>
      ))}
      <button type="button" className="loop-squad-filter__opt" onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}>
        <span className="loop-squad-filter__check">{sortDir === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}</span>
        <span className="loop-squad-filter__name">{sortDir === "asc" ? t("loop.squad.sortAsc") : t("loop.squad.sortDesc")}</span>
      </button>
    </div>
  );

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <h2 className="loop-page__title">{t("loop.nav.squad")}</h2>
        {rows.length > 0 && <Text type="tertiary" style={{ fontSize: 13 }}>{rows.length}</Text>}
        <div className="loop-page__spacer" />
        <LoopButton icon={<Plus size={14} />} onClick={openCreate}>{t("loop.action.newSquad")}</LoopButton>
      </div>

      <div className="loop-agent-toolbar loop-squad-toolbar">
        <div className="loop-agent-scope">
          {(["mine", "all"] as Scope[]).map((s) => (
            <button key={s} type="button" className={`loop-agent-scope__btn ${scope === s ? "is-active" : ""}`} onClick={() => setScope(s)}>
              {t(s === "mine" ? "loop.squad.scopeMine" : "loop.squad.scopeAll")}
              <span className="loop-agent-scope__count">{scopeCounts[s]}</span>
            </button>
          ))}
        </div>
        <div className="loop-squad-toolbar__spacer" />
        <Dropdown trigger="click" position="bottomRight" render={filterMenu}>
          <Button theme={activeFilterCount ? "light" : "borderless"} type={activeFilterCount ? "primary" : "tertiary"} size="small" icon={<Filter size={14} />}>
            {activeFilterCount ? `${t("loop.squad.filter")} · ${activeFilterCount}` : t("loop.squad.filter")}
          </Button>
        </Dropdown>
        <Dropdown trigger="click" position="bottomRight" render={sortMenu}>
          <Button theme="borderless" type="tertiary" size="small" icon={sortDir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}>
            {SORT_LABEL[sortField]}<ChevronDown size={13} style={{ marginLeft: 2 }} />
          </Button>
        </Dropdown>
      </div>

      <div className="loop-page__body">
        {error ? <Banner type="danger" description={error} />
          : loading ? <div className="loop-page__center"><Spin /></div>
          : rows.length === 0 ? (
            <div className="loop-empty">
              <Users size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{t("loop.empty.squadTitle")}</div>
              <div className="loop-empty__desc">{t("loop.empty.squadDesc")}</div>
              <LoopButton icon={<Plus size={14} />} onClick={openCreate} style={{ marginTop: 12 }}>{t("loop.action.newSquad")}</LoopButton>
            </div>
          ) : visible.length === 0 ? (
            <div className="loop-empty">
              <Users size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{t("loop.squad.noMatches")}</div>
            </div>
          ) : (
            <div className="loop-squad-list">
              {visible.map((s) => {
                const members = s.members ?? s.member_preview ?? [];
                const shown = members.slice(0, 3);
                const overflow = memberCountOf(s) - shown.length;
                return (
                  <div key={s.id} className="loop-squad-row" role="button" tabIndex={0} onClick={() => openDetail(s.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") openDetail(s.id); }}>
                    <Avatar size="small" shape="square" color={avatarColor(s.name)}>{s.name.slice(0, 1).toUpperCase()}</Avatar>
                    <span className="loop-squad-row__name">{s.name}</span>
                    <span className="loop-squad-row__desc">{s.description}</span>
                    <span className="loop-squad-row__leader">
                      <Avatar size="extra-extra-small" color="light-blue" src={s.leader_avatar ?? undefined}>{(s.leader_name ?? "?").slice(0, 1)}</Avatar>
                      <span className="loop-squad-row__leadername">{s.leader_name ?? "—"}</span>
                    </span>
                    <span className="loop-squad-row__stack">
                      {shown.map((m) => (
                        <Avatar key={`${m.member_type}:${m.member_id}`} size="extra-extra-small" color={m.member_type === "agent" ? "violet" : "light-blue"} src={m.member_avatar ?? undefined}>
                          {(m.member_name ?? "?").slice(0, 1)}
                        </Avatar>
                      ))}
                      {overflow > 0 && <span className="loop-squad-row__more">+{overflow}</span>}
                    </span>
                    <span className="loop-squad-row__creator">{s.creator_name ?? "—"}</span>
                    <span className="loop-squad-row__time">{formatRelativeTime(s.created_at, format)}</span>
                    <span className="loop-squad-row__del">
                      <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />} onClick={(e) => askRemove(e, s)} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      <Modal className="loop-modal" title={t("loop.action.newSquad")} visible={createOpen} onOk={doCreate} onCancel={() => setCreateOpen(false)}
        okText={t("loop.action.create")} cancelText={t("loop.action.cancel")} confirmLoading={creating}>
        <div className="loop-fields">
          <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.squad.createDesc")}</Text>
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.field.name")}</div>
            <input autoFocus className="loop-field" value={nName} onChange={(e) => setNName(e.target.value)} placeholder={t("loop.squad.namePlaceholder")} />
          </div>
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.field.description")}</div>
            <textarea className="loop-field-textarea" value={nDesc} onChange={(e) => setNDesc(e.target.value)} placeholder={t("loop.squad.descPlaceholder")} />
          </div>
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.squad.leader")}</div>
            <div className="loop-fields__hint">{t("loop.squad.leaderHint")}</div>
            {agentCands.length === 0 ? (
              <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.squad.noAgents")}</Text>
            ) : (
              <Select value={nLeader} onChange={(v) => setNLeader(v as string)} dropdownClassName="loop-fields__dropdown" filter style={{ width: "100%" }} placeholder={t("loop.squad.leaderPlaceholder")}>
                {agentCands.map((a) => <Select.Option key={a.id} value={a.id}>{a.name}</Select.Option>)}
              </Select>
            )}
          </div>
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.squad.membersLabel")} <span className="loop-detail__section-optional">{t("loop.squad.membersOptional")}</span></div>
            <div className="loop-fields__hint">{t("loop.squad.membersHint")}</div>
            <Select multiple filter value={nMembers} onChange={(v) => setNMembers(v as string[])} dropdownClassName="loop-fields__dropdown" style={{ width: "100%" }} placeholder={t("loop.squad.membersPlaceholder")} maxTagCount={3}>
              {cands.filter((c) => !(c.type === "agent" && c.id === nLeader)).map((c) => (
                <Select.Option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>{c.name} · {t(`loop.assignee.${c.type}`)}</Select.Option>
              ))}
            </Select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
