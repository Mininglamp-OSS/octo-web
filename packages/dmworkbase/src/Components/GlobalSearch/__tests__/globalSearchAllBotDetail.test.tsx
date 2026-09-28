// @vitest-environment jsdom
import React from "react";
import { act } from "react-dom/test-utils";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBot } from "../../WKAvatar";
import UserService from "../../../Service/UserService";
import {
  defaultGlobalSearchFilters,
  type DriveSearchHit,
  type GlobalSearchDataSource,
  type GlobalSearchFilters,
} from "../../../Service/SearchTypes";
import GlobalSearchAllPanel from "../GlobalSearchAllPanel";

vi.mock("../../WKAvatar", () => ({ isBot: vi.fn(() => false) }));
vi.mock(
  "../../../im-runtime/currentChannelRuntime",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../im-runtime/currentChannelRuntime")
    >()),
    getCurrentImChannelInfo: () => undefined,
    fetchCurrentImChannelInfo: vi.fn().mockResolvedValue(undefined),
    addCurrentImChannelInfoListener: () => () => {},
  })
);
vi.mock("../item-contacts", () => ({
  default: ({ name, onClick }: { name: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {name}
    </button>
  ),
}));
vi.mock("../item-group", () => ({ default: () => null }));
vi.mock("../../BotDetailModal", () => ({
  default: ({ uid, visible }: { uid: string; visible: boolean }) =>
    visible ? <div data-testid="bot-detail">{uid}</div> : null,
}));
vi.mock("../../../bridge/globalChatSearch/useGlobalChatSearch", () => ({
  default: () => ({ overview: { conversations: [], status: "idle" } }),
}));

const dataSource: GlobalSearchDataSource = {
  getSelfUid: () => "self",
  getSenders: () => [],
  getSender: (uid) => ({ uid, name: uid }),
  searchMessages: vi.fn(),
  getFileTypeCategories: async () => [],
};

const filters = defaultGlobalSearchFilters();

function renderPanel(
  onClick = vi.fn(),
  keyword = "bot",
  panelFilters: GlobalSearchFilters = filters,
  isActive = true
) {
  return render(
    <GlobalSearchAllPanel
      keyword={keyword}
      friends={[
        { channel_id: "bot-1", channel_type: 1, channel_name: "Bot One" },
      ]}
      dataSource={dataSource}
      filters={panelFilters}
      isActive={isActive}
      contentSearchEnabled={false}
      docsEnabled={false}
      driveEnabled={false}
      onSelectTab={vi.fn()}
      onOpenConversation={vi.fn()}
      onClick={(type) => (item) => onClick(type, item)}
      onLocateMessage={vi.fn()}
      onOpenDoc={vi.fn()}
      onOpenDriveHit={vi.fn()}
    />
  );
}

describe("GlobalSearchAllPanel bot result", () => {
  beforeEach(() => {
    vi.mocked(isBot).mockReturnValue(false);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens an uncached bot card without routing away from search", async () => {
    vi.spyOn(UserService, "getUserProfile").mockResolvedValue({ robot: 1 });
    const onClick = vi.fn();
    renderPanel(onClick);

    fireEvent.click(screen.getByRole("button", { name: "Bot One" }));

    await waitFor(() =>
      expect(screen.getByTestId("bot-detail")).toHaveTextContent("bot-1")
    );
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders legacy results for a filter-only search", () => {
    renderPanel(vi.fn(), "", { ...filters, senderUids: ["sender-1"] });

    expect(screen.getByRole("button", { name: "Bot One" })).toBeTruthy();
  });

  it.each([0, 1])(
    "keeps the latest cached bot when an older profile resolves with robot=%s",
    async (robot) => {
      let resolveProfile!: (profile: { robot: number }) => void;
      vi.spyOn(UserService, "getUserProfile").mockReturnValue(
        new Promise((resolve) => {
          resolveProfile = resolve;
        })
      );
      const onClick = vi.fn();
      // The second hit has cached bot metadata and takes the synchronous path.
      vi.mocked(isBot).mockImplementation((uid) => uid === "bot-2");
      render(
        <GlobalSearchAllPanel
          keyword="bot"
          friends={[
            { channel_id: "bot-1", channel_type: 1, channel_name: "Bot One" },
            { channel_id: "bot-2", channel_type: 1, channel_name: "Bot Two" },
          ]}
          dataSource={dataSource}
          filters={filters}
          isActive
          contentSearchEnabled={false}
          docsEnabled={false}
          driveEnabled={false}
          onSelectTab={vi.fn()}
          onOpenConversation={vi.fn()}
          onClick={() => onClick}
          onLocateMessage={vi.fn()}
          onOpenDoc={vi.fn()}
          onOpenDriveHit={vi.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Bot One" }));
      fireEvent.click(screen.getByRole("button", { name: "Bot Two" }));
      expect(screen.getByTestId("bot-detail")).toHaveTextContent("bot-2");
      await act(async () => {
        resolveProfile({ robot });
        await Promise.resolve();
      });
      expect(screen.getByTestId("bot-detail")).toHaveTextContent("bot-2");
      expect(onClick).not.toHaveBeenCalled();
    }
  );

  it("ignores a pending ordinary-contact navigation after unmount", async () => {
    let resolveProfile!: (profile: { robot: number }) => void;
    vi.spyOn(UserService, "getUserProfile").mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      })
    );
    const onClick = vi.fn();
    const view = renderPanel(onClick);
    fireEvent.click(screen.getByRole("button", { name: "Bot One" }));
    view.unmount();
    await act(async () => {
      resolveProfile({ robot: 0 });
      await Promise.resolve();
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not hide file-only filtered results behind the start hint", () => {
    renderPanel(vi.fn(), "", { ...filters, fileExts: ["pdf"] });

    expect(screen.getByRole("button", { name: "Bot One" })).toBeTruthy();
  });

  it("uses the dedicated drive result row in the aggregate view", async () => {
    const hit: DriveSearchHit = {
      file_id: 42,
      space_id: "space-1",
      space_name: "产品空间",
      parent_id: 1,
      path: ["设计"],
      name: "评审纪要.docx",
      type: "blob",
      ext: "docx",
      size: 1024,
      owner_uid: "u1",
      owner_name: "Alex",
      updater_uid: "u1",
      updater_name: "Alex",
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-02T00:00:00.000Z",
      highlights: { body: ["<mark>评审</mark>已完成"] },
    };
    const onOpenDriveHit = vi.fn();
    const driveDataSource = {
      ...dataSource,
      searchDrive: vi.fn().mockResolvedValue({
        items: [hit],
        total: 1,
        truncated: false,
      }),
    };

    const { container } = render(
      <GlobalSearchAllPanel
        keyword="评审"
        dataSource={driveDataSource}
        filters={filters}
        isActive
        contentSearchEnabled={false}
        docsEnabled={false}
        driveEnabled
        onSelectTab={vi.fn()}
        onOpenConversation={vi.fn()}
        onClick={() => vi.fn()}
        onLocateMessage={vi.fn()}
        onOpenDoc={vi.fn()}
        onOpenDriveHit={onOpenDriveHit}
      />
    );

    const item = await waitFor(() => {
      const row = container.querySelector<HTMLElement>(
        ".wk-drive-search__item"
      );
      expect(row).not.toBeNull();
      return row!;
    });
    expect(item).toHaveTextContent("产品空间 / 设计");
    expect(item.querySelector(".wk-drive-search__icon-img")).not.toBeNull();
    expect(item.querySelector("mark")).toHaveTextContent("评审");
    fireEvent.click(item);
    expect(onOpenDriveHit).toHaveBeenCalledWith(hit);
  });

  it("uses ordinary-contact routing when the profile is not a bot or cannot load", async () => {
    const onClick = vi.fn();
    vi.spyOn(UserService, "getUserProfile").mockResolvedValueOnce({ robot: 0 });
    renderPanel(onClick);
    fireEvent.click(screen.getByRole("button", { name: "Bot One" }));
    await waitFor(() =>
      expect(onClick).toHaveBeenCalledWith(
        "contacts",
        expect.objectContaining({ channel_id: "bot-1" })
      )
    );

    cleanup();
    vi.spyOn(UserService, "getUserProfile").mockRejectedValueOnce(
      new Error("offline")
    );
    renderPanel(onClick);
    fireEvent.click(screen.getByRole("button", { name: "Bot One" }));
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(2));
  });

  it("ignores a bot profile response after the aggregate tab becomes inactive", async () => {
    let resolveProfile: (profile: { robot: number }) => void;
    vi.spyOn(UserService, "getUserProfile").mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      })
    );
    const view = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Bot One" }));

    view.rerender(
      <GlobalSearchAllPanel
        keyword="bot"
        friends={[
          { channel_id: "bot-1", channel_type: 1, channel_name: "Bot One" },
        ]}
        dataSource={dataSource}
        filters={filters}
        isActive={false}
        contentSearchEnabled={false}
        docsEnabled={false}
        driveEnabled={false}
        onSelectTab={vi.fn()}
        onOpenConversation={vi.fn()}
        onClick={() => vi.fn()}
        onLocateMessage={vi.fn()}
        onOpenDoc={vi.fn()}
        onOpenDriveHit={vi.fn()}
      />
    );
    await act(async () => {
      resolveProfile!({ robot: 1 });
      await Promise.resolve();
    });

    expect(screen.queryByTestId("bot-detail")).toBeNull();
  });
});
