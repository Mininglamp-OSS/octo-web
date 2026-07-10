import React from "react";
import { Tag } from "@douyinfe/semi-ui";
import type { IssueLabel } from "../api/types";

/**
 * 渲染 issue 的标签为彩色 chips（列表/看板卡片/详情共用）。
 * color 为后端给的 hex；用淡色底 + 同色字，兼顾任意色相的可读性。
 * 非法/非 #RRGGBB 颜色回退到 Semi 默认 Tag 样式。
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
          <Tag
            key={l.id}
            size="small"
            style={hex ? { backgroundColor: `${hex}1f`, color: hex, border: `1px solid ${hex}3d` } : undefined}
          >
            {l.name}
          </Tag>
        );
      })}
      {rest > 0 && <Tag size="small">{`+${rest}`}</Tag>}
    </span>
  );
}
