import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Crown, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { WKApp, WKButton, t, useI18n } from "@octo/base";
import ExpertEditorPage from "./ExpertEditorPage";
import {
  createSquad,
  getSquad,
  listExpertCategories,
  updateSquad,
  type ExpertCategoryCount,
  type SquadWriteForm,
} from "../api/expertService";

interface SquadEditorPageProps {
  mode: "create" | "edit";
  /** Required when mode === "edit". */
  squadId?: string;
}

/** A squad member row managed locally by the editor. `pluginId` is the member
 *  expert's own plugin id (the expert_team_expert relation target). */
interface MemberRow {
  pluginId: string;
  name: string;
  memberKey?: string;
  role?: string;
  leader: boolean;
}

const TOAST_MS = 2600;

/**
 * Full-page squad (专家团) editor — create + edit — mirroring the marketing
 * prototype's team editor. Pushed into the market right pane via
 * WKApp.routeRight.push; returns via pop. Edits the team's self-contained
 * content: name/summary/category/tags + 团队指令 (AGENTS.md, verbatim) + a
 * member list. Members are squad-internal expert plugins created/edited through
 * the expert editor (ExpertEditorPage) and bound via expert_team_expert.
 */
export default function SquadEditorPage({ mode, squadId }: SquadEditorPageProps) {
  useI18n();
  const isEdit = mode === "edit";

  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [instruction, setInstruction] = useState("");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  /** Set once a create succeeds so the page flips to edit-in-place (no route
   *  change — replaceToRoot would strand the user on the empty-state on back). */
  const [createdId, setCreatedId] = useState<string | null>(null);

  const editingId = squadId ?? createdId ?? undefined;
  const isEditing = isEdit || createdId !== null;

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => {
    let alive = true;
    listExpertCategories("squad")
      .then((cats: ExpertCategoryCount[]) => {
        if (alive) setCategories(cats.map((c) => c.name).filter(Boolean));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    if (!squadId) {
      setLoading(false);
      setError(t("mcp.squad.editor.noSquad"));
      return;
    }
    let alive = true;
    setLoading(true);
    getSquad(squadId)
      .then((s) => {
        if (!alive) return;
        setName(s.name);
        setSummary(s.summary);
        setCategory(s.category);
        setTags(s.tags ?? []);
        setInstruction(s.instruction ?? "");
        setMembers(
          (s.members ?? [])
            .filter((m) => m.pluginId)
            .map((m) => ({
              pluginId: m.pluginId as string,
              name: m.name,
              memberKey: m.key,
              role: m.role,
              leader: !!m.leader,
            }))
        );
        setDirty(false);
      })
      .catch(() => {
        if (alive) setError(t("mcp.squad.editor.loadFailed"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isEdit, squadId]);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    []
  );

  const mark = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  const addTag = () => {
    const value = tagDraft.trim();
    if (!value || tags.includes(value)) {
      setTagDraft("");
      return;
    }
    setTags([...tags, value]);
    setTagDraft("");
    setDirty(true);
  };
  const removeTag = (tag: string) => {
    setTags(tags.filter((tg) => tg !== tag));
    setDirty(true);
  };

  const addMember = () => {
    WKApp.routeRight.push(
      <ExpertEditorPage
        mode="create"
        publishToScene={false}
        onCommitted={({ id, name: memberName }) => {
          setMembers((prev) => [
            ...prev,
            { pluginId: id, name: memberName, memberKey: id, leader: false },
          ]);
          setDirty(true);
        }}
      />
    );
  };

  const editMember = (m: MemberRow) => {
    WKApp.routeRight.push(
      <ExpertEditorPage
        mode="edit"
        expertId={m.pluginId}
        onCommitted={({ id, name: memberName }) => {
          // The member name lives on the member plugin, not the relation — just
          // refresh the display; no squad relation change, so no dirty flag.
          setMembers((prev) =>
            prev.map((x) => (x.pluginId === id ? { ...x, name: memberName } : x))
          );
        }}
      />
    );
  };

  const removeMember = (pluginId: string) => {
    setMembers((prev) => prev.filter((x) => x.pluginId !== pluginId));
    setDirty(true);
  };

  /** Single-leader semantics: promote one member (clearing the rest); clicking
   *  the current leader again unsets it (no leader). */
  const toggleLeader = (pluginId: string) => {
    setMembers((prev) =>
      prev.map((x) =>
        x.pluginId === pluginId
          ? { ...x, leader: !x.leader }
          : { ...x, leader: false }
      )
    );
    setDirty(true);
  };

  const glyph = useMemo(() => (name || "?").trim().slice(0, 1), [name]);

  const goBack = () => {
    if (dirty && !window.confirm(t("mcp.squad.editor.leaveConfirm"))) return;
    WKApp.routeRight.pop();
  };

  const save = async () => {
    if (saving) return;
    if (!name.trim()) {
      showToast(t("mcp.squad.editor.nameRequired"));
      return;
    }
    const form: SquadWriteForm = {
      name: name.trim(),
      summary,
      category: category || undefined,
      tags,
      instruction,
      members: members.map((m) => ({
        pluginId: m.pluginId,
        name: m.name,
        memberKey: m.memberKey,
        role: m.role,
        isLeader: m.leader,
      })),
    };
    setSaving(true);
    try {
      if (isEditing && editingId) {
        await updateSquad(editingId, form);
      } else {
        const { id } = await createSquad(form);
        setCreatedId(id);
      }
      setDirty(false);
      showToast(t("mcp.squad.editor.saved"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("mcp.squad.editor.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const title = isEditing ? name || t("mcp.squad.editor.createTitle") : t("mcp.squad.editor.createTitle");

  return (
    <div className="wk-mcp-expert-editor">
      <header className="wk-mcp-expert-editor__topbar">
        <div className="wk-mcp-expert-editor__crumb">
          <button
            type="button"
            className="wk-mcp-expert-editor__back"
            onClick={goBack}
            aria-label={t("mcp.squad.editor.returnToMarket")}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t("mcp.squad.editor.returnToMarket")}
          </button>
          <span className="wk-mcp-expert-editor__crumb-sep">/</span>
          <b className="wk-mcp-expert-editor__crumb-title">{title}</b>
        </div>
        <WKButton
          variant="primary"
          icon={<Save size={15} />}
          loading={saving}
          disabled={loading || (isEditing && !dirty)}
          onClick={save}
        >
          {t("mcp.squad.editor.save")}
        </WKButton>
      </header>

      {loading ? (
        <div className="wk-mcp-expert-editor__state">{t("mcp.squad.editor.loading")}</div>
      ) : error ? (
        <div className="wk-mcp-expert-editor__state wk-mcp-expert-editor__state--error" role="alert">
          <span>{error}</span>
          <WKButton onClick={goBack}>{t("mcp.squad.editor.returnToMarket")}</WKButton>
        </div>
      ) : (
        <div className="wk-mcp-expert-editor__body">
          <section className="wk-mcp-expert-editor__hero">
            <div className="wk-mcp-expert-editor__avatar" aria-hidden="true">
              {glyph}
            </div>
            <div className="wk-mcp-expert-editor__hero-main">
              <input
                className="wk-mcp-expert-editor__title-input"
                value={name}
                maxLength={40}
                placeholder={t("mcp.squad.editor.namePlaceholder")}
                aria-label={t("mcp.squad.editor.editName")}
                onChange={(e) => mark(setName)(e.target.value)}
              />
              <textarea
                className="wk-mcp-expert-editor__desc-input"
                value={summary}
                rows={2}
                placeholder={t("mcp.squad.editor.descPlaceholder")}
                aria-label={t("mcp.squad.editor.editDesc")}
                onChange={(e) => mark(setSummary)(e.target.value)}
              />
            </div>
          </section>

          <section className="wk-mcp-expert-editor__block">
            <div className="wk-mcp-expert-editor__block-head">
              <div className="wk-mcp-expert-editor__block-title">
                {t("mcp.squad.editor.basicInfo")}
              </div>
            </div>
            <div className="wk-mcp-expert-editor__fields">
              <label className="wk-mcp-expert-editor__field">
                <span>{t("mcp.squad.editor.category")}</span>
                <select value={category} onChange={(e) => mark(setCategory)(e.target.value)}>
                  <option value="">{t("mcp.squad.editor.categoryPlaceholder")}</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wk-mcp-expert-editor__field">
                <span>{t("mcp.squad.editor.tags")}</span>
                <div className="wk-mcp-expert-editor__tags">
                  {tags.map((tag) => (
                    <span key={tag} className="wk-mcp-expert-editor__tag">
                      {tag}
                      <button
                        type="button"
                        aria-label={t("mcp.squad.editor.removeTag", { values: { name: tag } })}
                        onClick={() => removeTag(tag)}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagDraft}
                    placeholder={t("mcp.squad.editor.tagPlaceholder")}
                    aria-label={t("mcp.squad.editor.tags")}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    onBlur={addTag}
                  />
                </div>
              </label>
            </div>
          </section>

          <section className="wk-mcp-expert-editor__block">
            <div className="wk-mcp-expert-editor__block-head">
              <div className="wk-mcp-expert-editor__block-title">
                {t("mcp.squad.editor.teamInstructionTitle")}
              </div>
              <span className="wk-mcp-expert-editor__chip">Markdown</span>
            </div>
            <textarea
              className="wk-mcp-expert-editor__code"
              value={instruction}
              spellCheck={false}
              placeholder={t("mcp.squad.editor.instructionHint")}
              aria-label={t("mcp.squad.editor.teamInstructionTitle")}
              onChange={(e) => mark(setInstruction)(e.target.value)}
            />
          </section>

          <section className="wk-mcp-expert-editor__block">
            <div className="wk-mcp-expert-editor__block-head">
              <div className="wk-mcp-expert-editor__block-title">
                {t("mcp.squad.editor.membersTitle")}
              </div>
              <WKButton icon={<Plus size={15} />} onClick={addMember}>
                {t("mcp.squad.editor.addMember")}
              </WKButton>
            </div>
            {members.length ? (
              <div className="wk-mcp-expert-editor__member-list">
                {members.map((m) => (
                  <div key={m.pluginId} className="wk-mcp-expert-editor__member-row">
                    <div className="wk-mcp-expert-editor__member-main">
                      <span className="wk-mcp-expert-editor__member-avatar" aria-hidden="true">
                        {(m.name || "?").trim().slice(0, 1)}
                      </span>
                      <div>
                        <div className="wk-mcp-expert-editor__member-title">
                          {m.name}
                          {m.leader && (
                            <span className="wk-mcp-expert-editor__member-leader-badge">
                              <Crown size={12} aria-hidden="true" />
                              {t("mcp.squad.editor.leaderBadge")}
                            </span>
                          )}
                        </div>
                        <div className="wk-mcp-expert-editor__member-meta">
                          {m.pluginId} · {t("mcp.squad.editor.memberResourceLabel")}
                        </div>
                      </div>
                    </div>
                    <div className="wk-mcp-expert-editor__member-actions">
                      <button
                        type="button"
                        className={
                          m.leader
                            ? "wk-mcp-expert-editor__member-leader is-active"
                            : "wk-mcp-expert-editor__member-leader"
                        }
                        onClick={() => toggleLeader(m.pluginId)}
                      >
                        {m.leader
                          ? t("mcp.squad.editor.unsetLeader")
                          : t("mcp.squad.editor.setLeader")}
                      </button>
                      <button
                        type="button"
                        className="wk-mcp-expert-editor__member-link"
                        aria-label={t("mcp.squad.editor.editMember", { values: { name: m.name } })}
                        onClick={() => editMember(m)}
                      >
                        <Pencil size={14} aria-hidden="true" />
                        {t("mcp.squad.editor.edit")}
                      </button>
                      <button
                        type="button"
                        className="wk-mcp-expert-editor__member-link"
                        aria-label={t("mcp.squad.editor.removeMember", { values: { name: m.name } })}
                        onClick={() => removeMember(m.pluginId)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        {t("mcp.squad.editor.remove")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="wk-mcp-expert-editor__empty">
                {t("mcp.squad.editor.noMembers")}
              </div>
            )}
          </section>
        </div>
      )}

      {toast && <div className="wk-mcp-expert-editor__toast">{toast}</div>}
    </div>
  );
}
