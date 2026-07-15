import React from "react";
import { Dropdown } from "@douyinfe/semi-ui";
import { Check } from "lucide-react";
import { useI18n } from "@octo/base";
import type { ProjectStatus } from "../api/types";
import { PROJECT_STATUS_ORDER, PROJECT_STATUS_STYLE } from "./meta";

/**
 * 项目状态徽标（对标 multica ProjectStatusBadge）：彩色 chip 触发 + 下拉内联改状态。
 * 进行中/已完成为实心强调色，其余中性灰；下拉项带彩点 + 当前项打勾。
 * 放在可点击的行里时，外层需 stopPropagation 以免触发行跳转（见 ProjectPage）。
 */
export default function ProjectStatusBadge({
  status,
  onChange,
}: {
  status: ProjectStatus;
  onChange: (s: ProjectStatus) => void;
}) {
  const { t } = useI18n();
  const cur = PROJECT_STATUS_STYLE[status];
  return (
    <Dropdown
      trigger="click"
      position="bottomLeft"
      clickToHide
      render={
        <Dropdown.Menu>
          {PROJECT_STATUS_ORDER.map((s) => (
            <Dropdown.Item key={s} active={s === status} onClick={() => onChange(s)}>
              <span className="loop-pstatus__opt">
                <span className="loop-pstatus__dot" style={{ background: PROJECT_STATUS_STYLE[s].dot }} />
                <span>{t(`loop.projectStatus.${s}`)}</span>
                {s === status && <Check size={13} className="loop-pstatus__check" />}
              </span>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      }
    >
      <button
        type="button"
        className={`loop-pstatus loop-pstatus--${cur.solid ? "solid" : "muted"}`}
        style={cur.solid ? { background: cur.bg } : undefined}
      >
        {t(`loop.projectStatus.${status}`)}
      </button>
    </Dropdown>
  );
}
