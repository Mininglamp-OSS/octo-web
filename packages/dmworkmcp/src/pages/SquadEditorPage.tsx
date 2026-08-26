import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Crown, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { WKApp, WKButton, t, useI18n } from "@octo/base";
import ExpertEditorPage from "./ExpertEditorPage";
import {
  createSquad,
  getSquad,
  listExpertCategories,
  materializeExpert,
  rollbackPlugins,
  updateSquad,
  type ExpertCategoryCount,
  type ExpertMemberDraft,
  type SquadWriteForm,
} from "../api/expertService";

interface SquadEditorPageProps {
  mode: "create" | "edit";
  /** Required when mode === "edit". */
  squadId?: string;
}

/** A squad member: an already-persisted member expert, or an unsaved draft
 *  created here and materialized on the squad's save. `localKey` is a stable
 *  client id (drafts have no pluginId yet). */
type SquadMember =
  | {
      kind: "existing";
      localKey: string;
      pluginId: string;
      name: string;
      memberKey?: string;
      role?: string;
      leader: boolean;
    }
  | { kind: "draft"; localKey: string; draft: ExpertMemberDraft; leader: boolean };

const memberName = (m: SquadMember) => (m.kind === "existing" ? m.name : m.draft.name);

const TOAST_MS = 2600;

