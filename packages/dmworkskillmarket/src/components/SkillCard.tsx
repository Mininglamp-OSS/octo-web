import React, { useState } from "react";
import { Pencil, Terminal, Trash2 } from "lucide-react";
import { t, useI18n } from "@octo/base";
import type { Category, Skill } from "../types/skill";
import { getSkillAvatarColor, getSkillAvatarText } from "../utils/skillAvatar";

interface SkillCardProps {
  skill: Skill;
  categories: Category[];
  onOpen: (skill: Skill) => void;
  onEdit?: (skill: Skill) => void;
  onDelete?: (skill: Skill) => void;
  onInstall?: (skill: Skill) => void;
}

export default function SkillCard({ skill, categories: _categories, onOpen, onEdit, onDelete, onInstall }: SkillCardProps) {
  useI18n();
  void _categories;
  const [imgError, setImgError] = useState(false);
  const visibleTags = skill.tags.slice(0, 3);
  const hiddenTagCount = Math.max(0, skill.tags.length - visibleTags.length);
  const isOwnerCard = Boolean(onEdit || onDelete);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.target instanceof HTMLElement && event.target.closest("button")) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(skill);
    }
  }

  return (
    <article
      className={isOwnerCard ? "skill-market-card skill-market-card--owner" : "skill-market-card"}
      role="button"
      tabIndex={0}
      aria-label={`${skill.name} @${skill.ownerName}`}
      onClick={() => onOpen(skill)}
      onKeyDown={handleKeyDown}
    >
      <div className="skill-market-card__top">
        <span className="skill-market-card__icon">
          {skill.iconUrl && !imgError ? (
            <img src={skill.iconUrl} alt="" onError={() => setImgError(true)} />
          ) : (
            <span
              className="skill-market-card__icon-default"
              style={{ background: getSkillAvatarColor(skill.name) }}
            >
              {getSkillAvatarText(skill.name)}
            </span>
          )}
        </span>
        <div className="skill-market-card__info">
          <h3>{skill.displayName || skill.name}</h3>
          <div className="skill-market-card__tags">
            {visibleTags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
            {hiddenTagCount > 0 && <span>+{hiddenTagCount}</span>}
          </div>
        </div>
        <span className="skill-market-card__owner">@{skill.ownerName}</span>
        {(onEdit || onDelete) && (
          <div className="skill-market-card__actions" onClick={(event) => event.stopPropagation()}>
            {onEdit && (
              <button type="button" aria-label={t("skillMarket.card.editAriaLabel", { values: { name: skill.name } })} title={t("skillMarket.common.edit")} onClick={() => onEdit(skill)}>
                <Pencil size={15} />
              </button>
            )}
            {onDelete && (
              <button type="button" className="is-danger" aria-label={t("skillMarket.card.deleteAriaLabel", { values: { name: skill.name } })} title={t("skillMarket.common.delete")} onClick={() => onDelete(skill)}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}
      </div>
      <p className="skill-market-card__desc" title={skill.description}>{skill.description}</p>
      <div className="skill-market-card__footer" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="skill-market-card__install"
          onClick={() => onInstall?.(skill)}
        >
          <Terminal size={13} />
          {t("skillMarket.card.install")}
        </button>
      </div>
    </article>
  );
}
