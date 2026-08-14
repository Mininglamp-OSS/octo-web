// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExpertDetailModal from "../ExpertDetailModal";
import ExpertCard from "../ExpertCard";
import type { ExpertAgent, ExpertSquad } from "../../mock/expertMock";

const trackExpertView = vi.fn();

vi.mock("../../api/expertService", () => ({
  getExpertSkillContent: vi.fn(),
  getSquadSkillContent: vi.fn(),
  getExpertSkillDownloadUrl: vi.fn(),
  getSquadSkillDownloadUrl: vi.fn(),
  trackExpertView: (...args: unknown[]) => {
    trackExpertView(...args);
    return Promise.resolve();
  },
}));
vi.mock("../ExpertSpecView", () => ({ default: () => null }));
vi.mock("@octo/base", () => ({
  t: (key: string, opts?: { values?: { count?: number } }) =>
    opts?.values?.count !== undefined ? `${key}:${opts.values.count}` : key,
  useI18n: () => undefined,
  WKModal: ({
    children,
    header,
  }: {
    children: React.ReactNode;
    header?: React.ReactNode;
  }) => React.createElement("div", null, header, children),
}));

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (container) {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    container = null;
  }
  vi.clearAllMocks();
});

function render(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(element, container);
  });
  return container;
}

const agent: ExpertAgent = {
  id: "expert-1",
  kind: "agent",
  shortName: "架构",
  name: "后端架构师",
  summary: "评审服务边界。",
  category: "研发工具",
  tags: [],
  publisher: "Octo Community",
  createdByType: "human",
  creatorName: "王决",
  viewCount: 1280,
  installCount: 6,
};

const squad: ExpertSquad = {
  id: "squad-1",
  kind: "squad",
  shortName: "研发",
  name: "软件研发交付团",
  summary: "…",
  category: "研发工具",
  tags: [],
  publisher: "Octo Community",
  createdByType: "human",
  creatorName: "林澈",
  viewCount: 42,
  installCount: 3,
  leader: "",
  members: [],
  memberCount: 5,
  dependencies: { blocking: [], recommended: [] },
  permission: "",
  checkResult: "supported",
};

describe("expert metric counts", () => {
  it("tracks one view per opened detail, keyed by resource kind", () => {
    render(<ExpertDetailModal item={agent} onClose={vi.fn()} />);
    expect(trackExpertView).toHaveBeenCalledTimes(1);
    expect(trackExpertView).toHaveBeenCalledWith("agent", "expert-1");

    // Re-render with the SAME item (e.g. list item -> hydrated detail swap):
    // no second view event.
    act(() => {
      ReactDOM.render(
        <ExpertDetailModal item={{ ...agent }} onClose={vi.fn()} />,
        container
      );
    });
    expect(trackExpertView).toHaveBeenCalledTimes(1);

    act(() => {
      ReactDOM.render(
        <ExpertDetailModal item={squad} onClose={vi.fn()} />,
        container
      );
    });
    expect(trackExpertView).toHaveBeenCalledTimes(2);
    expect(trackExpertView).toHaveBeenLastCalledWith("squad", "squad-1");
  });

  it("renders compact view/install counts on the card and detail header", () => {
    const cardRoot = render(<ExpertCard item={agent} onOpen={vi.fn()} />);
    // Compute the expectation with the same Intl options the component uses —
    // compact notation output is locale-dependent (1.3K vs 1280 under zh-CN).
    const compact1280 = new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(1280);
    expect(cardRoot.textContent).toContain(compact1280);
    expect(cardRoot.textContent).toContain("6");

    const detailRoot = render(<ExpertDetailModal item={squad} onClose={vi.fn()} />);
    expect(detailRoot.querySelectorAll(".wk-mcp-expert-detail__stat")).toHaveLength(2);
    expect(detailRoot.textContent).toContain("42");
    expect(detailRoot.textContent).toContain("3");
  });

  it("keeps zero counts visible instead of hiding the stats", () => {
    const zero: ExpertAgent = { ...agent, viewCount: 0, installCount: 0 };
    const root = render(<ExpertCard item={zero} onOpen={vi.fn()} />);
    const stats = root.querySelectorAll(".wk-mcp-card__stat");
    expect(stats).toHaveLength(2);
    expect(stats[0].textContent).toContain("0");
    expect(stats[1].textContent).toContain("0");
  });
});