/**
 * Full-page squad (专家团) editor. Members are managed as drafts: "新建专家"
 * opens the expert editor in draft mode (nothing persisted), and the squad's
 * save materializes every draft member (its skills, then the member expert)
 * first, then creates/updates the squad wired to all members — one atomic-ish
 * save, rolled back if a step fails.
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
  const [members, setMembers] = useState<SquadMember[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
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
        const loaded: SquadMember[] = (s.members ?? [])
          .filter((m) => m.pluginId)
          .map((m) => ({
            kind: "existing",
            localKey: m.pluginId as string,
            pluginId: m.pluginId as string,
            name: m.name,
            memberKey: m.key,
            role: m.role,
            leader: !!m.leader,
          }));
        // A leader is required: a squad authored before this rule (or by a bot)
        // may carry no leader — promote the first member so save isn't blocked.
        if (loaded.length && !loaded.some((m) => m.leader)) {
          loaded[0] = { ...loaded[0], leader: true };
        }
        setMembers(loaded);
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
        mode="draft"
        onDraft={(draft) => {
          setMembers((prev) => [
            ...prev,
            // First member (or first after the leader was removed) becomes the
            // leader by default, since a squad always needs exactly one.
            {
              kind: "draft",
              localKey: crypto.randomUUID(),
              draft,
              leader: !prev.some((m) => m.leader),
            },
          ]);
          setDirty(true);
        }}
      />
    );
  };

  const editMember = (m: SquadMember) => {
    if (m.kind === "existing") {
      WKApp.routeRight.push(
        <ExpertEditorPage
          mode="edit"
          expertId={m.pluginId}
          onCommitted={({ name: memberN }) => {
            // Name lives on the member plugin, not the relation — just refresh
            // the display; the relation is unchanged, so no dirty flag.
            setMembers((prev) =>
              prev.map((x) => (x.localKey === m.localKey ? { ...x, name: memberN } : x))
            );
          }}
        />
      );
      return;
    }
    const localKey = m.localKey;
    WKApp.routeRight.push(
      <ExpertEditorPage
        mode="draft"
        initialDraft={m.draft}
        onDraft={(draft) => {
          setMembers((prev) =>
            prev.map((x) => (x.localKey === localKey && x.kind === "draft" ? { ...x, draft } : x))
          );
          setDirty(true);
        }}
      />
    );
  };

  const removeMember = (localKey: string) => {
    setMembers((prev) => {
      const next = prev.filter((x) => x.localKey !== localKey);
      // A leader is required: if the removed member was the leader, promote the
      // first remaining member so the squad always has exactly one.
      if (next.length && !next.some((m) => m.leader)) {
        next[0] = { ...next[0], leader: true };
      }
      return next;
    });
    setDirty(true);
  };

  /** Single-leader semantics: promote one member, clearing the rest. */
  const setLeader = (localKey: string) => {
    setMembers((prev) => prev.map((x) => ({ ...x, leader: x.localKey === localKey })));
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
    // A squad must designate exactly one leader among its members.
    if (members.length > 0 && !members.some((m) => m.leader)) {
      showToast(t("mcp.squad.editor.leaderRequired"));
      return;
    }

    setSaving(true);
    const allCreated: string[] = [];
    const materializedByKey = new Map<string, string>();
    try {
      // Materialize any draft members first (each: its skills, then the expert).
      const memberInputs: SquadWriteForm["members"] = [];
      for (const m of members) {
        if (m.kind === "existing") {
          memberInputs.push({
            pluginId: m.pluginId,
            name: m.name,
            memberKey: m.memberKey,
            role: m.role,
            isLeader: m.leader,
          });
        } else {
          const { id, createdPluginIds } = await materializeExpert(m.draft, {
            publishToScene: false,
          });
          allCreated.push(...createdPluginIds);
          materializedByKey.set(m.localKey, id);
          memberInputs.push({ pluginId: id, name: m.draft.name, memberKey: id, isLeader: m.leader });
        }
      }

      const form: SquadWriteForm = {
        name: name.trim(),
        summary,
        category: category || undefined,
        tags,
        instruction,
        members: memberInputs,
      };
      if (isEditing && editingId) {
        await updateSquad(editingId, form);
      } else {
        const { id } = await createSquad(form);
        setCreatedId(id);
      }

      // Convert now-persisted draft members into existing entries so a
      // subsequent save doesn't re-create them.
      setMembers((prev) =>
        prev.map((m) =>
          m.kind === "draft"
            ? {
                kind: "existing",
                localKey: m.localKey,
                pluginId: materializedByKey.get(m.localKey) as string,
                name: m.draft.name,
                memberKey: materializedByKey.get(m.localKey),
                leader: m.leader,
              }
            : m
        )
      );
      setDirty(false);
      showToast(t("mcp.squad.editor.saved"));
    } catch (err) {
      if (allCreated.length) await rollbackPlugins(allCreated);
      showToast(err instanceof Error ? err.message : t("mcp.squad.editor.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const title = name || t("mcp.squad.editor.createTitle");

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
                  <div key={m.localKey} className="wk-mcp-expert-editor__member-row">
                    <div className="wk-mcp-expert-editor__member-main">
                      <span className="wk-mcp-expert-editor__member-avatar" aria-hidden="true">
                        {(memberName(m) || "?").trim().slice(0, 1)}
                      </span>
                      <div>
                        <div className="wk-mcp-expert-editor__member-title">
                          {memberName(m)}
                        </div>
                        <div className="wk-mcp-expert-editor__member-meta">
                          {t("mcp.squad.editor.memberResourceLabel")}
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
                        disabled={m.leader}
                        onClick={() => setLeader(m.localKey)}
                      >
                        {m.leader && <Crown size={13} aria-hidden="true" />}
                        {m.leader
                          ? t("mcp.squad.editor.leaderBadge")
                          : t("mcp.squad.editor.setLeader")}
                      </button>
                      <button
                        type="button"
                        className="wk-mcp-expert-editor__member-link"
                        aria-label={t("mcp.squad.editor.editMember", { values: { name: memberName(m) } })}
                        onClick={() => editMember(m)}
                      >
                        <Pencil size={14} aria-hidden="true" />
                        {t("mcp.squad.editor.edit")}
                      </button>
                      <button
                        type="button"
                        className="wk-mcp-expert-editor__member-link"
                        aria-label={t("mcp.squad.editor.removeMember", { values: { name: memberName(m) } })}
                        onClick={() => removeMember(m.localKey)}
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
