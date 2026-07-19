import React from "react";

interface WKButtonMockProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  iconOnly?: boolean;
  loading?: boolean;
  variant?: string;
}

export function WKButton({ children, icon, iconOnly, loading, disabled, ...props }: WKButtonMockProps) {
  return (
    <button disabled={disabled || loading} {...props}>
      {loading ? "loading" : icon}
      {!iconOnly && children}
    </button>
  );
}

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
};

export const i18n = {
  registerNamespace: () => undefined,
};

export function t(value: string) {
  return value;
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
