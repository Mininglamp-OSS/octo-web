// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { createMentionMenu, type LoopMentionItem, type MentionMenuLabels } from "../suggestionMenu";

// jsdom doesn't implement scrollIntoView (present in every real browser).
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

const labels: MentionMenuLabels = {
  users: "Users",
  issues: "Tasks",
  agent: "Expert",
  squad: "Team",
  members: "Members",
  showMore: "Show more",
  searchMembersHint: "search members",
  searchIssuesHint: "search tasks",
};

function make(type: LoopMentionItem["type"], n: number, opts?: { group?: "search" }): LoopMentionItem[] {
  return Array.from({ length: n }, (_, i) => ({
    type,
    id: `${type}-${i}`,
    label: `${type} ${i}`,
    group: opts?.group,
  }));
}

function open(items: LoopMentionItem[]) {
  const menu = createMentionMenu(labels);
  menu.onStart({ items, command: () => {}, clientRect: null });
  return { menu, el: () => document.querySelector(".loop-mention-menu") as HTMLElement };
}

const rows = (el: HTMLElement) => el.querySelectorAll(".loop-suggest-item").length;
const more = (el: HTMLElement) => el.querySelector(".loop-suggest-more") as HTMLButtonElement | null;
const hints = (el: HTMLElement) => Array.from(el.querySelectorAll(".loop-suggest-hint")).map((n) => n.textContent);
const clickMore = (el: HTMLElement) => more(el)!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mention menu — experts / expert-teams reveal all", () => {
  it("caps experts at 10, 'show more' reveals ALL remaining", () => {
    const { el } = open(make("agent", 15));
    expect(rows(el())).toBe(10);
    expect(more(el())?.textContent).toContain(labels.showMore);
    expect(more(el())?.textContent).toContain("5"); // reveals 15 - 10

    clickMore(el());
    expect(rows(el())).toBe(15);
    expect(more(el())).toBeNull();
    expect(hints(el())).toEqual([]);
  });

  it("shows all experts with no 'show more' when they fit in 10", () => {
    const { el } = open(make("agent", 8));
    expect(rows(el())).toBe(8);
    expect(more(el())).toBeNull();
  });
});

describe("mention menu — members / tasks reveal up to 50, then hint", () => {
  it("reveals ALL when a member section fits under the ceiling", () => {
    const { el } = open(make("member", 8));
    expect(rows(el())).toBe(6);
    expect(more(el())?.textContent).toContain("2");
    clickMore(el());
    expect(rows(el())).toBe(8);
    expect(hints(el())).toEqual([]); // 8 <= 50, fully revealed, no hint
  });

  it("stops members at 50 and shows a search hint when more exist", () => {
    const { el } = open(make("member", 55));
    expect(more(el())?.textContent).toContain("44"); // reveals up to 50 → 50 - 6
    clickMore(el());
    expect(rows(el())).toBe(50);
    expect(more(el())).toBeNull();
    expect(hints(el())).toEqual(["search members"]);
  });

  it("stops tasks at 50 and shows a search hint when more exist", () => {
    const { el } = open(make("issue", 55));
    clickMore(el());
    expect(rows(el())).toBe(50);
    expect(hints(el())).toEqual(["search tasks"]);
  });

  it("shows neither 'show more' nor a hint when a section fits in 6", () => {
    const { el } = open(make("member", 4));
    expect(rows(el())).toBe(4);
    expect(more(el())).toBeNull();
    expect(hints(el())).toEqual([]);
  });
});

describe("mention menu — search mode is uncapped and reachable", () => {
  it("renders people matches flat with no cap", () => {
    const { el } = open(make("member", 25, { group: "search" }));
    expect(rows(el())).toBe(25);
    expect(more(el())).toBeNull();
    expect(hints(el())).toEqual([]);
  });

  it("shows ALL task matches (no 6-cap, no dead-end hint) — the reviewers' bug", () => {
    const { el } = open(make("issue", 15, { group: "search" }));
    expect(rows(el())).toBe(15);
    expect(more(el())).toBeNull();
    expect(hints(el())).toEqual([]);
  });
});

describe("mention menu — keyboard reaches the overflow expander", () => {
  it("ArrowUp wraps onto 'show more', Enter expands it", () => {
    const { menu, el } = open(make("agent", 15));
    menu.onKeyDown({ event: new KeyboardEvent("keydown", { key: "ArrowUp" }) });
    menu.onKeyDown({ event: new KeyboardEvent("keydown", { key: "Enter" }) });
    expect(rows(el())).toBe(15);
    expect(more(el())).toBeNull();
  });
});
