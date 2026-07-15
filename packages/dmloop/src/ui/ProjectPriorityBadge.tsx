import React from "react";
import { Dropdown } from "@douyinfe/semi-ui";
import { Check } from "lucide-react";
import { useI18n } from "@octo/base";
import type { IssuePriority } from "../api/types";
import { PRIORITY_ORDER, PRIORITY_ICON, PRIORITY_HEX } from "./meta";

/**
 * 项目优先级徽标（对标 multica ProjectPriorityBadge）：图标 + 文案的 ghost chip，
 * 点击下拉内联改优先级；下拉项带优先级图标 + 当前项打勾。
 * 放在可点击的行里时，外层需 stopPropagation 以免触发行跳转（见 ProjectPage）。
 */
export default function ProjectPriorityBadge({
  priority,
  onChange,
}: {
  priority: IssuePriority;
  onChange: (p: IssuePriority) => void;
}) {
  const { t } = useI18n();
  const CurIcon = PRIORITY_ICON[priority];
  return (
    <Dropdown
      trigger="click"
      position="bottomLeft"
      clickToHide
      render={
        <Dropdown.Menu>
          {PRIORITY_ORDER.map((p) => {
            const Icon = PRIORITY_ICON[p];
            return (
              <Dropdown.Item key={p} active={p === priority} onClick={() => onChange(p)}>
                <span className="loop-pstatus__opt">
                  <Icon size={14} style={{ color: PRIORITY_HEX[p] }} />
                  <span>{t(`loop.priority.${p}`)}</span>
                  {p === priority && <Check size={13} className="loop-pstatus__check" />}
                </span>
              </Dropdown.Item>
            );
          })}
        </Dropdown.Menu>
      }
    >
      <button type="button" className="loop-pprio">
        <CurIcon size={14} style={{ color: PRIORITY_HEX[priority] }} />
        <span>{t(`loop.priority.${priority}`)}</span>
      </button>
    </Dropdown>
  );
}
