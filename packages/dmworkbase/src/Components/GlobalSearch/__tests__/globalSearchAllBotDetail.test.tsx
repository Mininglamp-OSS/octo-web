// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import UserService from "../../../Service/UserService";
import {
  defaultGlobalSearchFilters,
  type GlobalSearchDataSource,
  type GlobalSearchFilters,
} from "../../../Service/SearchTypes";
import GlobalSearchAllPanel from "../GlobalSearchAllPanel";

vi.mock("../../WKAvatar", () => ({ isBot: () => false }));
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
  panelFilters: GlobalSearchFilters = filters
) {
  return render(
    <GlobalSearchAllPanel
      keyword={keyword}
      friends={[
        { channel_id: "bot-1", channel_type: 1, channel_name: "Bot One" },
      ]}
      dataSource={dataSource}
      filters={panelFilters}
      isActive={false}
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
});
