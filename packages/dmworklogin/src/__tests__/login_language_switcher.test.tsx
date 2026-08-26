import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";

const { setLocaleMock } = vi.hoisted(() => ({
  setLocaleMock: vi.fn(),
}));

vi.mock("@octo/base", () => ({
  IM_DEVICE_FLAG_PC: 2,
  IM_DEVICE_FLAG_WEB: 1,
  getExpectedImDeviceFlag: () => 1,
  WKApp: {
    apiClient: {
      config: { apiURL: "/api/v1/" },
    },
  },
  Provider: {},
  ProviderListener: class ProviderListener {
    notifyListener() {}
  },
  isElectronPowered: () => false,
  useI18n: () => ({
    locale: "zh-CN",
    setLocale: setLocaleMock,
    t: (key: string) => {
      const copy: Record<string, string> = {
        "base.navRail.language.switchToEnglish": "Switch to English",
        "base.navRail.language.switchToChinese": "Switch to Chinese",
        "login.languageShortZh": "中文",
        "login.languageShortEn": "EN",
      };
      return copy[key] ?? key;
    },
  }),
}));

vi.mock("@octo/ui", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement("button", props, children),
}));

vi.mock("@octo/ui/select", () => ({
  default: ({
    "aria-labelledby": ariaLabelledby,
    className,
    onChange,
    optionList,
    value,
  }: {
    "aria-labelledby"?: string;
    className?: string;
    onChange?: (value: string) => void;
    optionList?: Array<{ value: string; label: string }>;
    value?: string;
  }) =>
    React.createElement(
      "select",
      {
        "aria-labelledby": ariaLabelledby,
        className,
        value,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
          onChange?.(event.target.value),
      },
      optionList?.map((option) =>
        React.createElement(
          "option",
          { key: option.value, value: option.value },
          option.label,
        ),
      ),
    ),
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Spin: () => React.createElement("span", { "data-spin": "true" }),
  Toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) =>
    React.createElement("svg", { "data-qr-value": value }),
}));

import { LoginLanguageSwitcher } from "../login";

describe("LoginLanguageSwitcher", () => {
  afterEach(() => {
    setLocaleMock.mockClear();
    document.body.innerHTML = "";
  });

  it("renders with a stable accessible label without React 18 useId", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    act(() => {
      ReactDOM.render(React.createElement(LoginLanguageSwitcher), container);
    });

    const select = container.querySelector(".wk-login-language-select");
    expect(select).toBeTruthy();

    const labelId = select?.getAttribute("aria-labelledby");
    expect(labelId).toMatch(/^wk-login-language-label-\d+$/);
    expect(labelId ? container.querySelector(`#${labelId}`)?.textContent : undefined).toBe(
      "Switch to English",
    );
  });
});
