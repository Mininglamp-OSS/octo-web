// Dependency-free, keyboard-navigable @-mention popup.
//
// Browse (empty query): candidates grouped by type. Each group shows a few rows,
// then "show more". Experts and expert teams are small sets you pick by browsing,
// so "show more" reveals ALL of them. Members and tasks are large sets, so "show
// more" reveals up to REVEAL_CEILING recent rows and then, if still more exist, a
// "keep typing to search" hint (browsing thousands is pointless — search instead).
//
// Search (typed query): the caller tags items with group:"search"; the popup then
// shows every match (people + tasks) uncapped and keyboard-reachable — no caps or
// hints, since the user is already narrowing by name/title.

export interface LoopMentionItem {
  id: string;
  label: string;
  type: "member" | "agent" | "squad" | "issue" | "all";
  // set by the caller in search mode → uncapped, no per-type grouping for people.
  group?: "search";
  description?: string;
  statusHex?: string;
  statusFilled?: boolean;
  avatarUrl?: string;
  dotColor?: string;
}

export interface MentionMenuLabels {
  users: string;
  issues: string;
  agent: string;
  squad: string;
  members: string;
  showMore: string;
  searchMembersHint: string;
  searchIssuesHint: string;
}

export interface MentionMenuProps {
  items: LoopMentionItem[];
  command: (item: LoopMentionItem) => void;
  clientRect?: (() => DOMRect | null) | null;
}

export interface MentionMenuRenderer {
  onStart: (props: MentionMenuProps) => void;
  onUpdate: (props: MentionMenuProps) => void;
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
  onExit: () => void;
}

const DEFAULT_CAP = 6; // initial rows for members / tasks
const EXPERT_CAP = 10; // initial rows for experts / expert-teams (small, fully browsable)
const REVEAL_CEILING = 50; // most rows a capped section reveals; beyond this, search
// "show more" reveals ALL remaining rows (small, fully browsable sets).
const REVEAL_ALL = new Set(["agent", "squad"]);
// Capped sections: "show more" reveals up to REVEAL_CEILING rows, then this
// "keep typing to search" hint (large sets — browsing thousands is pointless).
const HINT_LABEL: Record<string, keyof MentionMenuLabels> = {
  member: "searchMembersHint",
  issues: "searchIssuesHint",
};
// search / issueSearch (typed-query buckets) carry no cap → shown in full.
const SECTION_ORDER = ["all", "search", "issueSearch", "agent", "squad", "member", "issues"] as const;

interface Section {
  key: string; // all | agent | squad | member | search | issues
  label: string | null; // null = no header row (e.g. the @all entry)
  items: LoopMentionItem[];
}

function itemKey(item: LoopMentionItem): string {
  return `${item.type}:${item.id}`;
}

// Leading glyph for the "show more" row: sits in the avatar column so the label
// aligns with candidate names and reads as "expand", not an orphaned entry.
function chevronDown(): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M4 6l4 4 4-4");
  svg.appendChild(path);
  return svg;
}

// Keyboard-navigable entries: candidate rows plus the "show more" expanders (the
// search hint is not navigable — it's informational). Arrow keys reach overflow
// candidates; Enter on an expander opens it.
type NavEntry =
  | { kind: "item"; key: string; item: LoopMentionItem }
  | { kind: "more"; key: string; sectionKey: string };

