import React, { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { WKButton } from "@octo/base";
import type { Skill } from "../types/skill";
import { useSkills } from "../hooks/useSkills";
import CategoryChips from "../components/CategoryChips";
import DeleteConfirmModal from "../components/DeleteConfirmModal";
import EditSkillModal from "../components/EditSkillModal";
import NewSkillModal from "../components/NewSkillModal";
import SearchBar from "../components/SearchBar";
import SkillCard from "../components/SkillCard";
import SkillDetailModal from "../components/SkillDetailModal";

interface SkillListPageProps {
  mine?: boolean;
}

export default function SkillListPage({ mine = false }: SkillListPageProps) {
  const list = useSkills({ mine });
  const [createVisible, setCreateVisible] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        list.loadMore();
      }
    }, { rootMargin: "160px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [list]);

  const title = mine ? "我创建" : "Skills";
  const desc = mine
    ? "管理当前用户创建的 Skill，支持编辑、删除和查看详情。"
    : "浏览团队 Skill 市场，按分类和关键词快速找到可复用能力。";

  return (
    <div className="skill-market-page">
      <header className="skill-market-topbar">
        <div>
          <h1>{title}</h1>
          <p>{desc}</p>
        </div>
        <div className="skill-market-topbar__actions">
          <WKButton variant="secondary" icon={<RefreshCw size={15} />} onClick={list.refresh}>
            刷新
          </WKButton>
          <WKButton variant="primary" icon={<Plus size={15} />} onClick={() => setCreateVisible(true)}>
            新建 Skill
          </WKButton>
        </div>
      </header>

      <section className="skill-market-toolbar">
        <SearchBar
          value={list.query}
          onChange={list.setQuery}
          placeholder={mine ? "搜索我创建的 Skill" : "搜索 Skill 名称、标签、描述"}
        />
        <CategoryChips
          categories={list.categories}
          activeId={list.categoryId}
          onChange={list.setCategoryId}
        />
      </section>

      <main className="skill-market-content">
        {list.loading && <div className="skill-market-state">加载 Skill...</div>}
        {list.error && <div className="skill-market-state is-error">{list.error}</div>}
        {!list.loading && !list.error && list.skills.length === 0 && (
          <div className="skill-market-state">
            <strong>没有匹配的 Skill</strong>
            <span>换个关键词或分类后再试。</span>
          </div>
        )}
        {!list.loading && !list.error && list.skills.length > 0 && (
          <div className="skill-market-grid">
            {list.skills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                categories={list.categories}
                onOpen={(item) => setDetailId(item.id)}
                onEdit={mine ? setEditing : undefined}
                onDelete={mine ? setDeleting : undefined}
              />
            ))}
          </div>
        )}
        <div ref={sentinelRef} className="skill-market-sentinel">
          {list.loadingMore ? "继续加载..." : list.hasMore ? "滚动加载更多" : "已加载全部"}
        </div>
      </main>

      <SkillDetailModal skillId={detailId} categories={list.categories} onClose={() => setDetailId(null)} />
      <NewSkillModal
        visible={createVisible}
        categories={list.categories}
        onClose={() => setCreateVisible(false)}
        onCreated={list.refresh}
      />
      <EditSkillModal
        skill={editing}
        categories={list.categories}
        onClose={() => setEditing(null)}
        onUpdated={list.refresh}
      />
      <DeleteConfirmModal
        skill={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={list.refresh}
      />
    </div>
  );
}
