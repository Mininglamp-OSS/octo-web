import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Typography, Input, Button, Tag, Spin, Modal, Toast } from "@douyinfe/semi-ui";
import { Search, Plus, Trash2, Briefcase, List, LayoutGrid, ListChecks } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Project } from "../api/types";
import { listProjects, createProject, deleteProject } from "../api/projectApi";
import ProjectDetailPage from "../panel/ProjectDetailPage";
import { PROJECT_STATUS_COLOR } from "../ui/meta";
import { confirmDelete } from "../ui/confirmDelete";
import { formatRelativeTime } from "../ui/time";
import { readView, writeView } from "../ui/viewMode";

const { Title, Text } = Typography;

type ViewMode = "list" | "card";
const VIEW_KEY = "loop.project.viewMode";

function Ring({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <div className="loop-ring">
      <svg width={40} height={40}>
        <circle className="loop-ring__track" cx={20} cy={20} r={r} fill="none" strokeWidth={4} />
        <circle
          className="loop-ring__fill"
          cx={20}
          cy={20}
          r={r}
          fill="none"
          strokeWidth={4}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
        />
      </svg>
      <span className="loop-ring__label">{done}/{total}</span>
    </div>
  );
}

export default function ProjectPage() {
  const { t, format } = useI18n();
  const [rows, setRows] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [view, setView] = useState<ViewMode>(() => readView(VIEW_KEY, ["list", "card"], "list"));
  const [createOpen, setCreateOpen] = useState(false);
  const [nTitle, setNTitle] = useState("");
  const [nDesc, setNDesc] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    listProjects().then(setRows).finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  const setViewMode = (v: ViewMode) => { setView(v); writeView(VIEW_KEY, v); };
  const openDetail = (id: string) => WKApp.routeRight.push(<ProjectDetailPage projectId={id} onChanged={reload} />);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => p.title.toLowerCase().includes(q));
  }, [keyword, rows]);

  const doCreate = async () => {
    if (!nTitle.trim()) { Toast.warning(t("loop.validate.titleRequired")); return; }
    try {
      await createProject({ title: nTitle.trim(), description: nDesc });
      setCreateOpen(false); setNTitle(""); setNDesc("");
      Toast.success(t("loop.toast.created"));
      reload();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    }
  };
  const remove = async (id: string) => {
    try { await deleteProject(id); Toast.success(t("loop.toast.deleted")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? t("loop.toast.deleteFailed")); }
  };
  const confirmRemove = (id: string) => confirmDelete({
    title: t("loop.confirm.delete"),
    okText: t("loop.action.delete"),
    cancelText: t("loop.action.cancel"),
    onOk: () => remove(id),
  });

  const renderList = () => (
    <div className="loop-project-list" role="list">
      {filtered.map((p) => (
        <div key={p.id} className="loop-project-list__row" role="listitem" onClick={() => openDetail(p.id)}>
          <span className="loop-project-list__icon">{p.icon || "📁"}</span>
          <span className="loop-project-list__name">{p.title}</span>
          <div className="loop-project-list__meta">
            <Tag color={PROJECT_STATUS_COLOR[p.status]} size="small">{t(`loop.projectStatus.${p.status}`)}</Tag>
            <span className="loop-project-list__count"><ListChecks size={13} />{p.done_count}/{p.issue_count}</span>
            <span className="loop-project-list__lead">{p.lead_name ?? t("loop.assignee.unassigned")}</span>
            <span className="loop-project-list__time">{formatRelativeTime(p.updated_at ?? p.created_at, format)}</span>
            <Button
              theme="borderless"
              type="danger"
              size="small"
              className="loop-project-list__del"
              icon={<Trash2 size={14} />}
              onClick={(e) => { e.stopPropagation(); confirmRemove(p.id); }}
            />
          </div>
        </div>
      ))}
    </div>
  );

  const renderCards = () => (
    <div className="loop-project-cards" role="list">
      {filtered.map((p) => (
        <div key={p.id} className="loop-project-card" role="listitem" onClick={() => openDetail(p.id)}>
          <Ring done={p.done_count} total={p.issue_count} />
          <div className="loop-project-card__body">
            <div className="loop-project-card__title">
              <span>{p.icon || "📁"}</span>
              <strong>{p.title}</strong>
            </div>
            <div className="loop-project-card__sub">
              {t("loop.detail.created")} {formatRelativeTime(p.created_at, format)}
            </div>
            <div className="loop-project-card__sub">{p.lead_name ?? t("loop.assignee.unassigned")}</div>
          </div>
          <Button
            theme="borderless"
            type="danger"
            size="small"
            className="loop-project-card__del"
            icon={<Trash2 size={14} />}
            onClick={(e) => { e.stopPropagation(); confirmRemove(p.id); }}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.project")}</Title>
        <Text type="tertiary" style={{ fontSize: 13 }}>{rows.length}</Text>
        <div className="loop-page__spacer" />
        <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>{t("loop.action.newProject")}</Button>
      </div>
      <div className="loop-project-toolbar">
        <Input className="loop-search" prefix={<Search size={14} />} placeholder={t("loop.search.project")} value={keyword} onChange={setKeyword} showClear style={{ width: 240 }} />
        <div className="loop-project-toolbar__spacer" />
        <div className="loop-viewtoggle">
          <button type="button" className={view === "list" ? "is-active" : ""} onClick={() => setViewMode("list")}>
            <List size={14} />{t("loop.view.list")}
          </button>
          <button type="button" className={view === "card" ? "is-active" : ""} onClick={() => setViewMode("card")}>
            <LayoutGrid size={14} />{t("loop.view.card")}
          </button>
        </div>
      </div>
      <div className="loop-page__body">
        {loading ? <div className="loop-page__center"><Spin /></div>
          : rows.length === 0 ? (
            <div className="loop-empty">
              <Briefcase size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{t("loop.empty.projectTitle")}</div>
              <div className="loop-empty__desc">{t("loop.empty.projectDesc")}</div>
              <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)} style={{ marginTop: 12 }}>{t("loop.action.newProject")}</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="loop-empty">
              <Briefcase size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{t("loop.empty.project")}</div>
            </div>
          ) : view === "card" ? renderCards() : renderList()}
      </div>
      <Modal className="loop-modal" title={t("loop.action.newProject")} visible={createOpen} onOk={doCreate} onCancel={() => setCreateOpen(false)} okText={t("loop.action.create")} cancelText={t("loop.action.cancel")}>
        <div className="loop-fields">
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.field.name")}</div>
            <input autoFocus className="loop-field" value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder={t("loop.project.namePlaceholder")} />
          </div>
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.field.description")}</div>
            <textarea className="loop-field-textarea" value={nDesc} onChange={(e) => setNDesc(e.target.value)} placeholder={t("loop.project.descPlaceholder")} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
