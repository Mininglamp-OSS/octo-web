import React, { useEffect, useMemo, useState } from "react";
import { WKButton, WKInput, WKModal } from "@octo/base";
import type { Category, Skill, Visibility } from "../types/skill";
import { updateSkill } from "../api/skillApi";
import { tagsFromInput } from "../utils/format";

interface EditSkillModalProps {
  skill: Skill | null;
  categories: Category[];
  onClose: () => void;
  onUpdated: () => void;
}

export default function EditSkillModal({ skill, categories, onClose, onUpdated }: EditSkillModalProps) {
  const selectableCategories = useMemo<Category[]>(
    () => categories.filter((category: Category) => category.id !== "all"),
    [categories],
  );
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("dev-tools");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("space");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!skill) return;
    setDescription(skill.description);
    setCategoryId(skill.categoryId);
    setTags(skill.tags.join(" "));
    setVisibility(skill.visibility);
  }, [skill]);

  async function submit() {
    if (!skill) return;
    setSaving(true);
    try {
      await updateSkill(skill.id, {
        description,
        categoryId,
        tags: tagsFromInput(tags),
        visibility,
      });
      onUpdated();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <WKModal
      visible={Boolean(skill)}
      onCancel={onClose}
      title={skill ? `编辑 ${skill.name}` : "编辑 Skill"}
      size="lg"
      footer={
        <>
          <WKButton variant="secondary" onClick={onClose} disabled={saving}>取消</WKButton>
          <WKButton variant="primary" onClick={() => void submit()} loading={saving}>保存</WKButton>
        </>
      }
    >
      <div className="skill-market-form">
        <label>
          <span>描述</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <div className="skill-market-form__row">
          <label>
            <span>分类</span>
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              {selectableCategories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>可见性</span>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}>
              <option value="space">空间</option>
              <option value="public">公开</option>
              <option value="private">私有</option>
            </select>
          </label>
        </div>
        <label>
          <span>标签</span>
          <WKInput value={tags} onChange={setTags} />
        </label>
      </div>
    </WKModal>
  );
}
