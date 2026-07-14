import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { FileArchive, Lock, Users } from "lucide-react";
import { WKModal } from "@octo/base";
import type { Category, Skill } from "../types/skill";
import { getSkill } from "../api/skillApi";
import { formatFileSize } from "../utils/format";

interface SkillDetailModalProps {
  skillId: string | null;
  categories: Category[];
  onClose: () => void;
}

function visibilityText(value: Skill["visibility"]): string {
  if (value === "private") return "私有";
  if (value === "space") return "空间可见";
  return "公开";
}

export default function SkillDetailModal({ skillId, categories, onClose }: SkillDetailModalProps) {
  const [skill, setSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!skillId) {
      setSkill(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    getSkill(skillId)
      .then((item) => {
        if (alive) setSkill(item);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [skillId]);

  const categoryName = skill ? categories.find((category) => category.id === skill.categoryId)?.name : "";

  return (
    <WKModal
      visible={Boolean(skillId)}
      onCancel={onClose}
      title={skill?.name ?? "Skill 详情"}
      size="lg"
      bodyStyle={{ maxHeight: "64vh", overflow: "auto" }}
    >
      {loading && <div className="skill-market-modal-state">加载中...</div>}
      {error && <div className="skill-market-modal-state is-error">{error}</div>}
      {skill && !loading && (
        <div className="skill-market-detail">
          <div className="skill-market-detail__meta">
            <span>{categoryName}</span>
            <span>v{skill.version}</span>
            <span>
              {skill.visibility === "private" ? <Lock size={13} /> : <Users size={13} />}
              {visibilityText(skill.visibility)}
            </span>
          </div>
          <p className="skill-market-detail__desc">{skill.description}</p>
          <div className="skill-market-detail__file">
            <FileArchive size={18} />
            <span>{skill.fileName}</span>
            <strong>{formatFileSize(skill.fileSize)}</strong>
          </div>
          <div className="skill-market-detail__readme">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {skill.readmeContent}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </WKModal>
  );
}
