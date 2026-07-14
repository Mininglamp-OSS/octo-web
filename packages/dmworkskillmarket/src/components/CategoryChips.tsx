import React from "react";
import type { Category } from "../types/skill";

interface CategoryChipsProps {
  categories: Category[];
  activeId: string;
  onChange: (categoryId: string) => void;
}

export default function CategoryChips({ categories, activeId, onChange }: CategoryChipsProps) {
  const ordered = [...categories].sort((a, b) => {
    if (a.id === "all") return -1;
    if (b.id === "all") return 1;
    return a.sortOrder - b.sortOrder;
  });

  return (
    <div className="skill-market-category-strip" aria-label="Skill 分类">
      {ordered.map((category) => (
        <button
          key={category.id}
          type="button"
          className={
            category.id === activeId
              ? "skill-market-category-chip is-active"
              : "skill-market-category-chip"
          }
          aria-pressed={category.id === activeId}
          onClick={() => onChange(category.id)}
          title={`${category.name} · ${category.skillCount} 个 Skill`}
        >
          <span className="skill-market-category-label">{category.name}</span>
          <span className="skill-market-category-count">{category.skillCount}</span>
        </button>
      ))}
    </div>
  );
}