export function createMentionMenu(
  labels: MentionMenuLabels,
  onPick?: (item: LoopMentionItem) => void,
): MentionMenuRenderer {
  let el: HTMLDivElement | null = null;
  let items: LoopMentionItem[] = [];
  // Pinned by item identity, not row index: "show more" and async updates
  // reorder/grow the list, so an index would point at a moving row.
  let selectedKey: string | null = null;
  // section key → rows currently revealed (grows on "show more"); absent → DEFAULT_CAP.
  const shown = new Map<string, number>();
  let cmd: ((item: LoopMentionItem) => void) | null = null;
  let closed = false;
  let onOutside: ((e: MouseEvent) => void) | null = null;
  // Set by paint(): the flat keyboard-navigable entries (rows + "show more") in
  // render order + their buttons, so nav toggles a class instead of rebuilding.
  let curNav: NavEntry[] = [];
  const rowByKey = new Map<string, HTMLButtonElement>();

  function sectionKeyOf(item: LoopMentionItem): string {
    if (item.type === "all") return "all";
    if (item.group === "search") return item.type === "issue" ? "issueSearch" : "search";
    return item.type === "issue" ? "issues" : item.type;
  }

  function isCapped(key: string): boolean {
    return REVEAL_ALL.has(key) || key in HINT_LABEL;
  }

  // Initial rows shown before "show more" (larger for the small expert sets).
  function initialCap(key: string): number {
    return REVEAL_ALL.has(key) ? EXPERT_CAP : DEFAULT_CAP;
  }

  // How many rows "show more" ultimately reveals for a section.
  function revealTarget(key: string, total: number): number {
    return REVEAL_ALL.has(key) ? total : Math.min(REVEAL_CEILING, total);
  }

  function buildSections(): Section[] {
    const buckets = new Map<string, LoopMentionItem[]>();
    for (const it of items) {
      const k = sectionKeyOf(it);
      const b = buckets.get(k);
      if (b) b.push(it);
      else buckets.set(k, [it]);
    }
    const label: Record<string, string | null> = {
      all: null,
      search: labels.users,
      issueSearch: labels.issues,
      agent: labels.agent,
      squad: labels.squad,
      member: labels.members,
      issues: labels.issues,
    };
    return SECTION_ORDER.filter((k) => buckets.has(k)).map((k) => ({
      key: k,
      label: label[k] ?? null,
      items: buckets.get(k)!,
    }));
  }

  function shownCount(sec: Section): number {
    return Math.min(shown.get(sec.key) ?? initialCap(sec.key), sec.items.length);
  }

  function visibleRows(sec: Section): LoopMentionItem[] {
    if (!isCapped(sec.key)) return sec.items;
    return sec.items.slice(0, shownCount(sec));
  }

  function canRevealMore(sec: Section): boolean {
    return isCapped(sec.key) && shownCount(sec) < revealTarget(sec.key, sec.items.length);
  }

  function selectedIndexIn(nav: NavEntry[]): number {
    if (selectedKey === null) return 0;
    const i = nav.findIndex((e) => e.key === selectedKey);
    return i === -1 ? 0 : i;
  }

  function row(item: LoopMentionItem, selected: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "loop-suggest-item" + (selected ? " is-selected" : "");

    const ava = document.createElement("span");
    ava.className = `loop-suggest-ava loop-suggest-ava--${item.type}`;
    if (item.type === "issue") {
      ava.classList.add("loop-suggest-ava--ring");
      if (item.statusHex) {
        ava.style.color = item.statusHex;
        if (item.statusFilled) ava.style.background = item.statusHex;
      }
    } else if (item.avatarUrl) {
      const img = document.createElement("img");
      img.className = "loop-suggest-ava-img";
      img.src = item.avatarUrl;
      img.alt = "";
      ava.appendChild(img);
    } else {
      ava.textContent = item.type === "all" ? "@" : (item.label[0] ?? "?").toUpperCase();
    }
    if (item.dotColor) {
      const dot = document.createElement("i");
      dot.className = "loop-suggest-dot";
      dot.style.background = item.dotColor;
      ava.appendChild(dot);
    }
    btn.appendChild(ava);

    const text = document.createElement("span");
    text.className = "loop-suggest-text";
    const name = document.createElement("span");
    name.className = "loop-suggest-name";
    name.textContent = item.label;
    text.appendChild(name);
    if (item.description) {
      const desc = document.createElement("span");
      desc.className = "loop-suggest-desc";
      desc.textContent = item.description;
      text.appendChild(desc);
    }
    btn.appendChild(text);

    if (item.type === "agent" || item.type === "squad") {
      const badge = document.createElement("span");
      badge.className = "loop-suggest-badge";
      badge.textContent = item.type === "agent" ? labels.agent : labels.squad;
      btn.appendChild(badge);
    }

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      select(item);
    });
    return btn;
  }

  function select(item: LoopMentionItem) {
    onPick?.(item);
    cmd?.(item);
  }

  function expandSection(sectionKey: string) {
    const sec = buildSections().find((s) => s.key === sectionKey);
    if (!sec || !isCapped(sectionKey)) return;
    const before = shownCount(sec);
    shown.set(sectionKey, revealTarget(sectionKey, sec.items.length));
    // land the highlight on the first newly-revealed row.
    const revealed = sec.items[before];
    if (revealed) selectedKey = itemKey(revealed);
    paint();
  }

  function activate(entry: NavEntry | undefined) {
    if (!entry) return;
    if (entry.kind === "item") select(entry.item);
    else expandSection(entry.sectionKey);
  }

  function paint() {
    if (!el) return;
    el.innerHTML = "";
    rowByKey.clear();
    const rendered = buildSections().map((sec) => ({ sec, rows: visibleRows(sec) }));
    const nav: NavEntry[] = [];
    for (const { sec, rows } of rendered) {
      for (const item of rows) nav.push({ kind: "item", key: itemKey(item), item });
      if (canRevealMore(sec)) {
        nav.push({ kind: "more", key: `more:${sec.key}`, sectionKey: sec.key });
      }
    }
    curNav = nav;
    const selKey = nav[selectedIndexIn(nav)]?.key;
    let selectedBtn: HTMLButtonElement | null = null;
    for (const { sec, rows } of rendered) {
      if (sec.label) {
        const header = document.createElement("div");
        header.className = "loop-suggest-group";
        header.textContent = sec.label;
        el.appendChild(header);
      }
      for (const item of rows) {
        const key = itemKey(item);
        const btn = row(item, key === selKey);
        rowByKey.set(key, btn);
        if (key === selKey) selectedBtn = btn;
        el.appendChild(btn);
      }
      if (canRevealMore(sec)) {
        const key = `more:${sec.key}`;
        const reveal = revealTarget(sec.key, sec.items.length) - rows.length;
        const more = document.createElement("button");
        more.type = "button";
        more.className = "loop-suggest-more" + (key === selKey ? " is-selected" : "");
        const chevron = document.createElement("span");
        chevron.className = "loop-suggest-more__chevron";
        chevron.appendChild(chevronDown());
        more.appendChild(chevron);
        const label = document.createElement("span");
        label.textContent = `${labels.showMore} (${reveal})`;
        more.appendChild(label);
        more.addEventListener("mousedown", (e) => {
          e.preventDefault();
          expandSection(sec.key);
        });
        rowByKey.set(key, more);
        if (key === selKey) selectedBtn = more;
        el.appendChild(more);
      } else if (sec.key in HINT_LABEL && sec.items.length > rows.length) {
        // Reached the reveal ceiling but more exist → only reachable via search.
        const hint = document.createElement("div");
        hint.className = "loop-suggest-hint";
        hint.textContent = labels[HINT_LABEL[sec.key]!];
        el.appendChild(hint);
      }
    }
    // Only scroll once the popup is anchored (position() set an inline top); otherwise
    // scrollIntoView on a body-mounted absolute element could nudge the whole page.
    if (el.style.top) selectedBtn?.scrollIntoView({ block: "nearest" });
  }

  // Arrow nav just moves the highlight class — no DOM rebuild (paint() only
  // runs when the item set or expansion actually changes).
  function moveSelection(delta: number) {
    if (curNav.length === 0) return;
    const curIdx = selectedIndexIn(curNav);
    const next = (curIdx + delta + curNav.length) % curNav.length;
    rowByKey.get(curNav[curIdx]!.key)?.classList.remove("is-selected");
    selectedKey = curNav[next]!.key;
    const btn = rowByKey.get(selectedKey);
    btn?.classList.add("is-selected");
    if (el?.style.top) btn?.scrollIntoView({ block: "nearest" });
  }

  function position(rect: DOMRect | null | undefined) {
    if (!el || !rect) return;
    el.style.position = "absolute";
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.bottom + 4}px`;
  }

  function destroy() {
    if (onOutside) {
      document.removeEventListener("mousedown", onOutside, true);
      onOutside = null;
    }
    el?.remove();
    el = null;
  }

  function mount() {
    if (el) return;
    el = document.createElement("div");
    el.className = "loop-mention-menu";
    document.body.appendChild(el);
    onOutside = (e) => {
      if (el && (!(e.target instanceof Node) || !el.contains(e.target))) {
        closed = true;
        destroy();
      }
    };
    document.addEventListener("mousedown", onOutside, true);
  }

  function sync(clientRect?: (() => DOMRect | null) | null) {
    if (closed) return;
    if (items.length === 0) {
      destroy();
      return;
    }
    mount();
    // Position at the caret BEFORE paint: paint()'s scrollIntoView must run with
    // the popup already anchored in-viewport, else it scrolls the whole page.
    position(clientRect?.());
    paint();
  }

  return {
    onStart: (props) => {
      items = props.items;
      selectedKey = null;
      shown.clear();
      cmd = props.command;
      closed = false;
      sync(props.clientRect);
    },
    onUpdate: (props) => {
      items = props.items;
      cmd = props.command;
      // Query changed → fresh result set; reset reveal counts so a
      // browse→search→browse round-trip doesn't leave a group wrongly expanded.
      shown.clear();
      sync(props.clientRect);
    },
    onKeyDown: (props) => {
      const { key } = props.event;
      if (key === "Escape") {
        if (!el) return false;
        closed = true;
        destroy();
        return true;
      }
      if (!items.length || !el) return false;
      if (key === "ArrowDown") {
        moveSelection(1);
        return true;
      }
      if (key === "ArrowUp") {
        moveSelection(-1);
        return true;
      }
      if (key === "Enter") {
        activate(curNav[selectedIndexIn(curNav)]);
        return true;
      }
      return false;
    },
    onExit: () => {
      closed = false;
      shown.clear();
      destroy();
    },
  };
}
