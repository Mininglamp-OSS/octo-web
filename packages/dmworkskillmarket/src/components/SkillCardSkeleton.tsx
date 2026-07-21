import React from "react";

export default function SkillCardSkeleton() {
  return (
    <div className="skill-market-card-skeleton" aria-hidden="true">
      <div className="skill-market-card-skeleton__title" />
      <div className="skill-market-card-skeleton__tags">
        <div className="skill-market-card-skeleton__tag" />
        <div className="skill-market-card-skeleton__tag" />
        <div className="skill-market-card-skeleton__tag" />
      </div>
      <div className="skill-market-card-skeleton__desc">
        <div className="skill-market-card-skeleton__line" />
        <div className="skill-market-card-skeleton__line" />
      </div>
    </div>
  );
}
