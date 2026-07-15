import React from "react";
import type { IssueLabel } from "../api/types";
import LoopTag from "./LoopTag";

/**
 * 渲染 issue 的标签为浊色 chips（列表/看板卡片/详情共用）。
 * color 为后端给的任意 hex；由 .loop-label-chip 用 color-mix 拉出深度（软底 + 加深文字 +
 * 描边），避免早期「12% 透明度贴白底」的高亮低饱和塑料感。
 * 非法/非 #RRGGBB 颜色回退到中性灰（.loop-label-chip 的 --loop-chip-color 默认值）。
 * max 限制展示数量，其余折叠成「+N」（用于卡片这类空间有限处）。
 */
export default function LabelChips({ labels, max }: { labels?: IssueLabel[] | null; max?: number }) {
  if (!labels || labels.length === 0) return null;
  const shown = max ? labels.slice(0, max) : labels;
  const rest = labels.length - shown.length;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {shown.map((l) => {
        const hex = /^#[0-9a-fA-F]{6}$/.test(l.color) ? l.color : undefined;
        return (
          <span
            key={l.id}
            className="loop-label-chip"
            style={hex ? ({ "--loop-chip-color": hex } as React.CSSProperties) : undefined}
          >
            {l.name}
          </span>
        );
      })}
      {rest > 0 && <LoopTag tone="grey">{`+${rest}`}</LoopTag>}
    </span>
  );
}
