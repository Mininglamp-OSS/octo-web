import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WKApp from "../../../App";
import GlobalSearchVM from "../../../bridge/globalSearch/GlobalSearchVM";
import type { GlobalSearchDataSource } from "../../../Service/SearchTypes";
import { t } from "../../../i18n";
import GlobalSearch from "../GlobalSearchPanel";

vi.mock("../../../Components/GlobalSearch/tab-all", () => ({ default: () => null }));
vi.mock("../../../Components/GlobalSearch/tab-contacts", () => ({ default: () => null }));
vi.mock("../../../Components/GlobalSearch/tab-group", () => ({ default: () => null }));
vi.mock("../../../Components/GlobalSearch/tab-file", () => ({ default: () => null }));
vi.mock("../../../Components/GlobalSearch/GlobalContentSearchPanel", () => ({ default: () => null }));
vi.mock("../../globalChatSearch/GlobalChatSearchPanel", () => ({ default: () => null }));
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }));

const cloudFlags = {
  docsOn: true,
  docsSearchOn: true,
  driveOn: true,
  driveSearchOn: true,
};
let originalFlags: typeof cloudFlags;

beforeEach(() => {
  originalFlags = {
    docsOn: WKApp.remoteConfig.docsOn,
    docsSearchOn: WKApp.remoteConfig.docsSearchOn,
    driveOn: WKApp.remoteConfig.driveOn,
    driveSearchOn: WKApp.remoteConfig.driveSearchOn,
  };
  Object.assign(WKApp.remoteConfig, cloudFlags);
  vi.stubGlobal("__POWERED_ELECTRON__", false);
});

afterEach(() => {
  cleanup();
  Object.assign(WKApp.remoteConfig, originalFlags);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mountSearch(selectedTabKey = "contacts") {
  const vm = new GlobalSearchVM();
  vm.selectedTabKey = selectedTabKey;
  vm.didMount = vi.fn();
  vm.didUnMount = vi.fn();
  const searchDocs = vi.fn().mockResolvedValue({ items: [] });
  const searchDrive = vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false });
  const dataSource: GlobalSearchDataSource = {
    getSelfUid: () => "self",
    getSenders: () => [],
    getSender: (uid) => ({ uid, name: uid }),
    searchMessages: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    searchDocs,
    searchDrive,
  };
  const view = render(
    <GlobalSearch
      createViewModel={() => vm}
      dataSource={dataSource}
      initialState={{ searchValue: "report" }}
    />
  );
  return { ...view, vm, searchDocs, searchDrive };
}

function tabLabels() {
  return within(screen.getByRole("navigation"))
    .getAllByRole("button")
    .map((tab) => tab.textContent);
}

describe("GlobalSearch cloud tabs", () => {
  it.each(["contacts", "docs", "drive"])(
    "does not mount or query cloud panels in Client with selected key %s",
    async (selectedTabKey) => {
      vi.useFakeTimers();
      vi.stubGlobal("__POWERED_ELECTRON__", true);
      const { container, searchDocs, searchDrive } = mountSearch(selectedTabKey);

      expect(tabLabels()).toEqual(
        ["contacts", "groups", "chat", "files"].map((key) => t(`base.globalSearch.tab.${key}`))
      );
      expect(container.querySelector(".wk-doc-search")).toBeNull();
      expect(container.querySelector(".wk-drive-search")).toBeNull();
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(searchDocs).not.toHaveBeenCalled();
      expect(searchDrive).not.toHaveBeenCalled();
    }
  );

  it("keeps both cloud tabs in standalone Web and searches only the active one", async () => {
    const { searchDocs, searchDrive } = mountSearch();
    expect(tabLabels()).toEqual(
      ["contacts", "groups", "chat", "files", "docs", "drive"].map((key) => t(`base.globalSearch.tab.${key}`))
    );
    expect(searchDocs).not.toHaveBeenCalled();
    expect(searchDrive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: t("base.globalSearch.tab.docs"), exact: true }));
    await waitFor(() => expect(searchDocs).toHaveBeenCalledOnce());
    expect(searchDrive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: t("base.globalSearch.tab.drive"), exact: true }));
    await waitFor(() => expect(searchDrive).toHaveBeenCalledOnce());
    expect(searchDocs).toHaveBeenCalledOnce();
  });

  it.each(["docs", "drive"] as const)(
    "unmounts the selected %s panel when its remote search flag is revoked",
    (key) => {
      vi.useFakeTimers();
      const { container, vm, searchDocs, searchDrive } = mountSearch(key);
      const selector = key === "docs" ? ".wk-doc-search" : ".wk-drive-search";
      expect(container.querySelector(selector)).not.toBeNull();

      act(() => {
        WKApp.remoteConfig[key === "docs" ? "docsSearchOn" : "driveSearchOn"] = false;
        vm.notifyListener();
      });

      expect(screen.queryByRole("button", { name: t(`base.globalSearch.tab.${key}`), exact: true })).toBeNull();
      expect(container.querySelector(selector)).toBeNull();
      act(() => { vi.advanceTimersByTime(1000); });
      expect(searchDocs).not.toHaveBeenCalled();
      expect(searchDrive).not.toHaveBeenCalled();
    }
  );
});
