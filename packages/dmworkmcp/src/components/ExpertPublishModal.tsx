import React, { useEffect, useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { t, useI18n, WKButton, WKModal } from "@octo/base";
import {
  EXPERT_AGENTS,
  EXPERT_CATEGORIES,
  EXPERT_WORKSPACE,
} from "../mock/expertMock";
import type { ExpertAgent, ExpertMember, ExpertSkill, ExpertSquad } from "../mock/expertMock";
import { getMcpAvatarColor } from "../utils/mcpAvatar";

interface ExpertPublishModalProps {
  visible: boolean;
  onClose: () => void;
  onPublish: (squad: ExpertSquad) => void;
  /** When set, the modal edits this squad's metadata instead of creating one. */
  editing?: ExpertSquad | null;
  /** Category NAMEs fetched from the backend; falls back to the static list. */
  categories?: string[];
  /** Published experts to pick members from; falls back to the static list. */
  library?: ExpertAgent[];
}

/**
 * A squad member being edited. `agentId` links to a library expert template
 * when the member was picked from the library (empty for members carried over
 * from an existing squad whose template isn't in the library — those still
 * round-trip via the preserved name/key/templateId).
 */
interface DraftMember {
  agentId: string;
  name: string;
  role: string;
  leader: boolean;
  instruction: string;
  key?: string;
  templateId?: string;
  mcpConfig?: string;
  skills?: ExpertSkill[];
}

interface Draft {
  name: string;
  summary: string;
  category: string;
  tags: string[];
  members: DraftMember[];
  strategies: string;
}

// Categories minus the "全部" pseudo bucket — a squad must pick a real one.
// Used as the fallback when the backend category list hasn't loaded.
const FALLBACK_CATEGORIES = EXPERT_CATEGORIES.filter((c) => c !== "全部");
const STEP_KEYS = ["basics", "members", "routing", "preview"] as const;
type StepKey = (typeof STEP_KEYS)[number];
// A squad needs at least this many members before it can be published.
const MIN_MEMBERS = 2;

function createDraft(defaultCategory = FALLBACK_CATEGORIES[0] ?? "营销策划"): Draft {
  return {
    name: "",
    summary: "",
    category: defaultCategory,
    tags: [],
    members: [],
    strategies: "",
  };
}

/** Match an existing squad member back to a library expert (by id then name). */
function resolveAgentId(member: ExpertMember, library: ExpertAgent[]): string {
  const byId = member.key || member.templateId;
  if (byId && library.some((a) => a.id === byId)) return byId;
  const byName = library.find((a) => a.name === member.name);
  return byName?.id ?? "";
}

/**
 * Seed the form from an existing squad in edit mode. Members ARE loaded so the
 * team can be edited; each is matched back to a library expert where possible,
 * and the original key/templateId are preserved so members outside the library
 * still round-trip intact.
 */
function draftFromSquad(squad: ExpertSquad, library: ExpertAgent[]): Draft {
  return {
    name: squad.name,
    summary: squad.summary,
    category: squad.category,
    tags: [...squad.tags],
    members: squad.members.map((m) => ({
      agentId: resolveAgentId(m, library),
      name: m.name,
      role: m.role,
      leader: Boolean(m.leader),
      instruction: m.instruction ?? "",
      key: m.key,
      templateId: m.templateId,
      mcpConfig: m.mcpConfig,
      skills: m.skills,
    })),
    strategies: (squad.strategies ?? []).join("\n"),
  };
}

/**
 * Manual squad-publishing wizard (基本信息 → 团队成员 → 调取逻辑 → 发布预览).
 * Members are PICKED from the published single experts (EXPERT_AGENTS) rather
 * than typed by hand, so a squad is always assembled from real, installable
 * expert templates. STATIC-first: on submit it builds an ExpertSquad and hands
 * it to onPublish, which prepends it to the in-memory catalog (no backend).
 */
export default function ExpertPublishModal({
  visible,
  onClose,
  onPublish,
  editing,
  categories,
  library,
}: ExpertPublishModalProps) {
  useI18n();
  const realCategories =
    categories && categories.length ? categories : FALLBACK_CATEGORIES;
  const realLibrary = library && library.length ? library : EXPERT_AGENTS;
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>(createDraft);
  const [tagInput, setTagInput] = useState("");
  const isEditing = Boolean(editing);

  // Category options. If the record's current category isn't in the fetched list
  // (deleted category / fallback mismatch), prepend it so the current value
  // renders and round-trips instead of being silently rewritten on save.
  const categoryOptions =
    realCategories.includes(draft.category) || !draft.category
      ? realCategories
      : [draft.category, ...realCategories];

  useEffect(() => {
    if (visible) {
      setStepIndex(0);
      setDraft(
        editing
          ? draftFromSquad(editing, realLibrary)
          : createDraft(realCategories[0])
      );
      setTagInput("");
    }
    // realCategories / realLibrary are derived from props; re-seeding the empty
    // draft's default category when they change is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing]);

  const step: StepKey = STEP_KEYS[stepIndex];

  const agentById = useMemo(
    () => new Map(realLibrary.map((agent) => [agent.id, agent])),
    [realLibrary]
  );
  const strategyList = useMemo(
    () => draft.strategies.split("\n").map((s) => s.trim()).filter(Boolean),
    [draft.strategies]
  );

  const canNext = (() => {
    if (step === "basics") {
      return draft.name.trim().length > 0 && draft.summary.trim().length > 0;
    }
    if (step === "members") {
      return (
        draft.members.length >= MIN_MEMBERS &&
        draft.members.some((m) => m.leader) &&
        draft.members.every((m) => m.instruction.trim().length > 0)
      );
    }
    return true;
  })();

  // -------- member editing (add from library / edit role / leader / remove) --------
  const addMember = (agent: ExpertAgent) => {
    setDraft((prev) => {
      if (prev.members.some((m) => m.agentId === agent.id)) return prev;
      const isFirst = prev.members.length === 0;
      return {
        ...prev,
        members: [
          ...prev.members,
          {
            agentId: agent.id,
            name: agent.name,
            role: agent.summary ?? "",
            leader: isFirst,
            instruction: agent.instruction ?? "",
            key: agent.id,
            templateId: agent.id,
            mcpConfig: agent.mcpConfig,
            skills: agent.skills,
          },
        ],
      };
    });
  };

  const removeMember = (index: number) => {
    setDraft((prev) => {
      const next = prev.members.filter((_, i) => i !== index);
      // Keep exactly one leader alive after removing the current one.
      if (next.length && !next.some((m) => m.leader)) next[0].leader = true;
      return { ...prev, members: next };
    });
  };

  const updateMemberRole = (index: number, role: string) => {
    setDraft((prev) => ({
      ...prev,
      members: prev.members.map((m, i) => (i === index ? { ...m, role } : m)),
    }));
  };

  const updateMemberInstruction = (index: number, instruction: string) => {
    setDraft((prev) => ({
      ...prev,
      members: prev.members.map((m, i) =>
        i === index ? { ...m, instruction } : m
      ),
    }));
  };

  const setLeader = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      members: prev.members.map((m, i) => ({ ...m, leader: i === index })),
    }));
  };

  // -------- tag chips (type + Enter/逗号 to add, Backspace to remove) --------
  const commitTag = () => {
    const parts = tagInput
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) {
      setDraft((prev) => {
        const set = new Set(prev.tags);
        parts.forEach((tag) => set.add(tag));
        return { ...prev, tags: Array.from(set) };
      });
    }
    setTagInput("");
  };

  const onTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitTag();
    } else if (event.key === "Backspace" && !tagInput && draft.tags.length) {
      setDraft((prev) => ({ ...prev, tags: prev.tags.slice(0, -1) }));
    }
  };

  const removeTag = (tag: string) => {
    setDraft((prev) => ({ ...prev, tags: prev.tags.filter((x) => x !== tag) }));
  };

  const handlePublish = () => {
    const tags = draft.tags.map((s) => s.trim()).filter(Boolean);
    const strategies = strategyList.length ? strategyList : undefined;

    // Build the roster from the editable member list. Library-backed members
    // pull fresh template metadata; members carried over from an existing squad
    // keep their preserved key/templateId so they round-trip intact.
    const members: ExpertMember[] = draft.members.map((m) => {
      const agent = agentById.get(m.agentId);
      return {
        key: m.key || m.agentId || undefined,
        templateId: m.templateId ?? agent?.id,
        name: agent?.name ?? m.name,
        role: m.role.trim() || agent?.summary || "",
        leader: m.leader,
        instruction: m.instruction.trim(),
        mcpConfig: m.mcpConfig ?? agent?.mcpConfig,
        skills: m.skills ?? agent?.skills,
      };
    });
    const leader = members.find((m) => m.leader) ?? members[0];

    if (editing) {
      // Edit preserves dependencies / permission / attribution; only the
      // editable fields (basics, tags, team, dispatch logic) are overwritten.
      const squad: ExpertSquad = {
        ...editing,
        shortName: Array.from(draft.name.trim()).slice(0, 2).join("") || editing.shortName,
        name: draft.name.trim(),
        summary: draft.summary.trim(),
        category: draft.category,
        tags: tags.length ? tags : ["自定义"],
        leader: leader?.name ?? "",
        members,
        strategies,
      };
      onPublish(squad);
      return;
    }

    const squad: ExpertSquad = {
      id: `custom-${Date.now()}`,
      kind: "squad",
      shortName: Array.from(draft.name.trim()).slice(0, 2).join("") || "团",
      name: draft.name.trim(),
      summary: draft.summary.trim(),
      category: draft.category,
      tags: tags.length ? tags : ["自定义"],
      publisher: EXPERT_WORKSPACE,
      leader: leader?.name ?? "",
      members,
      strategies,
      dependencies: { blocking: [], recommended: [] },
      permission: "读取工作区文件、创建专家配置、写入专家团关系",
      checkResult: "supported",
      createdByType: "human",
      creatorName: t("mcp.expert.selfCreator"),
      mine: true,
    };

    onPublish(squad);
  };

  const header = (
    <div className="wk-mcp-expert-pub__header">
      <span className="wk-mcp-expert-pub__eyebrow">
        {isEditing ? t("mcp.expert.editSquad") : t("mcp.expert.publish")}
      </span>
      <h2>
        {isEditing
          ? t("mcp.expert.squadEditTitle")
          : t("mcp.expert.manualPublishTitle")}
      </h2>
      <p>
        {isEditing
          ? t("mcp.expert.squadEditHint")
          : t("mcp.expert.manualPublishHint")}
      </p>
    </div>
  );

  const requiredMark = (
    <span className="wk-mcp-expert-pub__req" aria-hidden="true">
      *
    </span>
  );

  return (
    <WKModal
      visible={visible}
      onCancel={onClose}
      title={null}
      width="min(760px, calc(100vw - 32px))"
      className="wk-mcp-expert-pub"
      header={header}
    >
      <ol className="wk-mcp-expert-pub__stepper">
        {STEP_KEYS.map((key, index) => (
          <li
            key={key}
            className={
              index === stepIndex
                ? "is-current"
                : index < stepIndex
                  ? "is-complete"
                  : ""
            }
          >
            <span className="wk-mcp-expert-pub__step-index">
              {index < stepIndex ? <Check size={13} /> : index + 1}
            </span>
            {t(`mcp.expert.step.${key}`)}
          </li>
        ))}
      </ol>

      <div className="wk-mcp-expert-pub__body">
        {step === "basics" && (
          <div className="wk-mcp-expert-pub__form">
            <label>
              <span>
                {t("mcp.expert.fieldName")}
                {requiredMark}
              </span>
              <input
                className="wk-mcp-expert-pub__input"
                value={draft.name}
                maxLength={128}
                placeholder={t("mcp.expert.fieldNamePlaceholder")}
                onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              />
            </label>
            <label>
              <span>
                {t("mcp.expert.fieldSummary")}
                {requiredMark}
              </span>
              <textarea
                className="wk-mcp-expert-pub__textarea"
                rows={2}
                value={draft.summary}
                maxLength={512}
                placeholder={t("mcp.expert.fieldSummaryPlaceholder")}
                onChange={(e) => setDraft((p) => ({ ...p, summary: e.target.value }))}
              />
            </label>
            <label>
              <span>{t("mcp.expert.fieldCategory")}</span>
              <select
                className="wk-mcp-expert-pub__input"
                value={draft.category}
                onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value }))}
              >
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("mcp.expert.fieldTags")}</span>
              <div className="wk-mcp-expert-pub__tags">
                {draft.tags.map((tag) => (
                  <span className="wk-mcp-expert-pub__tag-chip" key={tag}>
                    {tag}
                    <button
                      type="button"
                      aria-label={t("mcp.expert.removeTag")}
                      onClick={() => removeTag(tag)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <input
                  className="wk-mcp-expert-pub__tag-field"
                  value={tagInput}
                  placeholder={
                    draft.tags.length ? "" : t("mcp.expert.fieldTagsPlaceholder")
                  }
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={onTagKeyDown}
                  onBlur={commitTag}
                />
              </div>
            </label>
          </div>
        )}

        {step === "members" && (
          <div className="wk-mcp-expert-pub__members">
            <div className="wk-mcp-expert-pub__members-head">
              <div>
                <h3>{t("mcp.expert.selectMembersTitle")}</h3>
                <p>{t("mcp.expert.selectMembersHint")}</p>
              </div>
              <span className="wk-mcp-expert-pub__selected-count">
                {t("mcp.expert.selectedCount", {
                  values: { count: draft.members.length },
                })}
              </span>
            </div>

            {draft.members.length > 0 && (
              <div className="wk-mcp-expert-pub__member-selected">
                {draft.members.map((member, index) => {
                  const agent = agentById.get(member.agentId);
                  const displayName = agent?.name ?? member.name;
                  const logoKey = member.agentId || member.name || String(index);
                  const logoText =
                    agent?.shortName ?? Array.from(displayName.trim())[0] ?? "专";
                  return (
                    <div
                      className="wk-mcp-expert-pub__member-card is-selected"
                      key={`${logoKey}-${index}`}
                    >
                      <div className="wk-mcp-expert-pub__member-pick">
                        <span
                          className="wk-mcp-expert-pub__member-logo"
                          style={{ background: getMcpAvatarColor(logoKey) }}
                          aria-hidden="true"
                        >
                          {logoText}
                        </span>
                        <span className="wk-mcp-expert-pub__member-info">
                          <strong>{displayName}</strong>
                          <small>
                            {agent
                              ? agent.category
                              : t("mcp.expert.memberFromTemplate")}
                          </small>
                        </span>
                        <button
                          type="button"
                          className="wk-mcp-expert-pub__member-remove"
                          aria-label={t("mcp.expert.removeMember")}
                          title={t("mcp.expert.removeMember")}
                          onClick={() => removeMember(index)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="wk-mcp-expert-pub__member-config">
                        <label className="wk-mcp-expert-pub__member-role">
                          <span>{t("mcp.expert.memberRoleLabel")}</span>
                          <input
                            className="wk-mcp-expert-pub__input"
                            value={member.role}
                            maxLength={500}
                            placeholder={t("mcp.expert.memberRolePlaceholder")}
                            onChange={(e) => updateMemberRole(index, e.target.value)}
                          />
                        </label>
                        <label className="wk-mcp-expert-pub__member-leader">
                          <input
                            type="radio"
                            name="wk-mcp-expert-pub-leader"
                            checked={member.leader}
                            onChange={() => setLeader(index)}
                          />
                          {t("mcp.expert.setLeader")}
                        </label>
                      </div>
                      <label className="wk-mcp-expert-pub__member-instruction">
                        <span>
                          {t("mcp.expert.fieldInstruction")}
                          {requiredMark}
                        </span>
                        <textarea
                          className="wk-mcp-expert-pub__textarea"
                          rows={3}
                          value={member.instruction}
                          placeholder={t("mcp.expert.instructionPlaceholder")}
                          onChange={(e) =>
                            updateMemberInstruction(index, e.target.value)
                          }
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="wk-mcp-expert-pub__member-add-head">
              {t("mcp.expert.addMember")}
            </div>
            <div className="wk-mcp-expert-pub__member-grid">
              {realLibrary.filter(
                (agent) => !draft.members.some((m) => m.agentId === agent.id)
              ).map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className="wk-mcp-expert-pub__member-add"
                  onClick={() => addMember(agent)}
                >
                  <span
                    className="wk-mcp-expert-pub__member-logo"
                    style={{ background: getMcpAvatarColor(agent.id) }}
                    aria-hidden="true"
                  >
                    {agent.shortName}
                  </span>
                  <span className="wk-mcp-expert-pub__member-info">
                    <strong>{agent.name}</strong>
                    <small>{agent.category}</small>
                  </span>
                  <Plus size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "routing" && (
          <div className="wk-mcp-expert-pub__form">
            <label>
              <span>{t("mcp.expert.strategyTitle")}</span>
              <p className="wk-mcp-expert-pub__field-hint">
                {t("mcp.expert.strategyEditorHint")}
              </p>
              <textarea
                className="wk-mcp-expert-pub__textarea"
                rows={7}
                value={draft.strategies}
                placeholder={t("mcp.expert.strategyPlaceholder")}
                onChange={(e) => setDraft((p) => ({ ...p, strategies: e.target.value }))}
              />
            </label>
          </div>
        )}

        {step === "preview" && (
          <div className="wk-mcp-expert-pub__preview">
            <div className="wk-mcp-expert-pub__preview-row">
              <span>{t("mcp.expert.fieldName")}</span>
              <strong>{draft.name || "—"}</strong>
            </div>
            <div className="wk-mcp-expert-pub__preview-row">
              <span>{t("mcp.expert.fieldCategory")}</span>
              <strong>{draft.category}</strong>
            </div>
            <div className="wk-mcp-expert-pub__preview-row">
              <span>{t("mcp.expert.membersTitle")}</span>
              <strong>
                {draft.members.length
                  ? draft.members
                      .map((m) => {
                        const name = agentById.get(m.agentId)?.name ?? m.name;
                        return m.leader ? `${name}（Leader）` : name;
                      })
                      .join("、")
                  : "—"}
              </strong>
            </div>
            <div className="wk-mcp-expert-pub__preview-row">
              <span>{t("mcp.expert.strategyTitle")}</span>
              <strong>
                {t("mcp.expert.strategyCount", { values: { count: strategyList.length } })}
              </strong>
            </div>
          </div>
        )}
      </div>

      <div className="wk-mcp-expert-pub__footer">
        {stepIndex > 0 ? (
          <WKButton variant="secondary" onClick={() => setStepIndex((i) => i - 1)}>
            {t("mcp.expert.prev")}
          </WKButton>
        ) : (
          <span />
        )}
        {step === "preview" ? (
          <WKButton variant="primary" onClick={handlePublish}>
            {isEditing ? t("mcp.expert.submitEdit") : t("mcp.expert.submitPublish")}
          </WKButton>
        ) : (
          <WKButton
            variant="primary"
            disabled={!canNext}
            onClick={() => setStepIndex((i) => i + 1)}
          >
            {t("mcp.expert.next")}
          </WKButton>
        )}
      </div>
    </WKModal>
  );
}
