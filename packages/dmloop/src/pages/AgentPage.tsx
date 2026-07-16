import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Input, Button, Select, Avatar, Spin, Modal, Toast, Banner } from "@douyinfe/semi-ui";
import LoopButton from "../ui/LoopButton";
import { Search, Plus, Trash2, Bot, RotateCcw } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Agent, RuntimeDevice } from "../api/types";
import { listAgents, createAgent, archiveAgent, restoreAgent, listRuntimesForAgent } from "../api/agentApi";
import { listAssigneeCandidates } from "../api/issueApi";
import AgentDetailPage from "../panel/AgentDetailPage";
import { confirmDelete } from "../ui/confirmDelete";
import { avatarColor } from "../ui/meta";
import { formatRelativeTime } from "../ui/time";

type Scope = "mine" | "all" | "archived";
const SCOPES: Scope[] = ["mine", "all", "archived"];
const SCOPE_LABEL: Record<Scope, string> = { mine: "scopeMine", all: "scopeAll", archived: "scopeArchived" };

export default function AgentPage() {
  const { t, format } = useI18n();
  const [rows, setRows] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [myMemberId, setMyMemberId] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [nName, setNName] = useState("");
  const [nDesc, setNDesc] = useState("");
  const [nModel, setNModel] = useState("");
  const [nRuntimeId, setNRuntimeId] = useState<string | undefined>();
  const [runtimes, setRuntimes] = useState<RuntimeDevice[]>([]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    listAgents({ includeArchived: true }).then(setRows).catch((e) => setError(e?.message ?? "load failed")).finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  // 解析「我的」所需的当前用户 member_id：候选里 octo_uid===loginInfo.uid 的成员（与 Issue「与我相关」一致）。
  useEffect(() => {
    const uid = WKApp.loginInfo.uid;
    if (!uid) return;
    listAssigneeCandidates()
      .then((cands) => setMyMemberId(cands.find((c) => c.type === "member" && c.octo_uid === uid)?.id))
      .catch(() => setMyMemberId(undefined));
  }, []);

  const counts = useMemo(() => ({
    mine: rows.filter((a) => !a.archived_at && !!myMemberId && a.owner_id === myMemberId).length,
    all: rows.filter((a) => !a.archived_at).length,
    archived: rows.filter((a) => !!a.archived_at).length,
  }), [rows, myMemberId]);

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((a) => {
      if (scope === "archived") { if (!a.archived_at) return false; }
      else if (a.archived_at) return false;
      if (scope === "mine" && !(myMemberId && a.owner_id === myMemberId)) return false;
      if (kw && !(a.name.toLowerCase().includes(kw) || (a.description ?? "").toLowerCase().includes(kw))) return false;
      return true;
    });
  }, [rows, scope, keyword, myMemberId]);

  const openDetail = (id: string) => WKApp.routeRight.push(<AgentDetailPage agentId={id} onChanged={reload} />);

  const openCreate = () => {
    setCreateOpen(true);
    listRuntimesForAgent().then((rs) => { setRuntimes(rs); if (rs[0]) setNRuntimeId(rs[0].id); }).catch(() => setRuntimes([]));
  };

  const doCreate = async () => {
    if (!nName.trim()) { Toast.warning(t("loop.validate.nameRequired")); return; }
    if (!nRuntimeId) { Toast.warning(t("loop.agent.runtimeRequired")); return; }
    try {
      await createAgent({ name: nName.trim(), description: nDesc, runtime_id: nRuntimeId, model: nModel || undefined, visibility: "workspace" });
      setCreateOpen(false); setNName(""); setNDesc("");
      Toast.success(t("loop.toast.created")); reload();
    } catch (e) { Toast.error((e as Error)?.message ?? "create failed"); }
  };

  const remove = async (id: string) => {
    try { await archiveAgent(id); Toast.success(t("loop.toast.archived")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? "archive failed"); }
  };

  const askRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    confirmDelete({ title: t("loop.agent.archiveConfirm"), okText: t("loop.agent.archive"), cancelText: t("loop.action.cancel"), onOk: () => remove(id) });
  };

  const doRestore = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try { await restoreAgent(id); Toast.success(t("loop.toast.restored")); reload(); }
    catch (err) { Toast.error((err as Error)?.message ?? "restore failed"); }
  };

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <h2 className="loop-page__title">{t("loop.nav.agent")}</h2>
        <div className="loop-page__spacer" />
        <Input className="loop-search" prefix={<Search size={14} />} placeholder={t("loop.search.agent")} value={keyword} onChange={setKeyword} showClear style={{ width: 220 }} />
        <LoopButton icon={<Plus size={14} />} onClick={openCreate}>{t("loop.action.newAgent")}</LoopButton>
      </div>

      <div className="loop-agent-toolbar">
        <div className="loop-agent-scope">
          {SCOPES.map((s) => (
            <button key={s} type="button" className={`loop-agent-scope__btn ${scope === s ? "is-active" : ""}`} onClick={() => setScope(s)}>
              {t(`loop.agent.${SCOPE_LABEL[s]}`)}
              <span className="loop-agent-scope__count">{counts[s]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="loop-page__body">
        {error ? <Banner type="danger" description={error} />
          : loading ? <div className="loop-page__center"><Spin /></div>
          : visible.length === 0 ? (
            <div className="loop-empty">
              <Bot size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{scope === "archived" ? t("loop.agent.archivedEmpty") : t("loop.empty.agentTitle")}</div>
              {scope !== "archived" && <div className="loop-empty__desc">{t("loop.empty.agentDesc")}</div>}
              {scope !== "archived" && <LoopButton icon={<Plus size={14} />} onClick={openCreate} style={{ marginTop: 12 }}>{t("loop.action.newAgent")}</LoopButton>}
            </div>
          ) : (
            <div className="loop-agent-list">
              {visible.map((a) => (
                <button key={a.id} className={`loop-agent-row ${a.archived_at ? "is-archived" : ""}`} onClick={() => openDetail(a.id)}>
                  <span className="loop-agent-row__avatar">
                    <Avatar size="extra-small" shape="square" color={avatarColor(a.name)}>{a.name.slice(0, 1).toUpperCase()}</Avatar>
                    <i className="loop-agent-row__dot" data-status={a.status} />
                  </span>
                  <span className="loop-agent-row__name">{a.name}</span>
                  <span className="loop-agent-row__desc">{a.description}</span>
                  <span className="loop-agent-row__meta">
                    <span className="loop-agent-row__device">{a.runtime_name || a.model || "—"}</span>
                    <span className="loop-agent-row__owner">
                      {a.owner_name && <Avatar size="extra-extra-small" color="grey">{a.owner_name.slice(0, 1).toUpperCase()}</Avatar>}
                      <span className="loop-agent-row__ownername">{a.owner_name ?? "—"}</span>
                    </span>
                    <span className="loop-agent-row__time">{formatRelativeTime(a.updated_at, format)}</span>
                  </span>
                  <span className="loop-agent-row__archive">
                    {a.archived_at
                      ? <Button theme="borderless" size="small" icon={<RotateCcw size={14} />} onClick={(e) => doRestore(e, a.id)}>{t("loop.agent.restore")}</Button>
                      : <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />} onClick={(e) => askRemove(e, a.id)} />}
                  </span>
                </button>
              ))}
            </div>
          )}
      </div>

      <Modal className="loop-modal" title={t("loop.action.newAgent")} visible={createOpen} onOk={doCreate} onCancel={() => setCreateOpen(false)} okText={t("loop.action.create")} cancelText={t("loop.action.cancel")}>
        <div className="loop-fields">
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.field.name")}</div>
            <input autoFocus className="loop-field" value={nName} onChange={(e) => setNName(e.target.value)} placeholder={t("loop.agent.namePlaceholder")} />
          </div>
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.field.description")}</div>
            <textarea className="loop-field-textarea" value={nDesc} onChange={(e) => setNDesc(e.target.value)} placeholder={t("loop.agent.descPlaceholder")} />
          </div>
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.agent.runtime")}</div>
            <Select value={nRuntimeId} onChange={(v) => setNRuntimeId(v as string)} dropdownClassName="loop-fields__dropdown" style={{ width: "100%" }} placeholder={t("loop.agent.runtime")}>
              {runtimes.map((r) => <Select.Option key={r.id} value={r.id}>{r.name}（{r.provider}）</Select.Option>)}
            </Select>
          </div>
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.agent.model")}</div>
            <input className="loop-field" value={nModel} onChange={(e) => setNModel(e.target.value)} placeholder="claude-opus-4 / codex-latest…" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
