import React from "react";
import { Dropdown } from "@douyinfe/semi-ui";
import { ChevronDown } from "lucide-react";

export interface LoopPropertyPillOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

/**
 * loop 属性 pill 选择器（对齐 multica 建单工具栏）：圆角 pill 触发 + Semi Dropdown 菜单。
 * 用于状态/优先级等离散单选属性；下拉沿用 loop 皮肤（保留 Semi，符合「下拉不重写」约定）。
 */
export default function LoopPropertyPill<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: LoopPropertyPillOption<T>[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Dropdown
      trigger="click"
      position="bottomLeft"
      clickToHide
      render={
        <Dropdown.Menu>
          {options.map((o) => (
            <Dropdown.Item key={o.value} active={o.value === value} onClick={() => onChange(o.value)}>
              <span className="loop-pill__opt">{o.icon}{o.label}</span>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      }
    >
      <button type="button" className="loop-pill" aria-label={ariaLabel}>
        {current?.icon}
        <span>{current?.label}</span>
        <ChevronDown size={12} className="loop-pill__caret" />
      </button>
    </Dropdown>
  );
}
