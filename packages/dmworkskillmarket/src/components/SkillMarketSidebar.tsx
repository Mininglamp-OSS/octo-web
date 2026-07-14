import React, { useState } from "react";
import { Blocks, UserRound } from "lucide-react";
import { WKApp } from "@octo/base";
import SkillListPage from "../pages/SkillListPage";
import MyCreatedPage from "../pages/MyCreatedPage";

const items = [
  {
    id: "skills",
    label: "Skills",
    icon: <Blocks size={16} />,
    render: () => <SkillListPage />,
  },
  {
    id: "mine",
    label: "我创建",
    icon: <UserRound size={16} />,
    render: () => <MyCreatedPage />,
  },
];

export default function SkillMarketSidebar() {
  const [activeId, setActiveId] = useState(items[0].id);

  return (
    <aside className="skill-market-sidebar">
      <div className="skill-market-sidebar__header">Skill 市场</div>
      <nav className="skill-market-sidebar__nav" aria-label="Skill 市场导航">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === activeId ? "is-active" : ""}
            onClick={() => {
              setActiveId(item.id);
              WKApp.routeRight.replaceToRoot(item.render());
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
