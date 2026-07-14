import React from "react";
import { CalendarDays, Lock, Package, Users } from "lucide-react";
import type { Category, Skill } from "../types/skill";
import { formatDate, formatFileSize } from "../utils/format";

interface SkillCardProps {
  skill: Skill;
  categories: Category[];
  onOpen: (skill: Skill) => void;
  onEdit?: (skill: Skill) => void;
  onDelete?: (skill: Skill) => void;
}

function visibilityLabel(value: Skill["visibility"]): string {
  if (value === "private") return "私有";
  if (value === "space") return "空间";
  return "公开";
}

function VisibilityIcon({ value }: { value: Skill["visibility"] }) {
  if (value === "private") return <Lock size={13} />;
  if (value === "space") return <Users size={13} />;
  return <Package size={13} />;
}

export default function SkillCard({ skill, categories, onOpen, onEdit, onDelete }: SkillCardProps) {
  const categoryName = categories.find((category) => category.id === skill.categoryId)?.name ?? skill.categoryId;
  return (
    <article className="skill-market-card" tabIndex={0} onClick={() => onOpen(skill)} onKeyDown={(event) => {
      if (event.key === "Enter") onOpen(skill);
    }}>
      <div className="skill-market-card__header">
        <div className="skill-market-card__mark">{skill.name.slice(0, 2).toUpperCase()}</div>
        <div className="skill-market-card__title-block">
          <h3>{skill.name}</h3>
          <span>{categoryName}</span>
        </div>
        <span className="skill-market-card__version">v{skill.version}</span>
      </div>
      <p className="skill-market-card__desc">{skill.description}</p>
      <div className="skill-market-card__tags">
        {skill.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <div className="skill-market-card__footer">
        <span className="skill-market-card__meta">
          <VisibilityIcon value={skill.visibility} />
          {visibilityLabel(skill.visibility)}
        </span>
        <span className="skill-market-card__meta">
          <CalendarDays size={13} />
          {formatDate(skill.updatedAt)}
        </span>
        <span className="skill-market-card__size">{formatFileSize(skill.fileSize)}</span>
      </div>
      {(onEdit || onDelete) && (
        <div className="skill-market-card__actions" onClick={(event) => event.stopPropagation()}>
          {onEdit && (
            <button type="button" onClick={() => onEdit(skill)}>
              编辑
            </button>
          )}
          {onDelete && (
            <button type="button" className="is-danger" onClick={() => onDelete(skill)}>
              删除
            </button>
          )}
        </div>
      )}
    </article>
  );
}
