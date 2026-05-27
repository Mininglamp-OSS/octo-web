import React, { Component } from "react";
import ReactDOM from "react-dom";
import { I18nContext, t } from "@octo/base";
import "./index.css";

/**
 * MatterLinkMenu — 多选消息后"添加到事项"弹出菜单
 *
 * 参考原型 MultiMenu（18-Matters-prototype-v4-shadcn.html）：
 *   - "+ 创建新事项 (智能)" 主按钮 — 走 PRD §3 智能创建
 *   - "→ 同步到已有事项" + Matter 列表 — 走 PRD §4.1 多选关联
 *
 * 组件分层：Layer 1 纯 UI，无 SDK/WKApp/Service 依赖。
 * 通过 props 接收 anchorRef（用于定位）和 onClose 回调，由调用方负责事件派发。
 *
 * Portal 渲染到 document.body —
 * 避免 MultiplePanel 祖先的 transform 把 fixed 变成相对定位。
 *
 * TODO(backend): Matter 列表目前 hardcode，后续接 API 查询可关联的 Matter 列表
 * TODO(interaction): 点击"创建新事项"走 SmartCreateModal（PRD §3）
 * TODO(interaction): 点击已有 Matter 走"多选关联"流程（PRD §4.1）
 */

export interface MatterLinkMenuItem {
  id: string;
  title: string;
}

export interface MatterLinkMenuProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  matters?: MatterLinkMenuItem[];
  onClose: () => void;
  onCreate?: () => void;
  onPick?: (matter: MatterLinkMenuItem) => void;
  /** 所有选项是否 disabled（占位阶段使用） */
  disabled?: boolean;
}

// 无默认 mock 数据 — 调用方必须传入 matters prop
// 如果未传，显示空列表

class MatterLinkMenu extends Component<MatterLinkMenuProps> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  private menuRef = React.createRef<HTMLDivElement>();

  componentDidMount() {
    document.addEventListener("mousedown", this.handleClickOutside);
  }

  componentWillUnmount() {
    document.removeEventListener("mousedown", this.handleClickOutside);
  }

  private handleClickOutside = (e: MouseEvent) => {
    const target = e.target as Node;
    if (
      this.menuRef.current &&
      !this.menuRef.current.contains(target) &&
      this.props.anchorRef.current &&
      !this.props.anchorRef.current.contains(target)
    ) {
      this.props.onClose();
    }
  };

  render() {
    const { anchorRef, onClose, onCreate, onPick, disabled } = this.props;
    const matters = this.props.matters ?? [];
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return null;

    // 定位在 anchor 元素上方（viewport 坐标）
    const style: React.CSSProperties = {
      position: "fixed",
      left: rect.left,
      bottom: window.innerHeight - rect.top + 8,
    };

    return ReactDOM.createPortal(
      <div
        ref={this.menuRef}
        className="wk-matter-link-menu"
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wk-matter-link-menu__head">{t("todo.linkMenu.currentGroupTasks")}</div>
        <button
          type="button"
          className="wk-matter-link-menu__item wk-matter-link-menu__item--primary"
          disabled={!onCreate}
          onClick={() => {
            if (onCreate) onCreate();
            onClose();
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>{t("todo.linkMenu.createNew")}</span>
        </button>
        <div className="wk-matter-link-menu__divider" />
        <div className="wk-matter-link-menu__sub">{t("todo.linkMenu.syncExisting")}</div>
        {matters.map((m) => (
          <button
            key={m.id}
            type="button"
            className="wk-matter-link-menu__item"
            disabled={disabled || !onPick}
            onClick={() => {
              if (onPick) {
                onPick(m);
              } else {
                onClose();
              }
            }}
          >
            <span className="wk-matter-link-menu__title">{m.title}</span>
          </button>
        ))}
      </div>,
      document.body,
    );
  }
}

export default MatterLinkMenu;
export { MatterLinkMenu };
