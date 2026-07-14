import React, { useMemo, useState } from "react";
import { UploadCloud } from "lucide-react";
import { WKButton, WKInput, WKModal } from "@octo/base";
import type { Category, NewSkillForm, Visibility } from "../types/skill";
import { createSkill } from "../api/skillApi";
import { tagsFromInput } from "../utils/format";

interface NewSkillModalProps {
  visible: boolean;
  categories: Category[];
  onClose: () => void;
  onCreated: () => void;
}

const defaultReadme = "# 新 Skill\n\n## 能力\n\n- 描述核心能力\n- 列出输入输出\n\n```bash\nocto skill run new-skill\n```";

export default function NewSkillModal({ visible, categories, onClose, onCreated }: NewSkillModalProps) {
  const selectableCategories = useMemo<Category[]>(
    () => categories.filter((category: Category) => category.id !== "all"),
    [categories],
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("dev-tools");
  const [tags, setTags] = useState("CLI 自动化");
  const [visibility, setVisibility] = useState<Visibility>("space");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !description.trim()) {
      setError("请填写名称和描述");
      return;
    }
    const form: NewSkillForm = {
      name,
      description,
      categoryId,
      tags: tagsFromInput(tags),
      visibility,
      readmeContent: defaultReadme.replace("新 Skill", name),
      fileName: `${name.trim() || "skill"}.zip`,
      fileSize: 1024 * 420,
    };
    setSaving(true);
    setError(null);
    try {
      await createSkill(form);
      setName("");
      setDescription("");
      setTags("CLI 自动化");
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <WKModal
      visible={visible}
      onCancel={onClose}
      title="新建 Skill"
      size="lg"
      footer={
        <>
          <WKButton variant="secondary" onClick={onClose} disabled={saving}>取消</WKButton>
          <WKButton variant="primary" onClick={() => void submit()} loading={saving}>创建</WKButton>
        </>
      }
    >
      <div className="skill-market-form">
        {error && <div className="skill-market-form__error">{error}</div>}
        <label>
          <span>Skill 名称</span>
          <WKInput value={name} onChange={setName} placeholder="cli-workflow-kit" />
        </label>
        <label>
          <span>描述</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明这个 Skill 解决什么问题" />
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
          <WKInput value={tags} onChange={setTags} placeholder="用空格或逗号分隔，最多 5 个" />
        </label>
        <div className="skill-market-upload">
          <UploadCloud size={22} />
          <div>
            <strong>上传区域占位</strong>
            <span>后续对接真实后端时在这里接入 zip / tgz 上传。</span>
          </div>
        </div>
      </div>
    </WKModal>
  );
}
