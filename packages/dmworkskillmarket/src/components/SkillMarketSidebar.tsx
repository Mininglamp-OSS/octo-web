import React from "react";
import { Blocks } from "lucide-react";
import { WKApp } from "@octo/base";
import SkillListPage from "../pages/SkillListPage";

export default function SkillMarketSidebar() {
  return (
    <aside className="skill-market-sidebar">
      <div className="skill-market-sidebar__header">Skill 市场</div>
      <nav className="skill-market-sidebar__nav" aria-label="Skill 市场导航">
        <button
          type="button"
          className="is-active"
          onClick={() => WKApp.routeRight.replaceToRoot(<SkillListPage />)}
        >
          <Blocks size={16} />
          <span>Skills</span>
        </button>
      </nav>
    </aside>
  );
}

