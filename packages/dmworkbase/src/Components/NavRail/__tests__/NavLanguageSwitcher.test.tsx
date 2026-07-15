/**
 * @vitest-environment jsdom
 */

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../i18n/instance";
import { I18nContext } from "../../../i18n/I18nProvider";

const hoisted = vi.hoisted(() => ({
  isLogined: vi.fn(),
  updateUserLanguagePreference: vi.fn(),
}));

vi.mock("../../../App", () => ({
  default: {
    shared: {
      isLogined: (...args: unknown[]) => hoisted.isLogined(...args),
    },
  },
  __esModule: true,
}));

vi.mock("../../../Service/UserLanguageService", () => ({
  updateUserLanguagePreference: (...args: unknown[]) => hoisted.updateUserLanguagePreference(...args),
}));

vi.mock("@douyinfe/semi-ui", () => ({
  ConfigProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  LocaleProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock("@douyinfe/semi-icons", () => ({
  IconLanguage: () => React.createElement("span", { "data-testid": "icon-language" }),
  IconTick: () => React.createElement("span", { "data-testid": "icon-tick" }),
}));

import NavLanguageSwitcher from "../NavLanguageSwitcher";

let container: HTMLDivElement;

beforeEach(() => {
  i18n.setLocale("zh-CN", { notify: false, persist: false });
  hoisted.isLogined.mockReset().mockReturnValue(true);
  hoisted.updateUserLanguagePreference.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});

function renderSwitcher() {
  act(() => {
    ReactDOM.render(
      <I18nContext.Provider
        value={{
          format: i18n.format,
          locale: "zh-CN",
          setLocale: (next) => i18n.setLocale(next),
          t: i18n.t.bind(i18n),
        }}
      >
        <NavLanguageSwitcher />
      </I18nContext.Provider>,
      container,
    );
  });
}

function clickLanguageMenuItem(label: string) {
  const item = Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.includes(label)) as HTMLButtonElement | undefined;
  expect(item).toBeTruthy();
  act(() => {
    item!.click();
  });
}

describe("NavLanguageSwitcher", () => {
  it("syncs signed-in language changes to backend after local switch", () => {
    renderSwitcher();

    act(() => {
      (container.querySelector(".wk-navrail__language") as HTMLButtonElement).click();
    });
    clickLanguageMenuItem("English");

    expect(i18n.getLocale()).toBe("en-US");
    expect(hoisted.updateUserLanguagePreference).toHaveBeenCalledWith("en-US");
  });

  it("does not call backend when the user is not signed in", () => {
    hoisted.isLogined.mockReturnValue(false);
    renderSwitcher();

    act(() => {
      (container.querySelector(".wk-navrail__language") as HTMLButtonElement).click();
    });
    clickLanguageMenuItem("English");

    expect(i18n.getLocale()).toBe("en-US");
    expect(hoisted.updateUserLanguagePreference).not.toHaveBeenCalled();
  });

  it("keeps local language when backend sync fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    hoisted.updateUserLanguagePreference.mockRejectedValueOnce({
      error: {
        config: {
          headers: {
            token: "secret-token",
          },
        },
      },
      msg: "sync failed",
      status: 500,
      code: "err.shared.internal",
    });
    renderSwitcher();

    act(() => {
      (container.querySelector(".wk-navrail__language") as HTMLButtonElement).click();
    });
    clickLanguageMenuItem("English");
    await act(async () => {
      await Promise.resolve();
    });

    expect(i18n.getLocale()).toBe("en-US");
    expect(hoisted.updateUserLanguagePreference).toHaveBeenCalledWith("en-US");
    expect(warn).toHaveBeenCalledWith("[i18n] failed to sync user language preference", {
      status: 500,
      code: "err.shared.internal",
      message: "sync failed",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-token");
    warn.mockRestore();
  });
});
