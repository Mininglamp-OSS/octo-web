import React from "react";

interface WKInputMockProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "size" | "prefix"> {
  prefix?: React.ReactNode;
  size?: string;
  value?: string;
  onChange?: (value: string) => void;
}

export function WKInput({ value, onChange, prefix, placeholder, size: _size, ...props }: WKInputMockProps) {
  return (
    <label>
      {prefix}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value)}
        {...props}
      />
    </label>
  );
}

interface WKModalMockProps {
  visible: boolean;
  title?: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  onCancel?: () => void;
  className?: string;
  size?: string;
  bodyStyle?: React.CSSProperties;
}

export function WKModal({ visible, title, header, footer, children, onCancel }: WKModalMockProps) {
  if (!visible) return null;
  return (
    <section role="dialog" aria-label={typeof title === "string" ? title : "modal"}>
      <button type="button" aria-label="关闭" onClick={onCancel} />
      {header}
      {title ? <h2>{title}</h2> : null}
      {children}
      {footer}
    </section>
  );
}

export const Toast = {
  success: () => undefined,
  error: () => undefined,
};

export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export const WKApp = {
  apiClient: {
    config: {
      apiURL: "/api/v1/",
    },
  },
  loginInfo: {
    token: "test-token",
    uid: "test-uid",
    loginUrl: "/login",
  },
  shared: {
    currentSpaceId: "space-123",
  },
  routeRight: {
    replaceToRoot: () => undefined,
  },
  routeLeft: {
    popToRoot: () => undefined,
  },
  route: {
    register: () => undefined,
  },
  menus: {
    register: () => undefined,
  },
  mittBus: {
    on: () => undefined,
    off: () => undefined,
  },
};

import zhCN from "../i18n/zh-CN.json";

const flattenMessages = (obj: Record<string, unknown>, prefix = ""): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      result[fullKey] = value;
    } else if (typeof value === "object" && value !== null) {
      Object.assign(result, flattenMessages(value as Record<string, unknown>, fullKey));
    }
  }
  return result;
};

const messages = flattenMessages(zhCN, "skillMarket");

export const i18n = {
  registerNamespace: () => undefined,
};

// 埋点单例 mock:组件在选择/搜索时命令式 Dap.shared.track。测试只需 track 是无副作用可断言的 no-op
// (真实 Dap 在 @octo/base 里;此 alias mock 需补齐,否则去掉可选链后 Dap.shared 会 undefined 崩)。
export const Dap = {
  shared: {
    track: (_event: string, _props?: Record<string, unknown>) => undefined,
  },
};

export function t(key: string, opts?: { values?: Record<string, string | number> }) {
  let text = messages[key] ?? key;
  if (opts?.values) {
    for (const [k, v] of Object.entries(opts.values)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
    }
  }
  return text;
}

export function useI18n() {
  return { t };
}

export class Menus {
  id: string;
  route: string;
  title: string;
  icon: React.ReactNode;
  activeIcon: React.ReactNode;
  onPress?: () => void;

  constructor(id: string, route: string, title: string, icon: React.ReactNode, activeIcon: React.ReactNode) {
    this.id = id;
    this.route = route;
    this.title = title;
    this.icon = icon;
    this.activeIcon = activeIcon;
  }
}
